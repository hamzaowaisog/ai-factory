// Ripple effects, code layer (no model): from the code a change touches (ground's anchors and the anchors of
// MODIFIED/REMOVED requirements), find what else may need to change or may break, through four lenses:
//   callers  — references to the changed types, DI registrations, DTOs, interfaces they implement
//   data     — DbSet, entity configuration, migrations, raw SQL for changed entities
//   screens  — frontend calls (fetch/axios/SWR) to changed API routes, Razor pages using changed types
//   tests    — tests touching changed code, appsettings keys and roles the changed code reads
// Pure functions over a file list and a reader, so they run on a snapshot, a fixture or an eval clone alike.
import { extractSymbols } from "./repomap.js";

export type Lens = "callers" | "data" | "screens" | "tests";
export const LENSES: Lens[] = ["callers", "data", "screens", "tests"];

export interface Seed {
  path: string;
  /** "OrderService.Cancel", "MapGet /orders/{id}", a type name… (optional) */
  symbol?: string;
  /** from a REMOVED requirement: whatever still uses it breaks */
  removed?: boolean;
  /** anchored by a MODIFIED/REMOVED requirement: the spec says this code changes (ground's anchors may be context only) */
  changing?: boolean;
}

export interface Candidate {
  lens: Lens;
  path: string;
  line: number;
  quote: string;
  /** what it matched: a type name, a route, a table, a setting key, a role */
  seed: string;
  kind: "reference" | "di" | "dto" | "interface" | "route-call" | "razor" | "dbset" | "entity-config" | "migration" | "sql" | "test" | "setting" | "role";
  /** 1 = uses the changed code directly; 2 = through an interface the changed code implements */
  hop: 1 | 2;
  /** uses something a REMOVED requirement takes away */
  breaks?: boolean;
  /** found in a linked repo (read-only): needs a matching change there, never part of this run */
  repo?: string;
}

export interface RippleResult {
  symbols: string[];
  routes: string[];
  entities: string[];
  settings: string[];
  roles: string[];
  lenses: Record<Lens, Candidate[]>;
  /** candidate files outside the modules (csproj / package + feature folder) the seeds live in; tests never count */
  outside: string[];
  /** entities (and their table names) that code the spec changes declares or names: only these count as "stored data" risk */
  changingData: string[];
}

export interface Source { files: string[]; read(path: string): string | undefined }

export const MAX_PER_LENS = 200;

const CODE = /\.(cs|ts|tsx|js|jsx|mjs|vue|svelte|razor|cshtml|fs|vb)$/i;
const FRONTEND = /\.(ts|tsx|js|jsx|mjs|vue|svelte|razor|cshtml)$/i;
const SKIP = /(^|\/)(bin|obj|node_modules|dist|build|\.next|out|coverage|wwwroot\/lib)\//i;
const TEST = /(^|\/)(tests?|__tests__|[^/]*\.Tests?(\.[^/]+)?|[^/]*Tests?)\/|\.(test|spec)\.[tj]sx?$|Tests?\.cs$/i;
const MIGRATION = /(^|\/)Migrations?\//i;
const SETTINGS = /(^|\/)appsettings[^/]*\.json$/i;

/** Names too common to search for: they'd match half the repo. */
const GENERIC = new Set(["program", "startup", "index", "app", "main", "default", "page", "layout", "route", "handler", "service", "controller",
  "model", "models", "entity", "result", "response", "request", "options", "settings", "config", "helper", "helpers", "utils", "extensions",
  "build", "get", "set", "add", "create", "update", "delete", "list", "data", "item", "items", "value", "values", "name", "type", "id"]);

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const word = (name: string) => new RegExp(`(?<![A-Za-z0-9_])${esc(name)}(?![A-Za-z0-9_])`);
const usable = (n: string) => n.length >= 4 && !GENERIC.has(n.toLowerCase()) && /^[A-Za-z_][A-Za-z0-9_]*$/.test(n);
const isTest = (p: string) => TEST.test(p);
export const isTestPath = isTest;

/** "OrderService.Cancel" → ["OrderService"]; "MapGet /orders/{id}" → []: the type a symbol names, if any. */
function symbolNames(symbol: string | undefined): string[] {
  if (!symbol) return [];
  const type = symbol.trim().split(".")[0]!;
  return /^[A-Z]/.test(type) && usable(type) ? [type] : [];
}

/** Types and exports a file declares (C# classes, records, interfaces, enums; TS exports). */
function declared(path: string, text: string): string[] {
  return extractSymbols(path, text).filter((s) => !s.startsWith(" ")).map((s) => s.split(/\s+/).pop()!).filter(usable);
}

/** C# extension methods (`static T Name(this X x)`): callers use the method, never the static class's name. */
function extensionMethods(path: string, text: string): string[] {
  if (!/\.cs$/i.test(path)) return [];
  return [...text.matchAll(/\bstatic\s+[\w<>\[\],.? ]+?\s+(\w+)\s*(?:<[^>()]*>)?\s*\(\s*this\s/g)].map((m) => m[1]!).filter(usable);
}

/** Interfaces a C# type implements: "class OrderService : IOrderService, IDisposable" → IOrderService. */
function interfacesOf(text: string, types: string[]): string[] {
  const out = new Set<string>();
  for (const t of types) {
    const m = new RegExp(`(?:class|record)\\s+${esc(t)}\\b[^{;]*?:\\s*([^{]+)`).exec(text);
    if (!m) continue;
    for (const part of m[1]!.split(",")) {
      const n = part.trim().replace(/<.*$/, "").split(/\s+/)[0]!;
      if (/^I[A-Z]\w+$/.test(n) && usable(n)) out.add(n);
    }
  }
  return [...out];
}

/** Route path → a pattern: params ({id}, [id], :id) become one segment wildcards. */
export function routePattern(route: string): RegExp | undefined {
  const p = route.trim().replace(/^~?\/?/, "/").replace(/\/+$/, "").toLowerCase();
  if (p.length < 3 || p === "/api") return undefined;
  const parts = p.split("/").filter(Boolean).map((seg) => (/^(\{.*\}|\[.*\]|:\w+|\*)$/.test(seg) ? "[^/'\"`?#\\s]+" : esc(seg)).replace(/\\\$\\\{[^}]*\\\}/g, "[^/]+"));
  return new RegExp(`/${parts.join("/")}(?=$|[?#'"\`\\s])`, "i");
}

/** API routes a file serves: minimal APIs, controller attributes, Next.js route handlers. */
export function routesOf(path: string, text: string): string[] {
  const out = new Set<string>();
  if (/\.cs$/i.test(path)) {
    for (const m of text.matchAll(/\.Map(?:Get|Post|Put|Patch|Delete|Methods)\(\s*"([^"]+)"/g)) out.add(m[1]!);
    const group = /\.MapGroup\(\s*"([^"]+)"/.exec(text)?.[1];
    if (group) for (const m of text.matchAll(/\.Map(?:Get|Post|Put|Patch|Delete)\(\s*"([^"]*)"/g)) out.add(`${group.replace(/\/$/, "")}/${m[1]!.replace(/^\//, "")}`);
    const base = /\[Route\(\s*"([^"]+)"/.exec(text)?.[1];
    const ctrl = /class\s+(\w+)Controller\b/.exec(text)?.[1];
    const prefix = base?.replace(/\[controller\]/i, ctrl ?? "").replace(/\/$/, "");
    for (const m of text.matchAll(/\[Http(?:Get|Post|Put|Patch|Delete)\(\s*"([^"]*)"/g)) out.add(prefix ? `${prefix}/${m[1]!.replace(/^\//, "")}` : m[1]!);
    if (prefix && !/\[Http(?:Get|Post|Put|Patch|Delete)\(\s*"/.test(text) && /\[Http(?:Get|Post|Put|Patch|Delete)\b/.test(text)) out.add(prefix);
  }
  const next = /(?:^|\/)(?:src\/)?app\/(api\/.*)\/route\.[tj]sx?$/.exec(path) ?? /(?:^|\/)(?:src\/)?pages\/(api\/.*?)(?:\/index)?\.[tj]sx?$/.exec(path);
  if (next) out.add(`/${next[1]}`);
  return [...out].map((r) => (r.startsWith("/") ? r : `/${r}`)).filter((r) => routePattern(r));
}

/** Configuration keys and roles a C# file reads. */
function settingsAndRoles(text: string): { settings: string[]; roles: string[] } {
  const settings = new Set<string>(), roles = new Set<string>();
  for (const m of text.matchAll(/(?:Configuration|config|configuration)\s*\[\s*"([^"]+)"\s*\]|GetSection\(\s*"([^"]+)"|GetValue<[^>]+>\(\s*"([^"]+)"|GetConnectionString\(\s*"([^"]+)"/g)) {
    const k = (m[1] ?? m[2] ?? m[3] ?? m[4])!.split(":")[0]!;
    if (k.length >= 3) settings.add(k);
  }
  for (const m of text.matchAll(/Roles\s*=\s*"([^"]+)"|RequireRole\(\s*"([^"]+)"|IsInRole\(\s*"([^"]+)"|Policy\s*=\s*"([^"]+)"/g)) {
    for (const r of (m[1] ?? m[2] ?? m[3] ?? m[4])!.split(",")) if (r.trim().length >= 3) roles.add(r.trim());
  }
  return { settings: [...settings], roles: [...roles] };
}

/** Entities: changed types that some DbSet<> lists, with their table names. */
function entitiesAmong(src: Source, types: string[]): { entities: string[]; tables: Map<string, string[]> } {
  const listed = new Set<string>();
  const tables = new Map<string, string[]>();
  for (const f of src.files) {
    if (!/\.cs$/i.test(f) || SKIP.test(f)) continue;
    const text = src.read(f) ?? "";
    if (!text.includes("DbSet<")) continue;
    for (const m of text.matchAll(/DbSet<\s*(\w+)\s*>\s+(\w+)/g)) {
      if (!types.includes(m[1]!)) continue;
      listed.add(m[1]!);
      tables.set(m[1]!, [...new Set([...(tables.get(m[1]!) ?? []), m[2]!, m[1]!])]);
    }
  }
  return { entities: [...listed], tables };
}

const rank = (c: Candidate) => (c.breaks ? 0 : 10) + c.hop * 2 + (c.kind === "reference" ? 1 : 0);

/**
 * The code layer: every file and line that may be affected, per lens, ranked (breaks first, direct before
 * indirect) and capped. Seed files themselves are not candidates: ground already has them.
 */
export function rippleCandidates(src: Source, seeds: Seed[]): RippleResult {
  const seedFiles = [...new Set(seeds.map((s) => s.path))].filter((p) => src.files.includes(p));
  const removedFiles = new Set(seeds.filter((s) => s.removed).map((s) => s.path));
  const removedSymbols = new Set(seeds.filter((s) => s.removed).flatMap((s) => symbolNames(s.symbol)));

  // what changed: declared types of seed files plus named symbols, the interfaces they implement, routes, settings, roles
  const direct = new Set<string>(seeds.flatMap((s) => symbolNames(s.symbol)));
  const routes = new Set<string>(), settings = new Set<string>(), roles = new Set<string>();
  const viaInterface = new Set<string>();
  // JS/TS exports and the module paths that lead to them ("lib/session" for lib/session.ts, "lib/x" for lib/x/index.ts)
  const exportsFrom = new Map<string, string[]>();
  for (const f of seedFiles) {
    const text = src.read(f) ?? "";
    const types = declared(f, text);
    if (/\.[mc]?[tj]sx?$/.test(f)) {
      const stem = f.replace(/\.[^./]+$/, "");
      for (const t of types) exportsFrom.set(t, [...(exportsFrom.get(t) ?? []), stem, stem.replace(/\/index$/, "")]);
    }
    for (const t of [...types, ...extensionMethods(f, text)]) direct.add(t);
    if (removedFiles.has(f)) for (const t of [...types, ...extensionMethods(f, text)]) removedSymbols.add(t);
    for (const i of interfacesOf(text, types)) viaInterface.add(i);
    for (const r of routesOf(f, text)) routes.add(r);
    const sr = settingsAndRoles(text);
    sr.settings.forEach((k) => settings.add(k));
    sr.roles.forEach((r) => roles.add(r));
  }
  for (const i of direct) viaInterface.delete(i);
  const symbols = [...direct];
  const { entities, tables } = entitiesAmong(src, symbols);
  const routeRes = [...routes].map((r) => [r, routePattern(r)!] as const);
  const symRes = symbols.map((s) => [s, word(s), 1 as const] as const);
  const ifaceRes = [...viaInterface].map((s) => [s, word(s), 2 as const] as const);
  const tableNames = [...new Set(entities.flatMap((e) => tables.get(e) ?? []))].filter((t) => t.length >= 4);

  const lenses: Record<Lens, Candidate[]> = { callers: [], data: [], screens: [], tests: [] };
  const seen = new Set<string>();
  const add = (c: Candidate) => {
    const k = `${c.lens}|${c.path}|${c.seed}`;
    if (seen.has(k)) return; // one line per file and thing it uses, per lens
    seen.add(k);
    lenses[c.lens].push(c);
  };

  for (const f of src.files) {
    if (SKIP.test(f) || seedFiles.includes(f)) continue;
    const isSettings = SETTINGS.test(f);
    if (!CODE.test(f) && !isSettings && !/\.sql$/i.test(f)) continue;
    const text = src.read(f);
    if (!text) continue;
    const lines = text.split("\n");
    const test = isTest(f), migration = MIGRATION.test(f), front = FRONTEND.test(f) && !/\.cs$/i.test(f);
    const foreign = front ? importedElsewhere(text, exportsFrom) : new Set<string>();
    lines.forEach((raw, i) => {
      const line = raw.trim();
      if (!line || line.startsWith("//") || line.startsWith("using ") || line.startsWith("import ") && !front) return;
      const at = { path: f, line: i + 1, quote: raw.trimEnd().slice(0, 200) };
      if (isSettings) {
        for (const k of settings) if (new RegExp(`"${esc(k)}"\\s*:`).test(raw)) add({ ...at, lens: "tests", seed: k, kind: "setting", hop: 1 });
        return;
      }
      // data: DbSet, entity configuration, migrations, raw SQL
      for (const e of entities) {
        if (new RegExp(`DbSet<\\s*${esc(e)}\\s*>`).test(raw)) add({ ...at, lens: "data", seed: e, kind: "dbset", hop: 1, breaks: removedSymbols.has(e) });
        else if (new RegExp(`IEntityTypeConfiguration<\\s*${esc(e)}\\s*>|Entity<\\s*${esc(e)}\\s*>`).test(raw)) add({ ...at, lens: "data", seed: e, kind: "entity-config", hop: 1, breaks: removedSymbols.has(e) });
        else if (migration && word(e).test(raw)) add({ ...at, lens: "data", seed: e, kind: "migration", hop: 1 });
      }
      if (tableNames.length && /\b(select|insert\s+into|update|delete\s+from|join|from)\b/i.test(raw) && /["'`@]/.test(raw)) {
        for (const t of tableNames) if (word(t).test(raw)) add({ ...at, lens: "data", seed: t, kind: "sql", hop: 1 });
      }
      // screens: frontend calls to changed routes
      if (front) for (const [r, re] of routeRes) if (re.test(raw)) add({ ...at, lens: "screens", seed: r, kind: "route-call", hop: 1, breaks: removedFiles.size > 0 && seedsRouteRemoved(r, seeds, src) });
      // callers (or tests, or Razor screens): references to changed types
      for (const [s, re, hop] of [...symRes, ...ifaceRes]) {
        if (foreign.has(s) || !re.test(raw)) continue;
        const di = /\bAdd(Scoped|Transient|Singleton|HostedService|DbContext)\b/.test(raw);
        const lens: Lens = test ? "tests" : /\.(razor|cshtml)$/i.test(f) ? "screens" : "callers";
        const kind: Candidate["kind"] = test ? "test" : lens === "screens" ? "razor" : di ? "di" : hop === 2 ? "interface" : /(Dto|Request|Response|Command|Query)\b/.test(f.split("/").pop()!.replace(/\.\w+$/, "")) ? "dto" : "reference";
        add({ ...at, lens, seed: s, kind, hop, breaks: removedSymbols.has(s) });
      }
      // tests and other code that names a changed route
      if (test && !front) for (const [r, re] of routeRes) if (re.test(raw)) add({ ...at, lens: "tests", seed: r, kind: "test", hop: 1 });
      for (const r of roles) if (new RegExp(`"${esc(r)}"`).test(raw)) add({ ...at, lens: "tests", seed: r, kind: "role", hop: 1 });
    });
  }
  for (const l of LENSES) lenses[l] = lenses[l].sort((a, b) => rank(a) - rank(b) || a.path.localeCompare(b.path) || a.line - b.line).slice(0, MAX_PER_LENS);
  const seedModules = new Set(seedFiles.map((f) => moduleOf(f, src.files)));
  const outside = [...new Set(LENSES.flatMap((l) => lenses[l]).map((c) => c.path))].filter((f) => !isTest(f) && !seedModules.has(moduleOf(f, src.files)));
  const changingFiles = new Set(seeds.filter((s) => s.changing || s.removed).map((s) => s.path));
  const changingNames = new Set([...seeds.filter((s) => s.changing || s.removed).flatMap((s) => symbolNames(s.symbol)),
    ...seedFiles.filter((f) => changingFiles.has(f)).flatMap((f) => declared(f, src.read(f) ?? ""))]);
  const changingData = [...new Set(entities.filter((e) => changingNames.has(e)).flatMap((e) => [e, ...(tables.get(e) ?? [])]))];
  return { symbols, routes: [...routes], entities, settings: [...settings], roles: [...roles], lenses, outside, changingData };
}

/** Names this JS/TS file imports from some other module than the seed that exports them (same name, other thing). */
function importedElsewhere(text: string, moduleOf: Map<string, string[]>): Set<string> {
  const out = new Set<string>();
  if (!moduleOf.size) return out;
  for (const m of text.matchAll(/import\s+(?:type\s+)?([^'";]*?)\s+from\s+['"]([^'"]+)['"]/g)) {
    const spec = m[2]!.replace(/^(\.{1,2}\/|[@~]\/|\/)+/, "").replace(/\.[mc]?[tj]sx?$/, "");
    for (const name of m[1]!.match(/[A-Za-z_$][\w$]*/g) ?? []) {
      const stems = moduleOf.get(name);
      if (stems && !stems.some((st) => st.endsWith(spec))) out.add(name);
    }
  }
  return out;
}

/** A route served by a file a REMOVED requirement anchors: calls to it break. */
function seedsRouteRemoved(route: string, seeds: Seed[], src: Source): boolean {
  return seeds.some((s) => s.removed && routesOf(s.path, src.read(s.path) ?? "").includes(route));
}

const projectDirs = new WeakMap<string[], { cs: Set<string>; pkg: Set<string> }>();
const dirOf = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");

/**
 * The module a file belongs to: .NET, the folder of the csproj that owns it; JS/TS, the nearest package.json folder
 * plus the feature folder under it (src/, app/ and pages/ skipped: "components", "(dashboard)"); else the top folder.
 */
export function moduleOf(path: string, files: string[]): string {
  let dirs = projectDirs.get(files);
  if (!dirs) {
    dirs = { cs: new Set(files.filter((f) => /\.(cs|fs|vb)proj$/i.test(f)).map(dirOf)), pkg: new Set(files.filter((f) => /(^|\/)package\.json$/.test(f)).map(dirOf)) };
    projectDirs.set(files, dirs);
  }
  const up = (set: Set<string>) => { for (let d = dirOf(path); ; d = dirOf(d)) { if (set.has(d)) return d; if (!d) return undefined; } };
  const cs = up(dirs.cs);
  // a csproj at the repo root owns its C# files, not a frontend that happens to sit under it
  if (cs !== undefined && (cs !== "" || /\.(cs|razor|cshtml)$/i.test(path))) return `cs:${cs}`;
  const pkg = up(dirs.pkg);
  if (pkg !== undefined) {
    const rest = (pkg ? path.slice(pkg.length + 1) : path).replace(/^(src\/)?((app|pages)\/)?/, "");
    return `js:${pkg}|${rest.includes("/") ? rest.split("/")[0] : ""}`;
  }
  return `dir:${path.split("/")[0]}`;
}

/**
 * A linked repo (read-only, e.g. the frontend of this backend): only calls to the changed routes (screens) and
 * the changed type names (callers) are searched. Every hit is a follow-up there, never a change in this run.
 */
export function linkedCandidates(src: Source, r: Pick<RippleResult, "routes" | "symbols">, repo: string): Candidate[] {
  const routeRes = r.routes.map((x) => [x, routePattern(x)!] as const);
  const types = r.symbols.filter((x) => /^[A-Z]/.test(x)).map((x) => [x, word(x)] as const);
  const out: Candidate[] = [];
  const seen = new Set<string>();
  for (const f of src.files) {
    if (SKIP.test(f) || !CODE.test(f) || isTest(f)) continue;
    const text = src.read(f);
    if (!text) continue;
    text.split("\n").forEach((raw, i) => {
      const at = { path: f, line: i + 1, quote: raw.trimEnd().slice(0, 200), hop: 1 as const, repo };
      for (const [x, re] of routeRes) if (re.test(raw) && !seen.has(`${f}|${x}`)) { seen.add(`${f}|${x}`); out.push({ ...at, lens: "screens", seed: x, kind: "route-call" }); }
      for (const [x, re] of types) if (re.test(raw) && !seen.has(`${f}|${x}`)) { seen.add(`${f}|${x}`); out.push({ ...at, lens: "callers", seed: x, kind: "reference" }); }
    });
  }
  return out.slice(0, MAX_PER_LENS);
}

/** Files the candidates name, best first (each file once). */
export function candidateFiles(r: RippleResult): string[] {
  const all = LENSES.flatMap((l) => r.lenses[l]).sort((a, b) => rank(a) - rank(b));
  return [...new Set(all.map((c) => c.path))];
}
