import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, posix } from "node:path";
import { describe, expect, it } from "vitest";
import { FormField, MockBlock, MockOverlay } from "../../contracts/artifacts.js";
import type { FileSource } from "../source.js";
import {
  detectUiTarget, kitFiles, loadKit, OWNED_MARK, resolveUiTarget, scaffold, shadcnThemeCss, SHADCN_COLOURS, targetPath, targetText, writeScaffold, nextRouteDir, routerPath,
} from "./index.js";
import { sampleDesign } from "./sample.js";
import { PLAYWRIGHT_VERSION } from "./e2e.js";

type Ts = typeof import("typescript");
const ts = createRequire(import.meta.url)("typescript") as Ts;
const kit = loadKit();
const TAG = "ai-factory design r1 v1 (abc), approved by lead on 2026-10-01";
const mem = (files: Record<string, string>): FileSource => ({ list: () => Object.keys(files).sort(), read: (p) => files[p] });
const exportsOf = (text: string) => [...text.matchAll(/export\s+(?:async\s+)?(?:function|const|class|interface|type)\s+(\w+)/g)].map((m) => m[1]!)
  .concat([...text.matchAll(/export\s*\{([^}]+)\}/g)].flatMap((m) => m[1]!.split(",").map((x) => x.trim().split(/\s+as\s+/).pop()!.replace(/^type\s+/, ""))));

describe("the shadcn kit", () => {
  it("pins every package exactly and carries shadcn/ui's licence with its components (PR #11 review, item 19)", () => {
    const m = kit.manifest;
    const all = { ...m.dependencies, ...Object.assign({}, ...Object.values(m.targetDependencies)), ...Object.assign({}, ...Object.values(m.devDependencies)) } as Record<string, string>;
    for (const [n, v] of Object.entries(all)) expect(v, n).toMatch(/^\d+\.\d+\.\d+$/);
    expect(PLAYWRIGHT_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(existsSync(join(kit.dir, "NOTICE"))).toBe(true);
    const files = kitFiles(kit, "next-shadcn", { root: "", alias: true });
    expect(files.find((f) => f.path === "components/ui/LICENSE")?.text).toMatch(/MIT License[\s\S]*shadcn/);
    expect(files.some((f) => /(^|\/)NOTICE$/.test(f.path))).toBe(false);
  });
  it("draws every block, form field and layer the design schema has", () => {
    const blockTypes = MockBlock.options.map((o) => (o.shape.type as unknown as { value: string }).value);
    expect(blockTypes.length).toBe(29);
    expect(Object.keys(kit.manifest.blocks).sort()).toEqual([...blockTypes].sort());
    expect(Object.keys(kit.manifest.controls).sort()).toEqual([...FormField.shape.kind.unwrap().options].sort());
    expect(Object.keys(kit.manifest.overlays).sort()).toEqual([...MockOverlay.shape.kind.options].sort());
    for (const part of [kit.manifest.blocks, kit.manifest.controls, kit.manifest.overlays, kit.manifest.parts].flatMap((g) => Object.values(g))) {
      const file = join(kit.dir, part.file);
      expect(existsSync(file), part.file).toBe(true);
      expect(exportsOf(readFileSync(file, "utf8")), `${part.file} exports ${part.component}`).toContain(part.component);
    }
  });

  it("every file is valid TSX, and every import resolves to a kit file or a listed package", () => {
    const packages = new Set([...Object.keys(kit.manifest.dependencies), ...Object.values(kit.manifest.targetDependencies).flatMap(Object.keys), ...Object.values(kit.manifest.devDependencies).flatMap(Object.keys)]);
    const has = (p: string) => ["", ".ts", ".tsx", "/index.ts", "/index.tsx"].some((x) => kit.files.includes(p + x))
      || kit.files.some((f) => /\.(next|vite)\.tsx?$/.test(f) && f.replace(/\.(next|vite)(\.tsx?)$/, "") === p);
    for (const f of kit.files.filter((x) => /\.tsx?$/.test(x))) {
      const text = readFileSync(join(kit.dir, f), "utf8");
      const out = ts.transpileModule(text, { reportDiagnostics: true, fileName: f, compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
      expect(out.diagnostics?.map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n")) ?? [], f).toEqual([]);
      for (const m of text.matchAll(/(?:from\s+|import\s*\(\s*)["']([^"']+)["']/g)) {
        const spec = m[1]!;
        if (spec.startsWith("@/")) expect(has(spec.slice(2)), `${f}: ${spec}`).toBe(true);
        else if (spec.startsWith(".")) expect(has(posix.normalize(posix.join(posix.dirname(f), spec))), `${f}: ${spec}`).toBe(true);
        else {
          const pkg = spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0]!;
          expect(packages.has(pkg) || pkg === "react", `${f}: ${spec}`).toBe(true);
        }
      }
    }
  });

  it("a kit file is written per target: the client directive, the target's own variant, imports the repo resolves", () => {
    expect(targetPath("lib/nav.next.tsx", "next-shadcn")).toBe("lib/nav.tsx");
    expect(targetPath("lib/nav.next.tsx", "vite-shadcn")).toBeUndefined();
    expect(targetPath("lib/nav.vite.tsx", "vite-shadcn")).toBe("lib/nav.tsx");
    const src = `// @client\nimport { cn } from "@/lib/utils";\n`;
    expect(targetText(src, { target: "next-shadcn", client: true, at: "components/ui/x.tsx", root: "", alias: true })).toBe(`"use client";\nimport { cn } from "@/lib/utils";\n`);
    expect(targetText(src, { target: "vite-shadcn", client: false, at: "src/components/ui/x.tsx", root: "src/", alias: false })).toBe(`import { cn } from "../../lib/utils";\n`);
    const next = kitFiles(kit, "next-shadcn", { root: "", alias: true });
    expect(next.find((f) => f.path === "lib/nav.tsx")?.text).toContain("next/navigation");
    expect(next.every((f) => !f.text.startsWith("// @client"))).toBe(true);
    const vite = kitFiles(kit, "vite-shadcn", { root: "src/", alias: true });
    expect(vite.find((f) => f.path === "src/lib/nav.tsx")?.text).toContain("react-router");
    expect(vite.some((f) => f.text.includes('"use client"'))).toBe(false);
  });
});

describe("the repo's stack", () => {
  it("Next.js or Vite with React takes the kit when it uses shadcn/ui or has no pages yet; another stack, UI library or a Tailwind-only app builds with its own", () => {
    const pkg = (deps: Record<string, string>) => JSON.stringify({ dependencies: deps });
    expect(detectUiTarget(mem({ "package.json": pkg({ next: "15", react: "19" }), "app/page.tsx": "", "components/ui/button.tsx": "" }))).toMatchObject({ target: "next-shadcn", root: "", alias: false });
    // an app with pages but no shadcn/ui keeps its own: no second app beside it
    expect(detectUiTarget(mem({ "package.json": pkg({ next: "15", react: "19", tailwindcss: "4" }), "app/page.tsx": "" }))).toMatchObject({ target: "repo", why: "Next.js with Tailwind but not shadcn/ui: its own components and pages stay" });
    expect(detectUiTarget(mem({ "package.json": pkg({ vite: "7", react: "19" }), "src/pages/Home.tsx": "" })).target).toBe("repo");
    expect(detectUiTarget(mem({ "package.json": pkg({ next: "15", react: "19" }), "src/app/page.tsx": "", "tsconfig.json": `{ "compilerOptions": { "paths": { "@/*": ["./src/*"] } } }`, "components.json": "{}" })))
      .toMatchObject({ target: "next-shadcn", root: "src/", alias: true, why: "Next.js with shadcn/ui" });
    expect(detectUiTarget(mem({ "package.json": pkg({ vite: "7", react: "19" }) }))).toMatchObject({ target: "vite-shadcn", root: "src/" });
    expect(detectUiTarget(mem({ "package.json": pkg({ next: "15", react: "19", "@mui/material": "7" }) })).target).toBe("repo");
    expect(detectUiTarget(mem({ "package.json": pkg({ "@angular/core": "20" }) })).target).toBe("repo");
    expect(detectUiTarget(mem({ "Api/Program.cs": "" })).target).toBe("repo");
    expect(detectUiTarget(mem({})).target).toBeUndefined();
  });

  it("the target comes from the project's setting per app, the project's, the run's, then detection; a phone app has none", () => {
    expect(resolveUiTarget({ app: { id: "m", device: "phone" }, config: { uiTarget: "next-shadcn" } })).toEqual({ target: "repo", source: "phone" });
    expect(resolveUiTarget({ app: { id: "admin" }, config: { uiTarget: "next-shadcn", uiTargets: { admin: "vite-shadcn" } } }).target).toBe("vite-shadcn");
    expect(resolveUiTarget({ config: { uiTarget: "repo" }, run: "next-shadcn" })).toEqual({ target: "repo", source: "config" });
    expect(resolveUiTarget({ run: "vite-shadcn", detected: { target: "next-shadcn", why: "" } })).toEqual({ target: "vite-shadcn", source: "run" });
    expect(resolveUiTarget({ detected: { target: "repo", why: "" } })).toEqual({ target: "repo", source: "detected" });
    expect(resolveUiTarget({})).toEqual({ target: "next-shadcn", source: "default" });
  });
});

describe("the shadcn theme", () => {
  it("names every colour shadcn reads, with the dark values for a product in both modes", () => {
    const theme = sampleDesign().theme!;
    const css = shadcnThemeCss(theme, TAG);
    expect(css.split("\n")[0]).toBe(`/* ${TAG} */`);
    for (const [k] of SHADCN_COLOURS) {
      expect(css, k).toMatch(new RegExp(`--${k}: [^;]+;`));
      expect(css).toContain(`--color-${k}: var(--${k});`);
    }
    expect(css).toContain(".dark, [data-theme=\"dark\"]");
    expect(css).toContain("@media (prefers-color-scheme: dark)");
    expect(css).toContain(`--primary: ${theme.brand}`);
    expect(css).toMatch(/--spacing-pad: var\(--space-pad\)/);
    const light = shadcnThemeCss({ ...theme, mode: "light" }, TAG);
    expect(light).not.toContain("prefers-color-scheme");
    expect(light).not.toContain(".dark, [data-theme");
  });
});

describe("the scaffold", () => {
  const design = sampleDesign();
  const base = { design, kit, product: "Acme Billing", tag: TAG, apps: ["portal"] };

  it("routes are paths the stack serves", () => {
    expect(nextRouteDir("/")).toBe("");
    expect(nextRouteDir("/accounts/:id/edit")).toBe("accounts/[id]/edit");
    expect(nextRouteDir("/a b")).toBeUndefined();
    expect(routerPath("/accounts/[id]")).toBe("/accounts/:id");
  });

  it("a fresh Next.js app: the kit, the theme, a page per web screen with its blocks, states and fixtures, and the app around them", () => {
    const l = scaffold({ ...base, target: "next-shadcn" });
    expect(l.fresh).toBe(true);
    expect(l.screens.map((s) => s.id)).toEqual(["S-1", "S-2", "S-3", "S-4", "S-5", "S-7"]);
    expect(l.notes.join()).toContain("S-6");
    const file = (p: string) => l.files.find((f) => f.path === p)?.text ?? "";
    for (const p of ["package.json", "tsconfig.json", "next.config.ts", "postcss.config.mjs", "app/layout.tsx", "app/globals.css", "app/design-theme.css", "app/page.tsx", "app/invoices/[id]/page.tsx", "components/screens/frame.ts", "lib/messages.ts"]) expect(file(p), p).not.toBe("");
    const s1 = l.screens[0]!;
    expect(s1).toMatchObject({ component: "DashboardScreen", containerName: "DashboardContainer", container: "components/screens/s-1/container.tsx", page: "app/page.tsx" });
    expect(Object.keys(s1.states)).toEqual(["default", "loading", "empty", "error", "dialog-new-invoice", "confirm-delete-every-invoice", "menu-row-actions", "toast-marked-as-paid", "full-data"]);
    const screen = file(s1.screen);
    expect(screen.startsWith(`"use client";`)).toBe(true);
    expect(screen).toContain(OWNED_MARK);
    for (const [i, t] of ["stats", "chart", "toolbar", "table", "alert", "actions"].entries()) expect(screen).toContain(`mark="${t}" {...data.b${i}}`);
    expect(screen).toContain(`"to": "/invoices/:id"`);
    expect(file(s1.fixtures)).toContain("satisfies TableData");
    expect(file("app/page.tsx")).toContain(`fixtureState(typeof fixture === "string" ? fixture : undefined, "S-1")`);
    expect(file("lib/messages.ts")).toContain(`"Dashboard": "ڈیش بورڈ"`);
    expect(JSON.parse(file("package.json")).dependencies.next).toBeDefined();
    // everything but the app's own files is protected from the implement tasks
    expect(l.protected).toContain(s1.screen);
    expect(l.protected).toContain("app/design-theme.css");
    expect(l.protected).toContain("components/ui/button.tsx");
    expect(l.protected).not.toContain(s1.container);
    expect(l.designSystem.files).toEqual(expect.arrayContaining(["package.json", "app/globals.css", "app/layout.tsx"]));
  });

  it("Vite: a route list instead of route files, the kit under src/", () => {
    const l = scaffold({ ...base, target: "vite-shadcn" });
    expect(l.root).toBe("src/");
    const routes = l.files.find((f) => f.path === "src/design-routes.tsx")!.text;
    expect(routes).toContain(`{ path: "/invoices/:id", element: <Fixture id="S-2" page={(f) => <InvoiceContainer fixture={f} />} /> }`);
    expect(l.files.some((f) => f.path === "src/lib/nav.tsx" && f.text.includes("react-router"))).toBe(true);
    expect(l.files.map((f) => f.path)).toEqual(expect.arrayContaining(["index.html", "vite.config.ts", "src/main.tsx", "src/index.css", "src/design-theme.css"]));
  });

  it("an existing repo: nothing of its own is written over; what the kit needs becomes the design-system task's work", () => {
    const repo = mem({
      "package.json": JSON.stringify({ dependencies: { next: "15", react: "19", "lucide-react": "0.5" } }),
      "app/layout.tsx": "export default function L() {}",
      "app/globals.css": "@import \"tailwindcss\";",
      "components/ui/button.tsx": "export function Button() {}",
      "app/page.tsx": "export default function Home() {}",
    });
    const l = scaffold({ ...base, target: "next-shadcn", src: repo, root: "", alias: true });
    expect(l.fresh).toBe(false);
    const paths = l.files.map((f) => f.path);
    for (const p of ["package.json", "app/layout.tsx", "app/globals.css", "components/ui/button.tsx", "app/page.tsx"]) expect(paths, p).not.toContain(p);
    expect(l.kept).toEqual(expect.arrayContaining(["components/ui/button.tsx", "app/page.tsx"]));
    expect(l.protected).not.toContain("components/ui/button.tsx");
    const todo = l.designSystem.todo.join("\n");
    expect(todo).toContain("radix-ui@");
    expect(todo).not.toContain("lucide-react@");
    expect(todo).toContain(`@import "./design-theme.css"`);
    expect(todo).not.toContain("DesignProviders");
    expect(todo).toContain("from the app's own navigation in app/layout.tsx");
    expect(l.files.some((f) => /components\/screens\/(frame\.ts|providers\.tsx)$/.test(f.path))).toBe(false);
    expect(todo).toContain("button.tsx");
    expect(l.designSystem.files).toEqual(["package.json", "app/globals.css", "app/layout.tsx"]);
  });

  it("a change request writes only the changed screens again, over the factory's own files only", () => {
    const first = scaffold({ ...base, target: "next-shadcn" });
    const built = Object.fromEntries(first.files.map((f) => [f.path, f.text]));
    built["components/screens/s-3/screen.tsx"] = "// the team's own page now";
    const l = scaffold({ ...base, target: "next-shadcn", src: mem(built), root: "", alias: true, changed: ["S-2", "S-3"], removed: ["S-9"] });
    const paths = l.files.map((f) => f.path);
    expect(paths.filter((p) => p.includes("components/screens/s-"))).toEqual([]); // S-2 unchanged text, S-3 the team's own: neither written
    expect(l.kept).toContain("components/screens/s-3/screen.tsx");
    expect(l.screens.map((s) => s.id)).toContain("S-1");
    expect(l.designSystem.todo.join()).toContain("S-9");
    const changedDesign = structuredClone(design);
    changedDesign.screens[1]!.mock!.title = "Invoice detail";
    const l2 = scaffold({ ...base, design: changedDesign, target: "next-shadcn", src: mem(built), root: "", alias: true, changed: ["S-2"] });
    expect(l2.files.map((f) => f.path).filter((p) => p.includes("/s-"))).toEqual(["components/screens/s-2/fixtures.ts", "components/screens/s-2/screen.tsx", "e2e/design/s-2.spec.ts"].filter((p) => built[p] !== l2.files.find((f) => f.path === p)?.text));
    expect(l2.files.find((f) => f.path === "components/screens/s-2/screen.tsx")?.text).toContain("Invoice detail");
  });

  it("the repo's look stays: no theme", () => {
    const l = scaffold({ ...base, design: { ...design, themeSource: "repo" }, target: "next-shadcn" });
    expect(l.files.some((f) => f.owner === "theme")).toBe(false);
    expect(l.files.find((f) => f.path === "app/globals.css")?.text).not.toContain("design-theme");
  });

  // npm install and a production build of both targets; slow and needs the network: FACTORY_KIT_E2E=1
  it.runIf(process.env.FACTORY_KIT_E2E === "1")("the scaffolded apps install and build", { timeout: 900_000 }, () => {
    for (const target of ["vite-shadcn", "next-shadcn"] as const) {
      const dir = mkdtempSync(join(tmpdir(), `kit-${target}-`));
      try {
        writeScaffold(scaffold({ ...base, target }), dir);
        execFileSync("npm", ["install", "--no-audit", "--no-fund"], { cwd: dir, stdio: "pipe" });
        execFileSync("npx", target === "vite-shadcn" ? ["vite", "build"] : ["next", "build"], { cwd: dir, stdio: "pipe", env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" } });
        // every kit file typechecks in both targets (after the build, which writes next-env.d.ts)
        execFileSync("npx", ["tsc", "-p", ".", "--noEmit"], { cwd: dir, stdio: "pipe" });
      } finally { rmSync(dir, { recursive: true, force: true }); }
    }
  });
});
