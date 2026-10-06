# A new product in one run, and a full-stack product on one API contract

Two features, built on top of each other:

1. **Greenfield in one run.** `factory start` on an empty Node repo reads the request, writes the spec, draws the design
   on the factory's shadcn kit, and builds the web app. No separate design run.
2. **Full stack on one contract.** A web app (Next.js) and an API (.NET 9 + SQLite) in two repos, both held to one
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

## 3. `factory fullstack`: one request, two repos

```
factory fullstack start --name clinic --file intent.md --dir ~/code --max-cost 10
#   answer the web run's cards as usual (factory answer / factory approve / factory resume)
factory fullstack next clinic --max-cost 6       # once the web plan is approved
#   answer the API run's plan card; resume the web run if it stopped
factory fullstack up clinic                      # once both runs are delivered
docker compose -f ~/code/clinic-run/docker-compose.yml up
```

| Command | What it does | Code |
|---|---|---|
| `start` | Makes `<name>-web` (empty) and `<name>-api` (the skeleton in `src/fullstack/skeleton.ts`: .NET 9, SQLite, one test, CORS for `localhost:3000`), writes both project configs, starts the web run. | `setUpProduct` |
| `next` | Copies the contract approved with the web plan into the API repo's base branch and starts the API run. Before the plan is approved it only says so. Later it reports where each run is. | `approvedContract`, `handOverContract`, `apiRequest` |
| `up` | Checks out the two delivered branches side by side and writes a compose file: the API on port 5080, the web app on 3000. | `writeRunFiles` |

State is kept in `~/.factory/fullstack/<name>.json`. Both project configs name the same SDK image, so the two runs
share one coding image (`factory-agent:dotnet8`, rebuilt from the project's SDK image) and may overlap.

It is two ordinary runs underneath: two specs, two ledgers, two branches, and two PRs if the repos have a GitHub
remote and a token.

### In `factory ui`
New run, Greenfield, then "Web app + API" is `start`: a name, the folder for both repos, the request (typed or a
dropped `.md`) and the web run's max cost. Products lists each product; its page shows both runs side by side, the
contract once the web plan is approved (with its operations, `GET /orders`), a Start API run button (`next`, with its
own max cost) and, once both runs are delivered, Write run files (`up`: it writes the compose file and shows the
command; it starts nothing). Each run's cards are decided on its own run page: questions, the design card and the
plan card, each with a typed name and the card's hash, recorded as "<name> (via web)". Approving the web run's plan
there approves the contract, as `factory approve` does. Waivers and cost limits stay in the terminal. Code:
`src/ui/fullstack.ts`, routes under `/api/fullstack` in `src/ui/server.ts`.

## Tests
| What | Where |
|---|---|
| The contract reader, the completeness check and the diff, against a document a real .NET 9 build wrote | `src/gates/contract.test.ts`, `src/gates/fixtures/dotnet9-built.json` |
| Web side with a fake lab: the contract on the card, the generated client, the lock, a tampering agent stopped, an incomplete contract sent back | `src/stages/greenfield.test.ts` ("held to an API contract") |
| API side with a fake lab: a match delivers, a renamed field is caught, a build with no document fails, no design is drawn | `src/stages/e2e.test.ts` ("a .NET API held to a locked API contract") |
| One-run greenfield with a fake lab; a test writer that adds a package is stopped | `src/stages/greenfield.test.ts`, `src/stages/modes.test.ts` |
| The wrapper: setup, hand-over, guards | `src/fullstack/product.test.ts` |
| The page: start, next and up, and their refusals | `src/ui/ui.test.ts` ("a web app + API product") |
| The whole thing on real containers with scripted models | [`dryrun/`](../dryrun/README.md) |

## Limits
- No real model has run the contract path. Everything is proven with scripted models.
- A product cannot start from an approved estimate yet: one estimate would feed two runs, so its tasks, budget and
  spec would have to be split per side, and the contract checked against its backend tasks. A greenfield run refuses
  an estimate that prices its own API and points here.
- The API skeleton is fixed (.NET 9 minimal API, SQLite). The factory refuses SQL Server; Postgres would use the
  project's `database` block and is not wired into the skeleton.
- The client's API address is a fixed string from the project config.
- The first task of a fresh web app has `package.json` in its file scope (set by the scaffold in `src/design/`), so
  that implementer can add a package without a check.
- The scaffold writes no page at `/`.
- Nothing checks the screens against the live API; the screens' tests run against the generated handlers.
