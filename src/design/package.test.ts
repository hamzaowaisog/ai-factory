// The design package (docs/estimates-design.md, "Design handoff", step 2): W3C tokens, the design.json
// format, the store (write once, checked by sha-256), the repo paths, the design-export step over a run
// (v1, then a change request's v2 in the same line) and reproducible pictures.
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { _resetEnvCache } from "../config/env.js";
import { DesignTheme } from "../contracts/artifacts.js";
import { buildDemo } from "./demo.js";
import { captureDemo, findChromium } from "./screenshots.js";
import { HUMAN_WRITER, Ledger } from "../ledger/ledger.js";
import { replay } from "../ledger/state.js";
import { designCard } from "../stages/estimate-approve.js";
import { designExportStep, ensurePackage, exportRunPackage } from "../stages/design-export.js";
import { codeBase } from "../stages/workspace.js";
import { isUiPath } from "./size.js";
import { dirSource, withoutPackages } from "./source.js";
import {
  checkPackage, DESIGN_SCHEMA_VERSION, demoShotList, findPackage, listPackages, nextVersion, PACKAGE_PATH, readDesignJson, repoFiles,
  w3cColour, w3cShadow, w3cTokens, writePackage, type PackageInput,
} from "./package.js";

const sha = "a".repeat(64);
const theme = DesignTheme.parse({ mood: "calm clinical", mode: "light", brand: "#1f6feb", neutral: "cool", chrome: "plain", font: "sans", radius: "soft", density: "comfortable", surface: "flat", motion: "lively", reading: { users: "clinic staff", context: "at a desk all day", device: "web", tone: "calm", hero: "the day's queue at a glance", traits: ["dense", "quiet"] }, basis: [{ ref: "Epic MyChart", took: "calm white page, one blue action" }, { ref: "Linear", took: "hairline borders, compact tables" }] });
const mock = { title: "Sign in", blocks: [{ type: "stats", items: [{ label: "Open orders", value: "14" }] }, { type: "actions", buttons: ["Sign in"] }], copy: {} };
const design = (extra: { id: string; route: string }[] = []) => ({
  flow: "A user signs in", theme, noScreen: [],
  screens: [{ id: "S-1", route: "/login", file: "app/login/page.tsx", reqs: ["REQ-1"], states: ["error"], size: "new", mock, mockFull: mock },
    ...extra.map((x) => ({ ...x, file: `app${x.route}/page.tsx`, reqs: ["REQ-1"], states: [], size: "new", mock: { ...mock, title: "Report" }, mockFull: mock }))],
});

beforeEach(() => {
  process.env.FACTORY_HOME = mkdtempSync(join(tmpdir(), "factory-pkg-"));
  process.env.ANTHROPIC_API_KEY = "sk-ant-test-not-real-000000000000";
  _resetEnvCache();
});

const input = (over: Partial<PackageInput> = {}): PackageInput => ({
  project: "demo", line: "run-1", version: 1, design: design() as never, designSha: sha, demoHtml: "<!doctype html><title>demo</title>", demoSha: "b".repeat(64),
  run: { id: "run-1", mode: "design", project: "demo" }, product: { name: "Clinic" }, approved: { by: "lead", at: "2026-10-02T10:00:00.000Z" },
  templateVersion: "20", references: [], ...over,
});

describe("W3C design tokens", () => {
  it("turns CSS colours into W3C colour values and refuses what it cannot read", () => {
    expect(w3cColour("#fff")).toEqual({ colorSpace: "srgb", components: [1, 1, 1], hex: "#ffffff" });
    expect(w3cColour("#1f6feb")).toMatchObject({ components: [0.1216, 0.4353, 0.9216], hex: "#1f6feb" });
    expect(w3cColour("rgba(0, 0, 0, 0.5)")).toEqual({ colorSpace: "srgb", components: [0, 0, 0], alpha: 0.5, hex: "#000000" });
    expect(w3cColour("#00000080").alpha).toBeCloseTo(0.502, 3);
    expect(() => w3cColour("var(--x)")).toThrow(/Not a colour/);
  });

  it("turns a box-shadow list into shadow values, keeping commas inside rgba()", () => {
    const s = w3cShadow("0 1px 2px rgba(0,0,0,.06), inset 0 4px 12px 1px #0000001a") as { offsetY: { value: number }; blur: { value: number }; spread: { value: number }; inset?: boolean; color: { alpha?: number } }[];
    expect(s).toHaveLength(2);
    expect(s[0]).toMatchObject({ offsetY: { value: 1, unit: "px" }, blur: { value: 2, unit: "px" }, color: { alpha: 0.06 } });
    expect(s[1]).toMatchObject({ inset: true, blur: { value: 12 }, spread: { value: 1 } });
  });

  it("names semantic tokens that point at the primitive values, with the other mode under $extensions", () => {
    const light = w3cTokens(theme) as { color: Record<string, { $value: string; $extensions?: unknown }>; primitive: { color: Record<string, unknown> }; radius: { $value: unknown }; $extensions: Record<string, { modes: string[] }> };
    expect(light.color.brand!.$value).toBe("{primitive.color.light.brand}");
    expect(light.color.brand!.$extensions).toBeUndefined();
    expect(Object.keys(light.primitive.color)).toEqual(["$type", "light"]);
    expect(light.radius.$value).toMatchObject({ unit: "px" });
    const both = w3cTokens({ ...theme, mode: "auto" }) as typeof light;
    expect(both.$extensions["ai.factory"]!.modes).toEqual(["light", "dark"]);
    expect(both.color.brand!.$extensions).toEqual({ "ai.factory.modes": { dark: "{primitive.color.dark.brand}" } });
    // every alias resolves
    const prim = both.primitive.color as Record<string, Record<string, unknown>>;
    for (const t of Object.values(both.color).filter((x) => typeof x === "object")) {
      const [, , , m, k] = /^\{(primitive)\.(color)\.(\w+)\.([\w-]+)\}$/.exec(t.$value) ?? [];
      expect(prim[m!]?.[k!], t.$value).toBeDefined();
    }
  });
});

describe("design.json", () => {
  it("reads the current format and refuses a newer one", () => {
    expect(readDesignJson(JSON.stringify({ schemaVersion: DESIGN_SCHEMA_VERSION, flow: "f" }))).toMatchObject({ flow: "f" });
    expect(readDesignJson(JSON.stringify({ flow: "f" })).flow).toBe("f");
    expect(() => readDesignJson(JSON.stringify({ schemaVersion: DESIGN_SCHEMA_VERSION + 1 }))).toThrow(/newer factory/);
  });
});

describe("the package store", () => {
  it("writes every file once, lists its sha-256, and catches a changed or missing file", async () => {
    const pkg = await writePackage(input());
    expect(pkg.dir).toBe(join(process.env.FACTORY_HOME!, "designs", "demo", "run-1", "v1"));
    expect(pkg.manifest).toMatchObject({ kind: "ai-factory/design-package", schemaVersion: 1, line: "run-1", version: 1, look: "design", product: { name: "Clinic" } });
    expect(pkg.manifest.files.map((f) => f.path)).toEqual(["demo/index.html", "design.json", "tokens.css", "tokens.json"]);
    expect(pkg.manifest.screens).toEqual([{ id: "S-1", title: "Sign in", route: "/login", reqs: ["REQ-1"], states: expect.arrayContaining(["error"]) }]);
    expect(pkg.manifest.shotsNote).toMatch(/switched off/);
    expect(JSON.parse(readFileSync(join(pkg.dir, "design.json"), "utf8"))).toMatchObject({ schemaVersion: 1, flow: "A user signs in" });
    expect(readFileSync(join(pkg.dir, "tokens.css"), "utf8")).toMatch(/--/);
    expect(checkPackage(pkg.dir).problems).toEqual([]);

    // the same design again is the same package; another design in the same version is refused
    expect((await writePackage(input())).manifest).toEqual(pkg.manifest);
    await expect(writePackage(input({ designSha: "c".repeat(64) }))).rejects.toThrow(/never changes/);

    writeFileSync(join(pkg.dir, "design.json"), "{}");
    expect(checkPackage(pkg.dir).problems).toEqual(["design.json was changed after approval"]);
  });

  it("finds a package by its design, counts versions per line, and keeps the repo's look out of tokens", async () => {
    await writePackage(input());
    await writePackage(input({ version: 2, designSha: "c".repeat(64), design: { ...design(), themeSource: "repo" } as never }));
    expect(listPackages("demo").map((p) => p.manifest.version)).toEqual([1, 2]);
    expect(findPackage("demo", "c".repeat(64))?.manifest).toMatchObject({ version: 2, look: "repo" });
    expect(findPackage("demo", "c".repeat(64))!.manifest.files.map((f) => f.path)).toEqual(["demo/index.html", "design.json"]);
    expect(nextVersion("demo", "run-1")).toBe(3);
    expect(nextVersion("demo", "other")).toBe(1);
  });

  it("maps to .factory/design/<line>/vN/ in a repo with the manifest last, and that folder is not app code", async () => {
    const pkg = await writePackage(input());
    const files = repoFiles(pkg);
    expect(files.map((f) => f.path)).toEqual([".factory/design/run-1/v1/demo/index.html", ".factory/design/run-1/v1/design.json", ".factory/design/run-1/v1/tokens.css", ".factory/design/run-1/v1/tokens.json", ".factory/design/run-1/v1/manifest.json"]);
    expect(files.every((f) => PACKAGE_PATH.test(f.path))).toBe(true);
    expect(PACKAGE_PATH.test("src/design/tokens.css")).toBe(false);
    expect(isUiPath(".factory/design/run-1/v1/demo/index.html")).toBe(false);
    // a client's own folder of that older shape is app code (PR #11 review, item 12); an older factory package is still skipped
    expect(PACKAGE_PATH.test("src/design/buttons/v2/Button.tsx")).toBe(false);
    expect(isUiPath("src/design/buttons/v2/Button.tsx")).toBe(true);
    const listed = ["design/run-0/v1/manifest.json", "design/run-0/v1/demo/index.html", "src/design/buttons/v2/manifest.json", "src/design/buttons/v2/Button.tsx", "src/App.tsx"];
    const texts: Record<string, string> = { "design/run-0/v1/manifest.json": JSON.stringify({ designSha: "x", templateVersion: "20" }), "src/design/buttons/v2/manifest.json": "{\"name\":\"buttons\"}" };
    expect(withoutPackages(listed, (p) => texts[p])).toEqual(["src/design/buttons/v2/manifest.json", "src/design/buttons/v2/Button.tsx", "src/App.tsx"]);
    expect(isUiPath("apps/web/.factory/design/run-1/v2/tokens.css")).toBe(false);
    expect(isUiPath("src/app/page.tsx")).toBe(true);

    const repo = mkdtempSync(join(tmpdir(), "pkg-repo-"));
    for (const d of [[".factory", "design", "run-1", "v1"], ["design", "run-0", "v1"], ["design", "tokens", "v2"], ["src"]]) mkdirSync(join(repo, ...d), { recursive: true });
    writeFileSync(join(repo, ".factory", "design", "run-1", "v1", "tokens.css"), ":root{}");
    writeFileSync(join(repo, "design", "run-0", "v1", "tokens.css"), ":root{}");
    writeFileSync(join(repo, "design", "run-0", "v1", "manifest.json"), JSON.stringify({ designSha: "x", templateVersion: "20" }));
    writeFileSync(join(repo, "design", "tokens", "v2", "tokens.css"), ":root{}");
    writeFileSync(join(repo, "src", "page.tsx"), "export {}");
    // the current place and an older factory package are skipped; the client's own design/tokens/v2/ is app code
    expect(dirSource(repo).list()).toEqual(["design/tokens/v2/tokens.css", "src/page.tsx"]);
  });

  it("pictures each screen in its demo states plus the Components page", () => {
    const list = demoShotList(design([{ id: "S-2", route: "/report" }]).screens as never);
    expect(list.map((x) => x.id)).toEqual(["S-1", "S-2", "components"]);
    expect(list[0]!.title).toBe("Sign in");
  });
});

// ---------- design-export over a run ----------

let n = 0;
async function approvedRun(d: object, parent?: object): Promise<Ledger> {
  const ledger = Ledger.create(`20261002-pkg-${++n}-${Math.random().toString(16).slice(2, 6)}`);
  await ledger.append({ type: "run.created", data: { mode: "design", project: "demo", request: "a portal", operator: "sam", ...(parent ? { parent } : {}) } }, HUMAN_WRITER);
  const designSha = ledger.putJson(d);
  const demoSha = ledger.putArtifact(Buffer.from("<!doctype html><title>demo</title>"));
  const bundle = ledger.putJson({ design: designSha, demo: demoSha });
  await ledger.append({ type: "human.requested", data: { cardId: "design-1", kind: "approve", artifactSha: bundle, step: "design-baseline" } }, HUMAN_WRITER);
  await ledger.append({ type: "human.decided", data: { cardId: "design-1", decision: "approve", by: "lead", artifactSha: bundle } }, HUMAN_WRITER);
  const base = ledger.putJson({ ui: true, design: designSha, by: "lead" });
  await ledger.append({ type: "step.completed", key: "design-baseline/1", inputsHash: sha, outputs: [base], data: { named: { "design-baseline": base } } }, HUMAN_WRITER);
  return ledger;
}

describe("design-export", () => {
  it("writes v1 of a new line for the run that approved it, and the step records where", async () => {
    const ledger = await approvedRun(design());
    const state = replay(ledger.events());
    expect(designExportStep.inputs(state, ledger)).toMatchObject({ baseline: expect.any(String) });
    const ctx = { state, ledger, log: () => undefined } as never;
    const out = await designExportStep.run(ctx);
    expect(out).toMatchObject({ kind: "done", data: { line: ledger.runId, version: 1 } });
    const pkg = findPackage("demo", state.steps.get("design-baseline") && ledger.getJson<{ design: string }>(state.steps.get("design-baseline")!.outputs[0]!).design)!;
    expect(pkg.manifest).toMatchObject({ line: ledger.runId, version: 1, approved: { by: "lead" }, run: { id: ledger.runId, mode: "design" } });
    expect(pkg.manifest.previous).toBeUndefined();
    // again: the same package
    expect(((await exportRunPackage(state, ledger)) as { dir: string }).dir).toBe(pkg.dir);
  });

  it("says why there is no package: no approval, or no UI", async () => {
    const ledger = Ledger.create(`20261002-pkg-none-${Math.random().toString(16).slice(2, 6)}`);
    await ledger.append({ type: "run.created", data: { mode: "design", project: "demo", request: "r", operator: "sam" } }, HUMAN_WRITER);
    const base = ledger.putJson({ ui: false });
    await ledger.append({ type: "step.completed", key: "design-baseline/1", inputsHash: sha, outputs: [base], data: { named: { "design-baseline": base } } }, HUMAN_WRITER);
    expect(await exportRunPackage(replay(ledger.events()), ledger)).toEqual({ none: expect.stringMatching(/no UI/) });
  });

  it("makes a change request the next version of the line it changes, with what changed, and the card says so", async () => {
    const v1 = await approvedRun(design());
    const v1Sha = ledger1Design(v1);
    // the earlier run has no package yet (approved before packages): the change writes it first
    const change = await approvedRun(design([{ id: "S-2", route: "/report" }]), { runId: v1.runId, kind: "change", estimateSha: sha, breakdownSha: sha, specSha: sha, designSha: v1Sha });
    // the change run's ledger carries the earlier design (as a change request copies it)
    change.putJson(v1.getJson(v1Sha));
    const r = await exportRunPackage(replay(change.events()), change);
    expect("none" in r).toBe(false);
    const m = (r as { manifest: { line: string; version: number; previous: unknown; changes: string[] } }).manifest;
    expect(m).toMatchObject({ line: v1.runId, version: 2, previous: { version: 1, designSha: v1Sha, runId: v1.runId } });
    expect(m.changes.join("\n")).toMatch(/S-2/);
    expect(listPackages("demo").map((p) => `${p.manifest.line} v${p.manifest.version}`)).toEqual([`${v1.runId} v1`, `${v1.runId} v2`]);
    expect((await ensurePackage(v1.runId))?.manifest.version).toBe(1);

    const md = designCard(change.runId, { ...design([{ id: "S-2", route: "/report" }]), mapping: { unmappedReqs: [], orphanScreens: [] } } as never, sha, { diff: m.changes, compare: { line: v1.runId, was: 1, becomes: 2, runId: v1.runId, pairs: 3 } });
    expect(md).toContain(`Version: this change becomes v2 of design ${v1.runId} (v1 was approved in ${v1.runId}).`);
    expect(md).toMatch(/Side by side: 3 picture\(s\) of v1 next to the new ones/);
  });

  it("a run seeded from another run's approved design uses that run's package", async () => {
    const origin = await approvedRun(design());
    const seeded = Ledger.create(`20261002-pkg-seed-${Math.random().toString(16).slice(2, 6)}`);
    await seeded.append({ type: "run.created", data: { mode: "estimate", project: "demo", request: "r", operator: "sam", designRef: { runId: origin.runId, designSha: ledger1Design(origin) } } }, HUMAN_WRITER);
    const r = await exportRunPackage(replay(seeded.events()), seeded);
    expect((r as { manifest: { line: string; version: number } }).manifest).toMatchObject({ line: origin.runId, version: 1 });
    expect(listPackages("demo")).toHaveLength(1);
  });
});

const ledger1Design = (l: Ledger): string => {
  const s = replay(l.events());
  return l.getJson<{ design: string }>(s.steps.get("design-baseline")!.outputs[0]!).design;
};

describe("codeBase", () => {
  it("starts the build's own diff after the design package commit when there is one", () => {
    const steps = new Map<string, unknown>();
    const state = { info: { baseCommit: "base" }, steps } as never;
    expect(codeBase(state)).toBe("base");
    steps.set("stub-commit", { data: { stubCommit: "s" } });
    expect(codeBase(state)).toBe("base");
    steps.set("stub-commit", { data: { designCommit: "pkg" } });
    expect(codeBase(state)).toBe("pkg");
  });
});

describe("reproducible pictures", () => {
  it.skipIf(!findChromium())("takes the same bytes twice: frozen clock, no motion, fonts loaded", async () => {
    const off = process.env.FACTORY_NO_SCREENSHOTS;
    delete process.env.FACTORY_NO_SCREENSHOTS;
    try {
      const screens = [{ id: "S-1", route: "/pay", file: "app/pay/page.tsx", reqs: ["REQ-1"], states: ["default", "error"], size: "new", frames: [] }];
      const d = mkdtempSync(join(tmpdir(), "pkg-shots-"));
      const f = join(d, "demo.html");
      writeFileSync(f, buildDemo({ title: "Pay", flow: "pay", screens, requirements: { "REQ-1": "When paying, the system shall confirm." }, noScreen: [] }));
      const list = [{ id: "S-1", route: "/pay", states: ["default", "error"] }];
      const a = await captureDemo(f, list, join(d, "a"), { reproducible: true });
      const b = await captureDemo(f, list, join(d, "b"), { reproducible: true });
      // a capture that stopped part way says why (PR #11 review, item 21)
      expect(a.note).toBeUndefined();
      expect(b.note).toBeUndefined();
      expect(a.shots.length).toBeGreaterThan(0);
      expect(b.shots.map((s) => s.file)).toEqual(a.shots.map((s) => s.file));
      for (const s of a.shots) expect(readFileSync(join(d, "b", s.file)).equals(readFileSync(join(d, "a", s.file))), s.file).toBe(true);
      expect(a.shots[0]).toMatchObject({ id: "S-1" });
      const capped = await captureDemo(f, list, join(d, "c"), { reproducible: true, max: 2 });
      expect(capped.shots).toHaveLength(2);
      expect(capped.note).toBeTruthy();
    } finally {
      if (off !== undefined) process.env.FACTORY_NO_SCREENSHOTS = off;
    }
  }, 120_000);
});

describe("the first build commit", () => {
  it("puts the approved package in the repo (when the project asks) as its own commit before the stubs, and the build's diff starts after it", async () => {
    const { execFileSync } = await import("node:child_process");
    const { stubCommitStep } = await import("../stages/build.js");
    const repo = mkdtempSync(join(tmpdir(), "pkg-build-"));
    const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
    const git = (...a: string[]) => execFileSync("git", a, { cwd: repo, env, encoding: "utf8" }).trim();
    git("init", "-q", "-b", "main");
    writeFileSync(join(repo, "a.txt"), "x");
    git("add", "-A");
    git("commit", "-q", "-m", "init");
    const base = git("rev-parse", "HEAD");

    const ledger = Ledger.create(`20261002-pkg-build-${Math.random().toString(16).slice(2, 6)}`);
    await ledger.append({ type: "run.created", data: { mode: "brownfield", project: "demo", request: "a portal", operator: "sam", repoPath: repo, baseCommit: base } }, HUMAN_WRITER);
    const designSha = ledger.putJson(design());
    const bundle = ledger.putJson({ design: designSha, demo: ledger.putArtifact("<!doctype html><title>demo</title>") });
    await ledger.append({ type: "human.requested", data: { cardId: "design-1", kind: "approve", artifactSha: bundle, step: "design-baseline" } }, HUMAN_WRITER);
    await ledger.append({ type: "human.decided", data: { cardId: "design-1", decision: "approve", by: "lead", artifactSha: bundle } }, HUMAN_WRITER);
    await ledger.append({ type: "step.completed", key: "design/1", inputsHash: sha, outputs: [designSha], data: { named: { design: designSha } } }, HUMAN_WRITER);
    for (const [step, out] of [["design-baseline", { ui: true, design: designSha, by: "lead" }], ["plan", { stubs: [{ path: "src/Stub.cs", content: "class Stub {}" }] }], ["approve", {}]] as const) {
      const o = ledger.putJson(out);
      await ledger.append({ type: "step.completed", key: `${step}/1`, inputsHash: sha, outputs: [o], data: { named: { [step]: o } } }, HUMAN_WRITER);
    }
    const state = replay(ledger.events());
    // off by default (PR #11 review, item 12): the client's branch gets no package and the diff starts at the base
    const off = await stubCommitStep.run({ runId: ledger.runId, ledger, writer: HUMAN_WRITER, state, project: { design: {} }, log: () => undefined } as never);
    const offData = (off as { data: { designCommit?: string; design: { dir?: string } } }).data;
    expect(offData.designCommit).toBeUndefined();
    expect(offData.design.dir).toBeUndefined();
    const ctx = { runId: ledger.runId, ledger, writer: HUMAN_WRITER, state, project: { design: { commitPackage: true } }, log: () => undefined } as never;
    const out = await stubCommitStep.run(ctx);
    expect(out.kind).toBe("done");
    const data = (out as { data: { commit: string; designCommit: string; design: { dir: string; version: number } } }).data;
    expect(data.design).toMatchObject({ dir: `.factory/design/${ledger.runId}/v1`, version: 1 });
    const wt = replay(ledger.events()).workspace!.path;
    const show = (c: string) => execFileSync("git", ["show", "--name-only", "--format=%s", c], { cwd: wt, env, encoding: "utf8" }).trim().split("\n");
    const pkgCommit = show(data.designCommit);
    expect(pkgCommit[0]).toBe(`factory: design ${ledger.runId} v1 (approved by lead) for ${ledger.runId}`);
    expect(pkgCommit.slice(1).filter(Boolean).every((f) => f.startsWith(`.factory/design/${ledger.runId}/v1/`))).toBe(true);
    expect(pkgCommit).toContain(`.factory/design/${ledger.runId}/v1/manifest.json`);
    expect(show(data.commit).slice(1).filter(Boolean)).toEqual(["src/Stub.cs"]);
    expect(checkPackage(join(wt, data.design.dir)).problems).toEqual([]);
    const after = replay(ledger.events());
    after.steps.set("stub-commit", { data } as never);
    expect(codeBase(after)).toBe(data.designCommit);
  });
});
