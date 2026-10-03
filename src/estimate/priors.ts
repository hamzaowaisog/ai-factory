// The pinned external prior the estimate is read against (docs/estimates-design.md, "Duration harness"): tool rounds per
// resolved task from a public agent-trajectory dataset, copied from bench/external/snapshots/openhands.json with its source
// and revision. It is read from a file in the repo and never fetched. It is a prior to compare with, not a number the
// estimate uses: the internal measurement wins, and a class whose measured turns fall outside the prior's p10..p90 band is
// flagged on the approval card so a lead looks at it.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Estimate } from "../contracts/index.js";

export interface RoundsPrior {
  source: { name: string; url: string; revision: string; license: string; retrieved: string };
  resolvedRounds: { n: number; p10: number; p50: number; p90: number };
  caveat: string;
}

export function loadRoundsPrior(file = join(dirname(fileURLToPath(import.meta.url)), "assets", "priors.json")): RoundsPrior | undefined {
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as RoundsPrior) : undefined;
}

export type PriorFlag = "below p10" | "above p90";
type Basis = NonNullable<Estimate["elapsed"]["basis"]>;

/** Where a class's measured median turns per task sit against the prior's band; undefined when within it or not measured. */
export function priorFlag(turnsMedian: number | undefined, p: RoundsPrior | undefined): PriorFlag | undefined {
  if (!p || turnsMedian === undefined) return undefined;
  return turnsMedian < p.resolvedRounds.p10 ? "below p10" : turnsMedian > p.resolvedRounds.p90 ? "above p90" : undefined;
}

/** The basis with each class's flag against the prior added (the prior's own source stays on the basis). */
export function withPrior(basis: Basis, p: RoundsPrior | undefined): Basis {
  if (!p) return basis;
  return {
    ...basis,
    prior: { source: p.source.url, revision: p.source.revision, roundsP10: p.resolvedRounds.p10, roundsP50: p.resolvedRounds.p50, roundsP90: p.resolvedRounds.p90 },
    byClass: basis.byClass.map((c) => { const f = priorFlag(c.turnsMedian, p); return f ? { ...c, priorFlag: f } : c; }),
  };
}
