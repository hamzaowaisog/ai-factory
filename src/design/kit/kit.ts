// The factory's UI kits (docs/estimates-design.md, "Kit and scaffold"): React components for every block, form control and layer the
// design can use, copied into the repo for the stack it is built in, so the agents fill in behaviour instead of redrawing the look.
//
//   kits/<id>/kit.json        what the kit is: its targets, packages, and which file and component draws each block, control, layer
//   kits/<id>/components/...  the components (a repo owns them once copied, like shadcn/ui)
//   kits/<id>/lib/...         helpers: class names, translations, fixture states, navigation (a file per target: nav.next.tsx)
//
// A kit file is written once per target: its first line `// @client` becomes "use client" for Next.js and goes for Vite; a file named
// `x.next.tsx` or `x.vite.tsx` is that target's own `x.tsx`; `@/` imports point at the target's source root (kept when the repo maps
// `@/*` there, relative otherwise).
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, posix, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { FileSource } from "../source.js";

/** Where the kits are: `dist/kits` in a build (`npm run build` copies them, PR #11 review item 19), else the repo root `kits/`. */
export const KITS_DIR = [new URL("../../kits", import.meta.url), new URL("../../../kits", import.meta.url)].map((u) => fileURLToPath(u)).find((d) => existsSync(join(d, "shadcn", "kit.json"))) ?? fileURLToPath(new URL("../../../kits", import.meta.url));

export const UI_TARGETS = ["next-shadcn", "vite-shadcn", "repo"] as const;
export type UiTarget = (typeof UI_TARGETS)[number];
/** The targets a kit draws (repo has none: it builds with the repo's own components). */
export type KitTarget = Exclude<UiTarget, "repo">;
/** A UI target named on the command line or in the UI (`--ui-target`); undefined when none is given. */
export function uiTargetOption(v: string | undefined): UiTarget | undefined {
  if (v === undefined) return undefined;
  if (!(UI_TARGETS as readonly string[]).includes(v)) throw new Error(`--ui-target takes ${UI_TARGETS.join(", ")}; not ${v}`);
  return v as UiTarget;
}
export const isKitTarget = (t: string | undefined): t is KitTarget => t === "next-shadcn" || t === "vite-shadcn";

const Part = z.object({ file: z.string(), component: z.string() });
const Target = z.object({
  framework: z.enum(["next", "vite"]),
  /** where the kit goes in a fresh app ("src/" for Vite, "" for Next) */
  root: z.string(),
  /** the source roots the kit may go under in a repo, in order of preference */
  srcRoots: z.array(z.string()),
  stylesheet: z.string(), theme: z.string(),
  clientDirective: z.boolean(),
  routes: z.string(),
});
export const KitManifest = z.object({
  kind: z.literal("ai-factory/ui-kit"), id: z.string(), version: z.string(), description: z.string(), license: z.string().optional(),
  targets: z.record(z.string(), Target),
  dependencies: z.record(z.string(), z.string()),
  targetDependencies: z.record(z.string(), z.record(z.string(), z.string())),
  devDependencies: z.record(z.string(), z.record(z.string(), z.string())),
  blocks: z.record(z.string(), Part), controls: z.record(z.string(), Part), overlays: z.record(z.string(), Part), parts: z.record(z.string(), Part),
  responsive: z.array(z.object({ block: z.string().optional(), part: z.string().optional(), shell: z.string().optional(), below: z.string(), becomes: z.string() })),
});
export type KitManifest = z.infer<typeof KitManifest>;
export type KitTargetInfo = z.infer<typeof Target>;

export interface Kit { manifest: KitManifest; dir: string; files: string[] }

/** The kit's components as a fixed list for the design step (`StarterComponents` in src/stages/design-inputs.ts). */
export function kitComponents(kit: Kit = loadKit(), target: KitTarget = "next-shadcn"): { source: string; framework: string; styling: string; componentSystem: string; components: { name: string; kind: string }[] } {
  const m = kit.manifest;
  const seen = new Set<string>();
  const components: { name: string; kind: string }[] = [];
  for (const [kind, group] of [["block", m.blocks], ["control", m.controls], ["overlay", m.overlays], ["part", m.parts]] as const) {
    for (const p of Object.values(group)) if (!seen.has(p.component)) { seen.add(p.component); components.push({ name: p.component, kind }); }
  }
  return { source: `ai-factory kit ${m.id} ${m.version}`, framework: m.targets[target]?.framework ?? target, styling: "tailwind v4", componentSystem: "shadcn/ui", components };
}

/** The kit that draws a target (one for now: shadcn). */
export const kitIdFor = (_t: KitTarget): string => "shadcn";

export function listKits(dir = KITS_DIR): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((d) => existsSync(join(dir, d, "kit.json"))).sort();
}

export function loadKit(id = "shadcn", dir = KITS_DIR): Kit {
  const root = join(dir, id);
  const file = join(root, "kit.json");
  if (!existsSync(file)) throw new Error(`No UI kit "${id}" in ${dir}`);
  const manifest = KitManifest.parse(JSON.parse(readFileSync(file, "utf8")));
  const files: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d).sort()) {
      const p = join(d, e);
      if (statSync(p).isDirectory()) walk(p);
      // a licence beside the files it covers (components/ui/LICENSE) travels with them; the kit's own NOTICE stays here
      else if (/\.(tsx?|css)$/.test(e) || (d !== root && /^(LICENSE|NOTICE)(\.[a-z]+)?$/.test(e))) files.push(relative(root, p).split("\\").join("/"));
    }
  };
  walk(root);
  return { manifest, dir: root, files };
}

export function kitTarget(kit: Kit, target: KitTarget): KitTargetInfo {
  const t = kit.manifest.targets[target];
  if (!t) throw new Error(`The ${kit.manifest.id} kit has no target ${target}`);
  return t;
}

/** The kit file a target writes: `x.next.tsx` is Next's `x.tsx`, another target's variant is skipped. */
export function targetPath(file: string, target: KitTarget): string | undefined {
  const m = /^(.*)\.(next|vite)(\.tsx?)$/.exec(file);
  if (!m) return file;
  return m[2] === kitTargetFramework(target) ? `${m[1]}${m[3]}` : undefined;
}
const kitTargetFramework = (t: KitTarget) => (t === "next-shadcn" ? "next" : "vite");

/**
 * A kit file's text for a target: the client directive, and `@/` imports as the repo resolves them. `at` is the file's path in the
 * repo, `root` the source root the kit goes under, `alias` whether the repo maps `@/*` to that root.
 */
export function targetText(text: string, o: { target: KitTarget; client: boolean; at: string; root: string; alias: boolean }): string {
  let out = text.replace(/^\/\/ @client\r?\n/, o.client ? `"use client";\n` : "");
  if (!o.alias) {
    const from = posix.dirname(o.at);
    out = out.replace(/(from\s+|import\s*\(\s*|import\s+)(["'])@\/([^"']+)\2/g, (_m, kw: string, q: string, p: string) => {
      let rel = posix.relative(from, posix.join(o.root, p));
      if (!rel.startsWith(".")) rel = `./${rel}`;
      return `${kw}${q}${rel}${q}`;
    });
  }
  return out;
}

export interface KitFile { path: string; text: string; from: string }

/** Every file of the kit for a target, at its path in the repo. */
export function kitFiles(kit: Kit, target: KitTarget, o: { root: string; alias: boolean }): KitFile[] {
  const t = kitTarget(kit, target);
  const out: KitFile[] = [];
  for (const f of kit.files) {
    const p = targetPath(f, target);
    if (!p) continue;
    const at = `${o.root}${p}`;
    out.push({ path: at, from: f, text: targetText(readFileSync(join(kit.dir, f), "utf8"), { target, client: t.clientDirective, at, root: o.root, alias: o.alias }) });
  }
  return out;
}

// ---------- the repo's stack ----------

export interface TargetGuess {
  /** undefined: nothing to go on (no package.json), so the run asks or the default applies */
  target?: UiTarget;
  why: string;
  /** where the kit goes under in this repo */
  root?: string;
  /** whether the repo maps `@/*` to that root */
  alias?: boolean;
}

const pkgDeps = (text: string | undefined): Record<string, string> => {
  if (!text) return {};
  try {
    const j = JSON.parse(text) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    return { ...j.dependencies, ...j.devDependencies };
  } catch { return {}; }
};

/** Does the repo's tsconfig map `@/*` to this root? (comments and trailing commas allowed) */
export function aliasRoot(src: FileSource): string | undefined {
  for (const f of ["tsconfig.json", "tsconfig.app.json", "jsconfig.json"]) {
    const text = src.read(f);
    if (!text) continue;
    const m = /"@\/\*"\s*:\s*\[\s*"([^"]*)"/.exec(text);
    if (m) return m[1]!.replace(/^\.\//, "").replace(/\*$/, "");
  }
  return undefined;
}

/**
 * The stack a repo is built in, from its package.json. An existing app takes the shadcn kit only when it already uses shadcn/ui
 * (components.json or components/ui/button.tsx) on Next.js or Vite with React; anything else (plain Tailwind, Angular, Vue, a
 * Razor app, another component library) builds with the repo's own components, in its own pages. A package.json with no app
 * code yet (a starter) takes the kit too.
 */
export function detectUiTarget(src: FileSource): TargetGuess {
  const files = src.list();
  const pkg = src.read("package.json");
  if (!pkg) {
    const code = files.some((f) => /\.(cs|cshtml|razor|java|py|rb|php|go|vue|svelte)$/.test(f));
    return code ? { target: "repo", why: "no package.json at the root: not a React app the kit can go into" } : { why: "an empty repo: nothing to detect" };
  }
  const deps = pkgDeps(pkg);
  const has = (n: string) => n in deps;
  const fw = has("next") ? "next" : has("vite") && has("react") ? "vite" : undefined;
  if (!fw) return { target: "repo", why: has("react") ? "React without Next.js or Vite" : `not a React app (${["@angular/core", "vue", "svelte"].find(has) ?? "no react"})` };
  const other = ["@mui/material", "@chakra-ui/react", "antd", "@mantine/core", "react-bootstrap", "@fluentui/react-components"].find(has);
  if (other) return { target: "repo", why: `${fw === "next" ? "Next.js" : "Vite"} with ${other}: its own components stay` };
  const target: KitTarget = fw === "next" ? "next-shadcn" : "vite-shadcn";
  const kitRoot = fw === "next" ? (files.some((f) => f.startsWith("src/app/") || f.startsWith("src/pages/")) ? "src/" : "") : "src/";
  const mapped = aliasRoot(src);
  const shadcn = files.includes("components.json") || files.some((f) => /(^|\/)components\/ui\/button\.tsx$/.test(f));
  const tw = has("tailwindcss");
  const name = fw === "next" ? "Next.js" : "Vite + React";
  // an app with its own pages and no shadcn/ui: the kit would be a second app beside it, so its own components stay
  const pages = files.some((f) => /\.(t|j)sx$/.test(f));
  if (!shadcn && pages) return { target: "repo", why: `${name}${tw ? " with Tailwind" : ""} but not shadcn/ui: its own components and pages stay` };
  return {
    target, root: kitRoot, alias: mapped !== undefined && mapped === kitRoot,
    why: `${name}${shadcn ? " with shadcn/ui" : tw ? " with Tailwind" : ""}`,
  };
}

/** The target an app is built in: the project's setting for that app, then the project's, then the run's, then detection; a phone app has none. */
export function resolveUiTarget(o: { app?: { id: string; device?: string }; config?: { uiTarget?: UiTarget; uiTargets?: Record<string, UiTarget> }; run?: UiTarget; detected?: TargetGuess }): { target: UiTarget; source: "config" | "run" | "detected" | "default" | "phone" } {
  if (o.app?.device === "phone") return { target: "repo", source: "phone" };
  const per = o.app ? o.config?.uiTargets?.[o.app.id] : undefined;
  if (per) return { target: per, source: "config" };
  if (o.config?.uiTarget) return { target: o.config.uiTarget, source: "config" };
  if (o.run) return { target: o.run, source: "run" };
  if (o.detected?.target) return { target: o.detected.target, source: "detected" };
  return { target: "next-shadcn", source: "default" };
}
