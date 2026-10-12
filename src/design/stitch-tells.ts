// What gives a Stitch page away as generated, or leaves it still, read from its HTML alone (no browser, no call): the tells the
// stitch-design-taste skill's audit names that can be seen in markup. The design step gives a page with one a single Stitch fix.
import { load } from "cheerio";

/** One tell: what Stitch is asked to change. A `soft` one is fixed along with another, never paid for alone. */
export interface StitchTell { id: string; fix: string; soft?: boolean }

const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;

export function stitchTells(html: string): StitchTell[] {
  const $ = load(html);
  $("script, style").remove();
  // the words a person reads, each element's apart from the next one's
  const text = ($("body").html() ?? "").replace(/<[^>]+>/g, " ");
  const tells: StitchTell[] = [];
  if (!/@keyframes/.test(html) || count(html, /\btransition\b/g) < 3) tells.push({ id: "static", fix: "add the design system's motion: its tokens and keyframes in a <style> block (CSS only, no JavaScript), the entrance sequence on load, and a hover, focus and pressed state on every control" });
  if (/\banimate-(bounce|ping)\b/.test(html)) tells.push({ id: "bounce", fix: "remove the bouncing and pinging animations" });
  if (/\bblur-(2xl|3xl)\b/.test(html)) tells.push({ id: "blob", fix: "remove the blurred colour blobs behind the content" });
  if (/lorem ipsum|\bjohn doe\b|\bjane doe\b|\bacme\b/i.test(text)) tells.push({ id: "placeholder", fix: "replace the placeholder copy and names with real ones from this product's domain" });
  if (/\b(seamless(ly)?|elevate|unleash|supercharge|next-gen|revolutioni[sz]e)\b/i.test(text)) tells.push({ id: "cliche", fix: "reword the marketing clichés (seamless, elevate, unleash, next-gen) as plain statements of what the page does" });
  if (/[\u{1F300}-\u{1FAFF}]/u.test(text)) tells.push({ id: "emoji", fix: "remove the emojis" });
  if (!/prefers-reduced-motion|motion-reduce:/.test(html)) tells.push({ id: "reduced-motion", fix: "add a prefers-reduced-motion rule that turns the animations off", soft: true });
  return tells;
}
