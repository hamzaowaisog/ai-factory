// A drawn wireframe for a screen in a given state (docs/estimates-design.md, "Design baseline"). Pure code,
// no model: the blocks come from the wording of the requirements the screen serves (a form, a table, a chart,
// a search box, a button), and the state changes what the page shows (empty, loading, error, success). It is
// a layout sketch to talk about, not a design: the boxes say what is on the page and where, nothing more.
// Every string is escaped and the output is plain SVG with no script, so it can sit inline in the demo page.

export interface WireScreen { id: string; route: string; file?: string }
export type Block = "form" | "table" | "chart" | "search" | "button" | "cards" | "text";

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

const RULES: [Block, RegExp][] = [
  ["form", /\b(sign[ -]?in|log[ -]?in|password|register|sign[ -]?up|enter|fill|submit|form|field|input|address|email)\b/i],
  ["chart", /\b(chart|graph|trend|dashboard|metric|kpi|analytics|visuali[sz])/i],
  ["table", /\b(list|table|grid|history|orders|records|report|rows|results|inbox|catalog|catalogue)\b/i],
  ["search", /\b(search|filter|find|sort)\b/i],
  ["button", /\b(button|export|download|print|upload|confirm|approve|save|delete|cancel)\b/i],
  ["cards", /\b(card|tile|summary|overview|profile|detail)s?\b/i],
];

/** What a requirement's wording asks the page to show, in order. A requirement that matches nothing is a text block. */
export function blocksFor(text: string): Block[] {
  const found = RULES.filter(([, re]) => re.test(text)).map(([b]) => b);
  return found.length ? found.slice(0, 3) : ["text"];
}

const W = 640, PAD = 24, GREY = "#d9dce1", LIGHT = "#eef0f3", INK = "#3b4250";

function drawBlock(b: Block, y: number, label: string, skeleton: boolean): { svg: string; h: number } {
  const fill = skeleton ? LIGHT : "#fff";
  const cap = `<text x="${PAD}" y="${y + 14}" font-size="12" fill="${INK}">${esc(clip(label, 78))}</text>`;
  const top = y + 24;
  const box = (x: number, yy: number, w: number, h: number, r = 4) => `<rect x="${x}" y="${yy}" width="${w}" height="${h}" rx="${r}" fill="${fill}" stroke="${GREY}"/>`;
  const line = (x: number, yy: number, w: number) => `<rect x="${x}" y="${yy}" width="${w}" height="8" rx="4" fill="${GREY}"/>`;
  switch (b) {
    case "form": {
      const rows = [0, 1].map((i) => `${line(PAD, top + i * 56, 90)}${box(PAD, top + 14 + i * 56, 320, 28)}`).join("");
      return { svg: `${cap}${rows}<rect x="${PAD}" y="${top + 122}" width="110" height="30" rx="6" fill="${INK}"/><text x="${PAD + 55}" y="${top + 141}" font-size="12" fill="#fff" text-anchor="middle">Submit</text>`, h: 24 + 164 };
    }
    case "table": {
      const hdr = `<rect x="${PAD}" y="${top}" width="${W - 2 * PAD}" height="26" fill="${GREY}"/>`;
      const rows = [0, 1, 2, 3].map((i) => `${box(PAD, top + 26 + i * 26, W - 2 * PAD, 26, 0)}${line(PAD + 10, top + 35 + i * 26, 70 + ((i * 37) % 60))}${line(PAD + 260, top + 35 + i * 26, 90)}`).join("");
      return { svg: `${cap}${hdr}${rows}`, h: 24 + 26 + 104 + 8 };
    }
    case "chart": {
      const bars = [50, 80, 35, 95, 60, 75].map((v, i) => `<rect x="${PAD + 24 + i * 52}" y="${top + 120 - v}" width="34" height="${v}" fill="${skeleton ? LIGHT : GREY}"/>`).join("");
      return { svg: `${cap}${box(PAD, top, W - 2 * PAD, 130)}${bars}`, h: 24 + 138 };
    }
    case "search":
      return { svg: `${cap}${box(PAD, top, 360, 30, 15)}<circle cx="${PAD + 18}" cy="${top + 15}" r="6" fill="none" stroke="${INK}"/>${box(PAD + 376, top, 90, 30, 15)}`, h: 24 + 40 };
    case "button":
      return { svg: `${cap}<rect x="${PAD}" y="${top}" width="140" height="32" rx="6" fill="none" stroke="${INK}" stroke-width="1.5"/><text x="${PAD + 70}" y="${top + 21}" font-size="12" fill="${INK}" text-anchor="middle">Action</text>`, h: 24 + 44 };
    case "cards":
      return { svg: `${cap}${[0, 1, 2].map((i) => `${box(PAD + i * 196, top, 180, 84)}${line(PAD + 12 + i * 196, top + 14, 90)}${line(PAD + 12 + i * 196, top + 34, 130)}`).join("")}`, h: 24 + 96 };
    default:
      return { svg: `${cap}${line(PAD, top, 400)}${line(PAD, top + 18, 360)}${line(PAD, top + 36, 280)}`, h: 24 + 56 };
  }
}

/**
 * The wireframe of one screen in one state, as an SVG string. `reqs` are the requirement texts the screen serves.
 * States are matched by word: empty, loading, error, success; anything else draws the normal page.
 */
export function wireframeSvg(screen: WireScreen, state: string, reqs: { id: string; text: string }[]): string {
  const st = /empty|no data|none/i.test(state) ? "empty" : /load|wait|pending|progress/i.test(state) ? "loading" : /error|fail|invalid|denied/i.test(state) ? "error" : /success|done|saved|complete|confirm/i.test(state) ? "success" : "normal";
  let y = 92;
  const parts: string[] = [];
  const banner = st === "error" ? ["#fdeceb", "#c0392b", "Something went wrong. Say what, and how to fix it."] : st === "success" ? ["#e8f6ee", "#1e8449", "Done. Say what happened."] : undefined;
  if (banner) {
    parts.push(`<rect x="${PAD}" y="${y}" width="${W - 2 * PAD}" height="34" rx="6" fill="${banner[0]}" stroke="${banner[1]}"/><text x="${PAD + 12}" y="${y + 21}" font-size="12" fill="${banner[1]}">${esc(banner[2]!)}</text>`);
    y += 46;
  }
  if (st === "empty") {
    parts.push(`<rect x="${PAD}" y="${y}" width="${W - 2 * PAD}" height="170" rx="8" fill="#fff" stroke="${GREY}" stroke-dasharray="6 4"/><circle cx="${W / 2}" cy="${y + 62}" r="22" fill="${LIGHT}" stroke="${GREY}"/><text x="${W / 2}" y="${y + 116}" font-size="14" fill="${INK}" text-anchor="middle">Nothing here yet</text><text x="${W / 2}" y="${y + 136}" font-size="11" fill="#7b8494" text-anchor="middle">Say what to do next</text>`);
    y += 182;
  } else {
    for (const r of (reqs.length ? reqs : [{ id: "", text: screen.id }]).slice(0, 4)) {
      for (const b of blocksFor(r.text).slice(0, 2)) {
        const d = drawBlock(b, y, `${r.id} ${r.text}`.trim(), st === "loading");
        parts.push(d.svg);
        y += d.h + 10;
      }
    }
  }
  const H = Math.max(y + 16, 240);
  const title = clip(screen.id, 30);
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${esc(`Wireframe of ${screen.id} (${state})`)}" font-family="system-ui,sans-serif">
<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="10" fill="#fafbfc" stroke="${GREY}"/>
<rect x="0.5" y="0.5" width="${W - 1}" height="40" rx="10" fill="${LIGHT}" stroke="${GREY}"/>
<circle cx="20" cy="20" r="5" fill="${GREY}"/><circle cx="38" cy="20" r="5" fill="${GREY}"/><circle cx="56" cy="20" r="5" fill="${GREY}"/>
<rect x="84" y="9" width="${W - 108}" height="22" rx="11" fill="#fff" stroke="${GREY}"/><text x="98" y="24" font-size="12" fill="${INK}">${esc(clip(screen.route, 70))}</text>
<text x="${PAD}" y="74" font-size="18" font-weight="600" fill="${INK}">${esc(title)}</text>
<text x="${W - PAD}" y="74" font-size="11" fill="#7b8494" text-anchor="end">${esc(state)}</text>
${parts.join("\n")}
</svg>`;
}
