// The design drawn from the references the user attached (docs/estimates-design.md, "Design references",
// step 6): the brief and rules the design step gets with references, and the checks code runs on the
// drawn theme. Pure code, no model.
//  - match: the references' values exactly (brand and accent near a reference colour, the type pair theirs)
//  - inspire: within the references' colour family; the library fills the gaps
//  - layout: only how their screens are arranged; the look is chosen as with no references
// Every reference is used (cited in theme.basis or on a screen) or set aside with a reason.
import type { DesignTheme } from "../contracts/artifacts.js";
import type { DesignRefsArt, RefRead } from "../stages/design-refs.js";
import { colourGap, hsl, MAX_HUE_GAP } from "./refs/fit.js";

type Problem = { check: string; message: string };

/** How far the brand may sit from a match reference's colour: the same colour to the eye, allowing for a picture's sampling. */
const MATCH_HUE = 8, MATCH_SL = 0.12;
const LOOK_PARTS = new Set(["brand", "button", "accent", "header", "link"]);

export const lookRefs = (r: DesignRefsArt | undefined): RefRead[] => (r?.refs ?? []).filter((x) => x.role === "match" || x.role === "inspire");
/** the look comes from the references (any match or inspire reference), not from the field's library */
export const lookFromRefs = (r: DesignRefsArt | undefined): boolean => lookRefs(r).length > 0;

/** A reference's colours that can carry a brand: the ones read as brand, button, accent, header or link, else any with colour in it. */
export function brandColours(r: RefRead): string[] {
  const parts = r.brief.palette.filter((p) => LOOK_PARTS.has(p.name)).map((p) => p.hex);
  return parts.length ? parts : r.brief.palette.map((p) => p.hex).filter((h) => hsl(h).s >= 0.12);
}

const near = (a: string, b: string): boolean => {
  const x = hsl(a), y = hsl(b);
  if (x.s < 0.12 && y.s < 0.12) return Math.abs(x.l - y.l) <= MATCH_SL;
  return colourGap(a, b) <= MATCH_HUE && Math.abs(x.s - y.s) <= MATCH_SL * 2 && Math.abs(x.l - y.l) <= MATCH_SL;
};

/** The reading's type style as the theme's body font, and as its heading. Only styles that map one way are checked. */
const BODY: Record<string, DesignTheme["font"][]> = { sans: ["sans", "grotesk"], grotesk: ["grotesk", "sans"], humanist: ["humanist"], rounded: ["rounded"], serif: ["book", "serif"] };
const HEAD: Record<string, DesignTheme["heading"][]> = { serif: ["serif"], display: ["display"], geometric: ["geometric"], condensed: ["condensed"], slab: ["slab"], mono: ["mono"], sans: ["match"], grotesk: ["match"], humanist: ["match"] };

export interface RefUse { id: string; use: "used" | "set-aside"; how: string }

/** Code's checks of a design drawn with references. `existing`: the app keeps its own look (references shape layout only). */
export function refFit(
  theme: DesignTheme | undefined,
  screens: { id: string; refs?: string[] }[],
  use: RefUse[] | undefined,
  reading: DesignRefsArt,
  existing = false,
): Problem[] {
  const bad: Problem[] = [];
  const ids = new Set(reading.refs.map((r) => r.id));
  const cited = new Set<string>();
  for (const s of screens) for (const r of s.refs ?? []) { if (ids.has(r)) cited.add(r); else bad.push({ check: "design-ref-unknown", message: `Screen ${s.id} cites ${r}, which is not one of the references (${[...ids].join(", ")}).` }); }
  for (const b of theme?.basis ?? []) { const m = b.ref.match(/\bR-\d+\b/); if (m) { if (ids.has(m[0])) cited.add(m[0]); else bad.push({ check: "design-ref-unknown", message: `theme.basis cites ${m[0]}, which is not one of the references.` }); } }
  // every reference is used or set aside with a reason
  for (const r of reading.refs) {
    const u = use?.find((x) => x.id === r.id);
    if (u?.use === "set-aside") { if (!u.how.trim()) bad.push({ check: "design-ref-unused", message: `${r.id} is set aside without a reason. Say in one sentence why (the requirements ask for something else, it shows another product's screen, ...).` }); continue; }
    if (!cited.has(r.id) && !(u?.use === "used" && u.how.trim())) bad.push({ check: "design-ref-unused", message: `${r.id} (${r.role}, ${r.source}) is neither used nor set aside. Cite it in "theme.basis" (look) or on the screens it shaped ("refs"), and list it in "refUse" with how it was used, or set it aside there with the reason.` });
  }
  if (existing || !theme) return bad;
  const match = reading.refs.filter((r) => r.role === "match");
  const inspire = reading.refs.filter((r) => r.role === "inspire");
  const setAside = new Set((use ?? []).filter((u) => u.use === "set-aside").map((u) => u.id));
  // match: the brand (and the accent, when given) is a reference's own colour
  const matchColours = match.filter((r) => !setAside.has(r.id)).flatMap(brandColours);
  if (matchColours.length) {
    if (!matchColours.some((c) => near(theme.brand, c))) bad.push({ check: "design-ref-colour", message: `Brand ${theme.brand} is not a colour of the match reference(s) (${matchColours.join(", ")}). A match reference's values are used exactly: take its brand colour as listed.` });
    const all = match.filter((r) => !setAside.has(r.id)).flatMap((r) => r.brief.palette.map((p) => p.hex));
    if (theme.accent && !all.some((c) => near(theme.accent!, c))) bad.push({ check: "design-ref-colour", message: `Accent ${theme.accent} is not a colour of the match reference(s) (${all.join(", ")}). Use one of theirs, or leave the accent out.` });
  }
  // match: the type pair follows the reference's (when it was read)
  for (const r of match.filter((x) => !setAside.has(x.id))) {
    const body = r.type.body ? BODY[r.type.body] : undefined;
    if (body && !body.includes(theme.font)) bad.push({ check: "design-ref-font", message: `${r.id} sets its body text in a ${r.type.body} face; theme.font "${theme.font}" is not that. Use ${body.map((b) => `"${b}"`).join(" or ")}.` });
    const head = r.type.heading ? HEAD[r.type.heading] : undefined;
    if (head && !head.includes(theme.heading) && !(r.type.heading === "serif" && theme.font === "serif")) bad.push({ check: "design-ref-font", message: `${r.id} sets its headings in a ${r.type.heading} face; theme.heading "${theme.heading}" is not that. Use ${head.map((h) => `"${h}"`).join(" or ")}.` });
  }
  // inspire (with no match): the brand stays in the references' colour family unless the theme says why
  if (!matchColours.length) {
    const family = inspire.filter((r) => !setAside.has(r.id)).flatMap(brandColours);
    if (family.length && !family.some((c) => colourGap(theme.brand, c) <= MAX_HUE_GAP) && !theme.departure?.trim()) {
      bad.push({ check: "design-ref-family", message: `Brand ${theme.brand} is more than ${MAX_HUE_GAP} degrees of hue from every colour of the inspire reference(s) (${family.join(", ")}). Stay in their colour family, or say in "departure" what in the requirements makes this product differ.` });
    }
  }
  if (lookFromRefs(reading) && !(theme.basis ?? []).some((b) => /\bR-\d+\b/.test(b.ref))) bad.push({ check: "design-ref-basis", message: `"theme.basis" must cite the references the look came from by id ("R-1: violet primary action, 4 px corners"), not other products.` });
  return bad;
}

/** Fonts a match reference measured exactly (a site's CSS, a Figma file): the theme carries them so the demo and the tokens use them. */
export function matchFamilies(reading: DesignRefsArt | undefined, setAside: string[] = []): { body?: string; heading?: string } | undefined {
  const plain = (f: string) => /^[A-Za-z0-9][A-Za-z0-9 _-]{0,47}$/.test(f);
  for (const r of (reading?.refs ?? []).filter((x) => x.role === "match" && x.measured === "exact" && !setAside.includes(x.id))) {
    const fonts = r.brief.fonts.filter(plain);
    if (fonts.length) return { body: fonts[0], ...(fonts[1] ? { heading: fonts[1] } : {}) };
  }
  return undefined;
}

/** The typed part of the reading for the design step (trusted: code measured it, the allow-list cleaned it). */
export function refBrief(reading: DesignRefsArt): unknown[] {
  return reading.refs.map((r) => ({
    id: r.id, role: r.role, kind: r.kind, measured: r.measured,
    palette: r.brief.palette, ...(r.brief.fonts.length ? { fonts: r.brief.fonts } : {}), ...(r.brief.radiusPx !== null ? { radiusPx: r.brief.radiusPx } : {}),
    type: r.type, ...(r.corners ? { corners: r.corners } : {}), ...(r.density ? { density: r.density } : {}), navigation: r.navigation,
    screens: r.brief.screens.map((s) => ({ name: s.id, regions: s.regions.map((x) => x.name) })), reqs: r.reqs,
  }));
}

/** The untrusted words of the reading: the reader's notes and the user's own note per reference. */
export function refNotes(reading: DesignRefsArt): string {
  return reading.refs.map((r) => [
    ...(r.userNote ? [`${r.id}, the client's note: ${r.userNote}`] : []),
    ...r.brief.untrustedNotes.map((n) => `${r.id}: ${n}`),
  ].join("\n")).filter(Boolean).join("\n");
}

export const REF_RULES = `CLIENT REFERENCES. The client attached design references (the "client-references" section, R-1, R-2, ..., with their pictures). They come before the field's library and before your own taste, each by its role:
- match: use its values exactly. theme.brand is its brand (or button) colour as listed, the accent (if any) one of its colours, theme.font and theme.heading the styles it was read with, radius and density as it shows. Do not "improve" a client's brand.
- inspire: stay in its colour family and feel (brand within its hues, its corners, density and surfaces); choose your own exact values, filling what it leaves open as you would with no references.
- layout: take only how its screens are arranged (the navigation, the regions and their order) for the screens it relates to; the look is chosen as with no references.
- theme.basis cites the references the look came from by id and what was taken ("R-1: violet primary action, 4 px corners"). With only layout references, it cites the field's products as usual.
- Each screen lists in "refs" the reference ids that shaped it (layout or look); a screen shaped by none has none.
- "refUse": one entry per reference: use "used" with how (one short sentence), or "set-aside" with why (it shows something the requirements do not ask for, it conflicts with a requirement). The requirements beat a reference: where you depart from one, say so in "departure".
- A colour you use from a reference is written exactly as listed in "client-references"; never sample one from a picture.`;
