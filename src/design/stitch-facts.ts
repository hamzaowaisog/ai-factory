// What a Stitch screen shows, read from its HTML: the title, buttons, fields, table columns and headings. A Stitch screen has
// no design JSON, so the test writer, the coding brief and the fidelity check take these words as the approved page's.
// Only the page's own words count: the app's navigation, header and footer are the frame's (the kit draws them), and sample data
// (times, counts, dates) and long card text change with the data, so neither is something a built page must repeat word for word.
import { load } from "cheerio";

export interface StitchFacts {
  title?: string; buttons: string[]; fields: string[]; columns: string[]; headings: string[];
  /** the page's UI parts as the estimate counts them ([points, what], the same weights as the design JSON's blocks) */
  ui?: [number, string][];
}

const MAX = 20;
// icon fonts write the icon's name as text ("add", "search"): not words a person reads
const NOT_WORDS = "script, style, noscript, template, .material-symbols-outlined, .material-symbols-rounded, .material-symbols-sharp, .material-icons";
// the app's frame around the page
const FRAME = "nav, aside, header, footer, [role=navigation], [role=banner], [role=contentinfo]";
/** A word the page shows whatever its data is: no digits (times, counts, dates, amounts) and short enough to be a label. */
const steady = (w: string) => !/\d/.test(w) && w.length <= 40;

export function stitchFacts(html: string): StitchFacts {
  const $ = load(html);
  $(NOT_WORDS).remove();
  const text = (el: Parameters<typeof $>[0]) => $(el).text().replace(/\s+/g, " ").trim();
  // the page's title: its main content's first heading, before the frame is set aside (a sidebar often holds the brand's h1)
  const title = text($("main h1").first()) || text($("h1").not($(FRAME).find("h1")).first()) || text($("main h2").first()) || text($("h2").first());
  $(FRAME).remove();
  const list = (sel: string, read: (el: Parameters<typeof $>[0]) => string = text) =>
    [...new Set($(sel).toArray().map(read).filter((x) => x !== "" && steady(x)))].slice(0, MAX);
  const ui = uiParts($);
  return {
    ...(title ? { title } : {}),
    // always counted, even to nothing: a Stitch page with no parts is a simple page, not an unsized one
    ui,
    buttons: list("button, [role=button], input[type=submit], input[type=button]", (el) => text(el) || ($(el).attr("value") ?? "").trim()),
    fields: list("label"),
    columns: list("th"),
    headings: list("h1, h2, h3"),
  };
}

type Doc = ReturnType<typeof load>;
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

/**
 * What the page's own HTML holds, in the estimate's points (src/estimate/ui-complexity.ts): its form fields (and the rich kinds
 * among them), tables, charts, dialogs, tab sets and file uploads. The frame (navigation, header, footer) is already set aside.
 */
function uiParts($: Doc): [number, string][] {
  const parts: [number, string][] = [];
  type El = Parameters<Doc>[0];
  const attr = (el: El, a: string) => ($(el).attr(a) ?? "").toLowerCase();
  const inTable = (el: El) => $(el).closest("table, [role=grid]").length > 0;
  // what a person fills in: not hidden inputs, buttons or the file input (the upload is counted on its own)
  const inputs = $("input, select, textarea").filter((_, el) => !/^(hidden|submit|button|reset|image|file)$/.test(attr(el, "type")) && $(el).attr("hidden") === undefined && attr(el, "aria-hidden") !== "true");
  const choice = (el: El) => /^(checkbox|radio)$/.test(attr(el, "type"));
  // a box that searches the page's data, as the design JSON's filters block, not a form
  const search = (el: El) => attr(el, "type") === "search" || (!choice(el) && /search/.test(`${attr(el, "placeholder")} ${attr(el, "aria-label")} ${attr(el, "name")} ${attr(el, "id")}`));
  const fields: El[] = [], groups = new Map<unknown, El>();
  let searches = 0;
  inputs.each((_, el) => {
    if (inTable(el)) return; // a table's checkboxes are its row selection
    if (search(el)) { searches++; return; }
    if (!choice(el)) { fields.push(el); return; }
    // a set of checkboxes or radios is one field, as the design JSON's checkbox field is
    const key = $(el).attr("name") ? `name:${$(el).attr("name")}` : ($(el).closest("fieldset, [role=group], [role=radiogroup]").get(0) ?? $(el).parent().parent().get(0));
    if (!groups.has(key)) { groups.set(key, el); fields.push(el); }
  });
  if (fields.length) {
    const kinds = new Set<string>();
    for (const el of fields) {
      const t = attr(el, "type"), tag = (el as { tagName?: string }).tagName?.toLowerCase();
      if (tag === "select") kinds.add("dropdown");
      else if (t === "date" || t === "datetime-local" || t === "time") kinds.add("date or time picker");
      else if (t === "tel") kinds.add("phone");
      else if (t === "password") kinds.add("password");
      else if (t === "checkbox") kinds.add("multi-choice");
    }
    const required = fields.some((el) => $(el).attr("required") !== undefined) || $("label").toArray().some((el) => /\*\s*$/.test($(el).text().trim()));
    const rich = [...kinds, ...(required ? ["field validation"] : [])];
    parts.push([1 + Math.ceil(fields.length / 2) + rich.length, `form of ${fields.length} field${fields.length === 1 ? "" : "s"}${rich.length ? ` (${rich.join(", ")})` : ""}`]);
  }
  if (searches) parts.push([1, "search and filters"]);
  if ($("input[type=file]").length) parts.push([4, "file upload with progress and retry"]);
  const tables = $("table, [role=grid]").filter((_, el) => $(el).parents("table, [role=grid]").length === 0).toArray();
  if (tables.length) {
    const selecting = tables.filter((el) => $(el).find("input[type=checkbox]").length > 0).length;
    parts.push([2 * tables.length + selecting, `${plural(tables.length, "table")}${selecting ? " with row selection" : ""}`]);
  }
  // a chart is its outermost chart element (its header, body and bars are the same chart), or a canvas, or a drawing bigger than an icon
  const chartClass = (el: El) => /(^|\s)[\w-]*chart[\w-]*(\s|$)/i.test($(el).attr("class") ?? "");
  const charted = $("[class*=chart]").filter((_, el) => chartClass(el) && !$(el).parents().toArray().some(chartClass)).toArray();
  const inChart = (el: El) => $(el).parents().toArray().some((p) => charted.includes(p as never));
  const iconSized = (el: El) => {
    const w = Number(($(el).attr("viewBox") ?? $(el).attr("viewbox") ?? "").trim().split(/[\s,]+/)[2] ?? $(el).attr("width") ?? NaN);
    return Number.isFinite(w) && w <= 48;
  };
  const drawings = $("canvas").filter((_, el) => !inChart(el)).length
    + $("svg").filter((_, el) => !inChart(el) && !iconSized(el) && $(el).find("rect, path, circle, line, polyline").length >= 5).length;
  const charts = Math.min(3, charted.length + drawings);
  if (charts) parts.push([2 * charts, plural(charts, "chart")]);
  const dialogs = $("dialog, [role=dialog]").toArray();
  if (dialogs.length) parts.push([dialogs.reduce((n, el) => n + ($(el).find("input, select, textarea").length ? 3 : 2), 0), plural(dialogs.length, "dialog")]);
  if ($("[role=tablist]").length) parts.push([2, "in-page tabs"]);
  return parts;
}
