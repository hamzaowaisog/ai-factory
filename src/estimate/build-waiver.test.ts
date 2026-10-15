import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { failure } from "../gates/engine.js";
import { DEFAULT_POLICY } from "../gates/policy.js";
import { HUMAN_WRITER, Ledger } from "../ledger/ledger.js";
import { replay } from "../ledger/state.js";
import type { StepContext } from "../stages/framework.js";
import { NO_TRACE } from "../util/trace.js";
import { buildWaiver } from "./build-waiver.js";
import { sizeCap, unrequestedBehaviour } from "./gates.js";

beforeEach(() => { process.env.FACTORY_HOME = mkdtempSync(join(tmpdir(), "factory-bw-")); });

async function ctxOf(ledger: Ledger): Promise<StepContext> {
  const state = replay(ledger.events());
  return { runId: state.info.runId, ledger, writer: HUMAN_WRITER, state, project: {} as never, policy: DEFAULT_POLICY, attempt: 1, rung: 0, priorFailures: [], log: () => undefined, trace: NO_TRACE, usage: async () => undefined };
}

describe("build gate waivers (B1, B3, B4)", () => {
  it("asks on a waiver card, then accepts once that gate and scope are waived, and no other", async () => {
    const ledger = Ledger.create(`20261001-bw-${Math.random().toString(16).slice(2, 6)}`);
    await ledger.append({ type: "run.created", data: { mode: "brownfield", project: "p", request: "x" } }, HUMAN_WRITER);
    const failed = [{ def: sizeCap, failures: [failure("b3-size", "900 changed lines against an approved cap of 400")] }];
    const ask = buildWaiver(await ctxOf(ledger), "integrate", failed, "commit-1", "advice line");
    if (ask.kind !== "ask" || ask.outcome.kind !== "wait") throw new Error("expected a card");
    const card = ask.outcome.card;
    expect(card).toMatchObject({ kind: "waiver" });
    expect(card.markdown).toContain(`Run ${ledger.runId} these gates fail:`);
    expect(card.markdown).toMatch(/build\.b3-size-cap: 900 changed lines.*factory waive .* --reason.*advice line/s);

    await ledger.append({ type: "human.requested", data: { cardId: card.cardId, kind: "waiver", artifactSha: card.artifactSha } }, HUMAN_WRITER);
    await ledger.append({ type: "human.decided", data: { cardId: card.cardId, decision: "waive", by: "lead", artifactSha: card.artifactSha, reason: "generated lockfile" } }, HUMAN_WRITER);

    const ctx = await ctxOf(ledger);
    expect(buildWaiver(ctx, "integrate", failed, "commit-1", "")).toMatchObject({ kind: "waived", waivers: [{ gateIds: ["build.b3-size-cap"], human: "lead", reason: "generated lockfile" }] });
    // a new commit, or another gate, needs its own decision
    expect(buildWaiver(ctx, "integrate", failed, "commit-2", "").kind).toBe("ask");
    expect(buildWaiver(ctx, "review", [{ def: unrequestedBehaviour, failures: [] }], "commit-1", "").kind).toBe("ask");
  });
});

describe("integrate's size cards in demo mode", () => {
  it("are accepted without asking and named, and still asked outside demo mode (run 3f0f stopped on one)", async () => {
    const { integrateWaiver } = await import("../stages/build.js");
    const { designSizeCap } = await import("../design/gates.js");
    const ledger = Ledger.create(`20261001-bwd-${Math.random().toString(16).slice(2, 6)}`);
    await ledger.append({ type: "run.created", data: { mode: "brownfield", project: "p", request: "x" } }, HUMAN_WRITER);
    const failed = [{ def: designSizeCap, failures: [failure("design-size", "design-system change, but a new screen was approved")] }];
    const was = process.env.FACTORY_DEMO;
    try {
      delete process.env.FACTORY_DEMO;
      expect(integrateWaiver(await ctxOf(ledger), failed, "commit-1", "").kind).toBe("ask");
      process.env.FACTORY_DEMO = "1";
      expect(integrateWaiver(await ctxOf(ledger), failed, "commit-1", "")).toMatchObject({ kind: "waived", waivers: [{ gateIds: ["design.size-cap"], human: "DEMO mode", reason: "accepted without asking: design-system change, but a new screen was approved" }] });
    } finally {
      if (was === undefined) delete process.env.FACTORY_DEMO; else process.env.FACTORY_DEMO = was;
    }
  });
});
