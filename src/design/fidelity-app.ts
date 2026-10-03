// Fidelity of the built app to the approved design (docs/estimates-design.md, "Fidelity and tests"). The app is run in fixture
// mode (?fixture=S-3:empty) and every screen's states are opened at the widths, modes and languages the package pictured, then
// read at four levels: tokens (every computed colour, font, corner and shadow is one of the design's), structure (every approved
// block with its columns, buttons, fields, tabs and labels), accessibility (axe critical and serious, the keyboard's path, a visible
// focus), and layout and pixels (advisory: the blocks against the approved demo's, the pictures against an accepted baseline).
// The first three are blocking gates (design.tokens, design.structure, design.a11y), waivable on the waiver card.
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { z } from "zod";
import type { DesignBody } from "../contracts/artifacts.js";
import { DEFAULT_THEME, demoStates, FULL_DATA } from "./demo.js";
import { findChromium, VIEWPORTS, type Viewport } from "./screenshots.js";
import { designTokens } from "./tokens.js";
import { loadAxe } from "./capture.js";
import type { CheckResult, CheckStatus } from "./fidelity.js";
import { inPage, readBlocks, readColours, readFocus, readStyles, type ReadBlock, type ReadStyle } from "./fidelity-read.js";
import { fontList } from "./package.js";
import { NOTICEABLE_RATIO, pixelDiff } from "./pixeldiff.js";
import { routerPath, screenStates } from "./kit/scaffold.js";

type Design = Pick<z.infer<typeof DesignBody>, "screens" | "theme" | "locale" | "themeSource">;

/** The approved theme to check the tokens against: a new look's. An existing app's own look (or none) is not compared. */
export const approvedTheme = (d: Pick<Design, "theme" | "themeSource">): NonNullable<Design["theme"]> | undefined => (d.theme && d.themeSource !== "repo" ? d.theme : undefined);
type DScreen = Design["screens"][number];
type Block = NonNullable<DScreen["mock"]>["blocks"][number];

export type FidelityLevel = "tokens" | "structure" | "a11y" | "layout" | "pixels";
export const BLOCKING: FidelityLevel[] = ["tokens", "structure", "a11y"];
export const LEVEL_TITLE: Record<FidelityLevel, string> = { tokens: "Tokens", structure: "Structure", a11y: "Accessibility", layout: "Layout", pixels: "Pixels" };

/** One page the check opens: a screen in one state, at one width, mode and language. */
export interface FidelityPage {
  key: string; id: string; screen: string; state: string; slug: string; viewport: Viewport;
  mode?: "dark"; lang?: string;
  /** the address in the app, from its root */
  path: string;
  /** the state's tab in the approved demo */
  demoState: number;
}
export interface FidelityFinding { level: FidelityLevel; message: string; pages: string[] }
export interface FidelityPageResult extends FidelityPage {
  /** the built page's picture, under the report's folder */
  built?: string;
  /** the approved picture of the same page in the package (shots/), when it was pictured */
  approved?: string;
  /** the accepted picture it was compared with, and how much differs */
  baseline?: string; ratio?: number; noticeable?: boolean; diff?: string;
}
export interface FidelityReport {
  kind: "design-fidelity";
  levels: (CheckResult & { level: FidelityLevel; blocking: boolean })[];
  findings: FidelityFinding[];
  pages: FidelityPageResult[];
  overall: "pass" | "fail" | "unchecked";
  /** browsers and modes run, and anything not run */
  ran: string[]; notes: string[];
  skipped?: string;
}

const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "default";
const norm = (s: string): string => s.replace(/\s+/g, " ").trim().toLowerCase();

/** A design route as an address to open: its parameters filled with "sample", as the fixtures are. */
export const samplePath = (route: string): string => routerPath(route).replace(/:([A-Za-z_]\w*)/g, "sample");

/**
 * The pages to open, as the package pictures them: every state at phone and desktop width, the first state at tablet width, and
 * the first state in dark mode and in the other language when the design has them. Only the screens built with the kit.
 */
export function fidelityPages(design: Design, screenIds: string[]): FidelityPage[] {
  const dark = !!design.theme && Object.keys(designTokens({ ...DEFAULT_THEME, ...design.theme }).colour).length > 1;
  const other = (design.locale?.languages ?? []).find((l) => l !== "en");
  const out: FidelityPage[] = [];
  for (const vp of ["phone", "desktop", "tablet"] as Viewport[]) {
    for (const s of design.screens.filter((x) => screenIds.includes(x.id))) {
      const names = demoStates(s);
      const slugs = Object.keys(screenStates(s));
      const screen = s.mock?.title ?? s.route;
      const page = (k: number, extra: Pick<FidelityPage, "mode" | "lang"> = {}) => {
        const sl = slugs[k] ?? "default";
        const path = `${samplePath(s.route)}?fixture=${encodeURIComponent(`${s.id}:${sl}`)}${extra.lang ? `&lang=${extra.lang}` : ""}`;
        out.push({ key: `${slug(s.id)}-${sl}-${vp}${extra.mode ? "-dark" : ""}${extra.lang ? `-${extra.lang}` : ""}`, id: s.id, screen, state: names[k] ?? "default", slug: sl, viewport: vp, path, demoState: k, ...extra });
      };
      for (let k = 0; k < Math.max(1, names.length); k++) if (vp !== "tablet" || k === 0) page(k);
      if (vp === "tablet") continue;
      if (other) page(0, { lang: other });
      if (dark) page(0, { mode: "dark" });
    }
  }
  return out;
}

/** The approved picture of a page: the package's shot of the same screen, state, width, mode and language. */
export function approvedShot(p: FidelityPage, shots: { file: string; id?: string; state: string; viewport: string; mode?: string; lang?: string }[]): string | undefined {
  return shots.find((s) => s.id === p.id && s.viewport === p.viewport && (s.mode ?? "") === (p.mode ?? "") && (s.lang ?? "") === (p.lang ?? "")
    && (p.mode || p.lang ? true : s.state === p.state))?.file;
}

// ---- structure: what the approved design says each block shows ----

const WORD_KEYS = new Set(["title", "label", "submit", "cta", "action", "search", "with"]);
const LIST_KEYS = new Set(["columns", "ranges", "segments", "periods", "chips", "tabs", "buttons", "quick"]);
const PART_KEYS = new Set(["fields", "selects", "buttons", "totals", "facets", "columns"]);
const LABEL_ONLY = new Set(["items", "rows"]);

/**
 * The words a block must show: its title and label, its columns, buttons, tabs and segments, its fields' and figures' labels. On a
 * phone a search's filters fold behind a Filters button, so their titles are not asked for there.
 */
export function blockWords(b: Block, phone = false): string[] {
  const out: string[] = [];
  const add = (s: unknown) => { if (typeof s === "string" && s.trim() && s.length <= 60 && !out.includes(s.trim())) out.push(s.trim()); };
  const walk = (o: Record<string, unknown>, depth: number, only?: string) => {
    for (const [k, v] of Object.entries(o)) {
      if (only ? k === only : WORD_KEYS.has(k)) add(v);
      if (depth > 0 || !Array.isArray(v)) continue;
      if (LIST_KEYS.has(k)) v.forEach((x) => typeof x === "string" && add(x));
      if (phone && k === "facets") continue;
      if (PART_KEYS.has(k) || LABEL_ONLY.has(k)) for (const x of v) if (x && typeof x === "object") walk(x as Record<string, unknown>, depth + 1, LABEL_ONLY.has(k) ? "label" : undefined);
    }
  };
  walk(b as unknown as Record<string, unknown>, 0);
  return out;
}

export interface Expected { blocks: { type: string; words: string[] }[]; page: string[]; toast?: string; busy?: boolean }

/** What a screen must show in a state: the page's title and tabs, then its blocks, its state's message, its open layer or toast. */
export function expectedFor(s: DScreen, stateSlug: string, phone = false): Expected {
  const m = s.mock;
  const st = screenStates(s)[stateSlug] ?? { name: "default" };
  const page = [m?.title ?? "", ...(m?.tabs ?? [])].filter(Boolean);
  const kind = stateKindOf(st.name);
  if (kind === "loading") return { blocks: [], page, busy: true };
  if (kind === "empty") return { blocks: [{ type: "state:empty", words: [m?.copy?.emptyTitle ?? "Nothing here yet"] }], page };
  if (kind === "error") return { blocks: [{ type: "state:error", words: [m?.copy?.error ?? "Try again in a moment."] }], page };
  const src = st.full && s.mockFull ? s.mockFull : m;
  const blocks: Expected["blocks"] = (src?.blocks ?? []).map((b) => ({ type: b.type as string, words: blockWords(b, phone) }));
  if (kind === "success" && m?.copy?.success) blocks.unshift({ type: "state:success", words: [m.copy.success] });
  if (kind === "validation" && m?.copy?.validation) blocks.unshift({ type: "state:validation", words: [m.copy.validation] });
  if (st.overlay !== undefined) {
    const o = m!.overlays![st.overlay]!;
    const acts = (o.actions ?? []).map((a) => (typeof a === "string" ? a : a.label));
    // a menu shows its items; the other layers their title and buttons
    const items = ((o as { items?: (string | { label: string })[] }).items ?? []).map((x) => (typeof x === "string" ? x : x.label));
    blocks.push({ type: `overlay:${o.trigger}`, words: (o.kind === "menu" ? items : [o.title, ...acts]).filter((x): x is string => !!x) });
  }
  const toast = st.toast !== undefined ? m!.toasts![st.toast]!.text : undefined;
  return { blocks, page, ...(toast ? { toast } : {}) };
}

// the demo's reading of a state's name (src/design/demo.ts stateKind; the kit's lib/fixture.ts is the same)
const stateKindOf = (state: string): "normal" | "success" | "validation" | "loading" | "empty" | "error" =>
  state === FULL_DATA ? "normal"
  : /empty|no data|none|no results/i.test(state) ? "empty"
  : /load|wait|pending|progress|skeleton/i.test(state) ? "loading"
  : /valid|invalid|required/i.test(state) ? "validation"
  : /error|fail|denied|offline|unauthori[sz]ed|forbidden/i.test(state) ? "error"
  : /success|done|saved|complete|confirm|sent/i.test(state) && !/^(confirm|dialog|panel|sheet|menu|toast|popover|drawer):/i.test(state) ? "success"
  : "normal";

/** The approved blocks and words missing from the built page (blocks matched by type, in order). */
export function structureFindings(exp: Expected, got: ReadBlock[], pageWords: string, toasts: string): string[] {
  const out: string[] = [];
  const hay = norm(pageWords);
  for (const w of exp.page) if (!hay.includes(norm(w))) out.push(`the page does not show "${w}"`);
  if (exp.busy && !/aria-busy/.test(pageWords)) out.push("the loading state shows no loading placeholder");
  const seen = new Map<string, number>();
  for (const b of exp.blocks) {
    const n = seen.get(b.type) ?? 0;
    seen.set(b.type, n + 1);
    const match = got.filter((x) => x.type === b.type)[n];
    const name = b.type.startsWith("overlay:") ? `the layer opened by "${b.type.slice(8)}"` : b.type.startsWith("state:") ? `the ${b.type.slice(6)} message` : `${b.type} block${n ? ` ${n + 1}` : ""}`;
    if (!match) { out.push(`${name} is missing`); continue; }
    const words = norm(match.words);
    const missing = b.words.filter((w) => !words.includes(norm(w)));
    if (missing.length) out.push(`${name} does not show ${missing.slice(0, 6).map((w) => `"${w}"`).join(", ")}${missing.length > 6 ? ` and ${missing.length - 6} more` : ""}`);
  }
  if (exp.toast && !norm(toasts).includes(norm(exp.toast))) out.push(`the message "${exp.toast}" is not shown`);
  return out;
}

// ---- tokens: every drawn value is one of the design's ----

export interface TokenSet { colours: [number, number, number][]; fonts: string[]; radii: number[]; shadows: string[] }

/** The design's own values for one mode: its colours (as bytes, read in the page), its two fonts, its corner steps, its shadows. */
export function tokenValues(theme: NonNullable<Design["theme"]>, mode: "light" | "dark"): { colours: string[]; fonts: string[]; radii: number[]; shadows: string[] } {
  const t = designTokens({ ...DEFAULT_THEME, ...theme });
  const m = t.colour[mode] ? mode : (Object.keys(t.colour)[0] as "light" | "dark");
  const r = t.radiusPx;
  return {
    colours: [...new Set(Object.values(t.colour[m]!))],
    fonts: [...new Set([fontList(t.type.body)[0]!, fontList(t.type.heading)[0]!])],
    radii: [...new Set([0, Math.max(0, r - 4), Math.max(0, r - 2), r, r + 4])],
    shadows: [t.shadow[m]!.card, t.shadow[m]!.raised],
  };
}

const LAYER_RE = /(rgba?\([^)]*\))\s+(-?[\d.]+)px\s+(-?[\d.]+)px\s+(-?[\d.]+)px\s+(-?[\d.]+)px(\s+inset)?/g;
const layers = (css: string) => [...css.matchAll(LAYER_RE)].map((m) => ({ colour: m[1]!, g: [m[2], m[3], m[4], m[5]].map(Number) as [number, number, number, number], inset: !!m[6] }));
const geometry = (css: string): string[] => {
  // a token shadow as written (0 1px 2px rgba(...)): its lengths in order, the spread 0 when left out
  const out: string[] = [];
  for (const part of css.split(/,(?![^(]*\))/)) {
    const lens = [...part.replace(/(rgba?|hsla?|oklch|oklab|color)\([^)]*\)/g, "").matchAll(/(-?[\d.]+)(px)?/g)].map((m) => Number(m[1]));
    if (lens.length >= 2) out.push([...lens, 0, 0].slice(0, 4).join(" "));
  }
  return out;
};
const near = (a: number[], b: number[], tol = 4) => Math.abs(a[0]! - b[0]!) <= tol && Math.abs(a[1]! - b[1]!) <= tol && Math.abs(a[2]! - b[2]!) <= tol;

/** The drawn values that are none of the design's: one line per value, with where it was first seen. */
export function tokenFindings(styles: ReadStyle[], set: TokenSet): string[] {
  const out: string[] = [];
  const isColour = (rgb: number[]) => set.colours.some((c) => near(c, rgb));
  const shadowGeo = new Set(set.shadows.flatMap(geometry));
  for (const s of styles) {
    if (s.prop === "colour") {
      // a translucent black scrim behind a layer is the page dimmed, not a colour of its own
      if (s.rgb && s.rgb[3] < 1 && s.rgb[0] + s.rgb[1] + s.rgb[2] === 0) continue;
      if (s.rgb && !isColour(s.rgb)) out.push(`colour rgb(${s.rgb.slice(0, 3).join(", ")}) is not a design colour (${s.where}${s.count > 1 ? `, ${s.count} places` : ""})`);
    } else if (s.prop === "font") {
      if (s.value && !set.fonts.some((f) => norm(f) === norm(s.value))) out.push(`font "${s.value}" is not the design's (${set.fonts.join(" or ")}) (${s.where})`);
    } else if (s.prop === "radius") {
      const px = parseFloat(s.value);
      const round = px >= 999 || (s.size !== undefined && px >= s.size / 2 - 0.5);
      if (!round && !set.radii.some((r) => Math.abs(r - px) <= 0.5)) out.push(`corner ${s.value} is not one of the design's (${set.radii.map((r) => `${r}px`).join(", ")}) (${s.where})`);
    } else if (s.prop === "shadow") {
      for (const l of layers(s.value)) {
        if (l.g.every((x) => x === 0)) continue;
        const [x, y, blur, spread] = l.g;
        const rgb = /rgba?\(([^)]*)\)/.exec(l.colour)![1]!.split(",").map((v) => Number(v.trim()));
        if (rgb.length > 3 && rgb[3] === 0) continue;
        // a focus or selection ring: a solid band of a design colour
        if (x === 0 && y === 0 && blur === 0 && spread! > 0) { if (!isColour(rgb)) out.push(`ring colour rgb(${rgb.slice(0, 3).join(", ")}) is not a design colour (${s.where})`); continue; }
        if (!shadowGeo.has(l.g.join(" "))) { out.push(`shadow ${l.g.map((v) => `${v}px`).join(" ")} is not one of the design's (${s.where})`); break; }
      }
    }
  }
  return out;
}

// ---- layout (advisory): the built blocks against the approved demo's ----

/**
 * Blocks the demo and the app place differently: a block only one has, blocks in another order, or one much wider or narrower
 * than approved (as a share of the page's widest block, so the demo's frame does not count). Top-level blocks only; the actions
 * row is left out of order and width, since the demo draws it in the page header.
 */
export function layoutFindings(demo: ReadBlock[], app: ReadBlock[]): string[] {
  const out: string[] = [];
  const top = (l: ReadBlock[]) => l.filter((b) => !b.nested && !b.type.includes(":"));
  const dt = top(demo), at = top(app);
  const d = dt.map((b) => b.type), a = at.map((b) => b.type);
  for (const t of new Set([...d, ...a])) {
    const nd = d.filter((x) => x === t).length, na = a.filter((x) => x === t).length;
    if (nd !== na) out.push(`${t}: ${na} built, ${nd} approved`);
  }
  const order = (l: string[]) => l.filter((t) => t !== "actions" && d.includes(t) && a.includes(t)).join(" > ");
  if (order(d) !== order(a)) out.push(`the blocks are in another order: ${order(a)} (approved ${order(d)})`);
  const widest = (l: ReadBlock[]) => Math.max(1, ...l.map((b) => b.box.w));
  const dw = widest(dt), aw = widest(at);
  const seen = new Map<string, number>();
  for (const b of dt.filter((x) => x.type !== "actions")) {
    const n = seen.get(b.type) ?? 0;
    seen.set(b.type, n + 1);
    const m = at.filter((x) => x.type === b.type)[n];
    if (!m || !b.box.w) continue;
    const want = b.box.w / dw, got = m.box.w / aw;
    if (Math.abs(want - got) > 0.25) out.push(`${b.type}${n ? ` ${n + 1}` : ""} is ${Math.round(got * 100)}% of the page's width, approved ${Math.round(want * 100)}%`);
  }
  return out;
}

// ---- the run ----

export interface FidelityRunInput {
  baseUrl: string;
  design: Design;
  /** the screens built with the kit */
  screens: string[];
  /** the approved demo (the package's demo/index.html) and its pictures */
  demoFile?: string; shotsDir?: string; shots?: { file: string; id?: string; state: string; viewport: string; mode?: string; lang?: string }[];
  /** accepted built pictures by page key (absolute paths) */
  baselines?: Record<string, string>;
  outDir: string;
  /** the folder the report names its pictures under, relative to the run's folder */
  relDir: string;
  log?: (m: string) => void;
  /** at most this many pages (the rest are listed as not checked) */
  max?: number;
  /** leave out the WebKit pass at phone width (run when WebKit is installed) */
  noWebkit?: boolean;
}

const STILL_CSS = "*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}";
const TAB_PRESSES = 25;

type Page = { goto(u: string, o?: object): Promise<unknown>; evaluate(s: string): Promise<any>; addStyleTag(o: object): Promise<unknown>; addScriptTag(o: object): Promise<unknown>; screenshot(o: object): Promise<unknown>; emulateMedia(o: object): Promise<void>; keyboard: { press(k: string): Promise<void> }; locator(s: string): { click(): Promise<void>; count(): Promise<number> }; waitForTimeout(n: number): Promise<void>; waitForLoadState(s: string): Promise<void>; close(): Promise<void>; mouse: { move(x: number, y: number): Promise<void> } };

async function settle(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await page.addStyleTag({ content: STILL_CSS }).catch(() => undefined);
  await page.evaluate("document.fonts ? document.fonts.ready.then(function(){return 1}) : 1").catch(() => undefined);
  await page.mouse.move(0, 0);
  await page.waitForTimeout(250);
}

/** axe's critical and serious violations, one line per rule. */
async function axeFindings(page: Page, src: string): Promise<string[]> {
  await page.addScriptTag({ content: src });
  const r = (await page.evaluate(`window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] } }).then(function (r) { return r.violations.map(function (v) { return { id: v.id, impact: v.impact, help: v.help, n: v.nodes.length, t: v.nodes.slice(0, 2).map(function (n) { return n.target.join(" "); }), c: v.nodes.slice(0, 2).map(function (n) { var d = n.any && n.any[0] && n.any[0].data; return d && d.fgColor ? d.fgColor + " on " + d.bgColor + ", " + d.contrastRatio + ":1" : ""; }) }; }); })`)) as { id: string; impact: string; help: string; n: number; t: string[]; c: string[] }[];
  return r.filter((v) => v.impact === "critical" || v.impact === "serious").map((v) => `${v.impact}: ${v.help} (${v.id}, ${v.n} element${v.n > 1 ? "s" : ""}: ${v.t.map((t, i) => (v.c[i] ? `${t} [${v.c[i]}]` : t)).join("; ")})`);
}

/** The keyboard's path through the page: focus that cannot be seen, or that lands on something hidden. */
async function focusFindings(page: Page): Promise<string[]> {
  const out = new Set<string>();
  let moved = 0;
  for (let i = 0; i < TAB_PRESSES; i++) {
    await page.keyboard.press("Tab");
    const f = (await page.evaluate(inPage(readFocus))) as ReturnType<typeof readFocus>;
    if (!f) continue;
    moved++;
    if (!f.keyboard) continue;
    if (f.hidden) out.add(`the keyboard focus lands on ${f.where}, which is hidden`);
    else if (!f.visible) out.add(`the keyboard focus on ${f.where} cannot be seen (no outline or ring)`);
  }
  if (!moved) out.add("the keyboard cannot reach anything on the page (Tab moves nowhere)");
  return [...out];
}

/** Run the four levels on a running app. Never throws: a browser that cannot start is the report's `skipped`. */
export async function runFidelity(o: FidelityRunInput): Promise<FidelityReport> {
  const log = o.log ?? (() => {});
  const all = fidelityPages(o.design, o.screens);
  const max = o.max ?? 160;
  const pages = all.slice(0, max);
  const notes: string[] = all.length > max ? [`${all.length - max} page(s) past the first ${max} were not checked`] : [];
  const empty = (skipped: string): FidelityReport => ({ kind: "design-fidelity", levels: levelsOf([], [], skipped), findings: [], pages: [], overall: "unchecked", ran: [], notes, skipped });
  if (process.env.FACTORY_NO_SCREENSHOTS) return empty("the browser is switched off (FACTORY_NO_SCREENSHOTS)");
  if (!pages.length) return empty("no screen is built with the kit");
  const exe = findChromium();
  if (!exe) return empty("no browser found (set FACTORY_CHROMIUM to a Chromium binary)");
  const axe = loadAxe();
  if (!axe) notes.push("axe-core is not installed, so accessibility was checked by the keyboard walk only");
  const byScreen = new Map(o.design.screens.map((s) => [s.id, s]));
  // the tokens are checked against the approved theme only; an app that keeps its own look has its own tokens
  const theme = approvedTheme(o.design);
  const noTokens = theme ? undefined : "the app keeps its own look: its tokens are not compared with an approved theme";
  if (noTokens) notes.push(noTokens);
  const raw: { level: FidelityLevel; message: string; page: string }[] = [];
  const results: FidelityPageResult[] = [];
  const ran = new Set<string>();
  let browser: { close(): Promise<void>; newPage(o: object): Promise<Page> } | undefined;
  try {
    const { chromium } = await import("playwright-core");
    mkdirSync(join(o.outDir, "built"), { recursive: true });
    browser = (await chromium.launch({ executablePath: exe, args: ["--no-sandbox"], timeout: 30_000 })) as unknown as typeof browser;
    const tokens = new Map<string, TokenSet>();
    const demoUrl = o.demoFile && existsSync(o.demoFile) ? pathToFileURL(o.demoFile).href : undefined;
    if (!demoUrl) notes.push("the approved demo is not at hand, so layout was not compared");
    const walked = new Set<string>();
    for (const vp of ["phone", "tablet", "desktop"] as Viewport[]) {
      const opts = { viewport: VIEWPORTS[vp], reducedMotion: "reduce", deviceScaleFactor: 1, locale: "en-US", timezoneId: "UTC" };
      const app = await browser!.newPage(opts);
      const demo = demoUrl ? await browser!.newPage(opts) : undefined;
      for (const p of pages.filter((x) => x.viewport === vp)) {
        const s = byScreen.get(p.id)!;
        const add = (level: FidelityLevel, list: string[]) => list.forEach((message) => raw.push({ level, message, page: p.key }));
        try {
          await app.emulateMedia({ colorScheme: p.mode === "dark" ? "dark" : "light" });
          ran.add(`Chromium ${vp}${p.mode ? " dark" : ""}${p.lang ? ` ${p.lang}` : ""}`);
          await app.goto(new URL(p.path, o.baseUrl).href, { waitUntil: "load", timeout: 30_000 });
          await settle(app);
          // tokens, in the mode the page is drawn in
          const mode = p.mode ?? "light";
          if (theme && !tokens.has(mode)) {
            const v = tokenValues(theme, mode);
            const bytes = (await app.evaluate(inPage(readColours, v.colours))) as ([number, number, number, number] | null)[];
            tokens.set(mode, { colours: bytes.filter((b): b is [number, number, number, number] => !!b).map((b) => [b[0], b[1], b[2]]), fonts: v.fonts, radii: v.radii, shadows: v.shadows });
          }
          if (theme) add("tokens", tokenFindings((await app.evaluate(inPage(readStyles))) as ReadStyle[], tokens.get(mode)!));
          // structure, in the design's own words (the other language is pictured, not read)
          const got = (await app.evaluate(inPage(readBlocks, ""))) as ReadBlock[];
          if (!p.lang) {
            const words = (await app.evaluate(`(function(){var m=document.querySelector("main")||document.body;return m.innerText+" "+(m.querySelector("[aria-busy]")?"aria-busy":"")})()`)) as string;
            const toasts = (await app.evaluate(`(function(){return [].map.call(document.querySelectorAll("[data-sonner-toast],[role=status]"),function(e){return e.innerText}).join(" ")})()`)) as string;
            add("structure", structureFindings(expectedFor(s, p.slug, vp === "phone"), got, words, toasts));
          }
          // accessibility: axe on every page; the keyboard once per screen and state
          if (axe) add("a11y", await axeFindings(app, axe));
          if (vp === "desktop" && !p.mode && !p.lang && !walked.has(`${p.id}:${p.slug}`)) {
            walked.add(`${p.id}:${p.slug}`);
            add("a11y", await focusFindings(app));
          }
          const file = `built/${p.key}.png`;
          await app.evaluate("window.scrollTo(0, 0)");
          await app.screenshot({ path: join(o.outDir, file), fullPage: true });
          const r: FidelityPageResult = { ...p, built: `${o.relDir}/${file}` };
          const shot = o.shots ? approvedShot(p, o.shots) : undefined;
          if (shot) r.approved = shot;
          // layout against the approved demo in the same state
          // (a loading, empty or error state shows the state, not the blocks, so only the others are compared)
          if (demo && !/^(loading|empty|error)$/.test(stateKindOf(p.state))) {
            const sel = `#${p.id.replace(/[^\w-]/g, "\\$&")}`;
            await demo.goto(`${demoUrl}#${encodeURIComponent(p.id)}`);
            await demo.locator(`${sel} [data-state="${p.demoState}"]`).click();
            if (p.lang) await demo.evaluate("window.__lang && window.__lang(1)");
            if (p.mode) await demo.evaluate('window.__mode && window.__mode("dark")');
            await settle(demo);
            const d = (await demo.evaluate(inPage(readBlocks, `${sel} .canvas`))) as ReadBlock[];
            add("layout", layoutFindings(d, got));
            if (p.lang) await demo.evaluate("window.__lang && window.__lang(0)");
            if (p.mode) await demo.evaluate('window.__mode && window.__mode("light")');
          }
          results.push(r);
        } catch (e) {
          add("structure", [`the page could not be read: ${(e instanceof Error ? e.message : String(e)).split("\n")[0]}`]);
          results.push({ ...p });
        }
      }
      await app.close();
      await demo?.close();
    }
  } catch (e) {
    notes.push(`the check stopped: ${(e instanceof Error ? e.message : String(e)).split("\n")[0]}`);
  } finally {
    try { await browser?.close(); } catch { /* already gone */ }
  }
  // WebKit (Safari's engine) at phone width: the blocks and words, and axe, when WebKit is installed
  if (!o.noWebkit) {
    const phone = pages.filter((p) => p.viewport === "phone" && !p.mode && !p.lang);
    let wk: { close(): Promise<void>; newPage(o: object): Promise<Page> } | undefined;
    try {
      const { webkit } = await import("playwright-core");
      wk = (await webkit.launch({ timeout: 30_000 })) as unknown as typeof wk;
      const app = await wk!.newPage({ viewport: VIEWPORTS.phone, reducedMotion: "reduce", locale: "en-US", timezoneId: "UTC" });
      ran.add("WebKit phone");
      for (const p of phone) {
        const add = (level: FidelityLevel, list: string[]) => list.forEach((message) => raw.push({ level, message: `WebKit: ${message}`, page: `${p.key}-webkit` }));
        try {
          await app.goto(new URL(p.path, o.baseUrl).href, { waitUntil: "load", timeout: 30_000 });
          await settle(app);
          const got = (await app.evaluate(inPage(readBlocks, ""))) as ReadBlock[];
          const words = (await app.evaluate(`(function(){var m=document.querySelector("main")||document.body;return m.innerText+" "+(m.querySelector("[aria-busy]")?"aria-busy":"")})()`)) as string;
          const toasts = (await app.evaluate(`(function(){return [].map.call(document.querySelectorAll("[data-sonner-toast],[role=status]"),function(e){return e.innerText}).join(" ")})()`)) as string;
          add("structure", structureFindings(expectedFor(byScreen.get(p.id)!, p.slug, true), got, words, toasts));
          if (axe) add("a11y", await axeFindings(app, axe));
        } catch (e) {
          add("structure", [`the page could not be read: ${(e instanceof Error ? e.message : String(e)).split("\n")[0]}`]);
        }
      }
    } catch (e) {
      notes.push(`WebKit at phone width was not run: ${/Executable doesn't exist|browserType\.launch/i.test(String(e)) ? "WebKit is not installed (npx playwright install webkit)" : (e instanceof Error ? e.message : String(e)).split("\n")[0]}`);
    } finally {
      try { await wk?.close(); } catch { /* already gone */ }
    }
  }
  // pixels against the accepted pictures
  const pairs = results.filter((r) => r.built && o.baselines?.[r.key]).map((r) => ({ name: r.key, base: o.baselines![r.key]!, final: join(o.outDir, r.built!.slice(o.relDir.length + 1)), out: join(o.outDir, "diff", `${r.key}.png`) }));
  if (pairs.length) {
    mkdirSync(join(o.outDir, "diff"), { recursive: true });
    const px = await pixelDiff(pairs);
    if (px.note) notes.push(px.note);
    for (const d of px.results) {
      const r = results.find((x) => x.key === d.name)!;
      Object.assign(r, { baseline: d.name, ratio: d.ratio, noticeable: d.ratio >= NOTICEABLE_RATIO, ...(d.diff ? { diff: `${o.relDir}/diff/${d.name}.png` } : {}) });
      if (r.noticeable) raw.push({ level: "pixels", page: d.name, message: `${(d.ratio * 100).toFixed(1)}% of the picture differs from the accepted one${d.sizeChanged ? " (its size changed)" : ""}` });
    }
  }
  if (!pairs.length && results.some((r) => r.built)) notes.push("no accepted pictures yet: the built pages are shown beside the approved ones; accept them to make them the baseline");
  log(`fidelity: ${results.length} page(s) read`);
  const findings = group(raw);
  const levels = levelsOf(findings, results, undefined, o.baselines ? pairs.length : 0, noTokens);
  const overall = levels.some((l) => l.blocking && l.status === "FAIL") ? "fail" : levels.some((l) => l.blocking && l.status === "UNCHECKED") ? "unchecked" : "pass";
  return { kind: "design-fidelity", levels, findings, pages: results, overall, ran: [...ran], notes };
}

/** One finding per level and message, with every page it was seen on. */
function group(raw: { level: FidelityLevel; message: string; page: string }[]): FidelityFinding[] {
  const by = new Map<string, FidelityFinding>();
  for (const r of raw) {
    const k = `${r.level}|${r.message}`;
    const f = by.get(k) ?? { level: r.level, message: r.message, pages: [] };
    if (!f.pages.includes(r.page)) f.pages.push(r.page);
    by.set(k, f);
  }
  return [...by.values()];
}

function levelsOf(findings: FidelityFinding[], pages: FidelityPageResult[], skipped?: string, compared = 0, noTokens?: string): FidelityReport["levels"] {
  const read = pages.filter((p) => p.built).length;
  return (["tokens", "structure", "a11y", "layout", "pixels"] as FidelityLevel[]).map((level) => {
    const f = findings.filter((x) => x.level === level);
    // no approved theme: the tokens level is not this check's to pass or fail, so it does not hold the run as unchecked
    if (level === "tokens" && noTokens && !skipped) return { level, blocking: false, check: "design.tokens", status: "UNCHECKED" as CheckStatus, detail: noTokens };
    const blocking = BLOCKING.includes(level);
    const status: CheckStatus = skipped || !read ? "UNCHECKED" : f.length ? (blocking ? "FAIL" : "WARN") : level === "pixels" && !compared ? "UNCHECKED" : "PASS";
    const detail = skipped ?? (!read ? "no page could be read"
      : f.length ? `${f.length} finding(s) on ${new Set(f.flatMap((x) => x.pages)).size} of ${read} page(s)`
      : level === "pixels" && !compared ? "no accepted pictures to compare with yet" : `${read} page(s) checked`);
    return { level, blocking, check: `design.${level}`, status, detail, ...(f.length ? { items: f.slice(0, 20).map((x) => `${x.message} (${x.pages.length} page${x.pages.length > 1 ? "s" : ""})`) } : {}) };
  });
}
