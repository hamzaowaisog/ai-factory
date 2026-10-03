// What the fidelity checks read inside a page (docs/estimates-design.md, "Fidelity and tests"): the marked blocks with their
// words and boxes, every computed colour, font, corner and shadow, and where the keyboard focus goes. Each function runs in the
// browser, so it is plain and self-contained (it is serialised and sent to the page).

/** `words`: what the block shows and names (its text, and its controls' labels, placeholders and titles) */
export interface ReadBlock { type: string; words: string; box: { x: number; y: number; w: number; h: number }; /** inside another marked block (a form in a layer, the demo's toolbar in its table) */ nested?: boolean }
export interface ReadStyle { prop: "colour" | "font" | "radius" | "shadow"; value: string; where: string; count: number; rgb?: [number, number, number, number]; size?: number }
/** `keyboard`: the browser shows it as keyboard focus (:focus-visible); focus a script moved (a closed toast handing it back) is not judged */
export interface ReadFocus { where: string; visible: boolean; hidden: boolean; keyboard: boolean }

/** The visible blocks marked `data-b` under `root` (a selector; the whole page when empty), in page order, with their words and boxes. */
export function readBlocks(root: string): ReadBlock[] {
  const top = root ? document.querySelector(root) : document.body;
  if (!top) return [];
  const shown = (e: Element): boolean => {
    const r = e.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    for (let x: Element | null = e; x && x !== document.body; x = x.parentElement) {
      const c = getComputedStyle(x);
      if (c.display === "none" || c.visibility === "hidden") return false;
    }
    return true;
  };
  const clean = (s: string | null | undefined): string => (s ?? "").replace(/\s+/g, " ").trim();
  const sx = top === document.body ? 0 : top.getBoundingClientRect().x, sy = top === document.body ? 0 : top.getBoundingClientRect().y;
  const out: ReadBlock[] = [];
  for (const b of top.querySelectorAll("[data-b]")) {
    if (!shown(b)) continue;
    const words = [clean((b as HTMLElement).innerText)];
    for (const e of [b, ...b.querySelectorAll("[aria-label],[placeholder],[title],[alt],input[value]")]) {
      for (const a of ["aria-label", "placeholder", "title", "alt", "value"]) { const v = clean(e.getAttribute(a)); if (v) words.push(v); }
    }
    const r = b.getBoundingClientRect();
    out.push({ type: b.getAttribute("data-b")!, words: words.join(" ").slice(0, 4000), ...(b.parentElement?.closest("[data-b]") ? { nested: true } : {}), box: { x: Math.round(r.x - sx), y: Math.round(r.y - sy + scrollY), w: Math.round(r.width), h: Math.round(r.height) } });
  }
  return out;
}

/**
 * Every colour, first font, corner and shadow drawn on the visible page, once per value, with where it was first seen. Colours
 * come back as sRGB bytes (drawn on a canvas, so oklch, color-mix and named colours read the same), corners in pixels with the
 * element's short side (a circle or a pill is half of it).
 */
export function readStyles(): ReadStyle[] {
  const cv = document.createElement("canvas");
  cv.width = cv.height = 1;
  const g = cv.getContext("2d", { willReadFrequently: true })!;
  const rgb = (v: string): [number, number, number, number] | undefined => {
    g.clearRect(0, 0, 1, 1);
    g.fillStyle = "#000";
    g.fillStyle = v;
    g.fillRect(0, 0, 1, 1);
    const d = g.getImageData(0, 0, 1, 1).data;
    return [d[0]!, d[1]!, d[2]!, d[3]! / 255];
  };
  const name = (e: Element): string => {
    const id = e.id ? `#${e.id}` : "";
    const b = e.closest("[data-b]")?.getAttribute("data-b");
    const t = ((e as HTMLElement).innerText ?? "").replace(/\s+/g, " ").trim().slice(0, 30);
    return `${e.tagName.toLowerCase()}${id}${b ? ` in ${b}` : ""}${t ? ` "${t}"` : ""}`;
  };
  const seen = new Map<string, ReadStyle>();
  const add = (prop: ReadStyle["prop"], value: string, e: Element, extra: Partial<ReadStyle> = {}) => {
    const k = `${prop}|${value}`;
    const s = seen.get(k);
    if (s) s.count++;
    else seen.set(k, { prop, value, where: name(e), count: 1, ...extra });
  };
  const ownText = (e: Element) => [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent!.trim());
  for (const e of document.body.querySelectorAll("*")) {
    if (e.closest("svg") && e.tagName.toLowerCase() !== "svg") continue;
    const r = e.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    const c = getComputedStyle(e);
    if (c.display === "none" || c.visibility === "hidden" || Number(c.opacity) === 0) continue;
    const colour = (v: string) => { const x = rgb(v); if (x && x[3] >= 0.15) add("colour", v, e, { rgb: x }); };
    if (ownText(e)) { colour(c.color); add("font", c.fontFamily.split(",")[0]!.trim().replace(/^["']|["']$/g, ""), e); }
    colour(c.backgroundColor);
    for (const side of ["Top", "Right", "Bottom", "Left"] as const) {
      if (parseFloat(c[`border${side}Width`]) > 0 && c[`border${side}Style`] !== "none") colour(c[`border${side}Color`]);
    }
    for (const corner of [c.borderTopLeftRadius, c.borderTopRightRadius, c.borderBottomRightRadius, c.borderBottomLeftRadius]) {
      const px = corner.endsWith("%") ? (parseFloat(corner) / 100) * Math.min(r.width, r.height) : parseFloat(corner);
      if (px > 0) add("radius", `${Math.round(px * 10) / 10}px`, e, { size: Math.min(r.width, r.height) });
    }
    if (c.boxShadow && c.boxShadow !== "none") add("shadow", c.boxShadow, e);
  }
  for (const s of seen.values()) if (s.prop === "shadow") {
    // each layer's colour as bytes too, for the ring check
    s.value = s.value.replace(/(rgba?\([^)]*\)|oklch\([^)]*\)|oklab\([^)]*\)|color\([^)]*\)|#[0-9a-f]{3,8})/gi, (m) => { const x = rgb(m); return x ? `rgba(${x[0]}, ${x[1]}, ${x[2]}, ${Math.round(x[3] * 100) / 100})` : m; });
  }
  return [...seen.values()];
}

/** Colours as sRGB bytes, read the same way as readStyles does. */
export function readColours(list: string[]): ([number, number, number, number] | null)[] {
  const cv = document.createElement("canvas");
  cv.width = cv.height = 1;
  const g = cv.getContext("2d", { willReadFrequently: true })!;
  return list.map((v) => {
    g.clearRect(0, 0, 1, 1);
    g.fillStyle = "#000";
    g.fillStyle = v;
    if (!v || (g.fillStyle === "#000000" && !/^(#000|#000000|black|rgb\(0,\s*0,\s*0\))$/i.test(v.trim()))) return null;
    g.fillRect(0, 0, 1, 1);
    const d = g.getImageData(0, 0, 1, 1).data;
    return [d[0]!, d[1]!, d[2]!, d[3]! / 255];
  });
}

/** Where the focus is now: the element, whether it shows a ring, outline or other visible change, and whether it is hidden. */
export function readFocus(): ReadFocus | null {
  const e = document.activeElement as HTMLElement | null;
  if (!e || e === document.body || e === document.documentElement) return null;
  const r = e.getBoundingClientRect();
  let hidden = r.width < 1 || r.height < 1;
  for (let x: Element | null = e; x && !hidden; x = x.parentElement) {
    const c = getComputedStyle(x);
    if (c.display === "none" || c.visibility === "hidden" || Number(c.opacity) === 0) hidden = true;
  }
  const c = getComputedStyle(e);
  // an outline, or a shadow layer with any size (a ring); a one-time-code input is see-through and its box draws the ring
  const ring = (c.outlineStyle !== "none" && parseFloat(c.outlineWidth) > 0) || /(\d+(\.\d+)?px)/.test(c.boxShadow.replace(/0px/g, "")) || e.hasAttribute("data-input-otp");
  const t = (e.innerText || e.getAttribute("aria-label") || e.getAttribute("placeholder") || "").replace(/\s+/g, " ").trim().slice(0, 30);
  const b = e.closest("[data-b]")?.getAttribute("data-b");
  return { where: `${e.tagName.toLowerCase()}${b ? ` in ${b}` : ""}${t ? ` "${t}"` : ""}`, visible: ring, hidden, keyboard: e.matches(":focus-visible") };
}

/**
 * One of these functions as a script for `page.evaluate`, called with `arg`. Sent as text with a stand-in for the name helper a
 * TypeScript runner (tsx, esbuild with keepNames) wraps local functions in, so it runs the same from the source and the build.
 */
export const inPage = <A, R>(fn: (a: A) => R, arg?: A): string =>
  `(() => { const __name = (f) => f; return (${fn.toString()})(${JSON.stringify(arg ?? null)}); })()`;
