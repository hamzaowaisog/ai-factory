import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { ProjectConfig } from "../config/project.js";
import { DEFAULT_POLICY } from "../gates/policy.js";
import { HUMAN_WRITER, Ledger } from "../ledger/ledger.js";
import { replay } from "../ledger/state.js";
import { defaultProvider, type Provider } from "../runners/api.js";
import type { ModelImage } from "../util/image.js";
import { NO_TRACE } from "../util/trace.js";
import type { StepContext } from "./framework.js";
import { budgetFor, S, setProviderFactory, think, UNTRUSTED_IMAGE_NOTE } from "./think.js";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16]);
const Out = z.object({ seen: z.number() });

beforeEach(() => {
  process.env.FACTORY_HOME = mkdtempSync(join(tmpdir(), "factory-think-"));
  process.env.FACTORY_NO_CACHE = "1";
});
afterEach(() => {
  setProviderFactory(defaultProvider);
  delete process.env.FACTORY_NO_CACHE;
});

async function ctxFor(): Promise<StepContext> {
  const ledger = Ledger.create("think-img");
  await ledger.append({ type: "run.created", data: { mode: "estimate", project: "demo", changeClass: "feature", request: "r" } }, HUMAN_WRITER);
  const state = replay(ledger.events());
  return {
    runId: "think-img", ledger, writer: HUMAN_WRITER, state, project: ProjectConfig.parse({ project: "demo", repo: "/x", stack: "dotnet" }),
    policy: DEFAULT_POLICY, attempt: 1, rung: 0, priorFailures: [], log: () => undefined, trace: NO_TRACE, usage: async () => undefined,
  };
}

describe("think with images", () => {
  it("sends the stored image bytes with the briefing, in the order of their markers", async () => {
    const ctx = await ctxFor();
    const a = ctx.ledger.putArtifact(PNG);
    const b = ctx.ledger.putArtifact(JPG);
    let got: { user: string; images: ModelImage[] } | undefined;
    const provider: Provider = {
      start(_m, _e, _s, user, _t, images = []) {
        got = { user, images };
        return {
          async next() { return { calls: [{ id: "1", name: "submit_result", input: { seen: images.length } }], text: "", stop: "tool_use", usage: { inputTokens: 10, outputTokens: 5, cacheRead: 0, cacheWrite: 0 } }; },
          toolResults() {}, say() {},
        };
      },
    };
    setProviderFactory(() => provider);
    const r = await think(ctx, {
      stage: "design", route: "design", cls: "read-large", tools: [], schema: Out,
      sections: [S.template("rules", UNTRUSTED_IMAGE_NOTE), S.image("R-1", "upload", a, "the client's home page"), S.image("R-2", "url", b), S.task("Look at both.")],
    });
    expect(r.ok && r.output).toEqual({ seen: 2 });
    expect(got!.images.map((m) => m.mediaType)).toEqual(["image/png", "image/jpeg"]);
    expect(Buffer.from(got!.images[1]!.base64, "base64")).toEqual(JPG);
    expect(got!.user).toMatch(/<untrusted_image n="1" id="R-1" source="upload">\nthe client's home page\n<\/untrusted_image>/);
    expect(got!.user).toContain('<untrusted_image n="2" id="R-2" source="url"></untrusted_image>');
  });

  it("parks the step, without a model call, when a stored image is not one a model takes", async () => {
    const ctx = await ctxFor();
    const bad = ctx.ledger.putArtifact(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"));
    let called = false;
    setProviderFactory(() => ({ start() { called = true; throw new Error("no call expected"); } }));
    const r = await think(ctx, { stage: "design", route: "design", cls: "read-large", tools: [], schema: Out, sections: [S.image("R-1", "upload", bad), S.task("Look.")] });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.outcome).toMatchObject({ kind: "park", reason: expect.stringMatching(/Image 1 is not a PNG/) });
    expect(called).toBe(false);
  });
});

describe("briefing budget", () => {
  const state = (mode: string) => ({ state: { info: { mode } } }) as unknown as Parameters<typeof budgetFor>[0];
  const big = S.artifact("drafts", "drafts", Array.from({ length: 400 }, (_, i) => `requirement ${i}: the buyer sees the order status and gets an email when it changes`));
  const small = S.artifact("intent", "intent", ["one span"]);
  const doc = S.untrusted("request", "cli", "word ".repeat(20_000));

  it("grows by the factory's own earlier outputs in every mode, and keeps the usual room", () => {
    expect(budgetFor(state("build"), 15000, [small, S.task("t")], "claude-opus-5-5")).toBe(15000);
    const grown = budgetFor(state("build"), 15000, [big, S.task("t")], "claude-opus-5-5")!;
    expect(grown).toBeGreaterThan(15000 + 7500);
    expect(budgetFor(state("estimate"), 15000, [big, S.task("t")], "claude-opus-5-5")).toBe(grown);
  });

  it("grows by the requirements document only where requirements are read, and never past the cap", () => {
    expect(budgetFor(state("build"), 15000, [doc], "claude-opus-5-5")).toBe(15000);
    expect(budgetFor(state("estimate"), 15000, [doc], "claude-opus-5-5")).toBeGreaterThan(30000);
    expect(budgetFor(state("estimate"), 15000, [S.untrusted("request", "cli", "word ".repeat(400_000)), big], "claude-opus-5-5")).toBe(180_000);
    expect(budgetFor(state("estimate"), undefined, [doc], "claude-opus-5-5")).toBeUndefined();
  });
});

describe("stored answers in a build run", () => {
  let asked = 0;
  const counting: Provider = {
    start() {
      return {
        async next() { asked++; return { calls: [{ id: "1", name: "submit_result", input: { seen: asked } }], text: "", stop: "tool_use", usage: { inputTokens: 10, outputTokens: 5, cacheRead: 0, cacheWrite: 0 } }; },
        toolResults() {}, say() {},
      };
    },
  };
  async function buildCtx(runId: string): Promise<StepContext> {
    const ledger = Ledger.create(runId);
    await ledger.append({ type: "run.created", data: { mode: "greenfield", project: "demo", changeClass: "feature", request: "r" } }, HUMAN_WRITER);
    return {
      runId, ledger, writer: HUMAN_WRITER, state: replay(ledger.events()), project: ProjectConfig.parse({ project: "demo", repo: "/x", stack: "dotnet" }),
      policy: DEFAULT_POLICY, attempt: 1, rung: 0, priorFailures: [], log: () => undefined, trace: NO_TRACE, usage: async () => undefined,
    };
  }
  const ask = (ctx: StepContext) => think(ctx, { stage: "design", route: "design", cls: "read-large", tools: [], schema: Out, sections: [S.template("rules", "Count."), S.task("Answer.")] });
  beforeEach(() => { asked = 0; process.env.FACTORY_NO_CACHE = "0"; setProviderFactory(() => counting); });

  it("the same briefing in the same run reads the stored answer: a retry or a resume does not pay for it again", async () => {
    const ctx = await buildCtx("build-cache-1");
    expect((await ask(ctx) as { output: unknown }).output).toEqual({ seen: 1 });
    expect((await ask(ctx) as { output: unknown }).output).toEqual({ seen: 1 });
    expect(asked).toBe(1);
    // another build run asks the model itself: only estimates and designs share answers between runs
    await ask(await buildCtx("build-cache-2"));
    expect(asked).toBe(2);
  });

  it("an answer written against failures is never stored, so a retry rejected for the same reasons asks again", async () => {
    const ctx = { ...(await buildCtx("build-cache-3")), priorFailures: [{ check: "plan-coverage", message: "REQ-3 isn't covered by any task", frames: [] }] };
    await ask(ctx);
    await ask(ctx);
    expect(asked).toBe(2);
  });

  it("a rejected answer is forgotten", async () => {
    const ctx = await buildCtx("build-cache-4");
    const r = await ask(ctx);
    if (r.ok) r.forget?.();
    await ask(ctx);
    expect(asked).toBe(2);
  });
});
