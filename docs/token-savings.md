# Token and cost savings

How the estimate and design pipelines spend tokens, what has been done to spend fewer, and what is planned. Written 2026-10-06 on the `Hamza/token-savings` branch.

List prices per million tokens (`src/runners/pricing.ts`):

| Model | Input | Output | Cache read | Cache write |
|---|---|---|---|---|
| Opus 5.5 | $4 | $20 | $0.20 | $5 |
| Sonnet 5 | $2 | $10 | $0.20 | $2.50 |
| Haiku 4.5 | $1 | $5 | $0.10 | $1.25 |

Ground, specify, breakdown, estimate and design run on Opus 5.5 at high effort (`DEFAULT_ROUTES` in `src/stages/routing.ts`), so they carry most of the bill.

## Built

### 1. Calls sent side by side share the prompt cache

The three sketches, the spec drafts, the estimators, the breakdown's parts and the design's pages each send the same briefing several times at once. Before, every call paid 1.25x input to write the same cache entry, because an entry is readable only once the first answer starts streaming.

Now:
- the user sections the calls have in common go first and are cached as one block (`shared` in `src/stages/think.ts`, `sharedChars` in `src/context/pack.ts`);
- the first call goes alone and the others wait until its answer starts, then go together (`warmPrefix` in `src/runners/api.ts`); they pay 0.1x for the shared part instead of 1.25x;
- a breakdown part's EST- numbering moved from its rules to its task line, so every part has the same rules (the system prompt is part of the cached prefix);
- a lone call marks nothing, since a write nobody reads costs more than it saves.

Limits: design pages that cite a reference have extra rules, so they share with each other only. Calls more than about five minutes apart warm the cache again. The OpenAI drafter ignores the split.

### 2. Compact JSON in briefings

Artifact sections are serialized without indentation (`S.artifact` in `src/stages/think.ts`). Expected saving on those sections: roughly 15-25%, not yet measured.

Both changes alter the briefing text, so answers stored by the cross-run cache (`src/estimate/cache.ts`) before this change are not reused: the first run after it pays full price.

### 3. Per-step cost report

`factory report <run> --cost` (per stage across runs with `--all`, rows as JSON with `--json`) lists per step: model calls, answers reused from earlier runs, uncached input, cache writes and reads, output, the cache hit rate, the cost, and what caching saved at list prices after the write premium (`costRows`, `formatCost` in `src/report.ts`). The scorecard now records cache-write tokens, which it dropped before.

To measure items 1 and 2: run the same requirements on the old branch and on this one, and compare the two `--cost` reports.

## Model switching

Moving a call from Opus 5.5 to Sonnet 5 halves its price, so using cheaper models for part of the work is the largest lever left.

### Switch between calls, not inside one

- The prompt cache is per model. Switching mid-call makes the new model read the whole briefing again at its uncached price, and loses the shared cache from item 1. `docs/design/workflow-design.md` (model rules, rule 1): switch only at process boundaries.
- Most of our calls take 1-4 turns ending in one `submit_result`; there is no cheap middle to hand off.
- Context already moves between steps: each call gets a fresh briefing built from the stored outputs (spec, plan, breakdown), so a cheaper model on the next call sees the same context. An escalation restarts clean with the failures, not the weaker model's transcript (same doc, rule 2).

### What fits the pipeline

1. **Cheap first, Opus on failure.** A step already moves to the model in its route's `escalate` list on a later rung (`modelFor` in `src/stages/routing.ts`); Haiku-first steps escalate to Sonnet today, and every Opus step has `escalate: []`. Breakdown parts and design pages could run on Sonnet with `escalate: [Opus]`: most calls pay half, and only those failing their gates pay for Opus. The gates catch broken structure (uncovered requirements, unbuilt screens, bad ids), not weak judgement.
2. **Route by how hard the piece is.**
   - Design: simple pages (sign-in, settings, plain lists) on Sonnet, complex pages on Opus.
   - Estimate: one estimator on Opus, the others on Sonnet; a mixed panel also makes the estimators more independent.
   - Breakdown: the plan call on Opus, its parts on Sonnet.
3. **Keep Opus where judgement is the output:** the breakdown plan, the sizing and the spec. A cheaper model's mistakes there become wrong hours in the client workbook, which no gate catches.

### Measure before keeping a switch

Following the downgrade policy in `docs/design/workflow-design.md` (rule 6): downgrade one step at a time, and keep it only if cost per accepted result falls and quality holds. Retries eat the saving: if Sonnet fails a design page's checks on 30% of pages, those pages pay Sonnet, then Opus. `factory report --cost` shows cost and calls per step; `factory report` shows retries and why.

### Trying it without code

A project's `steps:` overrides a step's route (`routeFor` in `src/stages/routing.ts`). An estimate without a project reads the same block from `~/.factory/projects/standalone-estimates.yaml`.

```yaml
steps:
  design: { runner: api, model: claude-sonnet-5, escalate: [claude-opus-5-5], effort: high }
```

### Planned

- (a) Sonnet first with Opus as the fallback for design pages and breakdown parts.
- (b) Routing per call: design pages by complexity; a mixed estimator panel.
- Then the same requirements on both branches, comparing the `--cost` reports and the estimates themselves.

## Other options, not built

Ranked by expected saving:

- **Trim what each briefing sends:** drop fields a step does not read (e.g. a design page needs only its own requirements, which it already gets; check the others the same way).
- **Batch API for hands-off runs:** 50% off for calls that can wait; a hands-off estimate has no one waiting on it.
- **Lower effort** on steps whose gates rarely fail at medium.
- **Sonnet for narrow steps** that today run on Opus (e.g. merge, clarifier), measured as above.
- **One estimator for small estimates,** where several independent estimators add little.
