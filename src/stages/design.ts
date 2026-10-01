// Estimate mode's design step (docs/estimates-design.md, "Design baseline"). For a request with UI it
// proposes the screen inventory the estimate stands on: a flow, every screen with its route and the
// requirements it serves, and a reason for each requirement that needs no screen. Code checks the links
// both ways. It is an inventory of screens with sample content, not a finished design: a person approves it at E1b, and it
// becomes the count of screens, flows and reused components for the UI work.
import { z } from "zod";
import type { IntentBody, Spec } from "../contracts/index.js";
import type { DesignInventory } from "../design/inventory.js";
import { DesignTheme, ScreenMock } from "../contracts/artifacts.js";
import { failure } from "../gates/engine.js";
import { header, readOutput, requireOutput, type StepDef } from "./framework.js";
import { briefFor } from "../design/refs/index.js";
import { S, think, UNTRUSTED_NOTE } from "./think.js";

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
  })).min(1),
  /** the look of the product: chosen from what the requirements say it is and who uses it */
  theme: DesignTheme.optional(),
  /** requirements that need no screen (an API rule, a job) and why */
  noScreen: z.array(z.object({ req: z.string(), reason: z.string().min(1) })).default([]),
});

const RULES = `You are drawing the screen inventory of a UI request, for an estimate. The approved inventory is what the estimate counts.
- List every screen a user sees: id S-1, S-2, ..., its route, a proposed file path, the requirement ids it serves in "reqs", its states (empty, loading, error, success, validation) and its size:
  new (a screen that does not exist), tweak (a change to an existing screen), design-system (a new shared component or theme change), reuse (built only from existing components).
- Every requirement that has anything a user sees or does goes on at least one screen. A requirement with no screen at all (an API rule, a scheduled job) goes in "noScreen" with the reason. Nothing may be left out.
- "flow": two or three sentences on how a user moves between the screens.
- Use only requirement ids that exist. Do not invent screens the requirements do not need.
- ART DIRECTION. Work out what the product is and who uses it from the requirements alone, then return "theme": the look a real team in that field would ship. The goal is a believable product, not a showcase: restrained, legible, specific to its domain, and never a generic template.
  How real products are coloured: a mostly neutral page (white or near-white, or a deliberate dark), near-black text, ONE brand colour used for the app bar, the primary action and selection, and status colours only where they carry meaning (green done, red wrong, amber attention). Colour is information, not decoration. The "design-references" section shows how real products in this field (or, when the field is not listed, in the nearest kind of product) are coloured: stay in that family, borrow what they share, and do not copy one brand.
  Avoid what makes a design look machine-made: purple-to-blue gradients, neon glows on dark, glass panels everywhere, several accent colours, rainbow icons, one huge radius on everything, and centred "three cards" layouts.
  mood: two or three words for the feeling (for example "calm clinical", "precise financial", "warm retail"). Invent the one that fits.
  mode: "light" for most products, "dark" only when the audience works in it for hours (developer, trading, media, creative tools), "auto" to follow the viewer.
  brand: the one brand colour (#rrggbb), as a real brand in that field would choose it. accent: optional second colour for a sparing highlight, only when the domain has one (for example a gold on navy); leave it out otherwise.
  neutral: "cool" (technical, finance, health), "warm" (food, hospitality, craft, education) or "pure" (editorial, minimal).
  chrome: "brand" fills the app bar with the brand colour (airlines, retail, telecom, many consumer apps); "plain" keeps it white or dark (SaaS, back-office, finance, health).
  font: "sans" (default), "humanist" (friendly, health, education), "serif" (editorial, legal, luxury, heritage headings) or "rounded" (playful consumer).
  radius: "sharp" (enterprise, data-dense, government), "soft" (most products) or "round" (friendly consumer).
  density: "compact" for tools used all day, "comfortable" otherwise.
  surface: "flat" (hairline borders, no shadow: the default), "soft" (light shadow, consumer) or "glass" (translucent; only for media or creative tools).
  motion: "calm" (serious, high-stakes) or "lively" (consumer, showcase). The page animates entrances, charts, numbers and skeletons either way; calm only quiets it.
- MOCK CONTENT. For every screen also give "mock": what the page shows, as a picture to react to, not a spec.
  Take every noun from the requirements' own domain: its entities, roles, statuses, units, currencies, places, names and formats. Make the sample data believable and varied (different lengths, several statuses, plausible dates and amounts that agree with each other). Never "Lorem ipsum", "Item 1", "Column A", "Test User" or "Sample".
  "title" and "subtitle" of the page; "blocks" in page order (2 to 5), each one of: stats (label, value, delta), filters (search placeholder, chips), table (columns, 4 to 6 rows of cells, statusColumn = index of the status column), form (fields with label, kind text/select/date/textarea/toggle, placeholder or value, options; the submit label), chart (bar or line, title, 5 to 8 labelled points), cards (title, meta, badge; visual true for things people choose by picture, like products, places, listings), list (title, meta), steps (a progress or checkout path, current index), timeline (time, title, status done/now/next: tracking, history, itinerary), detail (a record's labelled facts; style "pass" for a ticket, booking or boarding pass, with a lead value like the route or amount), actions (button labels), text (body).
  Choose the block each requirement's wording asks for: something to browse or compare is a table or cards, a figure the user watches is stats, a trend is a chart, narrowing or finding is filters, something the user enters is a form, something the user triggers is actions. Keep cells and labels short.
  "copy" holds the words for the states the screen has, in the product's own voice: emptyTitle and emptyHint (when it can be empty), error, success, validation (one plain sentence each).
- If design frames are listed in the request (F-1, F-2, ...), each image frame is one screen or one state of a screen: put its id in that screen's "frames". Do not leave an image frame unused and do not cite a frame that is not listed.
- If an approved earlier design is given, this is a change to it: keep the id, route and file of every screen that does not change, give new screens the next free ids, and drop a screen only when the new requirements remove it.
- If an existing-system summary is given, mark a screen "reuse" or "tweak" only when an existing page or shared component really covers it.
${UNTRUSTED_NOTE}`;

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

const inventoryBrief = (inv: DesignInventory) => ({
  framework: inv.stack.framework, styling: inv.stack.styling, componentSystem: inv.stack.componentSystem,
  pages: inv.pages.slice(0, 40), sharedComponents: [...inv.primitives, ...inv.composites].slice(0, 40).map((c) => (c as { name?: string }).name ?? c),
});

export const designStep: StepDef = {
  key: "design", stage: "design", templateVersion: "6",
  inputs: (s, l) => {
    if (s.steps.get("specify")?.status !== "completed" || s.steps.get("intake")?.status !== "completed") return undefined;
    const ui = !!l.getJson<Intent>(s.steps.get("intake")!.outputs[0]!)?.touchesUi;
    return { spec: s.steps.get("specify")!.outputs[0], ui, inventory: s.steps.get("ground")?.data?.named, earlier: s.info.parent?.kind === "change" ? s.info.parent.designSha : undefined, frames: listedFrames(s.info.request ?? "").map((f) => f.id) };
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
    const refBrief = briefFor(spec.requirements.map((q) => q.ears).join("\n"));
    const r = await think(ctx, {
      stage: "design", route: "design", cls: "read-large", budgetTokens: 45000, tools: [], schema: DesignOut, maxTurns: 4,
      sections: [
        S.template("tpl", RULES),
        S.artifact("requirements", "spec", spec.requirements.map((q) => ({ id: q.id, ears: q.ears }))),
        ...(earlier && !earlier.skipped ? [S.artifact("approved-design", "approved-design", { flow: earlier.flow, screens: earlier.screens })] : []),
        ...(inv ? [S.artifact("existing", "existing-ui", inventoryBrief(inv))] : []),
        S.reference("design-references", `Design references (how real products in this field look):\n${refBrief}`),
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
    ];
    if (bad.length) return { kind: "fail", category: "other", failures: bad, signature: `design:${bad.map((f) => f.check).sort().join(",")}` };
    const artifact = {
      header: header(ctx.runId, "design", "design", "", r.model), flow: r.output.flow,
      screens: r.output.screens.map((s) => ({ id: s.id, route: s.route, file: s.file, reqs: s.reqs, states: s.states, size: s.size, frames: s.frames, ...(s.mock ? { mock: s.mock } : {}) })),
      mapping: { unmappedReqs: [], orphanScreens: [] }, noScreen: r.output.noScreen, ...(r.output.theme ? { theme: r.output.theme } : {}),
    };
    return { kind: "done", outputs: { design: ctx.ledger.putJson(artifact) }, data: { screens: artifact.screens.length, states: artifact.screens.reduce((n, s) => n + Math.max(1, s.states.length), 0) } };
  },
};
