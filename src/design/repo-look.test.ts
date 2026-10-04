// An existing app is drawn in its own look (PR #11 review, item 6): its pages are found in Vite, Vue and Angular repos too,
// its look is read from its stylesheets, and the approval card shows each page it changes beside the proposed screen.
import { describe, expect, it } from "vitest";
import { buildInventory, hasExistingLook } from "./inventory.js";
import { repoLook, toHex } from "./repo-look.js";
import type { FileSource } from "./source.js";
import { currentPages, designCard } from "../stages/design-approve.js";

const mem = (m: Record<string, string>): FileSource => ({ list: () => Object.keys(m), read: (p) => m[p] });
const pkg = (deps: Record<string, string>) => JSON.stringify({ dependencies: deps });

describe("colours in the forms stylesheets use", () => {
  it("reads hex, rgb, hsl, oklch and shadcn/ui's bare channels", () => {
    expect(toHex("#1A56DB")).toBe("#1a56db");
    expect(toHex("#fff")).toBe("#ffffff");
    expect(toHex("rgb(26, 86, 219)")).toBe("#1a56db");
    expect(toHex("hsl(0 100% 50%)")).toBe("#ff0000");
    expect(toHex("221.2 83.2% 53.3%")).toBe("#2563eb"); // shadcn/ui v3's blue primary
    expect(toHex("oklch(0.628 0.2577 29.23)")).toBe("#ff0000");
    expect(toHex("oklch(1 0 0)")).toBe("#ffffff");
    expect(toHex("var(--x)")).toBeUndefined();
  });
});

describe("the existing app's look", () => {
  it("takes the brand, light or dark, corners and type from the stylesheets; a coloured accent beats a grey primary", () => {
    const look = repoLook(mem({
      "src/index.css": `:root { --primary: oklch(0.205 0 0); --accent: #e11d48; --background: #0b0b0f; --radius: 0.25rem; }\nbody { font-family: "Nunito", sans-serif; }`,
    }))!;
    expect(look.theme).toMatchObject({ brand: "#e11d48", mode: "dark", radius: "soft", font: "rounded", fx: "quiet" });
    expect(look.from[0]).toContain("--accent");
  });

  it("reads SCSS variables, and gives no look when no brand colour is named", () => {
    expect(repoLook(mem({ "src/styles.scss": "$primary: #0f766e !default;\n$border-radius: 2px;" }))!.theme).toMatchObject({ brand: "#0f766e", mode: "light" });
    expect(repoLook(mem({ "src/styles.css": "body { margin: 0 }" }))).toBeUndefined();
  });
});

describe("a look set in JS: Tailwind config, MUI, antd, Chakra (PR #11 re-review, item 6)", () => {
  it("reads a Tailwind config's colours, corners and font", () => {
    const look = repoLook(mem({
      "tailwind.config.ts": `export default { theme: { extend: { colors: { brand: { 50: "#eef2ff", 500: "#4f46e5", 900: "#312e81" }, background: "#ffffff" },
        borderRadius: { lg: "1rem" }, fontFamily: { sans: ["Nunito", "sans-serif"] } } } }`,
    }))!;
    expect(look.theme).toMatchObject({ brand: "#4f46e5", mode: "light", radius: "round", font: "rounded" });
    expect(look.from[0]).toBe("brand #4f46e5 (brand in a JS theme, tailwind.config.ts)");
  });
  it("reads an MUI theme, dark mode included", () => {
    const look = repoLook(mem({
      "src/theme.ts": `import { createTheme } from "@mui/material/styles";
        export const theme = createTheme({ palette: { mode: "dark", primary: { light: "#63a4ff", main: "#1976d2" } }, shape: { borderRadius: 2 }, typography: { fontFamily: "Roboto, Arial, sans-serif" } });`,
    }))!;
    expect(look.theme).toMatchObject({ brand: "#1976d2", mode: "dark", radius: "sharp" });
    expect(look.from).toContain("dark (the JS theme's dark mode)");
  });
  it("reads an antd ConfigProvider token and a Chakra scale", () => {
    expect(repoLook(mem({ "src/App.tsx": `<ConfigProvider theme={{ token: { colorPrimary: "#00b96b", borderRadius: 6, colorBgLayout: "#f5f5f5" } }}>` }))!.theme)
      .toMatchObject({ brand: "#00b96b", mode: "light", radius: "soft" });
    expect(repoLook(mem({ "src/theme/index.ts": `extendTheme({ colors: { brand: { 100: "#f7fafc", 500: "#e53e3e" } } })` }))!.theme.brand).toBe("#e53e3e");
  });
  it("lets the stylesheets win, skips colours it cannot read, and never reads node_modules", () => {
    const look = repoLook(mem({
      "src/index.css": ":root { --primary: #0f766e; }",
      "tailwind.config.js": `module.exports = { theme: { extend: { colors: { primary: "hsl(var(--primary))", accent: "#f59e0b" } } } }`,
      "node_modules/x/theme.js": `createTheme({ palette: { primary: { main: "#ff0000" } } })`,
    }))!;
    expect(look.theme.brand).toBe("#0f766e");
    expect(look.theme.accent).toBe("#f59e0b");
    expect(repoLook(mem({ "node_modules/x/theme.js": `createTheme({ palette: { primary: { main: "#ff0000" } } })` }))).toBeUndefined();
  });
});

describe("pages of a Vite, Vue or Angular app", () => {
  it("finds a Vite + React app's src/pages, so it has a look of its own to keep", () => {
    const inv = buildInventory(mem({
      "package.json": pkg({ vite: "7", react: "19", tailwindcss: "4" }),
      "src/pages/Invoices.tsx": "export default function Invoices() { return <Table /> }",
      "src/pages/InvoiceDetailPage.tsx": "", "src/pages/components/Row.tsx": "",
      "src/index.css": ":root { --primary: #1a56db; }",
    }));
    expect(inv.pages.map((p) => [p.kind, p.route])).toEqual([["pages-folder", "/invoices"], ["pages-folder", "/invoice-detail"]]);
    expect(inv.look?.theme.brand).toBe("#1a56db");
    expect(hasExistingLook(inv)).toBe(true);
  });

  it("finds a Vue app's views and an Angular app's routed components", () => {
    const vue = buildInventory(mem({ "package.json": pkg({ vue: "3", vuetify: "3" }), "src/views/HomeView.vue": "", "src/views/Settings.vue": "" }));
    expect(vue.layout.framework).toBe("vue");
    expect(vue.stack.componentSystem).toBe("vuetify");
    expect(vue.pages.map((p) => p.route).sort()).toEqual(["/home", "/settings"]);
    expect(hasExistingLook(vue)).toBe(true);
    const ng = buildInventory(mem({
      "package.json": pkg({ "@angular/core": "20", "@angular/material": "20" }),
      "src/app/app.routes.ts": "export const routes = [{ path: 'invoices', component: InvoiceListComponent }, { path: 'invoices/:id', component: InvoiceDetailComponent }];",
      "src/app/invoices/invoice-list.component.ts": "export class InvoiceListComponent {}",
      "src/app/invoices/invoice-list.component.html": "<mat-toolbar></mat-toolbar><mat-table></mat-table>",
      "src/app/invoices/invoice-detail.component.ts": "export class InvoiceDetailComponent {}",
      "src/styles.scss": "$primary: #3f51b5;",
    }));
    expect(ng.stack.componentSystem).toBe("angular-material");
    expect(ng.pages.map((p) => [p.route, p.path])).toEqual([["/invoices", "src/app/invoices/invoice-list.component.ts"], ["/invoices/:id", "src/app/invoices/invoice-detail.component.ts"]]);
    expect(ng.pages[0]!.layout).toEqual(["mat-toolbar", "mat-table"]);
    expect(ng.look?.theme.brand).toBe("#3f51b5");
    expect(hasExistingLook(ng)).toBe(true);
  });
});

describe("current vs proposed on the approval card", () => {
  const design = {
    flow: "list then detail", themeSource: "repo", mapping: { unmappedReqs: [], orphanScreens: [] },
    screens: [
      { id: "S-1", route: "/invoices", file: "src/pages/Invoices.tsx", reqs: ["R-1"], size: "tweak", mock: { title: "Invoices", blocks: [{ type: "filters" }, { type: "table" }] } },
      { id: "S-2", route: "/reports", file: "src/pages/Reports.tsx", reqs: ["R-2"], size: "new", mock: { title: "Reports", blocks: [{ type: "chart" }] } },
    ],
  } as never;

  it("puts each page the design changes beside the proposed screen, with the look the demo was drawn in", () => {
    const cur = currentPages(design, { pages: [{ path: "src/pages/Invoices.tsx", kind: "pages-folder", route: "/invoices", layout: ["Table", "Button"], heading: null }] });
    expect(cur).toEqual([{ screen: "S-1", title: "Invoices", size: "tweak", route: "/invoices", file: "src/pages/Invoices.tsx", found: true, uses: ["Table", "Button"], proposed: ["filters", "table"] }]);
    const md = designCard("run-1", design, "a".repeat(64), { current: cur, look: ["brand #1a56db (--primary, src/index.css)"] });
    expect(md).toContain("## Current vs proposed");
    expect(md).toContain("Drawn in the app's own look, read from its styles and theme: brand #1a56db");
    expect(md).toContain("- Invoices: S-1 (tweak). Current: src/pages/Invoices.tsx at /invoices, built from Table, Button. Proposed: the demo's S-1 (filters, table).");
    expect(currentPages(design, { pages: [] })[0]).toMatchObject({ found: false });
  });
});
