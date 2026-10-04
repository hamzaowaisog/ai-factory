// Consistency suite runner (docs/estimate-consistency.md, section 10, step F). Every requirement file under
// cases/<group>/ is estimated hands-off from requirements alone, with the cross-run cache off, so reworded
// requirements are compared the way a client's would be. The design approval (E1b) is the one human card
// left in a hands-off estimate; here `bench` approves it. Costs real model calls: needs ANTHROPIC_API_KEY.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
// the gates register themselves on import, as the CLI does
import "../../src/gates/predicates.js";
import "../../src/design/gates.js";
import "../../src/estimate/lint.js";
import "../../src/estimate/gates.js";
import { ensureStandaloneProject, STANDALONE_PROJECT } from "../../src/config/project.js";
import { decide } from "../../src/ledger/human.js";
import { Ledger } from "../../src/ledger/ledger.js";
import { replay } from "../../src/ledger/state.js";
import { createRun, execute } from "../../src/stages/executor.js";
import { sampleFromRun, type Sample } from "./report.js";

export const casesDir = join(dirname(fileURLToPath(import.meta.url)), "cases");

export interface Case { group: string; name: string; file: string }

/** cases/<group>/<name>.md, sorted; `only` keeps the named groups. */
export function listCases(dir = casesDir, only: string[] = []): Case[] {
  return readdirSync(dir).filter((g) => statSync(join(dir, g)).isDirectory() && (!only.length || only.includes(g))).sort()
    .flatMap((group) => readdirSync(join(dir, group)).filter((f) => f.endsWith(".md")).sort()
      .map((f) => ({ group, name: f.replace(/\.md$/, ""), file: join(dir, group, f) })));
}

/** The settings every suite run uses: hands-off, from requirements alone, stack undecided. */
export const SUITE_SETTINGS = { deliveryModel: "agentic", stackSource: "undecided", designInTotal: true, feedbackRounds: 2, noRepo: true, humanReview: false } as const;

/** Estimate one case to the end. Only a design-approval card is answered; any other card stops the run. */
export async function runCase(c: Case, log: (s: string) => void = () => undefined): Promise<Sample> {
  ensureStandaloneProject();
  const runId = await createRun(readFileSync(c.file, "utf8"), STANDALONE_PROJECT, "bench", { mode: "estimate", estimate: { ...SUITE_SETTINGS }, requestFile: c.file });
  log(`${c.group}/${c.name}: ${runId}`);
  for (let i = 0; i < 4; i++) {
    const r = await execute(runId);
    if (r.status !== "waiting") break;
    const ledger = Ledger.open(runId);
    const card = replay(ledger.events()).openCard;
    if (card?.kind !== "design-approval") return { ...sampleFromRun(runId, c.group, c.name), error: `waiting on a ${card?.kind ?? "unknown"} card` };
    await decide(ledger, { decision: "approve", hashPrefix: card.artifactSha.slice(0, 6), by: "bench" });
  }
  return sampleFromRun(runId, c.group, c.name);
}

/** `--report group/case=run,...` pairs for runs that already exist. */
export function parseReportArgs(specs: string[]): { group: string; name: string; runId: string }[] {
  return specs.map((s) => {
    const m = /^([^/=]+)\/([^=]+)=(.+)$/.exec(s.trim());
    if (!m) throw new Error(`Can't read "${s}". Use group/case=run-id, for example portal/a=2026-10-03-client-portal-ab12.`);
    return { group: m[1]!, name: m[2]!, runId: m[3]! };
  });
}
