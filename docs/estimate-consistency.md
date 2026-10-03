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
- Decide cache scope (per project or global) and whether a cache hit should still require lead approval (I would say yes; superseded: the factory approves at E7 since 2026-10-03).

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
Guard rails: the model's output still passes the existing gates (E1-E7); the estimate is still approved at E7 (by the factory since 2026-10-03); the estimate labels itself `calibrated` only when the model was trained on at least a stated number of projects (threshold to be decided from the first data, not guessed now).

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

All built since: the Phase 2 decision log and actuals (section 11), approved past tasks as references (section 12), the catalogue's status from evidence (section 13), and Phase 3, where the catalogue tunes its factors and hours from builds and real project hours (section 14).

### Needs from the team

- ~~A delivery lead to sign off the catalogue and the standard answers.~~ Superseded on 2026-10-03: the flow is human-free and nobody signs these files off. The catalogue's status comes from evidence, and the standard answers are listed on every estimate as its assumptions (section 13).
- `ANTHROPIC_API_KEY` in `~/.factory/.env` for the suite's live runs. Everything else is built and tested without it.

### Build status

- **F done.** `bench/consistency/` (`cases/`, `report.ts`, `run.ts`, `consistency.test.ts`), `npm run bench -- consistency`. As built: the runner uses the standalone project and settings `stackSource: undecided, noRepo, humanReview: false`; it answers only a design-approval card (`by: bench`) and stops on any other card; a run that did not finish counts as a failed sample, and a group needs at least two finished estimates to pass. The baseline numbers (before D-E) still need a live run with the API key.
- **D done.** `mergeEstimators` (`src/estimate/hours.ts`) takes the median of the mins and of the maxes; the flag rule is unchanged. `estimatorsFor` returns 3 for every band. The estimate records `merge: "median"`; gate E6 (`src/estimate/lint.ts`) then recomputes the exact median. An estimate without the field (made before) is checked by the old widening rule, so `factory verify-evidence` still passes on old runs. The lead estimator's anchors, ratios and reasons are still the ones shown and edited; a lead's edit applies to every estimator's reading, as before.
- **C done.** The catalogue is `src/estimate/assets/catalogue.json` (version `2026-10-03.1`, 25 kinds; labelled status **draft** until section 13 replaced that with a status computed from evidence, and section 14 adds tuned versions; backend, UI, QA, design, ops, PM; size factors small 0.6, typical 1, large 1.6, very large 2.5; stacks default, dotnet and nextjs with no factors yet), loaded and checked by `src/estimate/catalogue.ts`. The breakdown prompt lists the kinds (section `task-kinds`) and the rules for splitting work into one kind per task; `BreakdownTask.kind` is optional in the contract so old breakdowns still read. New gate **E2c** (`estimate.e2c-task-kind`, no waiver) fails a task with no kind, an unknown kind, or a kind on a track it does not list. It reads the catalogue's version and kinds from its recorded inputs, not the live file. The breakdown step is template version 3 and its cache key includes the catalogue version. The consistency suite now counts tasks by kind. The hours in the catalogue are not used yet; that is A.
- **A + B done.** When every breakdown task has a kind, the estimator no longer writes hours. Per task it gives a `size` (small, typical, large, very large, read against the kind's written scale) and a `reason` naming what it counted; a factory or joint task also gets `verify` (easy, moderate, hard) and `context` (complete, partial). Code (`src/estimate/catalogue-size.ts`) computes the kind's typical hours on the task's track × size × complexity flag (skipped when the kind `covers` it: be-rules, be-integration, ui-complex) × the screen's UI level × verify × context × any stack factor. All the factors live in the catalogue file (no one signs it off since section 13; the factory tunes it, section 14). The result goes into the existing anchor-and-ratio shape: the first task of each kind and track is that group's anchor at ratio 1, and the others are ratios of it (rounded to 3 places). The median merge, gate E6, gates E5 and a lead's edits then work unchanged. The estimate records `catalogue: {version, status, stack}` and each task's `size`. The approval card and the web UI's estimate page ("Task catalogue" fact plus a kind · size tag on each task) show the catalogue's status; since section 13 the assumptions (the client's copy) no longer do. A breakdown without kinds (approved before C) is still sized by anchors and ratios. The estimate step is template version 4, and its cache key includes the catalogue version.
- **Split done.** A factory or joint task sized very large, or above the catalogue's `splitAboveHours` (16 h, a draft figure like the hours), is marked `splitAdvised` on the estimate. Its hours stay as estimated. Human tasks are never marked. The approval card lists these tasks under "Split before the build", the assumptions name them, and the web UI shows a "split before build" pill. The threshold is recorded on the estimate (`catalogue.splitAboveHours`). Anchor-sized estimates have no catalogue, so no split advice.
- **E done.** `src/estimate/assets/defaults.json` (version `2026-10-03.1`; no sign-off since section 13) lists 19 standard topics: sign-in, roles, admin, languages, colour modes, platforms, browsers, accessibility, notifications, payments, file uploads, reporting, search, data migration, audit, volumes, offline, environments and hosting. Each has a standard answer. `src/estimate/defaults.ts` loads and checks the file. The clarifier prompt lists the topic ids (not the answers) in a `standard-topics` section and tags each question with `topic` when it fits. When a question is not asked (always in a hands-off run), `assumedFrom` takes the table's answer for a known topic: "→ assumed (standard answer, sign-in): …" (plain "→ assumed: …" since section 13, the topic kept in `fromDefault`), and the assumption records `fromDefault`. An unknown topic, or none, keeps the model's recommendation. A question a person is asked is unchanged. Both clarify steps are template version 2, and their cache keys include the defaults version.

**Phase 1 is code-complete.** What is left is the live measurement: `npm run bench -- consistency` with the API key, once now and again after the catalogue has measured or tuned itself (sections 13 and 14).

## 11. Phase 2 (first part): decision log and actuals, as built

Approved in chat on 2026-10-03. The goal is to collect the evidence needed to try Jev (TypeSafe AI "System One", the Decider's second backend, `docs/design/core-design.md` §10a-2) against the model later. Nothing here changes an estimate's figures. The other Phase 2 item, approved past tasks as references, is section 12.

- **Decision log.** Each catalogue-sized estimate writes a named output `decisions` on the estimate step (`src/estimate/decisions.ts`, `sizeDecisions`). There is one record per task per question:
  - `size` for every task;
  - `verify` and `context` for factory and joint tasks.

  Each record uses the Decider's shape (`docs/design/contracts.md` §4): `question`, `choice`, `backend: "llm"`, `features` and `confidence`. Other fields:
  - The choice is the lead estimator's pick, the one the hours are built on.
  - `votes` lists every estimator's pick, lead first.
  - `confidence` is the share of estimators that agreed with the lead. It measures agreement and is not a calibrated probability.

  The features are derived from the breakdown only: kind, track, complexity, executor, the screen's UI level, the counts of items and dependencies, overhead, screen (0/1), band, stack and catalogue version. No titles, item text, reasons or client words are included. That is the rule for sending data to Jev.

  The log also records the catalogue version, stack, band, number of estimators and the count of a lead's `edits`. An edited estimate's hours are no longer the picks' alone.

  An estimate sized by anchors (a breakdown without kinds) writes no log. The step's data carries `decisions: <count>`.

  To support this, each proposal task now keeps the estimator's `verify` and `context` next to `size` (`proposalFromSizes`). Cached proposals from before this change have no grades, so they log size only.
- **Actuals.** `TaskRecord` (`src/estimate/durations.ts`) now carries what the approved estimate predicted for the task, next to the build's `activeMin`, turns, attempts, cost and outcome:
  - `kind` (from the breakdown);
  - `size` and sized `hours` (from the estimate);
  - `catalogue` version.

  Records are still made only for build runs that followed an approved estimate (`estimateRef`).
- **Pairs.** `decisionPairs()` joins each build's task records with the decision log of the estimate the build followed. It reads the log only when the estimate step's latest output is the approved estimate's sha. If the step ran again afterwards, that log no longer matches and pairs nothing.

  Two places show the pairs:
  - `factory calibrate --decisions` prints one JSON line per pair: decision, estimate and build run ids, sized hours, and actual minutes, turns, attempts, cost and outcome. With no pairs yet it says so.
  - `npm run bench -- calibrate` prints a summary per question and choice: tasks, mean agreement and median minutes.
- **Tests.**
  - `src/stages/estimate.test.ts` checks the following:
    - the log's shape, votes and confidence (2 of 3 = 0.67);
    - that human tasks have no grades;
    - that no title or reason leaks into the log;
    - that the anchor path writes no log.
  - `src/estimate/durations.test.ts` builds an estimate run and a build run, then checks the predicted fields on the task record, the three pairs, the summary, and that a re-run estimate pairs nothing.

**How the Jev comparison would run later.** Once enough builds have followed catalogue-sized estimates, export the pairs with `factory calibrate --decisions`. Then ask Jev for the same questions from the same `features`, and compare both against actual minutes and attempts on held-out runs. Switch the Decider's backend only if Jev is measurably better. Until then the backend stays `llm` and no data leaves the machine.

## 12. Phase 2 (second part): approved past tasks as references, as built

Approved in chat on 2026-10-03, with one rule from the user: estimates are approved by the factory, not a lead, so the flow is human-free. An estimate therefore counts as approved when its approve-estimate step passed. In a hands-off run that means the factory approved it after gate E7. A reviewed run (the default since the PR #11 review) counts once a person approves it.

- **Finding matches.** `src/estimate/references.ts` does the lookup.
  - `pastTasksOfRun` reads one run's approved estimate: its approval, then the estimate, then the breakdown. It returns each task's kind, track, complexity, executor, item count, size and hours. The screen's UI level comes from that estimate's decision log (section 11), because the breakdown does not keep it.
  - Runs without an approval, with a non-approved decision, or sized by anchors (no catalogue) give nothing.
  - `loadPastTasks` keeps only tasks on the same catalogue version.
  - `nearMatches` keeps past tasks with the same kind, track, complexity and executor. It ranks them by same UI level first, then the smallest difference in item count, then the newest approval, and returns at most 2 per task.
  - Matching reads categories and counts only. No text is compared.
- **Using them.** When any task has matches, the estimate step adds a reference section, `past-tasks`, to the prompt. It has one line per task: each match's size, hours, whether the UI level is the same, and how far apart the item counts are.
  - Size rule 6 says: count against the scale as usual; when the task counts the same as a past one, give the same size; when the size differs, say in the reason what differs.
  - The hours still come from the catalogue, not from the past task.
  - The cache key includes the references, so a new approved estimate means a fresh sizing.
  - The estimate step is template version 5.
- **Recording and showing.** These records travel with the estimate:
  - Each estimate task stores `references` (run, task, size, hours; at most 2).
  - The references stay on internal views (the card and the web UI). Since section 13, no assumption line names them on the client's copy.
  - The decision log adds two features, `pastMatches` and `pastSize`, so a backend compared later sees the same inputs.

  The approval card has a section "Sized with approved past tasks as references". It names the task, its size, and each reference. A task whose size differs from every reference is marked "sized differently: see its reason". The web UI's estimate page shows a "Like EST-n of <run> (size, hours)" line under the task's reason.
- **Tests.**
  - `src/estimate/references.test.ts` covers filtering, ranking, the cap of 2 and the text.
  - `src/stages/estimate.test.ts` runs a full sequence: a hands-off run is estimated and approved by the factory and becomes a reference, while an unapproved run does not. A later run's prompt then carries the references, its hours stay on the catalogue, and the card, assumptions and decision features show them.

**Risk to watch.** With approvals made by the factory, references can carry a sizing mistake forward from one estimate to the next. Three limits apply:
- References are hints; the estimators still count against the written scale.
- Only the same catalogue version counts, so changing the catalogue resets the pool.
- The decision log records how often a pick followed its reference (`pastSize`), so the actuals pairing (section 11) can show whether reuse drifts.

## 13. No sign-off: catalogue status from evidence, and internal-only wording, as built

Agreed in chat on 2026-10-03. Estimates are approved by the factory, so no person signs off the catalogue or the standard answers. The client's copy does not carry the catalogue's status. The status stays on the estimate as data and shows on internal views only.

- **Files.**
  - `catalogue.json` and `defaults.json` no longer have `status` or `signedOffBy`. Their versions are unchanged, because the hours and answers did not change.
  - The catalogue gains `calibration`: the thresholds below, labelled ASSUMED placeholders until real data exists.
  - `defaults.json` is now described as the factory's standard assumptions.
- **Status from evidence.** `src/estimate/catalogue-status.ts` computes the status:
  - `factorChecks` works within one kind and track. It compares the median build minutes of each pick with its baseline: large, small and very large against typical; hard and easy against moderate; partial against complete. It uses only completed tasks of this catalogue version, from the decision pairs (section 11).
  - A comparison needs `minPerCell` (5) finished tasks on each side. It holds when the measured ratio is within the catalogue's factor ×/÷ `tolerance` (1.5).
  - **draft** until `calibrated-factors` is reached.
  - **calibrated-factors** when there are at least `minBuilds` (10) builds and `minChecks` (6) comparisons, and at least `holdShare` (80%) of them hold.
  - **calibrated-hours** when the factors are calibrated and at least `minProjects` (10) finished projects of this version have real hours, with at least 80% inside their estimate's overall range.
  - Real hours are read from `~/.factory/actual-hours.csv`: `estimate-run,actual-hours` lines, the format `factory calibrate --actual-hours` reads.
  - Agent minutes can test only the catalogue's ratios, never its absolute hours. That is why the hours need real project hours.
- **On the estimate.** `catalogue.status` (draft, calibrated-factors or calibrated-hours) is set by the estimate step, along with `catalogue.evidence` (builds, checks, held, projects, projectsWithin). The step reads the evidence through `setCatalogueEvidenceSource`, which tests can replace.
- **Where it shows.**
  - It appears on internal views only:
    - the approval card ("Hours from task catalogue … : reference hours, not yet measured");
    - the web UI's Task catalogue fact, as a pill;
    - the team workbook's Confidence sheet, in the rows "Task catalogue" and "Catalogue status";
    - `npm run bench -- calibrate`, which prints the status and every factor check.
  - The estimate's assumptions, which the client file prints, no longer carry the catalogue line or the references line.
  - The wording in `catalogueStatusText` never names a person.
- **Standard answers.**
  - The assumption text is now plain: "… → assumed: <answer>".
  - Which topic it came from stays in `fromDefault`. The web UI's "Assumed by the factory" list shows it as a "standard answer: <topic>" tag.
  - The client still sees every assumption, because the assumptions are part of what is priced.
- **Tests.**
  - `src/estimate/catalogue-status.test.ts`: factor checks, all three statuses and their thresholds, other versions ignored, and the wording.
  - `export.test.ts`: the status appears in the team file and not in the client file.
  - `estimate.test.ts`: the assumptions do not mention the catalogue, and the card carries the status without "delivery lead" or "signed off".
  - `catalogue.test.ts` and `spec-rules.test.ts` updated for the files without sign-off.

## 14. Phase 3: the catalogue tunes itself, as built

Agreed in chat on 2026-10-03. After every estimate and every build, the factory measures the current catalogue version against what happened. When a value is off, it writes a proposal for the next version. No model call is involved: it is arithmetic over the ledgers.

**Revised after the PR #11 review (owner decision, 2026-10-03): tuning is a suggestion, not auto-applied.** The background tuner (`factory calibrate --auto`, `tuneNow({ mode: "propose" })`) writes its plan to `~/.factory/catalogues/proposed/<root>.json` (replaced each time, cleared when nothing is off). Nothing is sized from a proposal: `currentCatalogue()` reads only promoted versions. A person promotes it with `factory calibrate --apply`, which writes `<root>+t<n>.json` as before; `--history` shows a waiting proposal. Where the text below says the tuner writes a version, read: it proposes one, and `--apply` writes it. The aim is a fit, neither under nor over. It is not an exact match to the last few projects, because that would chase noise and make estimates swing, which is what Phase 1 removed.

- **When.**
  - When an executor stops after completing at least one step, it starts the tuner, in a run that has a finished estimate or that is a build following one (`src/stages/executor.ts`, `triggerTune`).
  - The tuner is `factory calibrate --auto` as a detached process, so no run waits on it. It writes one line per run to `~/.factory/catalogues/tune.log`.
  - An exclusive lock file keeps it to one tuner at a time; a lock older than ten minutes is taken over.
  - A failure never touches the run. Tests count the trigger and never spawn it. `FACTORY_NO_TUNE=1` turns it off.
  - An estimate brings no actuals by itself. New evidence comes from finished builds and from `actual-hours.csv`, so most runs end with "no change".
- **What it measures** (`src/estimate/tune.ts`, `planTune`):
  - **Size, verify and context factors**, from the section 13 factor checks of this version. For each pick, it takes the measured ratio over the catalogue's ratio in every kind and track, then pools them with a geometric mean weighted by tasks. Baseline picks (typical, moderate, complete) stay at 1.
  - **Hours**, from finished projects of this version: actual hours over the estimate's midpoint, pooled with a geometric mean. The result becomes one `hoursScale` on every kind's hours. Code applies it as a multiplier, and a task's reason shows "tuned hours ×N". The kinds' hours in the file are never rewritten. A scale per kind would need more projects than are expected for a while.
- **Guardrails**, in the catalogue's `tuning` block (starting values; change them with a version bump):
  - It waits for the section 13 minimums: `minBuilds` (10) builds for the factors, each comparison with `minPerCell` (5) tasks a side, and `minProjects` (10) projects for the hours.
  - `band` 0.1: a value measured within ±10% is fitted and left alone. This is where the tuning stops.
  - `step` 0.5: otherwise the value moves half way toward the measured value, on a ratio scale. It converges rather than overshooting. In the test, a true ratio of 2.2 goes 1.6 → 1.876 → 2.032, then stops inside the band.
  - `cap` 0.2: a value changes by at most ±20% per version.
  - `floor` 0.5 and `ceiling` 2: a value never goes outside 0.5× to 2× the repo file's value.
  - Each version is judged only on builds and projects sized with it, so no evidence is counted twice.
  - A value that hits the cap or a bound in two versions in a row is **flagged**. The kind's size wording is then more likely wrong than its number. Wording is a manual change.
- **Versions** (`src/estimate/catalogue-store.ts`):
  - The repo file is the root. Tuned versions are written once to `~/.factory/catalogues/<root>+t<n>.json` and never edited.
  - Each version records `tuned`: its parent, when it was made, the builds and projects used, every change (from, to, measured, evidence, limited by cap or bound) and the flagged values.
  - New runs use the newest version of the current root. The breakdown step records the version (`data.catalogue`), and the estimate step sizes from that exact version, so re-running or exporting a run gives the same numbers.
  - The breakdown's stored-answer key uses the root, because tuning changes numbers, never kinds.
  - Bumping the repo file's version starts a new root.
  - Approved past tasks (section 12) match across tuned versions of one root, because size wording is shared.
- **Where it shows** (internal only, as section 13):
  - The estimate's `catalogue.tuned` holds the generation and the last tuning's builds and projects.
  - The status text reads, for example, "self-tuned once, last from 12 builds and 0 finished projects; this version not yet measured". It appears on the approval card, the web UI pill, the team workbook and the bench.
  - The client's copy never mentions it.
  - `factory calibrate --tune` shows what would change, without writing; add `--apply` to write it now. `factory calibrate --history` lists every version and why it changed. `npm run bench -- calibrate` prints the plan too.
- **Tests.**
  - `src/estimate/tune.test.ts`: band, half step, cap and bound; waiting; fitted versus tuned; the hours scale; convergence inside the band; flagging; the lock; measuring the newest version.
  - `src/estimate/catalogue-store.test.ts`: version naming, newest version, older versions readable, no overwrite, the hours scale in the multiplier.
  - `estimate.test.ts`: a run stays pinned while a newer version arrives, and a new run takes it; the card text; nothing in the assumptions.
  - `estimate-e2e.test.ts`: the trigger fires once after a finished estimate and not before.
  - `catalogue-status.test.ts`: the tuned wording.
- **Not yet.** Jev is on hold. Rewording the size scale stays manual, guided by the flags. The starting limits are to be revisited once real data exists.
