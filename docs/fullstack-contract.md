# A new product in one run, and a full-stack product on one API contract

Two features, built on top of each other:

1. **Greenfield in one run.** `factory start` on an empty Node repo reads the request, writes the spec, draws the design
   on the factory's shadcn kit, and builds the web app. No separate design run.
2. **Full stack on one contract.** A web app (Next.js) and an API (.NET 9 on PostgreSQL) in two repos, both held to one
   OpenAPI file that is written before any code, approved by a person, and locked the way tests are locked.
   `factory fullstack` runs the two builds as one product.

Status and open work are in [handoff-greenfield-fullstack.md](handoff-greenfield-fullstack.md).

## 1. Greenfield in one run

```
mkdir shop && cd shop && git init -b main
factory init ~/code/shop --name shop          # an empty repo becomes a Node project
factory start --file intent.md --project shop --max-cost 10
```

`createRun` (`src/stages/executor.ts`) makes a plain start a greenfield run when the project is `stack: node` and its
repo is still empty. The step list (`greenfieldSteps` in `src/stages/modes.ts`):

```
discover -> intake -> ground -> clarify -> clarify-2 -> drafts -> merge -> specify
-> design -> design-baseline (you approve the design) -> design-export
-> plan -> approve (you approve the plan) -> stub-commit (the scaffold)
-> author-tests -> implement/TASK-n -> integrate -> accept -> design-fidelity -> design-check -> review -> deliver
```

- The ground step is `newProductGroundStep`: no model call, because an empty repo has nothing to read.
- The design steps are the ones estimates use (`designSteps`), given the kit's component list (`kitComponents()`).
- The scaffold's first `npm install` writes `package-lock.json`; the factory commits it as part of the scaffold, so
  it is not counted as an agent's change.
- `--from-design <design run>` still works: then the head of the run is seeded from that design run instead.

Cards you answer: questions (if any), the design approval, the plan approval.

## 2. The API contract

### Switching it on
A project opts in with a `contract` block in `~/.factory/projects/<name>.yaml`. Projects without it behave exactly
as before.

```yaml
# the web side
stack: node
contract:
  file: contracts/openapi.yaml        # default
  apiUrl: http://localhost:5080       # where the generated client calls the API (default)

# the API side
stack: dotnet
dotnet: { sdkImage: mcr.microsoft.com/dotnet/sdk:9.0, solution: App.sln }
contract:
  file: contracts/openapi.yaml
  built: App.Api/openapi/built.json   # the OpenAPI document the build writes
```

### What happens on the web side (a repo with no contract file yet)
| Step | What the contract adds | Code |
|---|---|---|
| plan | The plan must give `contracts/openapi.yaml` as a stub: OpenAPI 3.0, an `operationId` per operation, an `example` per JSON response. A missing or incomplete contract sends the plan back (`plan-contract`). | `src/stages/spec.ts`, `contractProblems` in `src/gates/contract.ts` |
| approve | The approval card lists the contract's operations. Approving the plan approves the contract. | `approvalCard` in `src/stages/spec.ts` |
| stub-commit | Pinned Orval, MSW and faker join the dev packages; Orval generates `lib/api/client.ts`, `client.schemas.ts` and `client.msw.ts` (test handlers that answer with the contract's examples), offline in the Node lab. All of it is part of the scaffold commit. | `stubCommitStep` in `src/stages/build.ts`, `src/stages/contract.ts` |
| author-tests | The contract, the generated files and `orval.config.cjs` join the test lock. Both agents are told to call the API only through the generated client. | `contractLockFiles`, `contractNote` |
| implement, integrate | The existing `task.lock-set-unchanged` gate (a safety gate) fails if any locked file changed. | `src/gates/predicates.ts` |

### What happens on the API side (the contract file is already in the repo)
| Step | What the contract adds | Code |
|---|---|---|
| intake | The run never draws a design, whatever the product's request says about screens. | `intakeStep` in `src/stages/spec.ts` |
| plan | The planner is given the locked contract and may not rewrite it. | `src/stages/spec.ts` |
| author-tests | The contract joins the test lock. | `src/stages/build.ts` |
| implement | After each task's build, gate `contract.matches` compares the document the build wrote with the contract. A task may leave another task's operation unbuilt; what it has built must match. A mismatch is an ordinary failure on the retry ladder, with the difference as the failure text. | `contractGate` in `src/stages/build.ts` |
| integrate | The same gate, on the whole contract. | same |

`contract.matches` (`src/gates/contract.ts`) is pure code: no model, no network. It compares paths, methods, status
codes and request/response fields (name, type, required), follows `$ref`, and ignores what .NET adds (tags,
descriptions, `format`). The document comes from the lab's kept build of the commit, written at build time by
`Microsoft.Extensions.ApiDescription.Server`.

### Why these choices
- **.NET 9.** On `sdk:9.0` the build writes OpenAPI 3.0 with integers as integers. `sdk:8.0` has no `AddOpenApi`.
  `sdk:10.0` writes integers as `["integer","string"]` and would need a schema transformer.
- **Orval.** It generates the client and the MSW handlers from the contract, so no agent writes them. With
  `useExamples` the handlers return the contract's examples, so tests are repeatable.
- **Opt-in by project config**, not by reading the request, so no other run can change.

## 2b. The data model (tables, keys, relations)

A backend plan gives the database as data, not prose: `dataModel` in the plan lists each table, its columns, the primary
key, unique keys and foreign keys (`src/contracts/artifacts.ts`). Relations are not written; they are read off the foreign
keys (`src/gates/data-model.ts`).

- **When it is asked for.** On a product's first backend build (a contract and no `contracts/data-model.yaml` yet), and on
  any backend change whose impact names stored entities. Never of a web app.
- **Plan checks** (`plan-data-model`, free): no primary key, a foreign key to a table or column that is not there or is
  not a key, a type that differs across a foreign key, an enum with no values, a required column with `onDelete:
  set-null`. A failed check goes back to the planner as a plan patch.
- **Approval card.** A "Data model" section: one line per table and per relation, and the diagram as a Mermaid block.
- **After approval.** The factory writes `contracts/data-model.yaml` in the stub commit; it is locked with the tests, and
  the test writer and every coding session get it in their briefing.
- **Where to see it.** The run's **Data model** tab in `factory ui` (`GET /api/runs/:id/data-model`, `src/ui/erd.ts`) draws
  the diagram from the plan as soon as the plan is written: before the approval, with no wait for the build. Before the
  plan exists it shows the model the repo already has. The product page links to it from the API side, and the pull
  request text carries the same diagram.
- **The built database is held to it** (gate `data-model.matches`, free). After each build the lab starts the app once
  with no network, finds the SQLite file it created, reads its tables, primary keys, unique keys and foreign keys with
  Node's own SQLite (`src/gates/sqlite-schema.ts`), removes the file again, and keeps the result with the build
  (`obj/factory-built-schema.json`). A backend on PostgreSQL (the project's `database`) is read the same way: the lab
  makes an empty database `factory_schema` beside the tests' one, starts the app on it, reads the tables and keys with
  one catalogue query (`src/gates/postgres-schema.ts`), and drops that database before any test runs. A task's check fails on anything wrong in what exists so far (a table the model does
  not have, a foreign key pointing elsewhere, a required column left optional); integrate checks the whole model. A
  column the model does not name passes and is logged. Column types are not compared: SQLite stores too little of them.
  The new-product skeleton creates the database at startup, guarded so the build-time OpenAPI run does not touch it.
  The Data model tab shows the last result ("Built database matches" or "differs").
- **An existing backend starts from its own database.** Discover starts the untouched code once in the lab (beside the
  baseline, no tests more, no model call) and reads the tables, columns, keys and relations it creates: SQLite or
  PostgreSQL, the same two readers the gate uses. Rows are never read. The reading is kept per repo and commit
  (`~/.factory/repos/<project>/schema-<commit>.json`) and as discover's `schema` output.
  - *The planner* is shown the database as it is (`dataModelBrief`: every table in full up to 30 tables; above that the
    tables the change is about and their neighbours in full, the rest by name, key and what they point at). It gives
    only the tables it adds or changes.
  - *The factory* lays those over the database (`mergeDataModel`) and marks each table new, changed or unchanged by
    comparing, not by the plan's word. The model kept in `contracts/data-model.yaml` is the whole database. Where the
    repo already has an approved model, its purposes, column types and enum values are carried over (`withKnown`).
  - *The approval card and the pull request* show the tables added or changed and the tables joined to them
    (`nearModel`), with a count of the rest. *The Data model tab* shows every table, new and changed ones marked, and
    shows the database as it is before the plan exists.
  - *The check after the build* compares every table: a run that loses or alters a table it never named fails.
  - A table the backend already had with no primary key, or another oddity of its own, is not held against the plan.
  - *A plan with no data model* (a fix that changes no stored data, in a repo with no approved model): no model file
    is written and nothing is pasted to the agents (the coder gets one line). The check still runs: every build's
    database is compared with the one discover read, and a table added, lost or re-keyed fails the run with "This plan
    has no data model, so the database must stay as it was". An added column passes, as everywhere.
  - Limits: a plan cannot say "drop this table" (a build that drops one fails the check); a foreign key over several
    columns is not read.
- **A backend that does not create its database on startup** is read through its migrations. When starting the app
  makes no table, the lab runs the backend's migrations on the empty database and reads the result (SQLite or
  PostgreSQL, same readers): `dotnet ef database update` for a repo with EF Core migrations (found by its model
  snapshot; the tool is fetched with the restore, in the EF version the snapshot names), or the project's own
  `migrate` command (project yaml) for anything else. The reading says how the database was made ("made by its EF
  Core migrations"). So a change to stored data in such a repo needs its migration, or the check fails.
- **A backend with neither** (no startup creation, no EF Core migrations, no `migrate` command) gives the read nothing:
  the plan names the tables it touches, and the gate passes with "Not compared". Give such a project a `migrate`
  command to bring it in.

## 2c. The database of a new product: PostgreSQL

Code: `src/fullstack/database.ts`, `src/fullstack/skeleton.ts`, `src/fullstack/product.ts`. No model call.

- **No choice.** Every new product's API is built on PostgreSQL. There is no option, no proposal and no switch.
- **What that means in the repos.** The skeleton uses `Npgsql.EntityFrameworkCore.PostgreSQL` and reads the connection
  string `App` (`ConnectionStrings__App`). The API project has a `database` block, so the lab starts `postgres:16-alpine`
  beside the tests and the booted app and hands them that connection. The API run's request names PostgreSQL. The run
  files (`fullstack up`) have a `db` service with a volume and give the API its connection.
- **Where a person sees it.** The `start` output, the product page (a Database panel) and a line on the web run's plan
  card.
- **A request that names another database** (SQLite, MySQL, SQL Server, MongoDB) is still built on PostgreSQL, and the
  line a person sees says so: "The request names SQLite, which the factory does not set up for a new product."
- **A product started before this** has a SQLite file beside its API and stays on it: its API run is told SQLite and its
  run files have no `db` service. Nothing moves it to PostgreSQL.
- **Existing backends are not affected.** A backend that already keeps its data in a SQLite file is still read and
  checked (§2b): this section is only about what the factory sets up for a new product.

## 3. `factory fullstack`: one request, two repos

```
factory fullstack start --name clinic --file intent.md --dir ~/code --max-cost 10
#   or start from an approved no-repo design or estimate: --from-design <run> / --from-estimate <run> (no request then)
#   --github: both repos also go on GitHub (private, under GITHUB_TOKEN's account); each run then opens a PR into main
#   answer the web run's cards as usual (factory answer / factory approve / factory resume)
factory fullstack next clinic --max-cost 6       # once the web plan is approved
#   answer the API run's plan card; resume the web run if it stopped
factory fullstack up clinic                      # once both runs are delivered
docker compose -f ~/code/clinic-run/docker-compose.yml up
```

| Command | What it does | Code |
|---|---|---|
| `start` | Makes `<name>-web` (empty) and `<name>-api` (the skeleton in `src/fullstack/skeleton.ts`: .NET 9, PostgreSQL (§2c), one test, CORS for `localhost:3000`, an empty `SeedData.cs`), writes both project configs, starts the web run. From an approved design made with no repo, the web run builds that design and skips its design steps; from an approved estimate made with no repo, it is held to the estimate (gates B1-B6). Either brings its own request, and is checked before anything is made. With neither, the web run draws its own design and nothing is estimated. | `productSeed`, `setUpProduct`, `startProduct` |
| `next` | Copies the contract approved with the web plan into the API repo's base branch (and pushes it to GitHub's main, for a product on GitHub) and starts the API run. Before the plan is approved it only says so. Later it reports where each run is. | `approvedContract`, `handOverContract`, `apiRequest` |
| `up` | Checks out the two delivered branches side by side and writes a compose file: the API on port 5080, the web app on 3000, and the product's PostgreSQL server. | `writeRunFiles` |

### Sample data
The API skeleton has `App.Api/SeedData.cs` (empty at first) and `Program.cs` runs it after the tables exist, only when the
setting `Seed:Demo` is true. The API run's request tells the run to write its sample rows there (a few per table, from the
contract's examples, added only to an empty table). The run files and the page's start set `Seed__Demo=true`; the tests and
the lab never do, so they start on an empty database. Nothing in a run checks that the file was filled: the page shows it
after a start, as the rows each of the contract's lists returns. A product delivered before this has no such file and
starts as its run left it. Code: `apiSeed`, `SEED_SETTING` in `src/fullstack/skeleton.ts`, `apiRequest`.

### Starting it on this machine
On a product's page, once both runs are delivered, **Start the product** writes the run files and starts three containers
with the container CLI itself (the factory's setup has no compose): the database, the API with its sample rows, and the web
app. No model and no cost. The first start builds both apps, which takes minutes; the page shows the step, then each app's
address, the containers and the rows each list returns. **Stop it** removes the containers; the database keeps its rows in
a volume. Code: `src/fullstack/apps.ts`; routes `GET /api/fullstack/:name/apps`, `POST .../apps/start`, `POST .../apps/down`.

- Ports are published on 127.0.0.1 only. The web app runs in the API's network, so `localhost:5080` reaches the API from
  the web app's server as well as from the browser (the compose file does not do this).
- **Port 3000 taken:** the web app goes on the next free port (3001 to 3009) and the API is told its address
  (`Cors__Origin`, read by the skeleton's `Program.cs`). An API delivered before that setting lets in only 3000, so its
  start is refused with the reason.
- **Port 5080 taken:** refused. The web app's generated client has `http://localhost:5080` written into it, a locked file.
- One product at a time: every product's API is on 5080.
- It is a page button only; `factory fullstack up` is unchanged.

State is kept in `~/.factory/fullstack/<name>.json`. Both project configs name the same SDK image, so the two runs
share one coding image (`factory-agent:dotnet8`, rebuilt from the project's SDK image) and may overlap.

It is two ordinary runs underneath: two specs, two ledgers, two branches, and two PRs if the repos have a GitHub
remote and a token.

### On GitHub
With `--github` (on the page: "Put it on GitHub", on by default when `GITHUB_TOKEN` is set), `start` first asks GitHub
for the token's account and checks that `<name>-web` and `<name>-api` are free there, before anything is made. Then
it makes both repos as above, creates a private GitHub repo for each under that account, pushes `main`, and writes a
`forge` block into each project config (`pullBase: true`). From then on each run is an ordinary GitHub delivery: it
pushes its own branch (`factory/<run>`) and opens a PR into `main`, first as a draft with the factory's review on it,
then ready. Before each run, `pullBase` brings the local `main` up to GitHub's (a fast-forward), so a request made
after a PR was merged starts from what was merged; a local `main` with commits GitHub lacks is refused. If GitHub
refuses a repo, nothing is kept on this machine and the error names any repo already made there. The web app alone
(the client's backend) works the same with one repo. Code: `src/forge/repos.ts`; tests: `src/forge/repos.test.ts`,
against a GitHub fake on 127.0.0.1 (`src/forge/testutil.ts`).

The token goes in `~/.factory/.env` as `GITHUB_TOKEN`. It must be allowed to create repos: a fine-grained token with
All repositories and Administration, Contents and Pull requests set to Read and write, or a classic token with `repo`.

### In `factory ui`
New run, Greenfield is `start` (Backend: "Build its API too", the default): a name, the folder for both repos, Start
from (nothing, an approved no-repo design or an approved no-repo estimate), the request when nothing is picked (typed or
a dropped `.md`) and the web run's max cost. "The client provides it" on the same form starts a web app alone in one
new repo instead (a greenfield run, no API run). Products lists each product; its page shows both runs side by side, the
contract once the web plan is approved (with its operations, `GET /orders`), a Start API run button (`next`, with its
own max cost) and, once both runs are delivered, Start the product (below) and Write run files (`up`: it writes the compose file and shows the
command; it starts nothing). Each run's cards are decided on its own run page: questions, the design card and the
plan card, each with a typed name and the card's hash, recorded as "<name> (via web)". Approving the web run's plan
there approves the contract, as `factory approve` does. A limit card is raised one step (or the run stopped) on the run page; gate waivers stay in the terminal. Code:
`src/ui/fullstack.ts`, routes under `/api/fullstack` in `src/ui/server.ts`.

## Tests
| What | Where |
|---|---|
| The contract reader, the completeness check and the diff, against a document a real .NET 9 build wrote | `src/gates/contract.test.ts`, `src/gates/fixtures/dotnet9-built.json` |
| Web side with a fake lab: the contract on the card, the generated client, the lock, a tampering agent stopped, an incomplete contract sent back | `src/stages/greenfield.test.ts` ("held to an API contract") |
| API side with a fake lab: a match delivers, a renamed field is caught, a build with no document fails, no design is drawn | `src/stages/e2e.test.ts` ("a .NET API held to a locked API contract") |
| One-run greenfield with a fake lab; a test writer that adds a package is stopped | `src/stages/greenfield.test.ts`, `src/stages/modes.test.ts` |
| The wrapper: setup, hand-over, guards | `src/fullstack/product.test.ts` |
| The page: start (from a request, an approved design or an approved estimate), next and up, and their refusals | `src/ui/ui.test.ts` ("a web app + API product") |
| The whole thing on real containers with scripted models | [`dryrun/`](../dryrun/README.md) |

## Limits
- No real model has run the contract path. Everything is proven with scripted models.
- A product started from an approved estimate holds only the web run to it (scope, budget, screens). The API run
  builds the contract the web plan wrote and a person approved; it is not held to the estimate's backend tasks or
  budget, and the contract is not checked against those tasks. Splitting one estimate across two runs is not built.
  An estimate that prices a phone app is refused.
- The API skeleton is fixed (.NET 9 minimal API) on PostgreSQL (§2c). The factory refuses SQL Server.
- The client's API address is a fixed string from the project config.
- On GitHub, a later request on the API repo is a new run with its own branch and PR. A later request on the web repo
  is refused once its first PR is merged: the factory builds a Node app only into an empty repo (PR #17 review, item 5).
- Repos go under the token's own account; an organisation is not offered.
- The first task of a fresh web app has `package.json` in its file scope (set by the scaffold in `src/design/`), so
  that implementer can add a package without a check.
- The scaffold writes no page at `/`.
- Nothing checks the screens against the live API; the screens' tests run against the generated handlers.
