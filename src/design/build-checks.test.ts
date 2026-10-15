import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { actualSize, approvedLevel, fidelityLint, screenLint, themeTokenLint, touchesUiFiles } from "./build-checks.js";
import { setsMonospace, stitchScaffoldBrief } from "./design-link.js";
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

describe("theme tokens a task changes", () => {
  it("fails a task that changes a theme token when the approved design is a new screen, and passes the rest (run 3f0f)", () => {
    const r = repo({ ...APP, "app/globals.css": `@import "tailwindcss";\n@import "./theme.css";\n` });
    // run 3f0f: a task put the approved look's variables in app/globals.css
    const tokens = r.commit({ "app/globals.css": `@import "tailwindcss";\n@import "./theme.css";\n:root {\n  --primary: oklch(0.5 0.2 250);\n}\n` });
    expect(themeTokenLint(r.dir, r.base, tokens, "new-screen")).toMatchObject({ check: "theme-tokens", status: "FAIL", items: ["app/globals.css"] });
    expect(themeTokenLint(r.dir, r.base, tokens, "design-system")).toBeUndefined();
    // a stylesheet edit that leaves the tokens alone, and a task with no stylesheet
    const plain = r.commit({ "app/globals.css": `@import "tailwindcss";\n@import "./theme.css";\n:root {\n  --primary: oklch(0.5 0.2 250);\n}\n.card { padding: 1rem; }\n` });
    expect(themeTokenLint(r.dir, tokens, plain, "tweak")).toMatchObject({ status: "PASS" });
    const page = r.commit({ "app/page.tsx": `export default function Home() { return <main /> }` });
    expect(themeTokenLint(r.dir, plain, page, "new-screen")).toBeUndefined();
  });
});

describe("a Stitch screen's page against its approved screen", () => {
  const screen = { id: "S-1", buttons: ["Mark delivered", "Open delivery"], mono: true };

  it("fails a page that leaves out a button, the monospace or fades its text (run 3f0f review)", () => {
    const r = repo(APP);
    const bad = r.commit({ "components/screens/s-1/container.tsx": `export function C() { return <div><span className="text-muted-foreground/70">D-1</span><button>Mark delivered</button></div> }` });
    const out = screenLint(r.dir, r.base, bad, screen);
    expect(out.map((x) => [x.check, x.status])).toEqual([["design labels", "FAIL"], ["design fonts", "FAIL"], ["design contrast", "FAIL"]]);
    expect(out[0]!.items).toEqual(["Open delivery"]);
    expect(out[2]!.items).toEqual(["text-muted-foreground/70"]);
  });

  it("passes the page that keeps them, wherever its words are written", () => {
    const r = repo(APP);
    const good = r.commit({
      "components/screens/s-1/container.tsx": `export function C() { return <div><span className="font-mono text-muted-foreground">D-1</span><button>{t.mark}</button><a className="hover:text-primary/80">open delivery</a></div> }`,
      "messages/en.json": JSON.stringify({ mark: "Mark delivered" }),
    });
    expect(screenLint(r.dir, r.base, good, screen).every((x) => x.status === "PASS")).toBe(true);
    // a design with no monospace asks for none
    expect(screenLint(r.dir, r.base, good, { ...screen, mono: false })[1]!.status).toBe("PASS");
  });

  it("tells the coding task the same before it starts", () => {
    const brief = stitchScaffoldBrief({ id: "S-1", container: "components/screens/s-1/container.tsx" }, ["default"], screen.buttons, true);
    expect(brief).toContain(`("Mark delivered", "Open delivery")`);
    expect(brief).toContain("keep them in font-mono");
    expect(brief).toContain("no see-through text");
    expect(stitchScaffoldBrief({ id: "S-1", container: "c.tsx" }, [])).not.toContain("font-mono");
    expect(setsMonospace(`<td class="font-mono text-xs">D-4823</td>`)).toBe(true);
    expect(setsMonospace(`<td class="text-xs">D-4823</td>`)).toBe(false);
  });
});
