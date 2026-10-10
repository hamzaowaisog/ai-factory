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
  const fields = $("input, select, textarea").filter((_, el) => !/^(hidden|submit|button|reset|image|search)$/i.test($(el).attr("type") ?? ""));
  if (fields.length) {
    const kinds = new Set<string>();
    fields.each((_, el) => {
      const t = ($(el).attr("type") ?? "").toLowerCase(), tag = (el as { tagName?: string }).tagName?.toLowerCase();
      if (tag === "select") kinds.add("dropdown");
      else if (t === "date" || t === "datetime-local" || t === "time") kinds.add("date or time picker");
      else if (t === "tel") kinds.add("phone");
      else if (t === "password") kinds.add("password");
    });
    const required = fields.filter((_, el) => $(el).attr("required") !== undefined).length > 0 || $("label").toArray().some((el) => /\*\s*$/.test($(el).text().trim()));
    const rich = [...kinds, ...(required ? ["field validation"] : [])];
    parts.push([1 + Math.ceil(fields.length / 2) + rich.length, `form of ${fields.length} field${fields.length === 1 ? "" : "s"}${rich.length ? ` (${rich.join(", ")})` : ""}`]);
  }
  const uploads = $("input[type=file]").length;
  if (uploads) parts.push([4, "file upload with progress and retry"]);
  const tables = $("table").length;
  if (tables) parts.push([2 * tables, plural(tables, "table")]);
  const charts = Math.min(3, $("canvas").length + $("svg").filter((_, el) => $(el).find("rect, path, circle").length >= 5).length + $("[class*=chart]").not("svg, canvas").length);
  if (charts) parts.push([2 * charts, plural(charts, "chart")]);
  const dialogs = $("dialog, [role=dialog]").toArray();
  if (dialogs.length) parts.push([dialogs.reduce((n, el) => n + ($(el).find("input, select, textarea").length ? 3 : 2), 0), plural(dialogs.length, "dialog")]);
  if ($("[role=tablist]").length) parts.push([2, "in-page tabs"]);
  return parts;
}
