// Estimate mode's design step (docs/estimates-design.md, "Design baseline"). For a request with UI it
// proposes the screen inventory the estimate stands on: a flow, every screen with its route and the
// requirements it serves, and a reason for each requirement that needs no screen. Code checks the links
// both ways. It is an inventory of screens with sample content, not a finished design: a person approves it at E1b, and it
// becomes the count of screens, flows and reused components for the UI work.
import { z } from "zod";
import type { IntentBody, Spec } from "../contracts/index.js";
import type { RunState } from "../ledger/state.js";
import type { DesignInventory } from "../design/inventory.js";
import { DesignTheme, ScreenMock, ScreenMockFull } from "../contracts/artifacts.js";
import { failure } from "../gates/engine.js";
import { header, readOutput, requireOutput, type StepDef } from "./framework.js";
import { briefFor, pickIndustries } from "../design/refs/index.js";
import { fitRefs, themeFit, type FitRefs } from "../design/refs/fit.js";
import { ensureMeasured } from "../design/refs/measure.js";
import { S, think, UNTRUSTED_NOTE } from "./think.js";
import { decideRework, designIndex, roundOf, screenName, Triage, TRIAGE_RULES, type ReworkPlan, type ReworkRound } from "./design-rework.js";

type Intent = z.infer<typeof IntentBody>;

export const DesignOut = z.object({
  flow: z.string().min(1),
  screens: z.array(z.object({
    id: z.string(), route: z.string().min(1), file: z.string().min(1), reqs: z.array(z.string()),
    states: z.array(z.string()).default([]),
    /** new screen, a tweak of an existing one, a design-system change, or reuse of existing components */
    size: z.enum(["new", "tweak", "design-system", "reuse"]).default("new"),
    /** attached design frames (F-1, ...) that show this screen or one of its states */
    frames: z.array(z.string()).default([]),
    /** believable sample content for the clickable demo; absent, the demo draws a plain wireframe */
    mock: ScreenMock.optional(),
    /** the same page with fine-grained data: shown as the demo's "Full data" state */
    mockFull: ScreenMockFull.optional(),
  })).min(1),
  /** the look of the product: chosen from what the requirements say it is and who uses it */
  theme: DesignTheme.optional(),
  /** requirements that need no screen (an API rule, a job) and why */
  noScreen: z.array(z.object({ req: z.string(), reason: z.string().min(1) })).default([]),
});

const RULES = `You are a principal UI/UX engineer with fifteen years shipping consumer and enterprise products, drawing the screen inventory of a UI request for an estimate. The approved inventory is what the estimate counts. Hold the work to the standard of a design review at a top product studio: clear visual hierarchy, one focal point per screen, consistent spacing rhythm, readable contrast, real content, every state considered. If it would not survive that review, redo it before answering.
- List every screen a user sees: id S-1, S-2, ..., its route, a proposed file path, the requirement ids it serves in "reqs", its states (empty, loading, error, success, validation) and its size:
  new (a screen that does not exist), tweak (a change to an existing screen), design-system (a new shared component or theme change), reuse (built only from existing components).
- Every requirement that has anything a user sees or does goes on at least one screen. A requirement with no screen at all (an API rule, a scheduled job) goes in "noScreen" with the reason. Nothing may be left out.
- "flow": two or three sentences on how a user moves between the screens.
- Use only requirement ids that exist. Do not invent screens the requirements do not need.
- ART DIRECTION. This is proof-driven design, not invention. Work out what the product is and who uses it from the requirements alone, then compare it with the real market: the "design-references" section lists the top products of this field (or, when the field is not listed, the nearest kind of product) with their brand colours, bar, corners and traits. Study what they share, and build the look from that.
  Return "theme" with:
  basis: two to four of those real products and what you took from each ("Delta: navy headings, red only on the primary action", "Emirates: filled brand bar, large photography"). Code rejects a theme that cites fewer than two briefed products, and one whose brand colour is far (over 40 degrees of hue) from every reference colour of the field. Differ from the field only where this product's users or job demand it, and say so in "basis".
  How real products are coloured: a mostly neutral page (white or near-white, or a deliberate dark), near-black text, ONE brand colour used for the app bar, the primary action and selection, and status colours only where they carry meaning (green done, red wrong, amber attention). Colour is information, not decoration.
  The result must look current and expensive, the kind of product shipped this year: confident type scale, generous spacing, depth from soft layered surfaces, and motion everywhere it helps (entrances, hover lift, counting numbers, drawing charts, skeleton shimmer, state transitions). It must not look machine-made. Avoid purple-to-blue gradients with no source in the field, neon glows on a business tool, glass panels everywhere, several accent colours, rainbow icons, one huge radius on everything, and centred "three cards" layouts.
  mood: two or three words for the feeling (for example "calm clinical", "precise financial", "warm retail"). Invent the one that fits.
  mode: "light" for most products, "dark" only when the audience works in it for hours (developer, trading, media, creative tools), "auto" to follow the viewer.
  brand: the one brand colour (#rrggbb), in the family of the references, as a competitor in the field would choose it. accent: optional second colour for a sparing highlight, only when the field has one (for example a gold on navy, or the red beside navy).
  neutral: "cool" (technical, finance, health), "warm" (food, hospitality, craft, education) or "pure" (editorial, minimal).
  chrome: "brand" fills the app bar with the brand colour (airlines, retail, telecom, many consumer apps); "plain" keeps it white or dark (SaaS, back-office, finance, health).
  font: "sans" (default), "humanist" (friendly, health, education), "serif" (editorial, legal, luxury, heritage headings) or "rounded" (playful consumer).
  radius: "sharp" (enterprise, data-dense, government), "soft" (most products) or "round" (friendly consumer).
  density: "compact" for tools used all day, "comfortable" otherwise.
  surface: "soft" (layered cards with a light shadow: the modern default), "flat" (hairline borders, no shadow; dense back-office tools) or "glass" (translucent; media, creative or premium consumer products).
  motion: "lively" (the default) or "calm" (only for serious, high-stakes tools). The page animates either way; calm only quiets it.
  fx: "modern" (the default: soft brand glow behind the page, hover lift, scroll reveal), "futuristic" (a glow mesh, spotlight that follows the pointer on cards, gradient headings; for products whose users expect it, such as travel, fintech, media, AI and developer tools) or "quiet" (none of it; government, legal, clinical back-office).
- MOCK CONTENT. For every screen also give "mock": what the page shows, as a picture to react to, not a spec.
  Take every noun from the requirements' own domain: its entities, roles, statuses, units, currencies, places, names and formats. Make the sample data believable and varied (different lengths, several statuses, plausible dates and amounts that agree with each other). Never "Lorem ipsum", "Item 1", "Column A", "Test User" or "Sample".
  "title" and "subtitle" of the page; "blocks" in page order (2 to 5), each one of: stats (label, value, delta), filters (search placeholder, chips), table (columns, 4 to 6 rows of cells, statusColumn = index of the status column), form (fields with label, kind text/select/date/textarea/toggle, placeholder or value, options; the submit label), chart (bar or line, title, 5 to 8 labelled points), cards (title, meta, badge; visual true for things people choose by picture, like products, places, listings), list (title, meta), steps (a progress or checkout path, current index), timeline (time, title, status done/now/next: tracking, history, itinerary), detail (a record's labelled facts; style "pass" for a ticket, booking or boarding pass, with a lead value like the route or amount), actions (button labels), text (body).
  The page follows the refined requirements, never a fixed template. Most screens need no chart and no table: a booking flow is steps, a form and a summary; a catalogue is cards; a status page is a timeline; a settings page is a form and toggles. Add a chart only when a requirement says a trend or figure is watched, a table only when records are compared or scanned, cards only when things are chosen by picture. A screen that draws a block no requirement asks for fails review.
  Choose the block each requirement's wording asks for: something to browse or compare is a table or cards, a figure the user watches is stats, a trend is a chart, narrowing or finding is filters, something the user enters is a form, something the user triggers is actions. Keep cells and labels short.
  The same sample data is shown in every state of the screen (loading refreshes it in place, empty previews what fills the page, an error keeps the last good data behind the message), so give each block enough real rows and values to carry all of them.
- FULL DATA. For every screen with figures, tables, charts, cards, lists or timelines also give "mockFull": the same page (same title, same block types, same order) with fine-grained data, the way it looks on a busy real day. Tables 8 to 14 rows using every status the product has, with varied lengths, dates and amounts that agree with the stats above them; every chart with more points (up to 14) and a believable shape (a trend, a seasonal dip, a spike with a cause); cards, lists and timelines at their fullest; stats whose deltas are consistent with the charts. Densify only the block types the normal page already has, because they came from the requirements; add a second chart or a detail block only when a requirement itself has something worth plotting or reading closely. It is the screen as the business would show it in a sales demo.
  The loading state is drawn from the normal page: titles, labels, column headers, filters, buttons and navigation stay real, and only the data turns into skeleton shapes. So write the normal page with real headers and labels.
  "copy" holds the words for the states the screen has, in the product's own voice: emptyTitle and emptyHint (when it can be empty), error, success, validation (one plain sentence each).
- If design frames are listed in the request (F-1, F-2, ...), each image frame is one screen or one state of a screen: put its id in that screen's "frames". Do not leave an image frame unused and do not cite a frame that is not listed.
- If an approved earlier design is given, this is a change to it: keep the id, route and file of every screen that does not change, give new screens the next free ids, and drop a screen only when the new requirements remove it.
- If an existing-system summary is given, mark a screen "reuse" or "tweak" only when an existing page or shared component really covers it.
${UNTRUSTED_NOTE}`;

const PLACEHOLDER = /lorem ipsum|\bitem \d\b|column [a-d]\b|test user|\bsample\b|john doe|jane doe|foo bar|\bTBD\b/i;

/**
 * What makes the demo look finished rather than raw. Without "theme" the page falls back to a default look; a screen
 * without "mock" is drawn as a grey wireframe. Both are optional in the schema, so code insists on them for a request with UI
 * (a screen shown by an attached frame needs no mock) and the model is asked again with these reasons.
 */
export function designQuality(out: z.infer<typeof DesignOut>, existing = false, refs?: FitRefs): { check: string; message: string }[] {
  const bad: { check: string; message: string }[] = [];
  // proof the look comes from real products in the field: colours near the references, and the references cited
  if (refs && !existing) bad.push(...themeFit(out.theme, refs));
  // an existing app keeps its own look: no theme is drawn, the build follows the repo's tokens and components
  if (!out.theme && !existing) bad.push({ check: "design-no-theme", message: 'No "theme". Choose the product look (brand colour, mode, radius, font, surface, motion) from the ART DIRECTION rules; without it the demo shows a default look.' });
  for (const sc of out.screens) {
    if (!sc.mock) {
      if (!sc.frames.length) bad.push({ check: "design-no-mock", message: `Screen ${sc.id} has no "mock". Give it believable sample content (2 to 5 blocks) so the demo is not a wireframe.` });
      continue;
    }
    if (/^(page|screen|view|untitled|new page|home page)\s*\d*$/i.test(sc.mock.title.trim())) bad.push({ check: "design-generic-title", message: `Screen ${sc.id} is titled "${sc.mock.title}". Name each page for what it shows ("Find a flight", "My trips"): the lead talks about pages by name.` });
    if (sc.mock.blocks.length < 2) bad.push({ check: "design-thin-mock", message: `Screen ${sc.id} has only ${sc.mock.blocks.length} block. A real page has 2 to 5 (header figures, a table or cards, filters, actions).` });
    const hit = JSON.stringify(sc.mock).match(PLACEHOLDER);
    if (hit) bad.push({ check: "design-placeholder", message: `Screen ${sc.id} sample content contains placeholder text ("${hit[0]}"). Use real names, amounts, statuses and dates from the product's domain.` });
    const dataTypes = ["stats", "table", "chart", "cards", "list", "timeline", "detail"];
    if (sc.mock.blocks.some((b) => dataTypes.includes(b.type))) {
      if (!sc.mockFull) bad.push({ check: "design-no-full-mock", message: `Screen ${sc.id} has no "mockFull". Give the same page with fine-grained data (see FULL DATA) so the demo can show it dense and complete.` });
      else {
        const hit2 = JSON.stringify(sc.mockFull).match(PLACEHOLDER);
        if (hit2) bad.push({ check: "design-placeholder", message: `Screen ${sc.id} full-data content contains placeholder text ("${hit2[0]}"). Use real names, amounts, statuses and dates from the product's domain.` });
        const size = (m: { blocks: { type: string }[] }, t: string) => m.blocks.filter((b) => b.type === t).length;
        const missing = [...new Set(sc.mock.blocks.map((b) => b.type))].filter((t) => dataTypes.includes(t) && size(sc.mockFull!, t) < size(sc.mock!, t));
        if (missing.length) bad.push({ check: "design-thin-full-mock", message: `The full-data page of ${sc.id} is missing ${missing.join(", ")} that the normal page has. It must keep every data block and make each denser.` });
        for (const t of ["cards", "list", "timeline"] as const) {
          const n = (m: { blocks: { type: string; items?: unknown[] }[] }) => Math.max(0, ...m.blocks.filter((b) => b.type === t).map((b) => b.items?.length ?? 0));
          const cap = t === "cards" ? 9 : 10, base = n(sc.mock as never);
          if (base && n(sc.mockFull as never) <= base && base < cap - 1) bad.push({ check: "design-thin-full-mock", message: `The ${t} of the full-data page of ${sc.id} must show more items than the normal page (up to ${cap}).` });
        }
        const rows = (m: { blocks: { type: string; rows?: unknown[]; points?: unknown[] }[] }, t: "rows" | "points") => Math.max(0, ...m.blocks.map((b) => b[t]?.length ?? 0));
        if (sc.mock.blocks.some((b) => b.type === "table") && rows(sc.mockFull as never, "rows") < 8) bad.push({ check: "design-thin-full-mock", message: `The tables of the full-data page of ${sc.id} have too few rows; give 8 to 14 varied rows with every status in use.` });
        if (sc.mock.blocks.some((b) => b.type === "chart") && rows(sc.mockFull as never, "points") <= rows(sc.mock as never, "points") && rows(sc.mock as never, "points") < 14) bad.push({ check: "design-thin-full-mock", message: `The charts of the full-data page of ${sc.id} must have more points than the normal page (up to 14).` });
      }
    }
    const tbl = sc.mock.blocks.find((b) => b.type === "table");
    if (tbl && tbl.type === "table" && tbl.rows.length < 3) bad.push({ check: "design-thin-mock", message: `The table on ${sc.id} has ${tbl.rows.length} rows; give 4 to 6 varied rows so it reads like real data.` });
  }
  return bad;
}

/** The design frames listed in the request text (`- F-1 home.png`), in order. JSON exports are data, not screens. */
export function listedFrames(request: string): { id: string; name: string }[] {
  return [...request.matchAll(/^- (F-\d+) (.+?)\s*$/gm)].map((m) => ({ id: m[1]!, name: m[2]! })).filter((f) => !/\.json$/i.test(f.name));
}

/** Code's view of the links: which requirements no screen serves, and which screens serve none. */
export function mapDesign(reqIds: string[], out: z.infer<typeof DesignOut>, frameIds: string[] = []): { unmappedReqs: string[]; orphanScreens: string[]; unknown: string[]; duplicateIds: string[]; duplicateRoutes: string[]; unknownFrames: string[]; unusedFrames: string[] } {
  const dup = (xs: string[]) => [...new Set(xs.filter((x, i) => xs.indexOf(x) !== i))];
  const used = out.screens.flatMap((s) => s.frames);
  const known = new Set(reqIds);
  const served = new Set(out.screens.flatMap((s) => s.reqs));
  const exempt = new Set(out.noScreen.map((n) => n.req));
  return {
    unmappedReqs: reqIds.filter((r) => !served.has(r) && !exempt.has(r)),
    orphanScreens: out.screens.filter((s) => s.reqs.length === 0).map((s) => s.id),
    unknown: [...new Set([...out.screens.flatMap((s) => s.reqs), ...out.noScreen.map((n) => n.req)].filter((r) => !known.has(r)))],
    duplicateIds: dup(out.screens.map((s) => s.id)),
    // a route is the same route however it is cased or ends
    duplicateRoutes: dup(out.screens.map((s) => s.route.trim().toLowerCase().replace(/\/+$/, "") || "/")),
    unknownFrames: [...new Set(used.filter((f) => !frameIds.includes(f)))],
    unusedFrames: frameIds.filter((f) => !used.includes(f)),
  };
}

/** A repo whose UI already has pages and a design system (or partial one): the design extends it instead of inventing a look. */
export const hasExistingLook = (inv: DesignInventory | undefined): inv is DesignInventory => !!inv && inv.pages.length > 0 && inv.verdict !== "none";

const EXISTING_RULES = `EXISTING APP. The "existing" section is this product's real UI. Extend it; do not restyle it.
- Do NOT return "theme": the app already has its look. The build will use the existing design tokens and shared components.
- Mark a screen "reuse" or "tweak" when an existing page or shared component covers it, "new" only for a page that does not exist, "design-system" only for a new shared component or token.
- Choose a route and file in the app's own structure (see its pages), and take the sample content from the same domain the existing pages show.`;

const inventoryBrief = (inv: DesignInventory) => ({
  verdict: inv.verdict, tokens: inv.tokens.total, framework: inv.stack.framework, styling: inv.stack.styling, componentSystem: inv.stack.componentSystem,
  pages: inv.pages.slice(0, 40), sharedComponents: [...inv.primitives, ...inv.composites].slice(0, 40).map((c) => (c as { name?: string }).name ?? c),
});

/** How many times a lead can send the design back before the run stops and asks for a different brief. */
export const MAX_DESIGN_REVISIONS = 4;

/** What the lead said when sending the design back, oldest first. The design is redrawn once for each. */
export function designRejections(s: RunState): string[] {
  return s.decisions.filter((d) => d.cardId.startsWith("design-") && d.decision === "reject")
    .map((d) => String((d as { reason?: string }).reason ?? "").trim() || "(no reason given)");
}


// ---------- sending a design back: fix what was named, or redraw ----------

type ScreenT = z.infer<typeof DesignOut>["screens"][number];
type Theme = z.infer<typeof DesignTheme>;
interface DesignArt { skipped?: boolean; flow: string; screens: ScreenT[]; noScreen: { req: string; reason: string }[]; theme?: Theme; themeSource?: "new" | "repo"; mapping: { unmappedReqs: string[]; orphanScreens: string[] }; revision?: number; rework?: ReworkRound[]; figmaUrl?: string }

const cut = (from: string, to: string): string => RULES.slice(RULES.indexOf(from), RULES.indexOf(to));
const ART_RULES = (): string => cut("- ART DIRECTION.", "- MOCK CONTENT.");
const MOCK_RULES = (): string => cut("- MOCK CONTENT.", "- If design frames");

const PATCH_SCREEN = `You are a principal UI/UX engineer fixing ONE page of an approved design after the lead sent it back. Return that page as "screen" with the same id, route, file and requirement ids.
- Change only what the feedback asks. Keep everything else on the page as it is: its title, blocks, states and sample content.
- The look (the theme) is fixed: use it as given. The other pages are only there so this one stays consistent with them.
- Name and words stay the lead's: the page keeps a clear title for what it shows.
`;
const PATCH_DATA = `This is a sample-content fix: keep the page's blocks, their types and their order exactly; change only the sample content (names, amounts, dates, rows, labels), and keep "mockFull" in step with it.
`;
const PATCH_LOOK = `You are a principal UI/UX engineer changing only the LOOK of an approved design after the lead sent it back. Return "theme" only: the pages and their content stay as they are and are not yours to change.
`;

const reqLines = (spec: Spec) => spec.requirements.map((q) => ({ id: q.id, ears: q.ears }));
const asks = (items: { quote: string; change: string }[]) => items.map((i, n) => `${n + 1}. The lead said: "${i.quote}". Change: ${i.change}`).join("\n");

interface Reworked { done?: { design: DesignArt }; redraw?: { round: ReworkRound; fine: string[] } }

/**
 * A design that was sent back. A cheap model reads the lead's reason against a compact index, code decides whether to fix the
 * named parts or redraw, and the parts are fixed one call each. Anything doubtful, or any fix that fails its checks twice,
 * falls back to the full redraw, so the worst case is the old behaviour plus a small triage call.
 */
async function reworkDesign(ctx: Parameters<StepDef["run"]>[0], spec: Spec, prev: DesignArt, reasons: string[], inv: DesignInventory | undefined): Promise<Reworked> {
  const existing = hasExistingLook(inv);
  const round = reasons.length;
  const earlier = reasons.slice(0, Math.max(0, (prev.revision ?? 0)));
  const fresh = reasons.slice(prev.revision ?? 0);
  const redraw = (plan: ReworkPlan | { mode: "redraw"; why: "failed" }, t?: Triage): Reworked => ({ redraw: { round: roundOf({ round, plan, ...(t ? { t } : {}), design: prev }), fine: (t?.fine ?? []) } });
  const tr = await think(ctx, {
    stage: "design", route: "design-triage", cls: "read-small", budgetTokens: 14000, tools: [], schema: Triage, maxTurns: 2,
    sections: [
      S.template("tpl", TRIAGE_RULES),
      S.artifact("design-index", "approved-design", designIndex(prev, reqLines(spec))),
      ...(earlier.length ? [S.reference("earlier-feedback", `Earlier notes from the lead, already answered:\n${earlier.map((x, i) => `${i + 1}. ${x}`).join("\n")}`)] : []),
      S.reference("feedback", `The lead's note on this design:\n${fresh.map((x) => `- ${x}`).join("\n")}`),
      S.task("Say which parts of the design to fix."),
    ],
  });
  if (!tr.ok) return redraw({ mode: "redraw", why: "vague" });
  const t = tr.output;
  const plan = decideRework(t, prev);
  if (plan.mode === "redraw") return redraw(plan, t);
  if (plan.mode === "patch" && plan.look && existing) return redraw({ mode: "redraw", why: "vague" }, t);
  const finish = (design: DesignArt, patched: string[], p: ReworkPlan): Reworked => {
    const r = roundOf({ round, plan: p, t, design, patched });
    return { done: { design: { ...design, revision: reasons.length, rework: [...(prev.rework ?? []), r] } } };
  };
  if (plan.mode === "none") return finish(prev, [], plan);

  const reqText = spec.requirements.map((q) => q.ears).join("\n");
  const others = (id: string) => prev.screens.filter((x) => x.id !== id).map((x) => ({ id: x.id, title: screenName(x), route: x.route }));
  let theme = prev.theme;
  const history = (x: string) => (earlier.length ? [S.reference(`earlier-${x}`, `Earlier notes from the lead (do not undo these fixes):\n${earlier.map((e, i) => `${i + 1}. ${e}`).join("\n")}`)] : []);

  if (plan.look) {
    const items = plan.items.filter((i) => i.part === "look");
    await ensureMeasured(pickIndustries(reqText).map((p) => p.industry.id)).catch(() => undefined);
    const refs = fitRefs(reqText);
    let failures: string[] = [], got: Theme | undefined;
    for (let attempt = 0; attempt < 2 && !got; attempt++) {
      const r = await think(ctx, {
        stage: "design", route: "design", cls: "read-large", budgetTokens: 24000, tools: [], schema: z.object({ theme: DesignTheme }), maxTurns: 3,
        sections: [
          S.template("tpl", PATCH_LOOK + ART_RULES() + UNTRUSTED_NOTE),
          S.artifact("requirements", "spec", reqLines(spec)),
          S.artifact("current-look", "approved-design", prev.theme),
          S.artifact("pages", "approved-design", prev.screens.map((x) => ({ title: screenName(x), route: x.route, blocks: x.mock?.blocks.map((b) => b.type) }))),
          S.reference("design-references", `Design references (how real products in this field look):\n${briefFor(reqText)}`),
          S.reference("feedback", `Change the look as the lead asked:\n${asks(items)}`),
          ...history("look"),
          ...(failures.length ? [S.reference("failures", `Your previous attempt was rejected:\n${failures.map((f) => `- ${f}`).join("\n")}`)] : []),
          S.task("Return the new theme."),
        ],
      });
      if (!r.ok) return redraw({ mode: "redraw", why: "failed" }, t);
      failures = themeFit(r.output.theme, refs).map((x) => x.message);
      if (!failures.length) got = r.output.theme;
    }
    if (!got) return redraw({ mode: "redraw", why: "failed" }, t);
    theme = got;
  }

  const screens = [...prev.screens];
  for (const id of plan.screens) {
    const at = screens.findIndex((x) => x.id === id), old = screens[at]!;
    const items = plan.items.filter((i) => i.part !== "look" && i.screen === id);
    const dataOnly = items.every((i) => i.part === "data");
    let failures: string[] = [], got: ScreenT | undefined;
    for (let attempt = 0; attempt < 2 && !got; attempt++) {
      const r = await think(ctx, {
        stage: "design", route: "design", cls: "read-large", budgetTokens: 30000, tools: [], schema: z.object({ screen: DesignOut.shape.screens.element }), maxTurns: 3,
        sections: [
          S.template("tpl", PATCH_SCREEN + (dataOnly ? PATCH_DATA : "") + MOCK_RULES() + UNTRUSTED_NOTE),
          S.artifact("requirements", "spec", reqLines(spec)),
          ...(theme ? [S.artifact("look", "approved-design", theme)] : []),
          S.artifact("other-pages", "approved-design", others(id)),
          S.artifact("this-page", "approved-design", old),
          S.reference("feedback", `Fix this page as the lead asked:\n${asks(items)}`),
          ...history("page"),
          ...(failures.length ? [S.reference("failures", `Your previous attempt was rejected:\n${failures.map((f) => `- ${f}`).join("\n")}`)] : []),
          S.task("Return the fixed page."),
        ],
      });
      if (!r.ok) return redraw({ mode: "redraw", why: "failed" }, t);
      const nw = r.output.screen, bad: string[] = [];
      if (nw.id !== old.id || nw.route !== old.route || nw.file !== old.file) bad.push(`keep the id ${old.id}, route ${old.route} and file ${old.file}`);
      if ([...nw.reqs].sort().join() !== [...old.reqs].sort().join()) bad.push(`keep the same requirements (${old.reqs.join(", ")})`);
      if (dataOnly && JSON.stringify(nw.mock?.blocks.map((b) => b.type)) !== JSON.stringify(old.mock?.blocks.map((b) => b.type))) bad.push("keep the same block types in the same order; this is a sample-content fix only");
      bad.push(...designQuality({ flow: prev.flow, noScreen: [], screens: [nw], ...(theme ? { theme } : {}) } as never, existing).map((q) => q.message));
      failures = bad;
      if (!bad.length) got = nw;
    }
    if (!got) return redraw({ mode: "redraw", why: "failed" }, t);
    screens[at] = got;
  }
  return finish({ ...prev, screens, ...(theme ? { theme } : {}) }, [...(plan.look ? ["look"] : []), ...plan.screens], plan);
}

export const designStep: StepDef = {
  key: "design", stage: "design", templateVersion: "12",
  inputs: (s, l) => {
    if (s.steps.get("specify")?.status !== "completed" || s.steps.get("intake")?.status !== "completed") return undefined;
    const ui = !!l.getJson<Intent>(s.steps.get("intake")!.outputs[0]!)?.touchesUi;
    return { spec: s.steps.get("specify")!.outputs[0], ui, inventory: s.steps.get("ground")?.data?.named, earlier: s.info.parent?.kind === "change" ? s.info.parent.designSha : undefined, frames: listedFrames(s.info.request ?? "").map((f) => f.id), rejections: designRejections(s).slice(0, MAX_DESIGN_REVISIONS) };
  },
  async run(ctx) {
    const intent = requireOutput<Intent>(ctx.state, ctx.ledger, "intake");
    // no UI: nothing to draw; E1b passes on the intent alone
    if (!intent.touchesUi) return { kind: "done", outputs: { design: ctx.ledger.putJson({ header: header(ctx.runId, "design", "design", ""), skipped: true, reason: "no UI in this request" }) }, data: { skipped: true } };
    const spec = requireOutput<Spec>(ctx.state, ctx.ledger, "specify");
    const inv = readOutput<DesignInventory>(ctx.state, ctx.ledger, "ground", "design");
    const frames = listedFrames(ctx.state.info.request ?? "");
    const p = ctx.state.info.parent;
    const earlier = p?.kind === "change" && p.designSha ? ctx.ledger.getJson<{ skipped?: boolean; flow: string; screens: unknown[] }>(p.designSha) : undefined;
    const reqText = spec.requirements.map((q) => q.ears).join("\n");
    // read the live sites of the field's top brands first (best effort), so the brief and the colour check use real colours
    if (!hasExistingLook(inv)) await ensureMeasured(pickIndustries(reqText).map((p) => p.industry.id)).catch(() => undefined);
    const refBrief = briefFor(reqText);
    const refs = fitRefs(reqText);
    const sentBack = designRejections(ctx.state).slice(0, MAX_DESIGN_REVISIONS);
    // a design that was sent back is fixed where the lead pointed, or redrawn when that is what the note needs
    const prevSha = ctx.state.steps.get("design")?.outputs[0];
    const prev = sentBack.length && prevSha ? ctx.ledger.getJson<DesignArt>(prevSha) : undefined;
    let again: { round: ReworkRound; fine: string[] } | undefined;
    if (prev && !prev.skipped && prev.screens?.length && (prev.revision ?? 0) < sentBack.length) {
      const rw = await reworkDesign(ctx, spec, prev, sentBack, inv);
      if (rw.done) {
        const d = rw.done.design;
        return { kind: "done", outputs: { design: ctx.ledger.putJson({ ...d, header: header(ctx.runId, "design", "design", "") }) }, data: { screens: d.screens.length, states: d.screens.reduce((n, x) => n + Math.max(1, (x.states ?? []).length), 0), rework: d.rework![d.rework!.length - 1]!.mode } };
      }
      again = rw.redraw;
    }
    const feedback = sentBack.length
      ? `The lead rejected the previous design ${sentBack.length === 1 ? "once" : `${sentBack.length} times`}. Their reasons, oldest first:\n${sentBack.map((x, i) => `${i + 1}. ${x}`).join("\n")}\nRedraw it so each reason is met: keep what they did not criticise, change what they did, and do not repeat the earlier screens, theme or sample data where they objected.${again?.fine.length && prev ? ` The lead said these pages are fine, so keep them as they are: ${prev.screens.filter((x) => again!.fine.includes(x.id)).map(screenName).join(", ")}.` : ""}`
      : "";
    const r = await think(ctx, {
      stage: "design", route: "design", cls: "read-large", budgetTokens: 80000, tools: [], schema: DesignOut, maxTurns: 4,
      sections: [
        S.template("tpl", RULES),
        ...(hasExistingLook(inv) ? [S.template("existing-rules", EXISTING_RULES)] : []),
        S.artifact("requirements", "spec", spec.requirements.map((q) => ({ id: q.id, ears: q.ears }))),
        ...(earlier && !earlier.skipped ? [S.artifact("approved-design", "approved-design", { flow: earlier.flow, screens: earlier.screens })] : []),
        ...(inv ? [S.artifact("existing", "existing-ui", inventoryBrief(inv))] : []),
        S.reference("design-references", `Design references (how real products in this field look):\n${refBrief}`),
        ...(feedback ? [S.reference("design-feedback", feedback)] : []),
        S.task("Draw the screen inventory."),
      ],
    });
    if (!r.ok) return r.outcome;
    const map = mapDesign(spec.requirements.map((q) => q.id), r.output, frames.map((f) => f.id));
    const bad = [
      ...map.unknown.map((x) => failure("design-unknown-req", `${x} is not a requirement in the spec`)),
      ...map.unmappedReqs.map((x) => failure("design-unmapped", `${x} is on no screen and not listed under noScreen`)),
      ...map.orphanScreens.map((x) => failure("design-orphan", `screen ${x} serves no requirement`)),
      ...map.duplicateIds.map((x) => failure("design-duplicate-id", `two screens share the id ${x}`)),
      ...map.duplicateRoutes.map((x) => failure("design-duplicate-route", `two screens share the route ${x}; one screen has one route (give states, not a second screen)`)),
      ...map.unknownFrames.map((x) => failure("design-unknown-frame", `${x} is not one of the attached frames`)),
      ...map.unusedFrames.map((x) => failure("design-frame-unused", `attached frame ${x} is on no screen`)),
      ...designQuality(r.output, hasExistingLook(inv), refs).map((q) => failure(q.check, q.message)),
    ];
    if (bad.length) return { kind: "fail", category: "other", failures: bad, signature: `design:${bad.map((f) => f.check).sort().join(",")}` };
    const artifact = {
      header: header(ctx.runId, "design", "design", "", r.model), flow: r.output.flow,
      screens: r.output.screens.map((s) => ({ id: s.id, route: s.route, file: s.file, reqs: s.reqs, states: s.states, size: s.size, frames: s.frames, ...(s.mock ? { mock: s.mock } : {}), ...(s.mockFull ? { mockFull: s.mockFull } : {}) })),
      ...(prev ? { revision: sentBack.length, rework: [...(prev.rework ?? []), ...(again ? [again.round] : [])] } : {}),
      mapping: { unmappedReqs: [], orphanScreens: [] }, noScreen: r.output.noScreen, ...(hasExistingLook(inv) ? { themeSource: "repo" as const } : { themeSource: "new" as const, ...(r.output.theme ? { theme: r.output.theme } : {}) }),
    };
    return { kind: "done", outputs: { design: ctx.ledger.putJson(artifact) }, data: { screens: artifact.screens.length, states: artifact.screens.reduce((n, s) => n + Math.max(1, s.states.length), 0) } };
  },
};
