// The picture on a card people choose by picture, drawn in code: a city, a coast, mountains, desert, a stay, a dish, a product,
// a person, an event, a course, a car. Natural colours (sky, sea, sand, wood), not the brand's, because a real product shows
// photos and photos are not brand-coloured. The kind comes from the item's own words, then the page's; the light (day, golden
// hour, dusk) and the layout vary per item so a grid of six never repeats. No text from the design is ever placed in the SVG.
import { icon, iconFor } from "./icons.js";

type Kind = "city" | "coast" | "mountain" | "desert" | "stay" | "house" | "food" | "product" | "person" | "event" | "learn" | "car" | "tile";

const KINDS: [RegExp, Kind][] = [
  [/\b(beach|island|coast(al)?|bay|maldives|bali|phuket|goa|seaside|cruise|sea|ocean|lagoon|antalya|zanzibar|cancun|mykonos|santorini|langkawi|boracay|gwadar|seychelles|mauritius|riviera)\b/i, "coast"],
  [/\b(mountains?|alps|hik(e|ing)|trek(king)?|ski(ing)?|swiss|switzerland|hunza|skardu|nepal|himalaya|national park|valley|banff|everest|murree|naran|swat|patagonia|norway|iceland|tbilisi|baku|almaty|interlaken)\b/i, "mountain"],
  [/\b(desert|safari|sahara|dunes?|oasis|petra|wadi|marrakech|cairo|giza|jaisalmer|thar|luxor|al ?ula)\b/i, "desert"],
  [/\b(villa|house|home|cottage|cabin|chalet|farmhouse|bungalow)\b/i, "house"],
  [/\b(hotel|resort|suite|room|stay|apartment|condo|loft|hostel|inn|property|residence|studio flat)\b/i, "stay"],
  [/\b(pizza|burger|biryani|karahi|sushi|ramen|salad|bowl|dish|meal|food|restaurant|kitchen|bakery|dessert|cake|coffee|latte|espresso|cafe|tea|breakfast|lunch|dinner|grill|bbq|tikka|kebab|pasta|noodles|tacos?|curry)\b/i, "food"],
  [/\b(dr\.?|doctor|physician|dentist|surgeon|therapist|nurse|coach|tutor|teacher|instructor|trainer|agent|advisor|consultant|specialist|lawyer|stylist|barber|photographer|mentor|host)\b/i, "person"],
  [/\b(concert|festival|gig|show|match|game night|event|conference|summit|meetup|workshop|exhibition|tickets?|live music|comedy|theat(re|er))\b/i, "event"],
  [/\b(course|lesson|class|bootcamp|module|lecture|certificate|tutorial|masterclass|curriculum|program(me)?)\b/i, "learn"],
  [/\b(car|suv|sedan|hatchback|rental|ride|taxi|vehicle|civic|corolla|tesla|bmw|audi|toyota|honda|hyundai|kia)\b/i, "car"],
  [/\b(shoes?|sneakers?|trainers?|bag|tote|backpack|purse|watch|headphones?|earbuds?|speaker|perfume|fragrance|serum|skincare|cream|lotion|bottle|phone|laptop|tablet|camera|chair|sofa|lamp|furniture|jacket|shirt|dress|hoodie|kurta|lawn|product|item|sku|in stock|out of stock|add to cart|price)\b/i, "product"],
  [/\b(city|downtown|skyline|dubai|london|paris|new york|istanbul|tokyo|singapore|doha|jeddah|riyadh|kuala lumpur|bangkok|toronto|berlin|rome|madrid|barcelona|amsterdam|seoul|hong kong|shanghai|lahore|karachi|islamabad|delhi|mumbai|chicago|sydney|manchester|milan|vienna|prague|lisbon|cairo|abu dhabi|muscat|manama|kuwait)\b/i, "city"],
];
const TRAVEL = /\b(travel|trips?|destinations?|flights?|fly|holidays?|vacations?|tours?|getaways?|explore|where to|escapes?|airline|fares?)\b/i;
const SHOP = /\b(shop|store|products?|catalog(ue)?|cart|collection|new in|arrivals|best ?sellers?|sale|price|buy)\b/i;
const STAYS = /\b(stays?|hotels?|rooms?|rentals?|homes?|properties|listings?|apartments?)\b/i;

/** What a card's picture shows, from its own words first, then the page's. */
export function sceneKind(item: string, page: string): Kind {
  const own = KINDS.find(([re]) => re.test(item))?.[1];
  if (own) return own;
  if (TRAVEL.test(page)) return (["city", "coast", "mountain", "desert"] as const)[Math.abs(hash(item)) % 4]!;
  if (STAYS.test(page)) return Math.abs(hash(item)) % 3 === 0 ? "house" : "stay";
  if (SHOP.test(page)) return "product";
  return KINDS.find(([re]) => re.test(page))?.[1] ?? "tile";
}

export function hash(s: string): number {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0;
  return h;
}
/** A small seeded generator, so the same item always gets the same picture (the demo's hash must not change between builds). */
const seeded = (seed: number) => { let s = (seed >>> 0) || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); };

const LIGHTS = {
  day: { sky: ["#5DA7F0", "#D8ECFF"], sun: "#FFF6D5", far: "#A8C2DD", near: "#4C6A8C", win: "rgba(255,255,255,.35)", sea: ["#2F8FC4", "#1A5E8E"], sand: "#F1D6A4", leaf: "#2E7A4F", hill: ["#9DB4D0", "#6E8DAE", "#3F6650"] },
  gold: { sky: ["#F29A55", "#FDE6C4"], sun: "#FFF3DA", far: "#D9A788", near: "#7E4F44", win: "rgba(255,226,160,.7)", sea: ["#3C7FA3", "#24506E"], sand: "#EBC08C", leaf: "#2F5E3D", hill: ["#D5A58F", "#A57066", "#4E4A3A"] },
  dusk: { sky: ["#3E4384", "#F2A98A"], sun: "#FFD9AE", far: "#8B7BA6", near: "#34315C", win: "rgba(255,214,140,.85)", sea: ["#545A93", "#2F3264"], sand: "#C9998A", leaf: "#1F3F38", hill: ["#8C7CA8", "#5E5687", "#2C3150"] },
} as const;
type Light = (typeof LIGHTS)[keyof typeof LIGHTS];

const sky = (id: string, L: Light, sunX: number, sunY: number, r = 16) =>
  `<defs><linearGradient id="${id}s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${L.sky[0]}"/><stop offset="1" stop-color="${L.sky[1]}"/></linearGradient><radialGradient id="${id}g"><stop offset="0" stop-color="${L.sun}" stop-opacity=".9"/><stop offset="1" stop-color="${L.sun}" stop-opacity="0"/></radialGradient></defs><rect width="320" height="200" fill="url(#${id}s)"/><circle cx="${sunX}" cy="${sunY}" r="${r * 3.2}" fill="url(#${id}g)"/><circle cx="${sunX}" cy="${sunY}" r="${r}" fill="${L.sun}"/>`;

const clouds = (rnd: () => number, n: number, op = 0.75) => Array.from({ length: n }, () => {
  const x = rnd() * 300, y = 18 + rnd() * 50, w = 26 + rnd() * 30;
  return `<g fill="#fff" opacity="${op}"><ellipse cx="${x}" cy="${y}" rx="${w}" ry="${w * 0.22}"/><ellipse cx="${x - w * 0.25}" cy="${y - w * 0.14}" rx="${w * 0.4}" ry="${w * 0.24}"/><ellipse cx="${x + w * 0.2}" cy="${y - w * 0.2}" rx="${w * 0.32}" ry="${w * 0.26}"/></g>`;
}).join("");

function city(id: string, rnd: () => number, L: Light): string {
  const row = (base: number, hMin: number, hMax: number, fill: string, lit: boolean) => {
    let x = -6, out = "";
    while (x < 320) {
      const w = 16 + rnd() * 26, h = hMin + rnd() * (hMax - hMin), top = base - h;
      out += `<rect x="${x.toFixed(1)}" y="${top.toFixed(1)}" width="${w.toFixed(1)}" height="${h + 40}" fill="${fill}"/>`;
      const r = rnd();
      if (r < 0.18) out += `<rect x="${(x + w / 2 - 0.8).toFixed(1)}" y="${(top - 14).toFixed(1)}" width="1.6" height="14" fill="${fill}"/>`;
      else if (r < 0.32) out += `<path d="M${x.toFixed(1)} ${top.toFixed(1)} L${(x + w / 2).toFixed(1)} ${(top - 10).toFixed(1)} L${(x + w).toFixed(1)} ${top.toFixed(1)}Z" fill="${fill}"/>`;
      if (lit) for (let wy = top + 6; wy < base - 4; wy += 8) for (let wx = x + 4; wx < x + w - 4; wx += 6) if (rnd() < 0.45) out += `<rect x="${wx.toFixed(1)}" y="${wy.toFixed(1)}" width="2.6" height="3.6" fill="${L.win}"/>`;
      x += w + 1 + rnd() * 3;
    }
    return out;
  };
  return `${sky(id, L, 60 + rnd() * 200, 50 + rnd() * 30)}${clouds(rnd, 2, 0.5)}${row(170, 50, 115, L.far, false)}${row(200, 30, 95, L.near, true)}`;
}

function coast(id: string, rnd: () => number, L: Light): string {
  const sx = 200 + rnd() * 80, hz = 108 + rnd() * 10;
  const waves = Array.from({ length: 6 }, (_, i) => { const y = hz + 12 + i * 12, x = rnd() * 220; return `<path d="M${x.toFixed(0)} ${y} q 10 -3 20 0 t 20 0" stroke="#fff" stroke-opacity=".35" stroke-width="1.4" fill="none"/>`; }).join("");
  const palm = (px: number, base: number, s: number) => `<g transform="translate(${px} ${base}) scale(${s})"><path d="M0 0 C 4 -30 10 -60 22 -86" stroke="#6B4A2E" stroke-width="5" fill="none" stroke-linecap="round"/>${[-150, -110, -60, -20, 20].map((a) => `<path d="M22 -86 q ${(Math.cos((a * Math.PI) / 180) * 26).toFixed(1)} ${(Math.sin((a * Math.PI) / 180) * 18 - 8).toFixed(1)} ${(Math.cos((a * Math.PI) / 180) * 46).toFixed(1)} ${(Math.sin((a * Math.PI) / 180) * 26 + 12).toFixed(1)} q ${(-Math.cos((a * Math.PI) / 180) * 18).toFixed(1)} -4 ${(-Math.cos((a * Math.PI) / 180) * 46).toFixed(1)} ${(-Math.sin((a * Math.PI) / 180) * 26 - 12).toFixed(1)}Z" fill="${L.leaf}"/>`).join("")}</g>`;
  return `${sky(id, L, sx, hz - 26, 14)}${clouds(rnd, 2, 0.55)}<path d="M${(rnd() * 80).toFixed(0)} ${hz} q 30 -14 70 0Z" fill="${L.hill[1]}" opacity=".7"/><defs><linearGradient id="${id}w" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${L.sea[0]}"/><stop offset="1" stop-color="${L.sea[1]}"/></linearGradient></defs><rect y="${hz}" width="320" height="${200 - hz}" fill="url(#${id}w)"/><ellipse cx="${sx}" cy="${hz + 22}" rx="16" ry="40" fill="${L.sun}" opacity=".22"/>${waves}<path d="M0 200 V${165 + rnd() * 10} Q 140 ${140 + rnd() * 10} 320 ${172 + rnd() * 10} V200Z" fill="${L.sand}"/><path d="M0 ${166} Q 140 ${146} 320 ${174}" stroke="#fff" stroke-opacity=".55" stroke-width="2" fill="none"/>${palm(30 + rnd() * 40, 196, 0.9 + rnd() * 0.2)}`;
}

function mountain(id: string, rnd: () => number, L: Light): string {
  const ridge = (base: number, amp: number, n: number) => { let d = `M0 200 V${base}`; for (let i = 1; i <= n; i++) { const x = (320 / n) * i; d += ` L${(x - 320 / n / 2).toFixed(0)} ${(base - amp * (0.5 + rnd() * 0.6)).toFixed(0)} L${x.toFixed(0)} ${(base - amp * rnd() * 0.25).toFixed(0)}`; } return `${d} V200Z`; };
  const px = 110 + rnd() * 100, py = 40 + rnd() * 14;
  const pines = Array.from({ length: 9 }, () => { const x = rnd() * 320, h = 22 + rnd() * 20, b = 196 - rnd() * 8; return `<path d="M${x.toFixed(0)} ${(b - h).toFixed(0)} l${(h * 0.3).toFixed(1)} ${(h * 0.55).toFixed(1)} h-${(h * 0.12).toFixed(1)} l${(h * 0.22).toFixed(1)} ${(h * 0.45).toFixed(1)} h-${(h * 0.8).toFixed(1)} l${(h * 0.22).toFixed(1)} -${(h * 0.45).toFixed(1)} h-${(h * 0.12).toFixed(1)}Z" fill="${L.leaf}"/>`; }).join("");
  return `${sky(id, L, 40 + rnd() * 240, 44, 13)}${clouds(rnd, 2, 0.6)}<path d="M${px - 110} 140 L${px} ${py} L${px + 120} 140Z" fill="${L.hill[0]}"/><path d="M${px - 22} ${py + 26} L${px} ${py} L${px + 24} ${py + 28} l-8 -4 -7 6 -6 -7 -7 5Z" fill="#fff" opacity=".92"/><path d="${ridge(150, 50, 4)}" fill="${L.hill[1]}"/><path d="${ridge(178, 30, 5)}" fill="${L.hill[2]}"/>${pines}`;
}

function desert(id: string, rnd: () => number, L: Light): string {
  const t = ["#EDBE84", "#DDA05E", "#C88245", "#A9682F"];
  const dune = (y: number, c: string) => `<path d="M0 200 V${y} C ${60 + rnd() * 40} ${y - 24 - rnd() * 16}, ${150 + rnd() * 40} ${y + 10}, 320 ${y - 14 - rnd() * 14} V200Z" fill="${c}"/>`;
  return `${sky(id, { ...L, sky: ["#F4B26B", "#FCE9CB"] } as unknown as Light, 60 + rnd() * 200, 70, 20)}${dune(118, t[0]!)}${dune(140, t[1]!)}${dune(162, t[2]!)}${dune(184, t[3]!)}`;
}

function stay(id: string, rnd: () => number, L: Light): string {
  const w = 120 + rnd() * 40, x = 160 - w / 2 + (rnd() - 0.5) * 60, top = 34 + rnd() * 20, body = rnd() < 0.5 ? "#F4EDE4" : "#E7EDF3";
  let win = "";
  for (let wy = top + 14; wy < 160; wy += 20) for (let wx = x + 10; wx < x + w - 14; wx += 22) win += `<rect x="${wx.toFixed(0)}" y="${wy.toFixed(0)}" width="13" height="12" rx="1.5" fill="${rnd() < 0.3 ? L.win.replace(/[\d.]+\)$/, "1)") : "#8FB3CF"}"/><rect x="${(wx - 2).toFixed(0)}" y="${(wy + 12).toFixed(0)}" width="17" height="2" fill="#C9BCA9"/>`;
  const tree = (tx: number, s: number) => `<rect x="${tx - 2}" y="${178 - 26 * s}" width="4" height="${26 * s}" fill="#6B4A2E"/><circle cx="${tx}" cy="${170 - 30 * s}" r="${18 * s}" fill="${L.leaf}"/><circle cx="${tx - 10 * s}" cy="${178 - 30 * s}" r="${12 * s}" fill="${L.leaf}" opacity=".85"/>`;
  return `${sky(id, L, 270 - rnd() * 40, 40, 12)}${clouds(rnd, 2, 0.6)}<rect x="${x.toFixed(0)}" y="${top.toFixed(0)}" width="${w.toFixed(0)}" height="${200 - top}" fill="${body}"/><rect x="${(x - 4).toFixed(0)}" y="${(top - 6).toFixed(0)}" width="${(w + 8).toFixed(0)}" height="7" fill="#B9A58C"/>${win}<rect x="${(x + w / 2 - 12).toFixed(0)}" y="172" width="24" height="28" fill="#5E4634"/><rect y="186" width="320" height="14" fill="#9DB08A"/>${tree(x - 24, 1.1)}${tree(x + w + 22, 0.9)}`;
}

function house(id: string, rnd: () => number, L: Light): string {
  const x = 70 + rnd() * 60, w = 150, wall = ["#F3E9DC", "#E9EEF2", "#F1E2D3"][Math.floor(rnd() * 3)]!, roof = ["#7A4B3A", "#3F4B5C", "#8C5A3C"][Math.floor(rnd() * 3)]!;
  return `${sky(id, L, 270, 42, 12)}${clouds(rnd, 2, 0.6)}<rect y="160" width="320" height="40" fill="#8DB27A"/><rect x="${x}" y="98" width="${w}" height="72" fill="${wall}"/><path d="M${x - 12} 100 L${x + w / 2} 52 L${x + w + 12} 100Z" fill="${roof}"/><rect x="${x + 20}" y="114" width="26" height="22" rx="2" fill="#8FB3CF"/><rect x="${x + w - 46}" y="114" width="26" height="22" rx="2" fill="${L.win.replace(/[\d.]+\)$/, "1)")}"/><rect x="${x + w / 2 - 12}" y="130" width="24" height="40" rx="2" fill="#5E4634"/><rect x="${x + w + 30}" y="168" width="70" height="14" rx="3" fill="#5BB8D6"/><circle cx="${x - 30}" cy="128" r="22" fill="${L.leaf}"/><rect x="${x - 32}" y="140" width="4" height="26" fill="#6B4A2E"/>`;
}

function food(id: string, rnd: () => number, item: string): string {
  const table = rnd() < 0.5 ? ["#C8996B", "#B9875A"] : ["#EDE5D8", "#E2D7C6"];
  const cx = 160 + (rnd() - 0.5) * 40, cy = 104;
  const toppings = (n: number, cols: string[], r: number, spread: number) => Array.from({ length: n }, () => { const a = rnd() * Math.PI * 2, d = rnd() * spread; return `<circle cx="${(cx + Math.cos(a) * d).toFixed(1)}" cy="${(cy + Math.sin(a) * d * 0.9).toFixed(1)}" r="${(r * (0.7 + rnd() * 0.6)).toFixed(1)}" fill="${cols[Math.floor(rnd() * cols.length)]}"/>`; }).join("");
  const plate = `<ellipse cx="${cx + 6}" cy="${cy + 10}" rx="78" ry="74" fill="#000" opacity=".12"/><circle cx="${cx}" cy="${cy}" r="76" fill="#FAFAF7"/><circle cx="${cx}" cy="${cy}" r="60" fill="#F1F0EB"/>`;
  let dish: string;
  if (/pizza/i.test(item)) dish = `<circle cx="${cx}" cy="${cy}" r="56" fill="#E2A65A"/><circle cx="${cx}" cy="${cy}" r="48" fill="#D1492F"/>${toppings(18, ["#F6E3B0", "#F6E3B0", "#3E7B3A", "#8A1E1E"], 5, 40)}`;
  else if (/coffee|latte|espresso|cafe|tea/i.test(item)) dish = `<circle cx="${cx}" cy="${cy}" r="44" fill="#fff" stroke="#E6E1D8" stroke-width="3"/><circle cx="${cx}" cy="${cy}" r="34" fill="#8A5A3B"/><path d="M${cx} ${cy - 18} c 14 6 14 22 0 30 c -14 -8 -14 -24 0 -30z" fill="#F3E3CD"/><path d="M${cx + 44} ${cy - 8} h 14 a8 8 0 0 1 0 16 h -14" fill="none" stroke="#fff" stroke-width="6"/>`;
  else if (/burger/i.test(item)) dish = `<ellipse cx="${cx}" cy="${cy - 14}" rx="46" ry="30" fill="#D9963F"/>${toppings(10, ["#F6E3B0"], 2, 30).replace(/cy="([\d.]+)"/g, (_, y) => `cy="${Number(y) - 24}"`)}<rect x="${cx - 50}" y="${cy + 6}" width="100" height="8" rx="4" fill="#4E9A3A"/><rect x="${cx - 46}" y="${cy + 12}" width="92" height="12" rx="6" fill="#6B3A25"/><rect x="${cx - 44}" y="${cy + 24}" width="88" height="12" rx="5" fill="#E2A65A"/>`;
  else dish = `<circle cx="${cx}" cy="${cy}" r="44" fill="${rnd() < 0.5 ? "#E9C46A" : "#F2E6CF"}"/>${toppings(26, ["#C8553D", "#588157", "#F4A259", "#7A3E2B", "#FFFFFF"], 4.2, 34)}`;
  return `<rect width="320" height="200" fill="${table[0]}"/>${table[0] === "#C8996B" ? [40, 90, 140, 190].map((y) => `<rect y="${y}" width="320" height="1.5" fill="${table[1]}"/>`).join("") : ""}${plate}${dish}<rect x="${cx + 92}" y="40" width="5" height="120" rx="2.5" fill="#C9CCD1"/><rect x="${cx - 100}" y="40" width="5" height="120" rx="2.5" fill="#C9CCD1"/><rect x="18" y="130" width="54" height="54" rx="8" fill="#fff" opacity=".7" transform="rotate(-12 45 157)"/>`;
}

function product(id: string, rnd: () => number, item: string): string {
  const bg = ["#F1E7DC", "#E2EBF4", "#E6EFE3", "#F3E3E7", "#ECE7F5", "#F4EEDC"][Math.floor(rnd() * 6)]!;
  const tone = ["#2B2D33", "#C9634B", "#3D6B8C", "#D9B38C", "#5B7F5E", "#E7E2DA"][Math.floor(rnd() * 6)]!;
  const k = /shoe|sneaker|trainer/i.test(item) ? 0 : /bag|tote|backpack|purse/i.test(item) ? 1 : /headphone|earbud|speaker|audio/i.test(item) ? 2 : /watch/i.test(item) ? 3 : /perfume|fragrance|serum|skincare|cream|lotion|bottle|oil/i.test(item) ? 4 : /phone|mobile|tablet/i.test(item) ? 5 : /chair|sofa|lamp|furniture/i.test(item) ? 6 : Math.abs(hash(item)) % 7;
  const things = [
    `<path d="M88 140 C 92 112 120 104 140 98 L 170 96 C 186 112 214 118 238 124 C 250 128 252 140 244 146 L 92 148 C 86 148 86 144 88 140Z" fill="${tone}"/><path d="M90 146 H 246" stroke="#fff" stroke-width="7" stroke-linecap="round"/><path d="M146 104 l 10 18 M160 102 l 10 18 M174 104 l 8 16" stroke="#fff" stroke-opacity=".7" stroke-width="2.5"/>`,
    `<path d="M120 86 h 80 l 10 74 h -100z" fill="${tone}"/><path d="M138 88 v -14 a 22 22 0 0 1 44 0 v 14" stroke="${tone}" stroke-width="6" fill="none"/><rect x="146" y="104" width="28" height="7" rx="3" fill="#fff" opacity=".5"/>`,
    `<path d="M112 120 v -14 a 48 48 0 0 1 96 0 v 14" stroke="${tone}" stroke-width="9" fill="none" stroke-linecap="round"/><rect x="98" y="110" width="30" height="46" rx="12" fill="${tone}"/><rect x="192" y="110" width="30" height="46" rx="12" fill="${tone}"/><rect x="104" y="118" width="10" height="30" rx="5" fill="#fff" opacity=".25"/>`,
    `<rect x="146" y="44" width="28" height="122" rx="10" fill="${tone}"/><circle cx="160" cy="104" r="34" fill="#2B2D33"/><circle cx="160" cy="104" r="28" fill="#F7F5F0"/><path d="M160 104 V 84 M160 104 l 12 8" stroke="#2B2D33" stroke-width="3" stroke-linecap="round"/>`,
    `<rect x="138" y="62" width="44" height="18" rx="4" fill="#2B2D33"/><rect x="120" y="78" width="80" height="84" rx="16" fill="${tone}" opacity=".92"/><rect x="132" y="100" width="56" height="30" rx="4" fill="#fff" opacity=".8"/><rect x="128" y="86" width="8" height="64" rx="4" fill="#fff" opacity=".3"/>`,
    `<rect x="126" y="40" width="68" height="128" rx="14" fill="#2B2D33"/><rect x="131" y="46" width="58" height="116" rx="10" fill="${tone === "#2B2D33" ? "#3D6B8C" : tone}"/><circle cx="148" cy="60" r="6" fill="#2B2D33"/>`,
    `<rect x="110" y="96" width="100" height="22" rx="8" fill="${tone}"/><rect x="118" y="56" width="84" height="46" rx="10" fill="${tone}"/><rect x="114" y="116" width="6" height="44" fill="#6B4A2E"/><rect x="200" y="116" width="6" height="44" fill="#6B4A2E"/>`,
  ][k]!;
  return `<defs><radialGradient id="${id}p" cx=".5" cy=".35" r=".8"><stop offset="0" stop-color="#fff" stop-opacity=".9"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs><rect width="320" height="200" fill="${bg}"/><rect width="320" height="200" fill="url(#${id}p)"/><ellipse cx="160" cy="166" rx="86" ry="10" fill="#000" opacity=".1"/>${things}`;
}

function person(id: string, rnd: () => number, item: string): string {
  const skin = ["#F1C7A5", "#E0AC85", "#C68A63", "#8D5A3B", "#F5D3B8"][Math.floor(rnd() * 5)]!;
  const hair = ["#2B1E16", "#4A3222", "#1C1C1C", "#7A5230"][Math.floor(rnd() * 4)]!;
  const shirt = /dr\.?|doctor|physician|dentist|surgeon|nurse/i.test(item) ? "#F7F7F5" : ["#3D6B8C", "#5B7F5E", "#C9634B", "#2B2D33", "#8C6A9E"][Math.floor(rnd() * 5)]!;
  const bg = ["#DCE8F2", "#EFE3D6", "#E3EEE4", "#EDE4F2"][Math.floor(rnd() * 4)]!;
  const long = rnd() < 0.45;
  const medic = shirt === "#F7F7F5" ? `<path d="M140 150 q 0 26 20 26 q 20 0 20 -26" stroke="#4E5D6C" stroke-width="3" fill="none"/><circle cx="180" cy="148" r="4" fill="#4E5D6C"/><path d="M152 140 l 8 12 8 -12" fill="#9CC5D8"/>` : "";
  return `<rect width="320" height="200" fill="${bg}"/><circle cx="250" cy="40" r="60" fill="#fff" opacity=".35"/>${long ? `<path d="M126 92 q -6 60 10 78 h 48 q 16 -18 10 -78z" fill="${hair}"/>` : ""}<path d="M92 200 q 4 -56 68 -62 q 64 6 68 62z" fill="${shirt}"/>${medic}<rect x="150" y="116" width="20" height="26" rx="8" fill="${skin}"/><ellipse cx="160" cy="92" rx="32" ry="36" fill="${skin}"/><path d="M127 90 q 0 -42 34 -42 q 32 0 32 40 q -16 -20 -40 -22 q -12 8 -26 24z" fill="${hair}"/><ellipse cx="148" cy="96" rx="2.6" ry="3" fill="#2B1E16"/><ellipse cx="172" cy="96" rx="2.6" ry="3" fill="#2B1E16"/><path d="M152 112 q 8 6 16 0" stroke="#8A4B3A" stroke-width="2.2" fill="none" stroke-linecap="round"/>`;
}

function event(id: string, rnd: () => number): string {
  const hue = ["#5B2A86", "#1E3A8A", "#7C2D5B", "#0F5E63"][Math.floor(rnd() * 4)]!;
  const beams = [60, 130, 200, 270].map((x, i) => `<path d="M${x} 0 L${x - 60 + i * 10} 170 L${x + 60 - i * 10} 170Z" fill="url(#${id}b)" opacity="${(0.35 + rnd() * 0.3).toFixed(2)}"/>`).join("");
  const crowd = Array.from({ length: 26 }, (_, i) => { const x = i * 13 + rnd() * 6, y = 172 + rnd() * 10; return `<circle cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="${(7 + rnd() * 3).toFixed(1)}" fill="#0B0B12"/><rect x="${(x - 9).toFixed(0)}" y="${(y + 5).toFixed(0)}" width="18" height="30" rx="7" fill="#0B0B12"/>`; }).join("");
  const hands = Array.from({ length: 6 }, () => { const x = 20 + rnd() * 280; return `<path d="M${x.toFixed(0)} 176 l 4 -26" stroke="#0B0B12" stroke-width="4" stroke-linecap="round"/>`; }).join("");
  return `<defs><linearGradient id="${id}e" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0E0B1A"/><stop offset="1" stop-color="${hue}"/></linearGradient><linearGradient id="${id}b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFF4D6"/><stop offset="1" stop-color="#FFF4D6" stop-opacity="0"/></linearGradient></defs><rect width="320" height="200" fill="url(#${id}e)"/>${beams}<rect y="150" width="320" height="6" fill="#FFF4D6" opacity=".25"/>${hands}${crowd}`;
}

function learn(id: string, rnd: () => number): string {
  const bg = ["#E6EDF5", "#EFE9DF", "#E7F0EA"][Math.floor(rnd() * 3)]!;
  const slide = ["#3D6B8C", "#5B7F5E", "#C9634B", "#5B4B8A"][Math.floor(rnd() * 4)]!;
  const bars = [0, 1, 2, 3].map((i) => `<rect x="${178 + i * 14}" y="${108 - (10 + rnd() * 26)}" width="9" height="${10 + rnd() * 26}" rx="2" fill="#fff" opacity=".85" transform="translate(0 ${0})"/>`).join("");
  return `<rect width="320" height="200" fill="${bg}"/><rect x="70" y="40" width="180" height="112" rx="8" fill="#2B2D33"/><rect x="78" y="48" width="164" height="96" rx="3" fill="${slide}"/><rect x="92" y="62" width="70" height="8" rx="3" fill="#fff"/><rect x="92" y="78" width="54" height="5" rx="2" fill="#fff" opacity=".6"/><rect x="92" y="88" width="62" height="5" rx="2" fill="#fff" opacity=".6"/><rect x="92" y="98" width="46" height="5" rx="2" fill="#fff" opacity=".6"/>${bars}<path d="M54 152 h 212 l -12 14 h -188z" fill="#C9CCD1"/><circle cx="160" cy="124" r="12" fill="#fff" opacity=".9"/><path d="M156 118 l 10 6 -10 6z" fill="${slide}"/><rect x="262" y="120" width="30" height="40" rx="3" fill="#E9C46A" transform="rotate(8 277 140)"/>`;
}

function car(id: string, rnd: () => number, L: Light): string {
  const paint = ["#C9634B", "#2B2D33", "#3D6B8C", "#E7E2DA", "#5B7F5E", "#B8BCC4"][Math.floor(rnd() * 6)]!;
  return `${sky(id, L, 60 + rnd() * 200, 46, 12)}${clouds(rnd, 2, 0.6)}<path d="M0 140 Q 160 ${120 + rnd() * 10} 320 140 V200 H0Z" fill="${L.hill[1]}" opacity=".6"/><rect y="150" width="320" height="50" fill="#4A4F57"/><path d="M0 176 H320" stroke="#F4F1E8" stroke-width="3" stroke-dasharray="22 16"/><g transform="translate(${70 + rnd() * 40} 0)"><path d="M10 150 q 0 -18 18 -20 l 26 -4 q 18 -22 46 -24 h 34 q 22 2 38 24 l 20 4 q 12 2 12 20 z" fill="${paint}"/><path d="M62 126 q 16 -18 38 -18 h 30 q 16 0 30 18z" fill="#9CC5D8"/><path d="M114 108 v 18" stroke="${paint}" stroke-width="4"/><circle cx="52" cy="152" r="15" fill="#1F2227"/><circle cx="52" cy="152" r="7" fill="#B8BCC4"/><circle cx="168" cy="152" r="15" fill="#1F2227"/><circle cx="168" cy="152" r="7" fill="#B8BCC4"/><rect x="190" y="132" width="10" height="5" rx="2" fill="#FFE9A8"/></g>`;
}

export type SceneLight = "mixed" | "day" | "golden" | "dusk" | "icons";
/** A picture for a card: the scene for its words, as inline SVG (stroke off, sized by its frame), in the theme's light ("mixed" varies it per card), or an icon tile. */
export function scene(item: string, page: string, uid: string, i: number, light: SceneLight = "mixed"): string {
  const kind = light === "icons" ? "tile" : sceneKind(item, page);
  const rnd = seeded(hash(item) + i * 977);
  const L = light === "day" ? LIGHTS.day : light === "golden" ? LIGHTS.gold : light === "dusk" ? LIGHTS.dusk : [LIGHTS.day, LIGHTS.gold, LIGHTS.dusk][(Math.abs(hash(item)) + i) % 3]!;
  const id = `sc${uid}`;
  const body =
    kind === "city" ? city(id, rnd, L) : kind === "coast" ? coast(id, rnd, L) : kind === "mountain" ? mountain(id, rnd, L) : kind === "desert" ? desert(id, rnd, L)
    : kind === "stay" ? stay(id, rnd, L) : kind === "house" ? house(id, rnd, L) : kind === "food" ? food(id, rnd, item) : kind === "product" ? product(id, rnd, item)
    : kind === "person" ? person(id, rnd, item) : kind === "event" ? event(id, rnd) : kind === "learn" ? learn(id, rnd) : kind === "car" ? car(id, rnd, LIGHTS.day)
    : "";
  if (!body) return `<div class="pic tile" aria-hidden="true"><span>${icon(iconFor(`${item} ${page}`) || "layers")}</span></div>`;
  return `<div class="pic" aria-hidden="true"><svg viewBox="0 0 320 200" preserveAspectRatio="xMidYMid slice">${body}</svg></div>`;
}
