# Estimate consistency: research and where we stand

Question: for the same requirement, how do we make the estimate come out the same, or close enough to trust?

This is research plus a read of the current code. Nothing here is built yet. Nothing was trained or benchmarked; external claims come from search results and are marked as such.

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
