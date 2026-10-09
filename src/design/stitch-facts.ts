// What a Stitch screen shows, read from its HTML: the title, buttons, fields, table columns and headings. A Stitch screen has
// no design JSON, so the test writer, the coding brief and the fidelity check take these words as the approved page's.
import { load } from "cheerio";

export interface StitchFacts { title?: string; buttons: string[]; fields: string[]; columns: string[]; headings: string[] }

const MAX = 20;
// icon fonts write the icon's name as text ("add", "search"): not words a person reads
const NOT_WORDS = "script, style, noscript, template, .material-symbols-outlined, .material-symbols-rounded, .material-symbols-sharp, .material-icons";

export function stitchFacts(html: string): StitchFacts {
  const $ = load(html);
  $(NOT_WORDS).remove();
  const text = (el: Parameters<typeof $>[0]) => $(el).text().replace(/\s+/g, " ").trim();
  const list = (sel: string, read: (el: Parameters<typeof $>[0]) => string = text) =>
    [...new Set($(sel).toArray().map(read).filter((x) => x !== ""))].slice(0, MAX);
  const headings = list("h1, h2, h3");
  const title = text($("h1").first()) || text($("h2").first());
  return {
    ...(title ? { title } : {}),
    buttons: list("button, [role=button], input[type=submit], input[type=button]", (el) => text(el) || ($(el).attr("value") ?? "").trim()),
    fields: list("label"),
    columns: list("th"),
    headings,
  };
}
