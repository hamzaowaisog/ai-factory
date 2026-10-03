# Estimate consistency: research and where we stand

Question: for the same requirement, how do we make the estimate come out the same, or close enough to trust?

This is research plus a read of the current code. Sections 1 to 8 are the research; **only the cross-run cache (section 9) is built**. Nothing was trained or benchmarked; external claims come from search results and are marked as such.

## 1. Where variation comes from

| Source | In this pipeline today |
|---|---|
| Model sampling | Every think step (clarify, specify, breakdown, estimate) is a live model call. Two runs on the same text can differ. |
| Input drift | Clarify answers, spec wording and the repo survey all feed the breakdown. A small change upstream changes the tasks, then the hours. |
| Model/prompt change | A model upgrade or prompt template edit changes outputs with no change to the requirement. |
| Arithmetic | None. `hours.ts` computes every sum in code; the model only proposes anchors and ratios. |

So the maths is already deterministic. The variation is in what the model proposes.

## 2. What exists in the code now

- **Per-run step cache.** Steps are keyed by `hashJson` of their inputs (`breakdown` and `estimate` build a `cacheKey` from spec, answers, survey and design). Within one run, unchanged inputs do not re-run.
- **That cache is not cross-run.** `waivedCache` (`src/stages/waiver.ts`) only replays a stored output when a lead waived a gate for that exact key. A fresh run of the same requirement calls the model again.
- **Independent estimators.** `estimate` can run `n` independent proposals (`estimate.ts`); `hours.ts` merges them and flags a spread wider than the tolerance. This measures disagreement; it does not remove it.
- **Lead edits do not call the model.** Edits re-assemble from earlier proposals (`applyEdits`).
- **Revisions.** `--revises` / `--from-run` seed spec, answers and breakdown from an approved run, so untouched work keeps its numbers. Only changed work is re-estimated.
- **No sampling control.** `src/runners/api.ts` sets `model`, `max_tokens`, `effort`, tools and caching. It sets no temperature, top_p or seed.

## 3. Finding: temperature 0 is not available

I suggested "temperature 0 on the estimate steps". That was wrong for current models.

Search results report that `temperature`, `top_p` and `top_k` are deprecated on Claude Opus 4.7 and later, including the Claude 5 family, and return HTTP 400 when set to a non-default value. They still work on Claude 4.6 and older and on Haiku 4.5. Sources:

- [Claude Platform docs: model deprecations](https://platform.claude.com/docs/en/about-claude/model-deprecations)
- [Migrating to Claude Opus 4.8? Drop the temperature parameter](https://conselara.dev/notes/opus-4-8-temperature-deprecated/)
- [verdikta-arbiter issue: temperature deprecated for Claude 5 / Opus 4.7+](https://github.com/verdikta/verdikta-arbiter/issues/51)

Consequences:

- We cannot reduce sampling variance with a parameter on the models we route to. Do not add `temperature` without a per-model guard, or requests will fail.
- Repeatability therefore has to come from structure (cache, aggregation, seeding from approved work), not from model settings.
- To confirm: which models the `estimate` and `breakdown` routes resolve to in a real config. If a route uses Haiku 4.5 or an older model, temperature would be accepted there, but I would not build on that.

## 4. Options

### A. Cross-run cache (exact repeatability)

Key: hash of normalised requirements, clarify answers, ground survey, settings, design, model ids, prompt template versions (`templateVersion` already exists per step), estimator count.
Hit: reuse the stored breakdown and proposals; run the maths again (cheap, deterministic).
Miss: run as today, store under the key.

- Gives: same inputs, same estimate, at no model cost.
- Does not give: equal numbers for reworded requirements, or accuracy.
- Risks: a stale cache after a prompt or model change (mitigated by putting versions in the key); a cached bad number persists (mitigated by `--fresh` and by calibration).
- Open design points: where it lives (ledger-wide store vs per project), whether a lead can see "reused from run X" on the approval card (they should), and how normalisation treats whitespace and ordering.

### B. Aggregate several samples (reduce variance without temperature)

Run `n` independent estimators and take a robust combination (median per task). The repo already merges estimators; the research summary below supports majority or median aggregation improving agreement with a reference, though those results are for scoring tasks, not effort estimation.

- Gives: lower variance than a single call, and the existing spread flag shows when the model is unsure.
- Costs: `n` times the estimate-step spend.
- Note: the cache (A) and aggregation (B) combine well: aggregate once, cache the result.

### C. Anchor on approved work

Few-shot examples of past approved breakdowns in the prompt, and seeding from `--revises`. Raises consistency between similar requirements, and costs nothing at run time. Depends on having approved estimates to draw from.

### D. Calibration with actual hours

`factory calibrate` already compares approved estimates with actual spend and, with a hours file, with real hours. This is the route to accuracy, not repeatability. Needs real data from you.

### E. Training or fine-tuning

Not recommended now. No labelled estimate-vs-actual pairs exist, and a model trained on few pairs can look consistent while being wrong. Revisit after D has produced data.

## 5. Evidence from the search

Reported by the search results, not verified by me:

- Agents given identical inputs produced 2.3 to 4.2 distinct action sequences per 10 runs ([How Consistent Are LLM Agents?](https://arxiv.org/pdf/2605.28840)). Multi-step pipelines like ours should expect some run-to-run difference.
- Consistent tasks (few distinct paths) were much more accurate than inconsistent ones ([When Agents Disagree With Themselves](https://arxiv.org/html/2602.11619v2)). This supports using spread as an uncertainty signal, which E-gate spread flagging already does.
- Majority-vote aggregation improved agreement with human judgements in scoring work ([Rating Roulette](https://www.alphaxiv.org/overview/2510.27106v1), [self-consistency summary](https://futureagi.com/glossary/self-consistency/)).

No result I found measures LLM effort estimation for software work specifically. Treat these as directional.

## 6. Recommendation

1. Build A (cross-run cache) with versions in the key, a `--fresh` flag and a "reused from run X" note on the card.
2. Keep B as a setting (`estimators: n`) and use 3 for estimates that will be quoted to a client.
3. Use C and D as data arrives.
4. Do not add temperature. Do not train.

## 7. Before building

- Measure first: run one requirement (`examples/estimate-requirements.md`) 5 to 10 times with the real key and record the spread of total hours. That tells us the real size of the problem and whether B alone is enough. This needs an `ANTHROPIC_API_KEY`, which this environment does not have.
- Decide cache scope (per project or global) and whether a cache hit should still require lead approval (I would say yes).

## 8. Local models trained on our own data

Question raised: use local models with billions of parameters and train them on our data, so the same requirement gives the same estimate.

### What it would give

- **Determinism from the model itself.** Open weights let us use greedy decoding, a fixed seed and a pinned model file. Current hosted Claude models have removed temperature control (section 3), so this is the only route to a deterministic model call. GPU batching can still cause small floating-point differences, so the runtime and hardware also need pinning.
- **Privacy and cost.** Client requirements stay on our machines, and there is no per-call fee after the hardware.
- **Stability.** The model changes only when we change it.

### What it would cost

- **Labelled data we do not have.** Fine-tuning needs many finished projects, each with requirements, the approved breakdown and the real hours. The ledger today holds cost records only (`records.ts`, `cost.ts`). `factory calibrate` can take real hours, but only as a file the team supplies. A few dozen pairs is too few for a large model; it would memorise them.
- **Weaker reading of requirements.** A local model of a few billion to tens of billions of parameters will break down requirements and read a repo less well than a frontier model. The breakdown drives the estimate, so this hurts accuracy. Replacing clarify and specify would make them worse too.
- **Operations.** GPUs, serving, retraining when delivery practice changes, and a held-out test to show it beats the current approach.
- **Consistency is not accuracy.** A fine-tuned model returns the same number every time, and that number can be confidently wrong.

### Recommended shape: a small sizing model, not a local LLM

Keep the hosted model for what needs language understanding: clarify, specify and breakdown. Replace only the part where the model proposes hours anchors and ratios with a small deterministic model trained on our history. This fits the existing rule that code does the maths.

Candidate features, all already computed or countable by the pipeline (`size.ts`, `assemble.ts`): counted units per track, complexity flag share, size band, task type, whether the work touches existing code, repo size and stack, number of screens, number of requirements, uncertainty grade inputs (assumptions, answered questions, critic findings).
Target: actual hours per task class, or per project when task-level hours are unavailable.
Model: gradient-boosted trees or regularised linear regression. These are deterministic, explainable, cheap, and workable on dozens to hundreds of projects. Output a range (quantile regression or residual spread), not a point.
Guard rails: the model's output still passes the existing gates (E1-E7); the lead still approves; the estimate labels itself `calibrated` only when the model was trained on at least a stated number of projects (threshold to be decided from the first data, not guessed now).

### Data to start collecting now

One line per finished project, extending the existing `calibrate` hours file:

```
estimate-run,actual-hours[,track:hours ...]
```

Per-track hours are optional but make the sizing model far more useful. We also need to record, at approval time, the features above, so training does not depend on re-parsing old runs. That is a small addition to the benchmark record.

### Sequence

1. Start collecting actual hours (no code beyond documenting the file format, or an optional per-track extension).
2. Cross-run cache (section 4A) for repeatability in the meantime.
3. After enough projects, fit the small sizing model offline, compare against the current proposals on held-out projects, and adopt it only if it is better.
4. Consider a local LLM for the whole pipeline only if data privacy rules out hosted models. Expect a quality drop and measure it first.

### Still unknown

- How many finished projects exist today with recorded hours.
- Whether client data policy forbids sending requirements to a hosted model (this changes the local-LLM case from optional to required).
- Hardware available for local serving.


## 9. Cross-run cache: what was built

Option A from section 4, in `src/estimate/cache.ts` and `src/stages/think.ts`.

- **Where.** Inside `think()`, so every model step of an estimate run is covered (intake, clarify helpers, specify, merge, critic, breakdown, estimate). Build runs are not cached.
- **Key.** Hash of the rendered briefing (system and user text), images, model, effort, tool list and, for steps that read the repository, the base commit. A step that reads a repository with no known commit is not cached. Prompt template edits change the briefing, so they change the key.
- **Because every step is keyed on its briefing, the whole chain is repeatable.** Same requirements give the same intake, so the same spec, so the same breakdown and proposals. Code then recomputes the totals.
- **Store.** `~/.factory/cache/think/<key>.json`, shared by all runs and projects, written atomically and best effort (a write failure never fails a run). A stored answer is checked against the step's schema on reuse; one that no longer fits is ignored.
- **Reuse is visible** in the run log and as a `cache.hit` trace event naming the run it came from. The step still goes through the gates, and the lead still approves.
- **Skipping it.** `factory estimate --fresh`, or `FACTORY_NO_CACHE=1`. Tests run with the cache off by default.
- **Not covered:** reworded requirements (different key), human clarify answers (they are inputs, not model output; different answers give a different key), and pruning (entries are never deleted; delete the folder to clear it).
- **A rejected answer** is also stored. It is reused and fails the same gate; the retry's briefing then carries the failure text, which is a different key whose answer is also stored. A repeat run therefore costs no model calls at all.

The local sizing model is researched in `docs/estimate-local-model.md`.

## 10. Phase 1: consistent estimates for similar requirements (approved 2026-10-03)

The cache (section 9) makes the same text give the same estimate. Phase 1 is about reworded or similar requirements, which miss the cache. Four things drift today (read from the code):

1. The model invents its anchors and their hours on every run (`ESTIMATE_RULES` in `src/stages/estimate.ts`). Every other task is a ratio of an anchor, so one different anchor moves the whole estimate.
2. Breakdown granularity varies: the same feature can be one task or three.
3. `mergeEstimators` (`src/estimate/hours.ts`) spans the lowest min and highest max of all estimators, so three estimators make the range wider, not steadier.
4. Hands-off assumptions are the model's own recommended answers, so two runs can assume different scope.

Research behind the fix (section 5, and the 2026 search in chat): LLMs rank sizes well and get absolute numbers wrong, and they follow numbers placed in the prompt. So the model classifies and counts; the absolute hours come from a pinned table that code reads.

### What changes

| Step | Change | Fixes |
|---|---|---|
| F | **Consistency suite.** `bench/consistency/`: groups of requirement files that mean the same thing in different words. `npm run bench -- consistency` runs each as a hands-off estimate with the cache off (the design card is approved by `bench`), then reports per group: runs, mean total, coefficient of variation (target 10% or less), task-count range and task-kind mix. `--report <run...>` reports on runs that already exist (no model calls). | Measures 1-4 |
| D | **Median merge.** Each task's range is the median of the estimators' mins and the median of their maxes; the spread flag stays. Three estimators for every band (the estimate step is about 5% of an estimate run's cost). Gate E6 recomputes the median. | 3 |
| C | **Task kinds.** Every breakdown task gets a `kind` from the catalogue (for example `be-crud`, `ui-form`, `qa-e2e`, `ops-setup`), with splitting rules in the prompt (one task per screen per platform, one per resource API, one per integration). New gate E2c checks every task has a known kind that fits its track. Old breakdowns without kinds keep the old sizing path. | 2 |
| A | **Pinned catalogue.** `src/estimate/assets/catalogue.json`, versioned: each kind's hour range for its typical size, a written definition of small / typical / large / very large, and per-stack overrides (default pack, .NET, Next.js; empty until a delivery lead signs the hours off). The catalogue's status is shown on the estimate as "draft" until then. | 1 |
| B | **Counted drivers.** The estimator no longer writes hours. Per task it picks the size step against the kind's written definition and names the counts behind it; for a factory task it also grades how hard the result is to verify and how complete its context is. Code turns that into hours: catalogue range x size step x complexity flag x UI level (from the approved design) x the factory grades. The result is written back in the existing anchor and ratio shape (the first task of each kind is its anchor), so edits, gates E5-E7 and the workbooks are unchanged. | 1 |
| Split | **Long factory tasks.** A factory task above `splitAboveHours` (assumed 16 h, labelled, from the METR time-horizon finding that agent success drops as tasks get longer) or sized very large is marked "split before build" on the card and in the assumptions. | agentic risk |
| E | **Default assumptions table.** `src/estimate/assets/defaults.json`: fixed answers for common unknowns (platform, browsers, roles, languages, sign-in, hosting, environments, notifications, file storage, accessibility, data migration). The clarifier tags a question with a topic id; an unasked question with a known topic is assumed with the table's answer, not the model's. | 4 |

Build order: F, D, C, A+B, Split, E. Prompt template versions go up (breakdown 3, estimate 4), so cached answers from before are not reused.

### Not in Phase 1

Retrieval of approved past tasks and near-match reuse (Phase 2); catalogue calibration from actual hours and measured ACEM retry and context factors (Phase 3).

### Needs from the team

- A delivery lead to sign off the catalogue hours, its factors and the 16 h split threshold (they set every estimate), and the standard answers in `src/estimate/assets/defaults.json`. Signing off means setting `status: "signed-off"` and `signedOffBy` in each file and bumping its version.
- `ANTHROPIC_API_KEY` in `~/.factory/.env` for the suite's live runs. Everything else is built and tested without it.

### Build status

- **F done.** `bench/consistency/` (`cases/`, `report.ts`, `run.ts`, `consistency.test.ts`), `npm run bench -- consistency`. As built: the runner uses the standalone project and settings `stackSource: undecided, noRepo, humanReview: false`; it answers only a design-approval card (`by: bench`) and stops on any other card; a run that did not finish counts as a failed sample, and a group needs at least two finished estimates to pass. The baseline numbers (before D-E) still need a live run with the API key.
- **D done.** `mergeEstimators` (`src/estimate/hours.ts`) takes the median of the mins and of the maxes; the flag rule is unchanged. `estimatorsFor` returns 3 for every band. The estimate records `merge: "median"`; gate E6 (`src/estimate/lint.ts`) then recomputes the exact median. An estimate without the field (made before) is checked by the old widening rule, so `factory verify-evidence` still passes on old runs. The lead estimator's anchors, ratios and reasons are still the ones shown and edited; a lead's edit applies to every estimator's reading, as before.
- **C done.** The catalogue is `src/estimate/assets/catalogue.json` (version `2026-10-03.1`, status **draft**, 25 kinds: backend, UI, QA, design, ops, PM; size factors small 0.6, typical 1, large 1.6, very large 2.5; stacks default, dotnet and nextjs with no factors yet), loaded and checked by `src/estimate/catalogue.ts`. The breakdown prompt lists the kinds (section `task-kinds`) and the rules for splitting work into one kind per task; `BreakdownTask.kind` is optional in the contract so old breakdowns still read. New gate **E2c** (`estimate.e2c-task-kind`, no waiver) fails a task with no kind, an unknown kind, or a kind on a track it does not list. It reads the catalogue's version and kinds from its recorded inputs, not the live file. The breakdown step is template version 3 and its cache key includes the catalogue version. The consistency suite now counts tasks by kind. The hours in the catalogue are not used yet; that is A.
- **A + B done.** When every breakdown task has a kind, the estimator no longer writes hours. Per task it gives a `size` (small, typical, large, very large, read against the kind's written scale) and a `reason` naming what it counted; a factory or joint task also gets `verify` (easy, moderate, hard) and `context` (complete, partial). Code (`src/estimate/catalogue-size.ts`) computes the kind's typical hours on the task's track × size × complexity flag (skipped when the kind `covers` it: be-rules, be-integration, ui-complex) × the screen's UI level × verify × context × any stack factor. All the factors live in the catalogue file, so the lead signs off one file. The result goes into the existing anchor-and-ratio shape: the first task of each kind and track is that group's anchor at ratio 1, and the others are ratios of it (rounded to 3 places). The median merge, gate E6, gates E5 and a lead's edits then work unchanged. The estimate records `catalogue: {version, status, stack}` and each task's `size`. The approval card, the web UI's estimate page ("Task catalogue" fact plus a kind · size tag on each task) and the assumptions all say when the catalogue is a draft. A breakdown without kinds (approved before C) is still sized by anchors and ratios. The estimate step is template version 4, and its cache key includes the catalogue version.
- **Split done.** A factory or joint task sized very large, or above the catalogue's `splitAboveHours` (16 h, a draft figure like the hours), is marked `splitAdvised` on the estimate. Its hours stay as estimated. Human tasks are never marked. The approval card lists these tasks under "Split before the build", the assumptions name them, and the web UI shows a "split before build" pill. The threshold is recorded on the estimate (`catalogue.splitAboveHours`). Anchor-sized estimates have no catalogue, so no split advice.
- **E done.** `src/estimate/assets/defaults.json` (version `2026-10-03.1`, **draft**) lists 19 standard topics: sign-in, roles, admin, languages, colour modes, platforms, browsers, accessibility, notifications, payments, file uploads, reporting, search, data migration, audit, volumes, offline, environments and hosting. Each has a standard answer. `src/estimate/defaults.ts` loads and checks the file. The clarifier prompt lists the topic ids (not the answers) in a `standard-topics` section and tags each question with `topic` when it fits. When a question is not asked (always in a hands-off run), `assumedFrom` takes the table's answer for a known topic: "→ assumed (standard answer, sign-in): …", and the assumption records `fromDefault`. An unknown topic, or none, keeps the model's recommendation. A question a person is asked is unchanged. Both clarify steps are template version 2, and their cache keys include the defaults version.

**Phase 1 is code-complete.** What is left is the live measurement: `npm run bench -- consistency` with the API key, once before sign-off and again after.
