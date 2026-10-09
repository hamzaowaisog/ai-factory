// What a Stitch screen shows, read from its HTML: the title, buttons, fields, table columns and headings. A Stitch screen has
// no design JSON, so the test writer, the coding brief and the fidelity check take these words as the approved page's.
// Only the page's own words count: the app's navigation, header and footer are the frame's (the kit draws them), and sample data
// (times, counts, dates) and long card text change with the data, so neither is something a built page must repeat word for word.
import { load } from "cheerio";

export interface StitchFacts { title?: string; buttons: string[]; fields: string[]; columns: string[]; headings: string[] }

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
  return {
    ...(title ? { title } : {}),
    buttons: list("button, [role=button], input[type=submit], input[type=button]", (el) => text(el) || ($(el).attr("value") ?? "").trim()),
    fields: list("label"),
    columns: list("th"),
    headings: list("h1, h2, h3"),
  };
}
