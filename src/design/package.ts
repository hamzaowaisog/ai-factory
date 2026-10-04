// The design package (docs/estimates-design.md, "The design package"): the approved design written out
// as files that do not depend on any stack, so exports, the build and later runs read one thing.
//
//   <store>/designs/<project>/<line>/vN/
//     manifest.json   the line, version, schemaVersion, design sha, who approved it and when, the run, the
//                     references used, the template version, the screens, the shots and every file's sha-256
//     design.json     the approved design (screens, blocks, states, overlays, toasts, links, theme, locale)
//     tokens.json     W3C Design Tokens (2025.10): primitive values per mode and the semantic names the code uses
//     tokens.css      the same tokens as CSS custom properties
//     demo/index.html the clickable demo the lead approved, byte for byte
//     shots/          reproducible pictures of the demo (each screen and state, phone, tablet, desktop, dark, other language)
//
// A package is never changed after it is written: the ledger stays the source of truth and the package is an
// export of it. A change after approval is a new version in the same line (v2, v3, ...). The repo gets the same
// folder under `design/<line>/vN/` with the first build commit.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import type { DesignTheme } from "../contracts/artifacts.js";
import { COMPONENTS_ID, demoStates } from "./demo.js";
import { captureDemo, type Shot, type ScreenShotInput } from "./screenshots.js";
import { designTokens } from "./tokens.js";
import { factoryHome } from "../util/paths.js";
import { STANDALONE_PROJECT } from "../config/project.js";

/** The package format (manifest and folder layout). */
export const PACKAGE_SCHEMA_VERSION = 1;
/** The format of `design.json`; an older one is migrated when read (`readDesignJson`). */
export const DESIGN_SCHEMA_VERSION = 1;
/** Where packages go in a repo. */
export const REPO_DESIGN_DIR = ".factory/design";
/** A file inside a package in a repo (`.factory/design/<line>/vN/...`): not app code, so the design inventory and the size checks skip it. */
export { DESIGN_PACKAGE_PATH as PACKAGE_PATH } from "./source.js";
/** Pictures in one package at most (each screen and state at three widths, dark mode and a second language). */
export const MAX_PACKAGE_SHOTS = 240;

export interface PackageFile { path: string; sha256: string; bytes: number }
export interface PackageScreen { id: string; title: string; route: string; reqs: string[]; states: string[] }

export interface DesignManifest {
  kind: "ai-factory/design-package";
  schemaVersion: number;
  /** the design line: the run that approved v1; every later version of the same design keeps it */
  line: string;
  version: number;
  /** the approved design in the ledger, and the clickable demo the lead approved */
  designSha: string;
  demoSha: string;
  run: { id: string; mode: string; project: string };
  product: { name?: string; client?: string };
  approved: { by: string; at: string };
  /** the design step's template version when it drew this design */
  templateVersion: string;
  designSchemaVersion: number;
  /** where the look comes from: the design's own theme, or the repo's (no tokens then: the app keeps its own) */
  look: "design" | "repo";
  references: { id: string; role: string; source: string; use?: string; how?: string }[];
  screens: PackageScreen[];
  /** the version this one changes, and what changed (a change request only) */
  previous?: { version: number; designSha: string; runId: string };
  changes?: string[];
  shots: Shot[];
  /** why there are fewer pictures than screens and states (no browser, a cap) */
  shotsNote?: string;
  files: PackageFile[];
}

export interface DesignPackage { manifest: DesignManifest; dir: string }

// ---------- W3C design tokens ----------

type Colour = { colorSpace: "srgb"; components: [number, number, number]; alpha?: number; hex: string };
const r4 = (n: number) => Math.round(n * 10000) / 10000;
const hex2 = (n: number) => Math.round(n).toString(16).padStart(2, "0");

/** A CSS colour (#rgb, #rrggbb, #rrggbbaa, rgb(), rgba()) as a W3C colour value. Throws on anything else. */
export function w3cColour(css: string): Colour {
  const c = css.trim().toLowerCase();
  let rgb: number[] | undefined, a = 1;
  const h = /^#([0-9a-f]{3,8})$/.exec(c)?.[1];
  if (h && [3, 6, 8].includes(h.length)) {
    const full = h.length === 3 ? h.split("").map((x) => x + x).join("") : h;
    rgb = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
    if (full.length === 8) a = parseInt(full.slice(6, 8), 16) / 255;
  }
  const f = /^rgba?\(([^)]+)\)$/.exec(c)?.[1];
  if (f) {
    const parts = f.split(/[\s,/]+/).filter(Boolean).map(Number);
    if (parts.length >= 3 && parts.every((x) => Number.isFinite(x))) { rgb = parts.slice(0, 3); a = parts[3] ?? 1; }
  }
  if (!rgb) throw new Error(`Not a colour the design tokens can hold: ${css}`);
  return { colorSpace: "srgb", components: rgb.map((x) => r4(x / 255)) as [number, number, number], ...(a < 1 ? { alpha: r4(a) } : {}), hex: `#${rgb.map(hex2).join("")}` };
}

/** Split a CSS list on its top-level commas (a comma inside rgba() stays). */
function topLevel(css: string): string[] {
  const out: string[] = [];
  let depth = 0, cur = "";
  for (const ch of css) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) { out.push(cur.trim()); cur = ""; } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

const px = (v: string) => ({ value: Number(v.replace(/px$/, "")) || 0, unit: "px" as const });

/** A CSS box-shadow as W3C shadow values. */
export function w3cShadow(css: string): object[] {
  return topLevel(css).map((one) => {
    const colour = /(rgba?\([^)]*\)|#[0-9a-f]{3,8})/i.exec(one)?.[1] ?? "#000000";
    const rest = one.replace(colour, " ").trim().split(/\s+/);
    const inset = rest.includes("inset");
    const lens = rest.filter((x) => x !== "inset");
    return { color: w3cColour(colour), offsetX: px(lens[0] ?? "0"), offsetY: px(lens[1] ?? "0"), blur: px(lens[2] ?? "0"), spread: px(lens[3] ?? "0"), ...(inset ? { inset: true } : {}) };
  });
}

/** A CSS font stack as a W3C font family list. */
export const fontList = (stack: string): string[] => topLevel(stack).map((f) => f.replace(/^["']|["']$/g, ""));

const bezier = (css: string): number[] | undefined => {
  const m = /^cubic-bezier\(([^)]+)\)$/.exec(css.trim());
  const n = m?.[1]!.split(",").map(Number);
  return n?.length === 4 && n.every(Number.isFinite) ? n : undefined;
};

/**
 * The approved look as W3C Design Tokens (format 2025.10): `primitive` holds the values of each colour mode,
 * and the semantic names the code uses (`color.brand`, `color.text-muted`, `radius`, `font.family.body`)
 * point at them. A product in both modes points at light and names the dark value under `$extensions`.
 */
export function w3cTokens(theme: DesignTheme): Record<string, unknown> {
  const t = designTokens(theme);
  const modes = Object.keys(t.colour) as ("light" | "dark")[];
  const first = modes[0]!;
  const primitive = Object.fromEntries(modes.map((m) => [m, Object.fromEntries(Object.entries(t.colour[m]!).map(([k, v]) => [k, { $value: w3cColour(v) }]))]));
  const ref = (m: string, k: string) => `{primitive.color.${m}.${k}}`;
  const otherModes = (k: string) => (modes.length > 1 ? { $extensions: { "ai.factory.modes": Object.fromEntries(modes.slice(1).map((m) => [m, ref(m, k)])) } } : {});
  const colour = Object.fromEntries(Object.keys(t.colour[first]!).map((k) => [k, { $value: ref(first, k), ...otherModes(k) }]));
  const shadow = Object.fromEntries((["card", "raised"] as const).map((k) => [k, {
    $value: w3cShadow(t.shadow[first]![k]),
    ...(modes.length > 1 ? { $extensions: { "ai.factory.modes": Object.fromEntries(modes.slice(1).map((m) => [m, w3cShadow(t.shadow[m]![k])])) } } : {}),
  }]));
  const ease = bezier(t.motion.ease), spring = bezier(t.motion.spring);
  return {
    $description: "The approved look as W3C Design Tokens (2025.10). Semantic names point at the primitive values of the default colour mode; other modes are under $extensions.ai.factory.modes.",
    primitive: { color: { $type: "color", ...primitive } },
    color: { $type: "color", ...colour },
    font: {
      family: { $type: "fontFamily", body: { $value: fontList(t.type.body) }, heading: { $value: fontList(t.type.heading) } },
      weight: { $type: "fontWeight", heading: { $value: t.type.headingWeight } },
      $extensions: { "ai.factory": { headingTracking: t.type.headingTracking } },
    },
    radius: { $type: "dimension", $value: { value: t.radiusPx, unit: "px" } },
    space: { $type: "dimension", pad: { $value: { value: t.space.padPx, unit: "px" } }, row: { $value: { value: t.space.rowPx, unit: "px" } } },
    shadow: { $type: "shadow", ...shadow },
    motion: {
      ...(ease ? { ease: { $type: "cubicBezier", $value: ease } } : {}),
      ...(spring ? { spring: { $type: "cubicBezier", $value: spring } } : {}),
      rise: { $type: "dimension", $value: { value: t.motion.risePx, unit: "px" } },
      $extensions: { "ai.factory": { calm: t.motion.calm } },
    },
    $extensions: { "ai.factory": { modes, defaultMode: first, surfaceBlur: t.surfaceBlur } },
  };
}

// ---------- design.json ----------

/** Migrations of `design.json`, from the version named to the next one. None yet: version 1 is the first. */
const MIGRATIONS: Record<number, (d: Record<string, unknown>) => Record<string, unknown>> = {};

/** Read a package's `design.json`, migrated to the current format. Refuses a newer format than this factory knows. */
export function readDesignJson(text: string): Record<string, unknown> {
  let d = JSON.parse(text) as Record<string, unknown>;
  let v = Number(d.schemaVersion ?? 1);
  if (v > DESIGN_SCHEMA_VERSION) throw new Error(`design.json is format ${v}, made by a newer factory (this one reads up to ${DESIGN_SCHEMA_VERSION}). Update the factory.`);
  while (v < DESIGN_SCHEMA_VERSION) {
    const m = MIGRATIONS[v];
    if (!m) throw new Error(`design.json format ${v} has no migration to ${v + 1}.`);
    d = { ...m(d), schemaVersion: ++v };
  }
  return d;
}

// ---------- the pictures ----------

/** A page's name as the lead knows it: its title, with the route when two pages share a title. */
export function screenLabels(screens: { id: string; route: string; mock?: { title?: string } }[]): Map<string, string> {
  const named = (s: (typeof screens)[number]) => s.mock?.title?.trim();
  return new Map(screens.map((s) => {
    const t = named(s);
    return [s.id, !t ? `${s.id} ${s.route}` : screens.filter((o) => named(o) === t).length > 1 ? `${t} (${s.route})` : t];
  }));
}

/** What the demo is pictured from: each screen with its demo tabs, and the Components page when the design draws pages. */
export function demoShotList(screens: { id: string; route: string; mock?: { title?: string } }[]): ScreenShotInput[] {
  const label = screenLabels(screens);
  return [
    ...screens.map((sc) => ({ id: sc.id, route: sc.route, states: demoStates(sc as never), title: label.get(sc.id)! })),
    ...(screens.some((sc) => sc.mock) && !screens.some((sc) => sc.id === COMPONENTS_ID) ? [{ id: COMPONENTS_ID, route: "/components", states: ["All states"], title: "Components" }] : []),
  ];
}

// ---------- the store ----------

export const storeRoot = (project: string): string => join(factoryHome(), "designs", project);
export const packageDir = (project: string, line: string, version: number): string => join(storeRoot(project), line, `v${version}`);
const sha256 = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");

/** Every package of a project, oldest line and version first. */
export function listPackages(project: string): DesignPackage[] {
  const root = storeRoot(project);
  if (!existsSync(root)) return [];
  const out: DesignPackage[] = [];
  for (const line of readdirSync(root).sort()) {
    const ld = join(root, line);
    if (!statSync(ld).isDirectory()) continue;
    for (const v of readdirSync(ld).filter((x) => /^v\d+$/.test(x)).sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))) {
      const f = join(ld, v, "manifest.json");
      if (!existsSync(f)) continue;
      try { out.push({ manifest: JSON.parse(readFileSync(f, "utf8")) as DesignManifest, dir: join(ld, v) }); } catch { /* a damaged manifest is no package */ }
    }
  }
  return out;
}

/** The package of an approved design, by its ledger sha. */
export const findPackage = (project: string, designSha: string): DesignPackage | undefined =>
  listPackages(project).find((p) => p.manifest.designSha === designSha);

/**
 * The package of a run's approved design: in the run's project, or, for a new product (a greenfield run), under the standalone
 * project the design was drawn in (it had no repo).
 */
export const packageForRun = (info: { project: string; mode: string }, designSha: string): DesignPackage | undefined =>
  findPackage(info.project, designSha) ?? (info.mode === "greenfield" ? findPackage(STANDALONE_PROJECT, designSha) : undefined);

/** The next free version in a line. */
export const nextVersion = (project: string, line: string): number =>
  listPackages(project).filter((p) => p.manifest.line === line).reduce((n, p) => Math.max(n, p.manifest.version), 0) + 1;

/** Read a package and check every file against its manifest: what is missing or changed is listed. */
export function checkPackage(dir: string): { manifest: DesignManifest; problems: string[] } {
  const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")) as DesignManifest;
  const problems: string[] = [];
  if (manifest.schemaVersion > PACKAGE_SCHEMA_VERSION) problems.push(`the package is format ${manifest.schemaVersion}, newer than this factory reads (${PACKAGE_SCHEMA_VERSION})`);
  for (const f of manifest.files) {
    const p = join(dir, f.path);
    if (!existsSync(p)) problems.push(`${f.path} is missing`);
    else if (sha256(readFileSync(p)) !== f.sha256) problems.push(`${f.path} was changed after approval`);
  }
  return { manifest, problems };
}

export interface PackageInput {
  project: string;
  line: string;
  version: number;
  design: { screens: { id: string; route: string; reqs: string[]; states?: string[]; mock?: { title?: string } }[]; theme?: DesignTheme; themeSource?: string; refUse?: { id: string; use: string; how: string }[] } & Record<string, unknown>;
  designSha: string;
  demoHtml: string;
  demoSha: string;
  run: DesignManifest["run"];
  product: DesignManifest["product"];
  approved: DesignManifest["approved"];
  templateVersion: string;
  references: { id: string; role: string; source: string }[];
  previous?: DesignManifest["previous"];
  changes?: string[];
  log?: (msg: string) => void;
}

/**
 * Write a package to the store. The folder is filled under a temporary name and moved into place at the end,
 * so a package is either whole or absent. A folder that already holds this design is returned as it is; one
 * that holds another design is refused (a package never changes).
 */
export async function writePackage(p: PackageInput): Promise<DesignPackage> {
  const dir = packageDir(p.project, p.line, p.version);
  if (existsSync(join(dir, "manifest.json"))) {
    const had = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")) as DesignManifest;
    if (had.designSha === p.designSha) return { manifest: had, dir };
    throw new Error(`Design ${p.line} v${p.version} already holds another approved design (${had.designSha.slice(0, 8)}); a package never changes.`);
  }
  const tmp = `${dir}.tmp-${process.pid}`;
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(join(tmp, "demo"), { recursive: true });
  const { header: _h, ...design } = p.design as Record<string, unknown> & { header?: unknown };
  writeFileSync(join(tmp, "design.json"), `${JSON.stringify({ schemaVersion: DESIGN_SCHEMA_VERSION, ...design }, null, 2)}\n`);
  const look = p.design.theme && p.design.themeSource !== "repo" ? "design" : "repo";
  if (look === "design") {
    writeFileSync(join(tmp, "tokens.json"), `${JSON.stringify(w3cTokens(p.design.theme!), null, 2)}\n`);
    writeFileSync(join(tmp, "tokens.css"), designTokens(p.design.theme!).css);
  }
  writeFileSync(join(tmp, "demo", "index.html"), p.demoHtml);
  const shots = await captureDemo(join(tmp, "demo", "index.html"), demoShotList(p.design.screens), join(tmp, "shots"), { reproducible: true, max: MAX_PACKAGE_SHOTS });
  if (shots.note) p.log?.(`design package: ${shots.note}`);
  const files: PackageFile[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const f = join(d, e.name);
      if (e.isDirectory()) walk(f);
      else { const b = readFileSync(f); files.push({ path: relative(tmp, f).split("\\").join("/"), sha256: sha256(b), bytes: b.length }); }
    }
  };
  walk(tmp);
  const label = screenLabels(p.design.screens);
  const use = new Map((p.design.refUse ?? []).map((u) => [u.id, u]));
  const manifest: DesignManifest = {
    kind: "ai-factory/design-package", schemaVersion: PACKAGE_SCHEMA_VERSION, line: p.line, version: p.version,
    designSha: p.designSha, demoSha: p.demoSha, run: p.run, product: p.product, approved: p.approved,
    templateVersion: p.templateVersion, designSchemaVersion: DESIGN_SCHEMA_VERSION, look,
    references: p.references.map((r) => ({ id: r.id, role: r.role, source: r.source, ...(use.get(r.id) ? { use: use.get(r.id)!.use, how: use.get(r.id)!.how } : {}) })),
    screens: p.design.screens.map((s) => ({ id: s.id, title: label.get(s.id)!, route: s.route, reqs: s.reqs, states: demoStates(s as never) })),
    ...(p.previous ? { previous: p.previous } : {}), ...(p.changes ? { changes: p.changes } : {}),
    shots: shots.shots, ...(shots.note ? { shotsNote: shots.note } : {}), files,
  };
  writeFileSync(join(tmp, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  mkdirSync(join(dir, ".."), { recursive: true });
  renameSync(tmp, dir);
  return { manifest, dir };
}

/** The package's files for a repo, as paths under `design/<line>/vN/` (the manifest last, so a reader sees a whole package). */
export function repoFiles(pkg: DesignPackage): { path: string; from: string }[] {
  const base = `${REPO_DESIGN_DIR}/${pkg.manifest.line}/v${pkg.manifest.version}`;
  return [...pkg.manifest.files.map((f) => ({ path: `${base}/${f.path}`, from: join(pkg.dir, f.path) })), { path: `${base}/manifest.json`, from: join(pkg.dir, "manifest.json") }];
}
