// How much UI each approved screen asks for, counted from the approved demo (docs/estimates-design.md, "UI complexity in the
// estimate"). Code reads what the page carries (its states, blocks, overlays, toasts, links, tabs) and gives the screen a level
// with the things that drive it, in plain words. No hours: the estimator sizes from the drivers, and gate E5 keeps a complex
// screen from being sized below a simple one. The points only order screens; they are not a rate.
import type { DesignLocale, MockBlock, MockOverlay, ScreenMock } from "../contracts/index.js";
import { isRtl } from "../design/locale.js";

export type UiLevel = "simple" | "moderate" | "complex";
export interface ScreenUi {
  /** simple, moderate or complex, from the counted points; absent when the screen has no sample page to count */
  level?: UiLevel;
  points: number;
  /** what makes the screen the size it is, the heaviest first */
  drivers: string[];
}

/** points at which a screen is moderate, then complex */
export const UI_LEVELS = { moderate: 8, complex: 16 } as const;

// the field kinds that are more than a text box: each needs its own control, formatting or validation
const RICH_FIELDS: Record<string, string> = { otp: "one-time code", card: "card number", phone: "phone with country code", search: "search-as-you-type", slider: "slider", currency: "currency amount", checkbox: "multi-choice", date: "date picker",
  password: "password with show/hide", time: "time picker", daterange: "date range picker", multiselect: "multi-select with chips", combobox: "searchable dropdown" };
// a button with more than one label: a split button opens a menu of its other choices
const splits = (bs: unknown[] | undefined): number => (bs ?? []).filter((x) => typeof x === "object" && !!(x as { menu?: unknown[] }).menu?.length).length;
// domain components: the parts a field is known for, each a small app of its own
const COMPONENTS: Record<string, [number, string]> = {
  map: [5, "map with pins"], chat: [5, "live chat"], kanban: [5, "drag-and-drop board"], calendar: [4, "calendar with bookable times"],
  upload: [4, "file upload with progress and retry"], results: [4, "search results with filters"], compare: [3, "side-by-side comparison"],
  plans: [3, "pricing plans with a period switch"], gallery: [3, "picture gallery"], notifications: [3, "notification centre"],
  reviews: [2, "ratings and reviews"], receipt: [2, "receipt or invoice"],
};

type Part = [number, string];

function blockParts(b: MockBlock): Part[] {
  switch (b.type) {
    case "table": {
      const extra = [b.sortBy !== undefined ? "sorting" : "", b.selectable ? "row selection" : "", b.bulk?.length ? "bulk actions" : "", (b.pages ?? 1) > 1 ? "paging" : ""].filter(Boolean);
      return [[2 + extra.length, `table${extra.length ? ` with ${and(extra)}` : ""}`]];
    }
    case "form": {
      const rich = [...new Set(b.fields.map((f) => RICH_FIELDS[f.kind]).filter((x): x is string => !!x))];
      // fields that are required, or show an error, need their rules written and their messages drawn
      if (b.fields.some((f) => f.required || f.error)) rich.push("field validation");
      return [[1 + Math.ceil(b.fields.length / 2) + rich.length, `form of ${b.fields.length} field${b.fields.length > 1 ? "s" : ""}${rich.length ? ` (${rich.join(", ")})` : ""}`]];
    }
    case "chart": return [[2, `${b.kind} chart`]];
    case "filters": return [[b.segments ? 2 : 1, b.segments ? "filters with a segmented switch" : "search and filters"]];
    case "carousel": return [[2, "carousel"]];
    case "map": return [[COMPONENTS.map![0] + (b.route ? 2 : 0), b.route ? "map with a route and stops" : COMPONENTS.map![1]]];
    case "cards": case "list": case "detail": {
      const ppl = b.type === "detail" ? !!b.people?.length : b.items.some((it) => "people" in it && !!(it as { people?: string[] }).people?.length);
      return [[ppl ? 2 : 1, ppl ? "avatar groups" : ""]];
    }
    case "stats": case "steps": case "timeline": case "accordion": return [[1, ""]];
    case "actions": { const n = splits(b.buttons); return n ? [[n, `${plural(n, "split button")}`]] : []; }
    case "text": return [];
    case "alert": return [[1, "inline alert"]];
    case "progress": return [[1, "progress bars"]];
    case "toolbar": {
      const extra = [b.selects.length ? `${plural(b.selects.length, "dropdown")}` : "", splits(b.buttons) ? "a split button" : ""].filter(Boolean);
      return [[1 + b.selects.length + splits(b.buttons), `toolbar${extra.length ? ` with ${and(extra)}` : ""}`]];
    }
    default: { const c = COMPONENTS[b.type]; return c ? [c] : [[1, ""]]; }
  }
}

function overlayParts(o: MockOverlay): Part {
  const form = (o.blocks ?? []).some((b) => b.type === "form"), split = splits(o.actions);
  return [(form ? 3 : 2) + split, `${o.kind}${form ? " with a form" : ""}${split ? " and a split button" : ""}`];
}

const and = (xs: string[]): string => xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The screen's UI, counted from its sample page and listed states. A screen with no sample page has no level. */
export function screenUi(s: { states?: string[]; size?: string; mock?: ScreenMock }): ScreenUi {
  const m = s.mock, states = (s.states ?? []).filter((x) => !/^(default|normal)$/i.test(x.trim()));
  const parts: Part[] = [];
  if (states.length) parts.push([states.length, `${plural(states.length, "state")} (${states.join(", ")})`]);
  if (m) {
    for (const b of m.blocks) parts.push(...blockParts(b));
    const ov = (m.overlays ?? []).map(overlayParts);
    if (ov.length) parts.push([ov.reduce((a, x) => a + x[0], 0), `${plural(ov.length, "overlay")} (${ov.map((x) => x[1]).join(", ")})`]);
    if (m.toasts?.length) parts.push([m.toasts.length, plural(m.toasts.length, "toast")]);
    if (m.tabs?.length) parts.push([2, `${m.tabs.length} in-page tabs`]);
    if (m.links?.length) parts.push([Math.ceil(m.links.length / 2), `links to ${plural(new Set(m.links.map((l) => l.to)).size, "page")}`]);
  }
  const points = parts.reduce((a, x) => a + x[0], 0);
  const drivers = parts.filter((x) => x[1]).sort((a, b) => b[0] - a[0]).map((x) => x[1]);
  const plain = m ? m.blocks.filter((b) => blockParts(b).some((x) => x[0] && !x[1])).length : 0;
  if (plain) drivers.push(`${plural(plain, "simple block")}`);
  if (s.size && s.size !== "new") drivers.unshift(s.size === "reuse" ? "reuses an existing page" : s.size === "tweak" ? "a change to an existing page" : "built from the design system");
  if (!m) return { points, drivers: [...drivers, "no sample page: sized from its requirements"] };
  return { level: points >= UI_LEVELS.complex ? "complex" : points >= UI_LEVELS.moderate ? "moderate" : "simple", points, drivers };
}

/** What adds UI work to every screen of the product: more than one app, two languages, right to left, both colour modes. */
export function uiFactors(d: { apps?: { name: string; device: string }[]; locale?: DesignLocale; theme?: { mode?: string }; themeSource?: string; restyle?: boolean }): string[] {
  const out: string[] = [];
  if ((d.apps?.length ?? 0) > 1) out.push(`${d.apps!.length} apps (${d.apps!.map((a) => `${a.name}, ${a.device === "phone" ? "phone" : "web"}`).join("; ")}), each with its own frame and navigation`);
  const langs = d.locale?.languages ?? [];
  if (langs.length > 1) out.push(`two languages (${langs.join(" and ")}): every page's words translated and switchable`);
  if (langs.some(isRtl)) out.push("right to left: every page mirrored");
  if (d.locale?.digits === "native") out.push("the script's own digits in every number");
  if (d.theme?.mode === "auto") out.push("both colour modes: every page in light and dark, with a switch");
  if (d.themeSource === "repo") out.push("the existing app's look and components are reused");
  if (d.restyle) out.push("the existing app is restyled to the client's reference: every existing page's look changes (a design-system change)");
  return out;
}

/** Each screen's UI and the product-wide factors, for the breakdown and the estimate. */
export function designUi(d: { skipped?: boolean; screens: { id: string; states?: string[]; size?: string; mock?: ScreenMock }[] } & Parameters<typeof uiFactors>[0]): { screens: Record<string, ScreenUi>; factors: string[] } | undefined {
  if (d.skipped || !d.screens.length) return undefined;
  return { screens: Object.fromEntries(d.screens.map((s) => [s.id, screenUi(s)])), factors: uiFactors(d) };
}
