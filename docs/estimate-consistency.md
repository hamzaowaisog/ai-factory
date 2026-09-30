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
