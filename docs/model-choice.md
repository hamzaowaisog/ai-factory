# Choosing the model for each step (2026-10-10)

## Summary

Every model step of a run has its own model. The person who starts a run can choose it, once, at the start. A step nobody chose runs on its default. The choice is saved with the run and never changes afterwards, so a run that stops and resumes keeps its models.

This works the same for all four kinds of run: estimate, design, brownfield and greenfield.

**Status:** built, with tests. Not yet proven in a paid run. The GPT-6 prices are not confirmed (see [Prices](#prices)).

## The rules

- **Asked once, at the start.** No step asks for a model mid-run, and a running run's models cannot be changed.
- **Every step is listed**, helper steps included. The one exception is `critic`: it always runs on Claude Opus 5.5 and cannot be changed, from the form, the command line or the project file.
- **Effort is not a choice.** Each step keeps its own effort.
- **An OpenAI key is needed.** `specify-other` and `review` run on GPT-6 by default. Without `OPENAI_API_KEY` in `~/.factory/.env`, a new run does not start. It never falls back to Claude silently.
- **Coding steps stay on Claude.** `author-tests` and `implement` take Claude Sonnet 5.5 or Claude Opus 5.5 only.
- **`specify-other` must be a GPT-6 model.** It is the second spec draft, and it has to differ from the critic. A Claude pick is refused.
- **Claude Opus 5.5 on `specify` or `merge` is allowed, with a warning.** The critic is the same model, so it would read a spec its own model wrote.

## Where the model of a step comes from

The first of these that says something wins:

| Order | Where | Logged as |
|---|---|---|
| 1 | The step is fixed (`critic`) | `fixed` |
| 2 | A model picked for that step at the start | `pick` |
| 3 | A preset chosen at the start | `pick`, with the preset's name |
| 4 | The project file's `steps:` entry | `config` |
| 5 | A suggested tier (a hook for the planner and the decision layer; nothing suggests one yet) | `recommended`, `plan size` or `rule` |
| 6 | The step's default | `default` |

## Models and tiers

A step names a vendor and a tier, not a model. The tier table turns that into a model:

| Vendor | light | standard | heavy |
|---|---|---|---|
| Anthropic | Claude Haiku 5.5 | Claude Sonnet 5.5 (medium effort) | Claude Opus 5.5 |
| OpenAI | GPT-6 Luna | GPT-6 Sol (medium effort) | GPT-6 Sol (high effort) |

What a person can pick at the start:

| Step group | Models offered |
|---|---|
| thinking, design, review | GPT-6 Luna, GPT-6 Sol, Claude Opus 5.5 |
| coding | Claude Sonnet 5.5, Claude Opus 5.5 |

Claude Haiku 5.5 is not offered by name. A step reaches it through its tier or a preset.

## Defaults

| Step | Group | Default model | Tier |
|---|---|---|---|
| `intake` | thinking | Claude Haiku 5.5 | light |
| `ground` | thinking | Claude Opus 5.5 | heavy |
| `sketches` | thinking | Claude Sonnet 5.5 | standard |
| `sketch-align` | thinking | Claude Haiku 5.5 | light |
| `clarifier` | thinking | Claude Opus 5.5 | heavy |
| `specify` | thinking | Claude Opus 5.5 | heavy |
| `specify-other` | thinking | GPT-6 Sol | heavy |
| `merge` | thinking | Claude Opus 5.5 | heavy |
| `restater` | thinking | Claude Sonnet 5.5 | standard |
| `rt-align` | thinking | Claude Haiku 5.5 | light |
| `critic` | review | Claude Opus 5.5 | fixed |
| `breakdown` | thinking | Claude Opus 5.5 | heavy |
| `estimate` | thinking | Claude Opus 5.5 | heavy |
| `design` | design | Claude Opus 5.5 | heavy |
| `design-triage` | design | Claude Haiku 5.5 | light |
| `design-read` | design | Claude Sonnet 5.5 | standard |
| `plan` | thinking | Claude Opus 5.5 | heavy |
| `author-tests` | coding | Claude Opus 5.5 | heavy |
| `implement` | coding | Claude Sonnet 5.5 | standard |
| `review` | review | GPT-6 Sol | heavy |
| `review-2` | review | Claude Opus 5.5 | heavy |
| `impact-lens` | thinking | Claude Sonnet 5.5 | standard |

An estimate run uses the steps from `intake` to `design-read`. A design run uses the same without `breakdown` and `estimate`. `factory models --mode <mode>` prints the list for one kind of run.

Thinking steps stay on Claude for now. They move to GPT-6 only after one paid proving run shows it holds up.

**The light lane.** A small change takes a shorter path through the run. On that path, `specify` and `author-tests` run on the standard tier when they are on their default. A pick, a preset or a project file entry is kept as it is.

## Presets

A preset sets every step at once. Any step can still be changed by hand after it.

| Preset | What it does |
|---|---|
| Balanced | Every step on its default tier. |
| Economy | Every step one tier down. |
| Quality | Every step one tier up. |

- A step already on the lowest or highest tier stays there.
- `author-tests` never goes below the standard tier. The test writer decides what "done" means for the code.
- `critic` is not touched.
- A step that moves tier takes that tier's effort. A step that stays keeps its own.

Under Economy, `implement` runs on Claude Haiku 5.5. Pick a model for `implement` by hand if that is too low for the work.

## How to choose

### Web screens

The estimate, design and build forms have a **Models** section: a preset, then one row per step. A row left alone shows the model it will get. A row changed by hand is marked "changed".

The Greenfield form has the same section, folded under **Models**. For a product with an API, the choice is kept with the product and the API run uses it too.

### Command line

`factory start`, `factory estimate`, `factory design start` and `factory fullstack start` take the same two options:

```bash
factory start "Add an orders page" --project shop --preset economy --model plan=gpt-6-sol
```

- `--preset economy|balanced|quality` sets every step.
- `--model step=model` sets one step, and wins over the preset. Repeat it for more steps.
- A group name sets every step of that group: `--model coding=claude-opus-5-5`. The groups are `thinking`, `design`, `coding` and `review`. A step's own name wins over a group of the same name (`design` is the step).

To see what a run would use before starting it, at no cost:

```bash
factory models --mode estimate --preset economy --model design=gpt-6-sol
```

It lists every step, its model, where that came from, the model a retry moves to and the models it can be given. It also says whether a run with these choices would start.

### Project file

A project can set its own model for a step, by model or by tier. A person's pick at the start still wins.

```yaml
steps:
  plan: { tier: standard }
  implement: { model: claude-opus-5-5 }
```

- Give a model or a tier, not both.
- A `steps:` entry for `critic` is ignored, and the start check says so.

### Jira watcher

Nobody is there to ask when a ticket starts a run, so the project's `jira:` block says the models. Left out, the runs use the defaults.

```yaml
jira:
  preset: economy
  models: { plan: gpt-6-sol }
```

### Claude Code (MCP)

`factory_start` takes an optional `preset` and an optional `models` map (`{ step: model }`). Left out, the run uses the defaults.

## Retries

A step that fails is retried on the same model first, with more effort. If it keeps failing, it moves one model up its ladder:

| Step | Ladder, weakest first |
|---|---|
| A Claude step | Claude Haiku 5.5, Claude Sonnet 5.5, Claude Opus 5.5 |
| A GPT-6 step | GPT-6 Luna, GPT-6 Sol, Claude Opus 5.5 |
| `specify-other`, `review` | GPT-6 Luna, GPT-6 Sol |
| `author-tests` | Claude Sonnet 5.5, Claude Opus 5.5 |
| `critic` | Claude Opus 5.5 only |

## Reading what a run used

**On the run page.** The **Models** panel shows each step's model, where it came from, and the calls and cost so far. Below it are the retries that moved a step to another model, and every model that answered.

**On the command line:**

```bash
factory models --run <run id>
```

**In the ledger.** Three events carry the models:

| Event | Fields |
|---|---|
| `run.created` | `routes`: every step's model, effort, source, tier and preset. `models`: what the person chose. |
| `step.started` | `route`: the model and effort of this attempt, its source, and `movedUpFrom` when a retry moved it. |
| `usage` | `factory.route`, `factory.route.source`, `factory.route.tier`, `factory.route.preset`, next to the model that answered, its tokens and its cost. |

**Runs from before this change** have no saved routes. They keep the models and the behaviour they began with, so a parked run resumes without running a finished step again. Their page and `factory models --run` say so and list the calls by step.

## Prices

Prices are in `src/runners/pricing.ts`, in USD per million tokens. They are estimates; the cost limits use them.

| Model | Input | Output | Note |
|---|---|---|---|
| Claude Opus 5.5 | $4 | $20 | |
| Claude Sonnet 5.5 | $2 | $10 | |
| Claude Haiku 5.5 | $0.10 | $0.50 | $0.50 / $2.50 for a prompt over 100,000 tokens |
| GPT-6 Sol | $2 | $10 | Not confirmed. $4 / $15 for a prompt over 272,000 tokens |
| GPT-6 Luna | $0.10 | $0.50 | Not confirmed. $0.20 / $0.75 for a prompt over 272,000 tokens |

The GPT-6 prices come from other sites, not OpenAI's own price page. If the bill says otherwise, set the real price in the project file:

```yaml
prices:
  gpt-6-sol: { input: 2, output: 10, cacheRead: 0.2 }
```

## Adding a step

A new step needs one line in `STEPS` in `src/stages/models.ts`:

```ts
"my-step": { runner: "api", group: "thinking", vendor: "anthropic", tier: "standard", effort: "medium" },
```

With that line the step gets a row on every form, the presets, the start checks, `--model my-step=…`, the project file's `steps:` entry and the route log. Nothing else needs to change.

Optional fields:

| Field | Meaning |
|---|---|
| `floor` | The lowest tier a preset or a suggestion may put it on. |
| `fixed` | The model it always runs on. It is never asked. |
| `only` | The vendors that may run it. A pick from another is refused. |
| `warn` | A vendor whose pick is allowed, with a warning at the start. |
| `ladder` | Its own retry ladder, when the vendor's does not fit. |

A new step must not show its own choice screen mid-run. A choice it needs goes on the start form.

A new model needs a line in `MODELS` (with the step groups that offer it) and a price in `src/runners/pricing.ts`.

## Not built yet

- The planner does not yet write a size per coding task that sets its tier.
- The form does not yet show a cost range for the chosen models.
