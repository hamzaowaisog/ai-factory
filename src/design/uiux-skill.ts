// The ui-ux-pro-max skill (.agents/skills/ui-ux-pro-max) on the JSON design track. The skill is a search over its own data
// (product types, styles, palettes, font pairings, UX rules), run with Python. The design step's model has no tools, so the
// factory runs the search itself, with no model, and the briefing gets the design system it returns as a starting point.
// The skill is a third party's code and data that the factory runs, so the copy is pinned by its hash.
import { execFile, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { pickIndustries } from "./refs/index.js";
import type { ResolvedSection } from "../context/pack.js";
import { S } from "../stages/think.js";

/** From src/design or dist/design, two levels up is the factory's root. */
export const UIUX_SKILL_DIR = fileURLToPath(new URL("../../.agents/skills/ui-ux-pro-max", import.meta.url));

/**
 * The hash of the reviewed copy: nextlevelbuilder/ui-ux-pro-max-skill, .claude/skills/ui-ux-pro-max, MIT (LICENSE beside it).
 * Every file in the folder counts (line endings as LF; Python's cache files left out). A copy that differs is refused at start-up
 * until someone reviews the change and updates this pin.
 */
export const UIUX_SKILL_SHA256 = "71137485ed53dc5312578513dc9d11205b2fb2c2502745a4609f6e88763cd848";

const SKIP = new Set(["__pycache__", ".pytest_cache"]);
function files(dir: string): string[] {
  return readdirSync(dir).filter((n) => !SKIP.has(n)).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : [p];
  });
}

/** The folder's hash: each file's path and content (LF line endings), in path order. */
export function uiuxSkillSha(dir = UIUX_SKILL_DIR): string {
  const h = createHash("sha256");
  for (const f of files(dir).map((p) => relative(dir, p).replace(/\\/g, "/")).sort()) {
    h.update(`${f}\n`);
    h.update(readFileSync(join(dir, f)).toString("utf8").replace(/\r\n/g, "\n"));
    h.update("\n");
  }
  return h.digest("hex");
}

/**
 * A start-up problem when the installed skill is not the reviewed copy. A missing skill is not a problem: the JSON track draws
 * without it, as before.
 */
export function uiuxProblem(dir = UIUX_SKILL_DIR, pinned = UIUX_SKILL_SHA256): string | undefined {
  if (!existsSync(join(dir, "SKILL.md"))) return undefined;
  const sha = uiuxSkillSha(dir);
  return sha === pinned ? undefined
    : `the ui-ux-pro-max skill at ${dir} is not the reviewed copy (sha256 ${sha.slice(0, 12)}, pinned ${pinned.slice(0, 12)}); review the change and update UIUX_SKILL_SHA256 in src/design/uiux-skill.ts`;
}

/** The Python that runs the search: the first that answers, found once. */
let python: { cmd: string; pre: string[] } | null | undefined;
export function findPython(): { cmd: string; pre: string[] } | undefined {
  if (python !== undefined) return python ?? undefined;
  for (const c of [{ cmd: "python3", pre: [] }, { cmd: "python", pre: [] }, { cmd: "py", pre: ["-3"] }]) {
    try {
      if (/^Python 3\./.test(execFileSync(c.cmd, [...c.pre, "--version"], { encoding: "utf8", timeout: 10_000, stdio: ["ignore", "pipe", "pipe"] }).trim())) return (python = c);
    } catch { /* not this one */ }
  }
  python = null;
  return undefined;
}

/** One search, in seconds: the skill reads its CSV files and answers in well under one. */
const SEARCH_MS = 30_000;
/** The most of the skill's answer the briefing takes. */
const MAX_TEXT = 6000;

/**
 * Runs the skill's search.py with these arguments: isolated from the environment and the user's packages (-E -s), and with no
 * cache files written into the skill (-B), so its pinned hash stays right.
 */
async function runSearch(args: string[]): Promise<string> {
  const py = findPython();
  if (!py) throw new Error("python 3 was not found (python3, python or py -3)");
  return new Promise((resolve, reject) => {
    execFile(py.cmd, [...py.pre, "-E", "-s", "-B", join(UIUX_SKILL_DIR, "scripts", "search.py"), ...args],
      { cwd: join(UIUX_SKILL_DIR, "scripts"), timeout: SEARCH_MS, maxBuffer: 2_000_000, encoding: "utf8", env: { PATH: process.env.PATH ?? "", SYSTEMROOT: process.env.SYSTEMROOT ?? "", PYTHONIOENCODING: "utf-8" } },
      (err, stdout, stderr) => (err ? reject(new Error(`${err.message.split("\n")[0]}${stderr ? `: ${String(stderr).trim().split("\n").pop()}` : ""}`)) : resolve(String(stdout))));
  });
}

let search: (args: string[]) => Promise<string> = runSearch;
/** Tests replace the search; undefined goes back to the skill's search.py. */
export function setUiuxSearch(f: ((args: string[]) => Promise<string>) | undefined): void { search = f ?? runSearch; }

/** What the search is asked for: the product's field (from the factory's own field list), its project name, and that it is an app. */
export function uiuxQuery(reqText: string, name?: string): string {
  const fields = pickIndustries(reqText).map((m) => m.industry);
  const words = fields.flatMap((f) => f.keywords.filter((k) => new RegExp(`\\b${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(reqText))).slice(0, 6);
  return [...fields.map((f) => f.label), ...words, name ?? "", "web app"].filter(Boolean).join(" ").replace(/\s+/g, " ").slice(0, 120).trim();
}

/** The skill's design system for this product, as markdown, or why there is none. Never throws. */
export async function uiuxDesignSystem(query: string, name: string): Promise<{ text?: string; why?: string }> {
  try {
    const out = (await search([query, "--design-system", "-f", "markdown", "-p", name || "Product"])).trim();
    if (!out) return { why: "the search returned nothing" };
    return { text: out.length > MAX_TEXT ? `${out.slice(0, MAX_TEXT - 20).trimEnd()}\n… (cut)` : out };
  } catch (e) {
    return { why: (e as Error).message };
  }
}

const GUIDE = `A starting point for the look from the ui-ux-pro-max skill's design data (style, palette, fonts, things to avoid, checks).
Use it where nothing else decides: the client's brand colours and fonts, an existing app's look, the client's references and the
lead's feedback all win over it, and the design references for this field still apply.
Its "Pattern" part is for marketing landing pages; app screens ignore it.
Take its palette roles and font pairing as suggestions to fit into the design's theme, and keep its checklist (contrast, focus
states, reduced motion) for every screen.`;

/**
 * The design briefing's ui-ux-pro-max section, for a design that chooses a new look; nothing for one that keeps a look (an
 * existing app, an approved design, a look taken from the client's references). A search that cannot run is a note, never a
 * failure: the design is drawn without it.
 */
export async function uiuxSection(reqText: string, name: string, newLook: boolean): Promise<{ section?: ResolvedSection; note?: string }> {
  if (!newLook) return {};
  if (!existsSync(join(UIUX_SKILL_DIR, "SKILL.md")) && search === runSearch) return { note: "design: the ui-ux-pro-max skill is not installed; drawn without it" };
  const r = await uiuxDesignSystem(uiuxQuery(reqText, name), name);
  if (!r.text) return { note: `design: ui-ux-pro-max could not run (${r.why}); drawn without it` };
  return { section: S.reference("ui-ux-pro-max", `${GUIDE}\n\n${r.text}`), note: "design: ui-ux-pro-max design system added to the briefing" };
}
