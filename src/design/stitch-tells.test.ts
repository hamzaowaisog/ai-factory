import { describe, expect, it } from "vitest";
import { stitchTells } from "./stitch-tells.js";

const moving = `<html><head><style>@keyframes rise{from{opacity:0}to{opacity:1}} @media (prefers-reduced-motion: reduce){*{animation:none}}</style></head>
<body><button class="transition hover:bg-zinc-100">Claim space</button><a class="transition-colors">Profile</a><div class="transition-transform">BKX-482</div></body></html>`;
const ids = (html: string) => stitchTells(html).map((t) => t.id);

describe("a page that left the design system", () => {
  const look = { canvas: "#F5F7F6", surface: "#FFFFFF", ink: "#222927", accent: "#A95540", heading: "Hanken Grotesk", body: "Source Sans 3", mono: "IBM Plex Mono" };
  const own = moving.replace("<body>", `<link href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk&family=Source+Sans+3&family=IBM+Plex+Mono"><body style="background:#f5f7f6"><button style="background:#A95540">Save</button>`);
  it("is clean when the page uses the system's background, accent and fonts", () => {
    expect(stitchTells(own, look)).toEqual([]);
    // with no look to check against, the page is not checked for it
    expect(stitchTells(moving)).toEqual([]);
  });
  it("is told the exact values it left: Stitch's tinted background and darkened accent, another font", () => {
    const off = stitchTells(own.replace("#f5f7f6", "#fff8f6").replace("#A95540", "#8b3e2a").replace("Source+Sans+3", "Public+Sans").replace("IBM+Plex+Mono", "JetBrains+Mono"), look);
    expect(off.map((t) => t.id)).toEqual(["off-look"]);
    expect(off[0]!.fix).toContain("the page background is #F5F7F6 on the body");
    expect(off[0]!.fix).toContain("primary buttons and the selected menu item are #A95540");
    expect(off[0]!.fix).toContain("all other text in Source Sans 3");
    expect(off[0]!.fix).toContain("in IBM Plex Mono, not JetBrains Mono");
  });
});

describe("what gives a Stitch page away, read from its HTML", () => {
  it("finds nothing on a page with motion, a reduced-motion rule and real copy", () => {
    expect(stitchTells(moving)).toEqual([]);
  });

  it("names a still page, and a missing reduced-motion rule only as a soft tell", () => {
    const still = stitchTells("<html><body><button>Claim space</button></body></html>");
    expect(still.map((t) => `${t.id}${t.soft ? " soft" : ""}`)).toEqual(["static", "reduced-motion soft"]);
  });

  it("names bouncing, blobs, placeholder copy, clichés and emojis, and reads copy only where a person would", () => {
    expect(ids(moving.replace("Claim space", "Claim space <i class='animate-bounce'></i>"))).toEqual(["bounce"]);
    expect(ids(moving.replace("<body>", "<body><div class='absolute blur-3xl'></div>"))).toEqual(["blob"]);
    expect(ids(moving.replace("BKX-482", "John Doe"))).toEqual(["placeholder"]);
    expect(ids(moving.replace("Profile", "Seamless parking"))).toEqual(["cliche"]);
    expect(ids(moving.replace("Profile", "Profile \u{1F680}"))).toEqual(["emoji"]);
    // a page dressed as a console: build numbers, protocol and node names, the briefing's own words
    for (const w of ["Build 4.19.2", "Identity Protocol v2.4", "Operations Node ID: FL3-PRK-882", "Tabular numerals verified"]) expect(ids(moving.replace("Profile", w))).toEqual(["console"]);
    for (const w of ["Registry V2.4", "12-col ledger"]) expect(ids(moving.replace("Profile", w))).toEqual(["console"]);
    expect(ids(moving.replace("Profile", "API v2.4 released"))).toEqual([]);
    expect(ids(moving.replace("Profile", "Build your route"))).toEqual([]);
    expect(ids(moving.replace("<body>", "<body><script>var acme = 'lorem ipsum'</script>"))).toEqual([]);
  });
});
