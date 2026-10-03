import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { ContextPack } from "../contracts/index.js";
import { anthropicUserContent, ApiRunner, chatUserContent, openaiResponsesUserContent, RateLimitedError, type Conversation, type Provider, type Turn } from "./api.js";
import type { ModelImage } from "../util/image.js";
import { sniffImage, toModelImage } from "../util/image.js";
import { costUsd } from "./pricing.js";
import { family } from "./types.js";

const pack = (tools: string[] = []): ContextPack => ({
  system: "sys", user: "usr", images: [], pointers: [], tools,
  manifest: { stage: "intake", model: "m", recipeVersion: "1", sections: [], packTokens: 1, budgetTokens: 10, countMethod: "proxy", redactions: 0, packSha: "0".repeat(64) },
});
const U = { inputTokens: 1000, outputTokens: 100, cacheRead: 0, cacheWrite: 0 };

/** A provider that plays back scripted turns and records what it was sent. */
function scripted(turns: (Turn | Error)[]) {
  const seen: { toolResults: { id: string; content: string; isError?: boolean }[][]; said: string[]; tools: string[]; images: ModelImage[] } = { toolResults: [], said: [], tools: [], images: [] };
  const provider: Provider = {
    start(_m, _e, _s, _u, tools, images = []): Conversation {
      seen.tools = tools.map((t) => t.name);
      seen.images = images;
      let i = 0;
      return {
        async next() {
          const t = turns[i++];
          if (!t) throw new Error("script ran out");
          if (t instanceof Error) throw t;
          return t;
        },
        toolResults(r) { seen.toolResults.push(r); },
        say(x) { seen.said.push(x); },
      };
    },
  };
  return { provider, seen };
}
const call = (name: string, input: unknown, id = "t1"): Turn => ({ calls: [{ id, name, input }], text: "", stop: "tool_use", usage: U });
const Out = z.object({ changeClass: z.enum(["bugfix", "feature"]), spans: z.array(z.string()).min(1) });
const job = (over = {}) => ({ step: "intake" as const, model: "claude-sonnet-5", pack: pack(), schema: Out, limits: { maxTurns: 8, maxUsd: 1, timeoutSec: 60 }, ...over });

describe("ApiRunner", () => {
  it("returns validated output from submit_result", async () => {
    const { provider, seen } = scripted([call("submit_result", { changeClass: "bugfix", spans: ["x"] })]);
    const usage: number[] = [];
    const r = await new ApiRunner({ provider: () => provider, onUsage: async (u) => { usage.push(u.costUsd); } }).run(job());
    expect(r.status).toBe("ok");
    expect(r.output).toEqual({ changeClass: "bugfix", spans: ["x"] });
    expect(seen.tools).toEqual(["submit_result"]);
    expect(usage).toHaveLength(1);
    expect(r.usage.estUsd).toBeCloseTo(costUsd("claude-sonnet-5", U));
  });

  it("re-asks on schema errors, at most twice", async () => {
    const bad = call("submit_result", { changeClass: "nope", spans: [] });
    const { provider, seen } = scripted([bad, call("submit_result", { changeClass: "feature", spans: ["a"] })]);
    const r = await new ApiRunner({ provider: () => provider }).run(job());
    expect(r.status).toBe("ok");
    expect(seen.toolResults[0]![0]!.isError).toBe(true);
    expect(seen.toolResults[0]![0]!.content).toMatch(/changeClass/);
    const { provider: p2 } = scripted([bad, bad, bad, bad]);
    expect((await new ApiRunner({ provider: () => p2 }).run(job())).status).toBe("bad-output");
  });

  it("serves read-only tools and refuses anything else", async () => {
    const tools = { call: (n: string, i: Record<string, unknown>) => `${n}:${JSON.stringify(i)}` };
    const { provider, seen } = scripted([
      { calls: [{ id: "a", name: "read_file", input: { path: "x.cs" } }, { id: "b", name: "bash", input: { cmd: "rm -rf /" } }], text: "", stop: "tool_use", usage: U },
      call("submit_result", { changeClass: "bugfix", spans: ["x"] }),
    ]);
    const r = await new ApiRunner({ provider: () => provider, tools: tools as never }).run(job({ pack: pack(["read_file"]) }));
    expect(r.status).toBe("ok");
    expect(seen.tools).toEqual(["read_file", "submit_result"]);
    expect(seen.toolResults[0]).toEqual([
      { id: "a", content: 'read_file:{"path":"x.cs"}' },
      { id: "b", content: "Tool bash isn't available.", isError: true },
    ]);
  });

  it("stops at the turn cap, the cost cap, on refusal and on rate limits", async () => {
    const loop = Array.from({ length: 5 }, () => ({ calls: [{ id: "x", name: "read_file", input: {} }], text: "", stop: "tool_use" as const, usage: U }));
    const tools = { call: () => "ok" };
    expect((await new ApiRunner({ provider: () => scripted(loop).provider, tools: tools as never }).run(job({ pack: pack(["read_file"]), limits: { maxTurns: 3, maxUsd: 1, timeoutSec: 60 } }))).status).toBe("bad-output");
    expect((await new ApiRunner({ provider: () => scripted(loop).provider, tools: tools as never }).run(job({ pack: pack(["read_file"]), limits: { maxTurns: 8, maxUsd: 0.0001, timeoutSec: 60 } }))).status).toBe("over-budget");
    expect((await new ApiRunner({ provider: () => scripted([{ calls: [], text: "", stop: "refusal", usage: U }]).provider }).run(job())).status).toBe("refused");
    expect((await new ApiRunner({ provider: () => scripted([new RateLimitedError("429")]).provider }).run(job())).status).toBe("rate-limited");
  });

  it("nudges when the model answers in plain text", async () => {
    const { provider, seen } = scripted([{ calls: [], text: "It's a bugfix", stop: "end", usage: U }, call("submit_result", { changeClass: "bugfix", spans: ["x"] })]);
    expect((await new ApiRunner({ provider: () => provider }).run(job())).status).toBe("ok");
    expect(seen.said[0]).toMatch(/submit_result/);
  });
});

describe("helpers", () => {
  it("prices and families", () => {
    expect(costUsd("claude-opus-5-5", { inputTokens: 1_000_000, outputTokens: 0, cacheRead: 0, cacheWrite: 0 })).toBe(4);
    expect(costUsd("ollama/qwen3.6", { inputTokens: 1_000_000, outputTokens: 1_000_000, cacheRead: 0, cacheWrite: 0 })).toBe(0);
    expect(family("claude-sonnet-5")).toBe("anthropic");
    expect(family("gpt-5.5")).toBe("openai");
  });
});

describe("audit fixes", () => {
  it("sends effort only to models that accept it", async () => {
    const { supportsEffort } = await import("./api.js");
    expect(supportsEffort("claude-haiku-4-5")).toBe(false);
    expect(supportsEffort("claude-sonnet-5")).toBe(true);
    expect(supportsEffort("claude-opus-5-5")).toBe(true);
    expect(supportsEffort("gpt-5.5")).toBe(false);
  });

  it("tells the model when its next turn is the last one", async () => {
    const read = (id: string) => ({ calls: [{ id, name: "read_file", input: { path: "x.cs" } }], text: "", stop: "tool_use" as const, usage: U });
    const { provider, seen } = scripted([read("a"), read("b"), call("submit_result", { changeClass: "bugfix", spans: ["x"] })]);
    const tools = { specs: [{ name: "read_file", description: "d", input_schema: {} }], call: () => "file text" };
    const r = await new ApiRunner({ provider: () => provider, tools: tools as never }).run(job({ pack: pack(["read_file"]), limits: { maxTurns: 3, maxUsd: 1, timeoutSec: 60 } }));
    expect(r.status).toBe("ok");
    expect(seen.toolResults[0]![0]!.content).toBe("file text");
    expect(seen.toolResults[1]![0]!.content).toContain("Your next turn is your last one: call submit_result now");
  });

  it("loads the briefing's images and hands them to the provider in order", async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 9]);
    const store: Record<string, Buffer> = { a: png, b: jpg };
    const { provider, seen } = scripted([call("submit_result", { changeClass: "bugfix", spans: ["x"] })]);
    const r = await new ApiRunner({ provider: () => provider, loadImage: (sha) => store[sha]! }).run(job({ pack: { ...pack(), images: ["a", "b"] } }));
    expect(r.status).toBe("ok");
    expect(seen.images.map((m) => m.mediaType)).toEqual(["image/png", "image/jpeg"]);
    expect(Buffer.from(seen.images[0]!.base64, "base64")).toEqual(png);
  });

  it("stops before any model call when an image cannot be sent", async () => {
    const { provider, seen } = scripted([]);
    const noLoader = await new ApiRunner({ provider: () => provider }).run(job({ pack: { ...pack(), images: ["a"] } }));
    expect(noLoader.status).toBe("config-error");
    expect(noLoader.error).toMatch(/no way to load them/);
    const notImage = await new ApiRunner({ provider: () => provider, loadImage: () => Buffer.from("<svg/>") }).run(job({ pack: { ...pack(), images: ["a"] } }));
    expect(notImage.status).toBe("config-error");
    expect(notImage.error).toMatch(/Image 1 is not a PNG, JPEG, GIF or WebP/);
    const huge = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(5_000_001)]);
    expect((await new ApiRunner({ provider: () => provider, loadImage: () => huge }).run(job({ pack: { ...pack(), images: ["a"] } }))).error).toMatch(/at most 5 MB/);
    expect(seen.tools).toEqual([]);
    expect(noLoader.usage.estUsd).toBe(0);
  });
});

describe("images for each provider", () => {
  const imgs: ModelImage[] = [{ mediaType: "image/png", base64: "AAA" }, { mediaType: "image/webp", base64: "BBB" }];

  it("knows image types by their bytes, not their names", () => {
    expect(sniffImage(Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]))).toBe("image/gif");
    expect(sniffImage(Buffer.from("RIFF\0\0\0\0WEBPVP8 "))).toBe("image/webp");
    expect(sniffImage(Buffer.from("RIFF\0\0\0\0WAVEfmt "))).toBeUndefined();
    expect(() => toModelImage(Buffer.from("%PDF-1.7"), "R-3")).toThrow(/R-3 is not/);
  });

  it("keeps text-only messages as plain text", () => {
    expect(anthropicUserContent("hi")).toBe("hi");
    expect(openaiResponsesUserContent("hi", [])).toBe("hi");
    expect(chatUserContent("hi")).toBe("hi");
  });

  it("puts each image after its label and the briefing last", () => {
    expect(anthropicUserContent("brief", imgs)).toEqual([
      { type: "text", text: "Image 1:" }, { type: "image", source: { type: "base64", media_type: "image/png", data: "AAA" } },
      { type: "text", text: "Image 2:" }, { type: "image", source: { type: "base64", media_type: "image/webp", data: "BBB" } },
      { type: "text", text: "brief" },
    ]);
    const o = openaiResponsesUserContent("brief", imgs) as { type: string; image_url?: string; text?: string }[];
    expect(o.map((x) => x.type)).toEqual(["input_text", "input_image", "input_text", "input_image", "input_text"]);
    expect(o[1]!.image_url).toBe("data:image/png;base64,AAA");
    const c = chatUserContent("brief", imgs) as { type: string; image_url?: { url: string } }[];
    expect(c[3]!.image_url!.url).toBe("data:image/webp;base64,BBB");
    expect(c.at(-1)).toEqual({ type: "text", text: "brief" });
  });
});
