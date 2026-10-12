import { describe, expect, it } from "vitest";
import { stitchTells } from "./stitch-tells.js";

const moving = `<html><head><style>@keyframes rise{from{opacity:0}to{opacity:1}} @media (prefers-reduced-motion: reduce){*{animation:none}}</style></head>
<body><button class="transition hover:bg-zinc-100">Claim space</button><a class="transition-colors">Profile</a><div class="transition-transform">BKX-482</div></body></html>`;
const ids = (html: string) => stitchTells(html).map((t) => t.id);

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
    expect(ids(moving.replace("<body>", "<body><script>var acme = 'lorem ipsum'</script>"))).toEqual([]);
  });
});
