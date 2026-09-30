import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { actualSize, approvedLevel, fidelityLint, touchesUiFiles } from "./build-checks.js";
import { overall } from "./fidelity.js";
import { sizeCapVerdict } from "./gates.js";

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const git = (d: string, ...a: string[]) => execFileSync("git", ["-C", d, "-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgSign=false", ...a], { encoding: "utf8" }).trim();
function repo(files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), "build-checks-"));
  dirs.push(dir);
  const put = (f: Record<string, string>) => { for (const [p, c] of Object.entries(f)) { mkdirSync(dirname(join(dir, p)), { recursive: true }); writeFileSync(join(dir, p), c); } };
  put(files);
  git(dir, "init", "-q", "-b", "main"); git(dir, "add", "-A"); git(dir, "commit", "-q", "-m", "base");
  const base = git(dir, "rev-parse", "HEAD");
  return { dir, base, commit: (f: Record<string, string>) => { put(f); git(dir, "add", "-A"); git(dir, "commit", "-q", "-m", "c"); return git(dir, "rev-parse", "HEAD"); } };
}
const APP = {
  "package.json": JSON.stringify({ dependencies: { next: "15.0.0", react: "19.0.0" } }),
  "tsconfig.json": JSON.stringify({ compilerOptions: { paths: { "@/*": ["./*"] } } }),
  "app/page.tsx": `import { Button } from "@/components/ui/button"\nexport default function Home() { return <Button /> }`,
  "components/ui/button.tsx": `export function Button() { return <button className="rounded">x</button> }`,
  "Api/Program.cs": "class P {}",
};

describe("approvedLevel", () => {
  it("is the biggest screen size, and none for a skipped design", () => {
    expect(approvedLevel(undefined)).toBe("none");
    expect(approvedLevel({ skipped: true })).toBe("none");
    expect(approvedLevel({ screens: [] })).toBe("none");
    expect(approvedLevel({ screens: [{ size: "reuse" }, { size: "tweak" }] })).toBe("tweak");
    expect(approvedLevel({ screens: [{ size: "tweak" }, { size: "new" }] })).toBe("new-screen");
    expect(approvedLevel({ screens: [{ size: "new" }, { size: "design-system" }] })).toBe("design-system");
  });
});

describe("build design checks over a commit range", () => {
  it("leaves a backend-only change alone", () => {
    const r = repo(APP);
    const head = r.commit({ "Api/Program.cs": "class P { int x; }" });
    expect(touchesUiFiles(r.dir, r.base, head)).toBe(false);
    expect(overall(fidelityLint(r.dir, r.base, head))).toBe("pass");
    expect(actualSize(r.dir, r.base, head).level).toBe("none");
  });

  it("fails the lint on a hex colour and passes a clean screen", () => {
    const r = repo(APP);
    const bad = r.commit({ "app/pay/page.tsx": `import { Button } from "@/components/ui/button"\nexport default function P() { return <div className="text-[#abcdef]"><Button /></div> }` });
    expect(touchesUiFiles(r.dir, r.base, bad)).toBe(true);
    expect(overall(fidelityLint(r.dir, r.base, bad))).toBe("fail");
    const r2 = repo(APP);
    const good = r2.commit({ "app/pay/page.tsx": `import { Button } from "@/components/ui/button"\nexport default function P() { return <Button /> }` });
    expect(overall(fidelityLint(r2.dir, r2.base, good))).toBe("pass");
  });

  it("the size cap passes within the approved size and fails above it", () => {
    const r = repo(APP);
    const head = r.commit({ "app/pay/page.tsx": `export default function P() { return <main /> }` });
    const actual = actualSize(r.dir, r.base, head);
    expect(actual.level).toBe("new-screen");
    expect(sizeCapVerdict(actual, { level: approvedLevel({ screens: [{ size: "new" }] }) }).passed).toBe(true);
    const over = sizeCapVerdict(actual, { level: approvedLevel({ screens: [{ size: "tweak" }] }) });
    expect(over.passed).toBe(false);
    expect(sizeCapVerdict(actual, { level: approvedLevel({ skipped: true }) }).passed).toBe(false);
  });
});

describe("ruleUi", () => {
  it("marks a request that names screens or carries frames as UI", async () => {
    const { ruleUi } = await import("../stages/spec.js");
    expect(ruleUi("Add a payments screen where users pick a card")).toBe(true);
    expect(ruleUi("Build the admin dashboard")).toBe(true);
    expect(ruleUi("Frames:\n- F-1 checkout.png\n")).toBe(true);
    expect(ruleUi("Add an endpoint that returns the invoice total")).toBe(false);
    expect(ruleUi("Fix the rounding of tax in the nightly job")).toBe(false);
  });
});

describe("project design settings and discover", () => {
  it("turns the design: block into toolkit options, leaving unset fields detected", async () => {
    const { designOptions } = await import("./build-checks.js");
    expect(designOptions(undefined)).toEqual({ navRaises: false });
    expect(designOptions({ sourceRoot: "", uiDir: "web/ui", brandFonts: [], navRaises: true })).toEqual({ sourceRoot: "", uiDir: "web/ui", navRaises: true });
  });
  it("finds a React or Next.js front end in any package.json", async () => {
    const { hasReactApp } = await import("./build-checks.js");
    const files = { "package.json": '{"name":"x"}', "web/package.json": '{"dependencies":{"next":"15.0.0"}}' };
    expect(hasReactApp(Object.keys(files), (p) => files[p as keyof typeof files])).toBe(true);
    expect(hasReactApp(["package.json"], () => '{"dependencies":{"express":"4"}}')).toBe(false);
    expect(hasReactApp(["src/App.cs"], () => "")).toBe(false);
  });
  it("uses the configured building-block folder for the size", async () => {
    const { actualSize } = await import("./build-checks.js");
    const r = repo({
      "package.json": JSON.stringify({ dependencies: { next: "15.0.0", react: "19.0.0" } }),
      "app/page.tsx": "export default function Home() { return <main /> }",
      "kit/card.tsx": "export function Card() { return <div /> }",
    });
    const head = r.commit({ "kit/badge.tsx": "export function Badge() { return <span /> }" });
    expect(actualSize(r.dir, r.base, head, { uiDir: "kit/" }).name).toBe("design-system change");
    expect(actualSize(r.dir, r.base, head).name).not.toBe("design-system change");
  });
});
