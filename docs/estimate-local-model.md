# Local model for the hours step: research

Scope: replace only the step where the model proposes hours (anchors and ratios) with a model we train and run ourselves, on our own history. The hosted model keeps reading requirements, asking questions and producing the breakdown. Nothing here is built. Claims from search results are marked *(reported)* and were not verified by me. Facts about the repo come from reading the code.

Related: `docs/estimate-consistency.md` (why, and the cross-run cache that is already built).

## 1. What the step does today, and what would change

Today `estimate.ts` asks the hosted model for a `Proposal`: up to 8 anchor tasks with hour ranges, and a ratio against an anchor for every other task. `hours.ts` and `assemble.ts` do all sums, merge independent estimators, flag wide spread, and gates E1 to E7 check the result. The model never writes a total.

A local model would produce the same `Proposal` shape, or directly an hour range per task, so everything downstream (gates, merge, workbooks, approval) stays as is. The hosted proposal could remain as a second, independent estimator, and the existing spread flag then shows when the two disagree.

## 2. Options, from least to most machinery

| Option | What it is | Data it needs | Deterministic | Verdict |
|---|---|---|---|---|
| A. Analogy (nearest neighbours) | Find the most similar finished tasks or projects, use their hours | Tens of tasks | Yes | Start here. Also the baseline everything else must beat |
| B. Regularised linear / GAM | Hours from a few counted features | Tens to low hundreds of projects | Yes | Cheap, explainable, hard to overfit |
| C. Gradient-boosted trees (quantile) | Non-linear on the same features | Low hundreds of projects to be worthwhile | Yes (fixed seed) | Add only if B is clearly beaten on held-out data |
| D. Embeddings plus A/B/C | A small local embedding model turns task titles and items into vectors, used as extra features or for similarity | Same as above | Yes | Useful because task text carries signal the counts miss |
| E. Fine-tuned local LLM (QLoRA) | Language model predicts hours from the task text | Reported: hundreds to thousands of examples, easy to overfit below that | Only with pinned serving | Not recommended until A to D plateau |

Published effort-estimation work on small project datasets (Desharnais, COCOMO, ISBSG, Albrecht, Tukutuku) mostly uses classical models: analogy, regression, trees and ensembles, evaluated by leave-one-out or k-fold cross-validation *(reported; [optimized model tree](https://arxiv.org/pdf/1703.05584), [accuracy of ML techniques](https://arxiv.org/pdf/2101.10658))*. One ensemble result: MMRE 0.30 and Pred(25) 64% *(reported)*. Treat that as the scale of what is achievable, not a promise: those are public datasets, not our work.

For text-based story-point estimation, GPT2SP, Deep-SE and a QLoRA-tuned Llama 3.2 ([Llama3SP](https://www.sciencedirect.com/science/article/pii/S2949719125000652)) exist; cross-project MAE was clearly worse than within-project *(reported; [GPT2SP summary](https://research.monash.edu/en/publications/gpt2sp-a-transformer-based-agile-story-point-estimation-approach/))*. Those datasets are open-source issue trackers with thousands of items. We will not have that. An embedding model with a tree ensemble on top is also reported as a competing approach ([GemSP](https://doi.org/10.3390/info17010110), [SBERT plus gradient boosting](https://link.springer.com/article/10.1007/s11219-025-09731-6)).

## 3. Data

### What a training row is

One row per finished **task** (the breakdown's unit), not per project. A project then contributes tens of rows, which makes a small ledger usable, but those rows are not independent (section 4).

Features, all already produced by the pipeline at approval time (`BreakdownTask`, `Estimate`, `size.ts`):

- track, executor, complexity flag, whether it is an overhead
- number of requirements and spec items it delivers, number of dependencies
- whether it builds a design screen
- delivery model, stack source, size band of the project, whether the project touches existing code
- task text (title and items), as an embedding or bag of words
- the hosted model's own proposed range (as a feature, or kept out so the two stay independent; decide by experiment)

Label: actual hours for the task. This is the missing piece. Per-task actuals are the best label; per-track or per-project actuals work with a coarser model (section 6).

### What exists and what does not

- Exists: every approved estimate stores its breakdown and sizing in the ledger, so features can be rebuilt for old runs. Benchmark records hold cost per phase (`records.ts`).
- Does not exist: real engineer hours per task. Project hours are typed into `~/.factory/actual-hours.csv` (`estimate-run,actual-hours`) by hand; `factory calibrate` and the catalogue's self-tuning read them (docs/estimate-consistency.md, sections 13 and 14). Agent minutes per task are recorded by every build (section 11).
- Therefore the first deliverable is not a model but a way to record actuals per task and per track, and a snapshot of features at approval so training never depends on re-parsing history.

### Label quality

Actual hours are noisy. Agree on what counts (rework, review, QA, meetings, waiting) before collecting, and record the definition with the data. Tasks that were cut or merged during delivery need a rule: drop them, or map their hours to the surviving task. Work done by the factory against hours by people need separate labels, since the executor differs.

## 4. Train and test protocol

1. **Split by project, never by task.** Tasks from one project share a team, stack and requirement style, so splitting by task leaks information and flatters the model.
2. **Under about 50 projects:** leave-one-project-out cross-validation. Train on all other projects, predict every task of the held-out one, repeat, and score the pooled predictions. Cross-validation on small effort datasets is standard *(reported)*.
3. **Around 100 or more projects:** add a time split. Train on older projects, test on the newest 20%. This matches real use and exposes drift.
4. **Keep an untouched final set** once there are enough projects. Tune only on the cross-validation folds, then look at it once.
5. **Within-company data.** Reported comparisons favour a model trained on the company's own projects over one trained on pooled cross-company data, including with about 20 projects *(reported; [Mendes et al.](https://www.researchgate.net/publication/266656263_How_to_make_best_use_of_cross-company_data_in_software_effort_estimation))*. Public datasets can warm-start a model but should not replace our data. Transfer approaches exist ([Dycom](https://www.researchgate.net/publication/320261349_Clustering_Dycom_An_Online_Cross-Company_Software_Effort_Estimation_Study)); skip them until the basics work.
6. **Baselines it must beat, on the same folds:**
   - the current hosted-model estimates (from `calibrate`)
   - a trivial baseline: median hours per (track, complexity flag)
   - analogy (option A)
   Adopt a model only if it beats all three.

### Metrics

- **Error:** median absolute error and median magnitude of relative error, per task and per project total. MMRE is common but biased towards under-estimates, so report it only alongside the others.
- **Pred(25):** share of estimates within 25% of actual, as in the literature.
- **Range quality:** how often actual hours fall inside the predicted range (coverage), and the average width. The pipeline outputs ranges, so this matters more than a point error.
- **Bias:** mean signed error per track. A model that is right on average but always low on mobile is a defect.
- **Stability:** variation of the prediction when the task text is lightly reworded. A learned model can be deterministic yet brittle.

## 5. Ranges from small data

Point predictions are not enough. Candidates:

- **Quantile regression** (trees or linear) for low and high quantiles.
- **Conformalized quantile regression**: calibrate the quantile range on held-out residuals so the stated coverage (for example 80%) holds in finite samples without distributional assumptions *(reported; [CQR paper](https://arxiv.org/abs/1905.03222))*. It fits our small-data case. It needs a calibration set carved from the training projects, which costs data, so it applies from roughly dozens of projects.
- Before that, the simple route: a range from the spread of the K nearest analogues.

The output maps to the existing `Range { min, max }`. A task or track with too little history keeps the hosted proposal and is labelled cold-start, as the pipeline already does for cost.

## 6. If per-task actuals are not available

Many teams only log hours per project or per track. Options:

- Train at track level (backend, mobile, web, qa, design, pm) with features aggregated per track, one row per project per track.
- Allocate project hours to tasks in proportion to the hosted proposal, then train on those pseudo-labels. This inherits the hosted model's relative sizing, so it learns calibration of the total, not better task ratios. Say so wherever it is used.

## 7. Running a local model, and determinism

If a language model is used at all (embeddings in option D, or option E), serving matters.

- **Repo support exists.** `src/runners/api.ts` routes models named `ollama/<name>` to an OpenAI-compatible endpoint (default `http://localhost:11434/v1`, `OLLAMA_BASE_URL` to change). `buildPack` caps local packs at `LOCAL_PACK_CAP` (16,000 tokens), so a long requirements document would need chunking or stay with the hosted model.
- **Temperature 0 is not enough.** Reported cause: kernels change how they split a reduction depending on batch size, so the same request batched with different neighbours can differ. Batch-invariant kernels for vLLM give identical outputs at temperature 0 under load, reportedly at about 61.5% throughput cost *(reported; [reproducible inference](https://hidekazu-konishi.com/entry/reproducible_llm_inference.html), [batch invariance in practice](https://medium.com/@siddhantg314/defeating-nondeterminism-in-llm-inference-in-practice-38a7dd1e4112))*. Serving one request at a time, with a pinned model file, runtime and GPU, avoids it at low volume.
- **Tabular models avoid the problem.** Options A to C are exactly reproducible with a fixed seed and pinned library versions. This is a strong reason to prefer them for the number itself and to use a language model, if at all, only to produce features.
- **Fine-tuning (option E).** QLoRA is reported to overfit easily on small data: use a small rank (about 8), low learning rate, few epochs, and watch validation loss; hundreds to thousands of good examples give measurable gains on narrow tasks *(reported)*. A language model asked to output a number also has no calibrated range, so it would still need quantile or conformal wrapping. For these reasons it comes last.
- **Hardware.** A tabular model needs a laptop. Embeddings from a small model need a CPU or a small GPU. Fine-tuning a few-billion-parameter model with QLoRA needs a single modern GPU with enough memory; the exact size depends on the model and is something to check against the chosen model's documentation, not a number I can give here.

## 8. Integration sketch (not built)

- `factory record-actuals <run> --task EST-4=6.5 ...` (or a CSV import) writing to the ledger beside the approved estimate, plus a feature snapshot written at approval.
- `factory sizing-eval` offline: builds the dataset from ledgers and actuals, runs the section 4 protocol, prints the section 4 metrics against the baselines. No effect on any estimate.
- `factory calibrate` extended to include model-versus-actual rows.
- Only if the evaluation beats the baselines: a `sizing` step option (`sizingModel: local`) that produces proposals from the trained model, runs beside the hosted estimator, and surfaces disagreement through the existing spread flag. The lead still approves; gates are unchanged; the cross-run cache already makes the hosted side repeatable.
- Model artefacts versioned and hashed into the cache key and the approval card, so an estimate says which model produced it.

## 9. Risks

- **Too little data.** The most likely failure. The evaluation tool must say "not enough projects" rather than print a number.
- **Learning our past mistakes.** Labels are actual hours, which reflect past scope creep, team skill and tooling. The factory changes the work itself, so human-built history may not transfer to factory-built tasks. Keep executor as a feature and expect a split.
- **Drift.** Re-test on a time split whenever the team, stack or process changes.
- **False confidence.** A deterministic model looks authoritative. Show its range and its history size on the card.
- **Leakage through features.** The hosted proposal and the final approved hours both come from earlier estimates. Features must exist before work starts, and labels must be actual hours, never an approved estimate.

## 10. Open questions for the team

1. How many finished projects have per-task, per-track or per-project hours recorded, and where?
2. Can hours be recorded per task going forward, and who owns the definition of what counts?
3. Does client data policy forbid sending requirements to a hosted model? (This decides whether a local language model is optional or required.)
4. What hardware is available (CPU only, one GPU, memory)?
5. Do factory-built and human-built tasks need separate models?

## 11. Suggested order

1. Record actuals and snapshot features at approval (small, needed by everything).
2. Write the offline evaluation with baselines and leave-one-project-out scoring, and run it as soon as there are a few dozen finished projects.
3. Fit options A and B first, then C and D only if they win on held-out projects.
4. Add ranges (section 5), then the optional local sizing step (section 8).
5. Consider fine-tuning a local language model only after steps 1 to 4 plateau.

## Sources

- [Software effort estimation based on optimized model tree](https://arxiv.org/pdf/1703.05584)
- [Software effort estimation accuracy prediction of machine learning techniques](https://arxiv.org/pdf/2101.10658)
- [Conformalized quantile regression](https://arxiv.org/abs/1905.03222)
- [GPT2SP (Monash)](https://research.monash.edu/en/publications/gpt2sp-a-transformer-based-agile-story-point-estimation-approach/)
- [Llama3SP](https://www.sciencedirect.com/science/article/pii/S2949719125000652)
- [GemSP](https://doi.org/10.3390/info17010110)
- [Improving story points estimation using ensemble machine learning](https://link.springer.com/article/10.1007/s11219-025-09731-6)
- [How to make best use of cross-company data in software effort estimation?](https://www.researchgate.net/publication/266656263_How_to_make_best_use_of_cross-company_data_in_software_effort_estimation)
- [Clustering Dycom](https://www.researchgate.net/publication/320261349_Clustering_Dycom_An_Online_Cross-Company_Software_Effort_Estimation_Study)
- [Reproducible LLM inference and batch invariance](https://hidekazu-konishi.com/entry/reproducible_llm_inference.html)
- [Defeating nondeterminism in LLM inference, in practice](https://medium.com/@siddhantg314/defeating-nondeterminism-in-llm-inference-in-practice-38a7dd1e4112)
