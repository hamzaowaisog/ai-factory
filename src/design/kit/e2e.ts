// The Playwright tests the scaffold writes beside the pages (docs/estimates-design.md, "Fidelity and tests"): one file per screen,
// tagged with its requirement ids, that opens every state by address (fixture mode) and checks its blocks and words, and on a
// desktop clicks through its links, layers and messages and finds its form fields by their labels. Chromium at phone, tablet and
// desktop width and WebKit at phone width; dark mode and the other language only when the design has them. Factory-owned: a
// later scaffold writes them again from the design.
import type { z } from "zod";
import type { DesignBody as DesignBodySchema } from "../../contracts/artifacts.js";
import { DEFAULT_THEME } from "../demo.js";
import { VIEWPORTS } from "../screenshots.js";
import { designTokens } from "../tokens.js";
import { expectedFor, samplePath } from "../fidelity-app.js";
import { OWNED_MARK, screenStates, type ScaffoldFile, type ScaffoldScreen } from "./scaffold.js";

type DesignBody = z.infer<typeof DesignBodySchema>;
type Screen = DesignBody["screens"][number];

export const E2E_DIR = "e2e/design";
export const E2E_CONFIG = "playwright.design.config.ts";
/** exact, like the kit's packages (PR #11 review, item 19): a scaffold installs the same versions every time */
export const PLAYWRIGHT_VERSION = "1.63.0";
/** the unit-test runner a fresh app gets for the factory's acceptance tests (greenfield: they live in tests/), pinned the same way */
export const VITEST_VERSION = "5.0.3";
/** where a fresh app's acceptance tests go, and the vitest config that runs only them (not the Playwright design tests) */
export const UNIT_TEST_DIR = "tests";
export const VITEST_CONFIG = "vitest.config.ts";

const q = (s: string): string => JSON.stringify(s);
const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** A route as a pattern for the address bar: its parameters match any one segment. */
const routeRe = (route: string): string => `${esc(samplePath(route)).replace(/sample/g, "[^/?#]+")}(\\?|#|$)`;

function fieldLabels(s: Screen): string[] {
  const out: string[] = [];
  for (const b of s.mock?.blocks ?? []) {
    if (b.type !== "form") continue;
    for (const f of ((b as { fields?: { label?: string; kind?: string }[] }).fields ?? [])) if (f.label && f.kind !== "otp") out.push(f.label);
  }
  return [...new Set(out)];
}

/** A click the tests make: tick the first row of a table first, and look inside a layer. */
export interface Press { label: string; within?: string; tick?: boolean }

/** The clicks that reach a control: a layer's action opens the layer first; a table's bulk action ticks a row first. */
export function pressesFor(s: Screen, label: string): Press[] {
  const m = s.mock!;
  for (const o of m.overlays ?? []) {
    const acts = [...(o.actions ?? []).map((a) => (typeof a === "string" ? a : a.label)), ...(((o as { items?: (string | { label: string })[] }).items ?? []).map((x) => (typeof x === "string" ? x : x.label)))];
    if (acts.includes(label) && o.trigger !== label) return [...pressesFor(s, o.trigger), { label, within: `[data-b="overlay:${o.trigger}"]` }];
  }
  for (const b of m.blocks) {
    const bulk = ((b as { bulk?: (string | { label: string })[] }).bulk ?? []).map((x) => (typeof x === "string" ? x : x.label));
    if (b.type === "table" && bulk.includes(label)) return [{ label, within: `[data-b="table"]`, tick: true }];
  }
  return [{ label }];
}

/** One screen's test file. */
export function screenSpec(s: Screen, x: Pick<ScaffoldScreen, "id" | "route" | "title">, all: Pick<Screen, "id" | "route">[], tag: string): string {
  const m = s.mock!;
  const states = Object.entries(screenStates(s)).map(([slug, st]) => ({
    slug, name: st.name,
    desktop: expectedFor(s, slug, false), phone: expectedFor(s, slug, true),
  }));
  const tags = [`@${x.id}`, ...(((s as { reqs?: string[] }).reqs) ?? []).map((r) => `@${r}`)];
  const path = samplePath(x.route);
  const links = (m.links ?? []).map((l) => ({ from: l.from, to: all.find((a) => a.id === l.to)?.route })).filter((l): l is { from: string; to: string } => !!l.to);
  const overlays = (m.overlays ?? []).map((o) => ({ trigger: o.trigger, presses: pressesFor(s, o.trigger) }));
  const toasts = (m.toasts ?? []).filter((t) => t.after).map((t) => ({ after: t.after!, text: t.text, presses: pressesFor(s, t.after!) }));
  const fields = fieldLabels(s);
  const L: string[] = [
    `// ${OWNED_MARK} from ${tag}.`,
    `// ${x.id} ${x.title} (${x.route}) as approved: every state by address, then its links, layers, messages and form. Written again`,
    `// from the design by each scaffold; change the design, not this file.`,
    `import { expect, test, type Page } from "@playwright/test";`,
    ``,
    `const PATH = ${q(path)};`,
    `const TAGS = ${JSON.stringify(tags)};`,
    `const STATES = ${JSON.stringify(states, null, 2)};`,
    ``,
    `const open = (page: Page, state: string) => page.goto(\`\${PATH}?fixture=${x.id}:\${state}\`);`,
    `const phone = () => test.info().project.name.includes("phone");`,
    `const block = (page: Page, type: string, n: number) => page.locator(\`[data-b="\${type}"]\`).nth(n);`,
    `type Press = { label: string; within?: string; tick?: boolean };`,
    `/** Click a control by its name (a button, tab, menu item or link), inside a layer when it is one's; tick a row first for a bulk action. */`,
    `async function press(page: Page, steps: Press[]) {`,
    `  for (const p of steps) {`,
    `    const scope = p.within ? page.locator(p.within).filter({ visible: true }).first() : page.locator("body");`,
    `    if (p.tick) await scope.locator("tbody [role=checkbox], tbody input[type=checkbox]").filter({ visible: true }).first().click();`,
    `    const name = { name: p.label, exact: true };`,
    `    await scope.getByRole("button", name).or(scope.getByRole("tab", name)).or(scope.getByRole("menuitem", name)).or(scope.getByRole("link", name)).filter({ visible: true }).first().click();`,
    `  }`,
    `}`,
    ``,
    `test.describe(${q(`${x.id} ${x.title}`)}, { tag: TAGS }, () => {`,
    `  for (const s of STATES) {`,
    `    test(\`state \${s.name}\`, async ({ page }) => {`,
    `      await open(page, s.slug);`,
    `      const want = phone() ? s.phone : s.desktop;`,
    `      const main = page.locator("main");`,
    `      for (const w of want.page) await expect(main).toContainText(w);`,
    `      if ("busy" in want && want.busy) await expect(page.locator("[aria-busy=true]").first()).toBeVisible();`,
    `      if ("toast" in want && want.toast) await expect(page.locator("[data-sonner-toast]").filter({ hasText: want.toast }).first()).toBeVisible();`,
    `      const seen: Record<string, number> = {};`,
    `      for (const b of want.blocks) {`,
    `        const n = (seen[b.type] = (seen[b.type] ?? -1) + 1);`,
    `        const el = block(page, b.type, n);`,
    `        await expect(el, \`\${b.type} block\`).toBeVisible();`,
    `        for (const w of b.words) await expect(el, \`\${b.type} shows "\${w}"\`).toContainText(w, { ignoreCase: true, useInnerText: true }).catch(async () => {`,
    `          // a control may name it instead of showing it (an icon button's label, a field's placeholder)`,
    `          // on a phone, actions fold behind the block's "More" menu`,
    `          await expect(el.locator(\`[aria-label="\${w}" i], [placeholder="\${w}" i], [title="\${w}" i]\${phone() ? ", [aria-label=More], [aria-haspopup=menu]" : ""}\`).first(), \`\${b.type} names "\${w}"\`).toBeAttached();`,
    `        });`,
    `      }`,
    `    });`,
    `  }`,
  ];
  if (links.length) L.push(
    ``,
    `  test("links", async ({ page }) => {`,
    `    test.skip(phone(), "clicked through at the larger widths");`,
    `    for (const l of ${JSON.stringify(links.map((l) => ({ from: l.from, to: routeRe(l.to) })))}) {`,
    `      await open(page, "default");`,
    `      await page.getByText(l.from, { exact: true }).filter({ visible: true }).first().click();`,
    `      await expect(page, \`"\${l.from}" opens its page\`).toHaveURL(new RegExp(l.to));`,
    `    }`,
    `  });`,
  );
  if (overlays.length) L.push(
    ``,
    `  test("layers", async ({ page }) => {`,
    `    test.skip(phone(), "clicked through at the larger widths");`,
    `    for (const { trigger, presses } of ${JSON.stringify(overlays)}) {`,
    `      await open(page, "default");`,
    `      await press(page, presses);`,
    `      const layer = page.locator(\`[data-b="overlay:\${trigger}"]\`);`,
    `      await expect(layer, \`"\${trigger}" opens its layer\`).toBeVisible();`,
    `      await page.keyboard.press("Escape");`,
    `      await expect(layer, \`Escape closes the layer of "\${trigger}"\`).toBeHidden();`,
    `    }`,
    `  });`,
  );
  if (toasts.length) L.push(
    ``,
    `  test("messages", async ({ page }) => {`,
    `    test.skip(phone(), "clicked through at the larger widths");`,
    `    for (const t of ${JSON.stringify(toasts)}) {`,
    `      await open(page, "default");`,
    `      await press(page, t.presses);`,
    `      await expect(page.locator("[data-sonner-toast]").filter({ hasText: t.text }).first(), \`"\${t.after}" says "\${t.text}"\`).toBeVisible();`,
    `    }`,
    `  });`,
  );
  if (fields.length) L.push(
    ``,
    `  test("form", async ({ page }) => {`,
    `    await open(page, "default");`,
    `    // a required field's label ends in its mark (*)`,
    `    for (const f of ${JSON.stringify(fields.map((label) => ({ label, re: `^${esc(label)}\\s*\\*?$` })))}) await expect(page.locator("main").getByLabel(new RegExp(f.re)).filter({ visible: true }).first(), \`a field labelled "\${f.label}"\`).toBeVisible();`,
    `  });`,
  );
  L.push(`});`, ``);
  return L.join("\n");
}

/** The test config: Chromium at the three widths, WebKit at phone width (DESIGN_BROWSERS=chromium leaves it out), dark and language when designed. */
export function e2eConfig(o: { tag: string; next: boolean; dark: boolean }): string {
  const vp = (k: keyof typeof VIEWPORTS) => `{ width: ${VIEWPORTS[k].width}, height: ${VIEWPORTS[k].height} }`;
  const port = 3100;
  const start = o.next ? `npm run build && npx next start -p ${port}` : `npm run build && npx vite preview --port ${port} --strictPort`;
  return [
    `// ${OWNED_MARK} from ${o.tag}.`,
    `// The approved design's tests (${E2E_DIR}): npx playwright test -c ${E2E_CONFIG}. Set DESIGN_BASE_URL to test a running app,`,
    `// DESIGN_BROWSERS=chromium to leave WebKit out, DESIGN_CHANNEL=chrome to use the installed Chrome.`,
    `import { defineConfig } from "@playwright/test";`,
    ``,
    `const base = process.env.DESIGN_BASE_URL;`,
    `const browsers = (process.env.DESIGN_BROWSERS ?? "chromium,webkit").split(",");`,
    `const channel = process.env.DESIGN_CHANNEL || undefined;`,
    `const chromium = (name: string, viewport: { width: number; height: number }, extra: object = {}) => ({ name, use: { browserName: "chromium" as const, channel, viewport, ...extra } });`,
    ``,
    `export default defineConfig({`,
    `  testDir: ${q(`./${E2E_DIR}`)},`,
    `  fullyParallel: true,`,
    `  reporter: process.env.CI ? [["list"], ["json", { outputFile: "test-results/design.json" }]] : "list",`,
    `  use: { baseURL: base ?? "http://127.0.0.1:${port}", reducedMotion: "reduce", locale: "en-US", timezoneId: "UTC" },`,
    `  projects: [`,
    `    chromium("phone", ${vp("phone")}, { isMobile: true, hasTouch: true }),`,
    `    chromium("tablet", ${vp("tablet")}),`,
    `    chromium("desktop", ${vp("desktop")}),`,
    ...(o.dark ? [`    chromium("desktop-dark", ${vp("desktop")}, { colorScheme: "dark" }),`] : []),
    `    ...(browsers.includes("webkit") ? [{ name: "webkit-phone", use: { browserName: "webkit" as const, viewport: ${vp("phone")}, isMobile: true, hasTouch: true } }] : []),`,
    `  ],`,
    `  webServer: base ? undefined : { command: ${q(start)}, url: "http://127.0.0.1:${port}", reuseExistingServer: true, timeout: 600_000 },`,
    `});`,
    ``,
  ].join("\n");
}

/** The test files for the screens written (all, or a change request's), and the config. */
export function e2eFiles(o: { design: Pick<DesignBody, "screens" | "theme" | "locale">; screens: ScaffoldScreen[]; write: (id: string) => boolean; tag: string; next: boolean }): ScaffoldFile[] {
  const dark = !!o.design.theme && Object.keys(designTokens({ ...DEFAULT_THEME, ...o.design.theme }).colour).length > 1;
  const files: ScaffoldFile[] = [];
  for (const x of o.screens) {
    const s = o.design.screens.find((d) => d.id === x.id);
    if (!s?.mock || !o.write(x.id)) continue;
    files.push({ path: `${E2E_DIR}/${x.id.toLowerCase()}.spec.ts`, text: screenSpec(s, x, o.design.screens, o.tag), owner: "glue", regenerate: true });
  }
  if (o.screens.length) files.push({ path: E2E_CONFIG, text: e2eConfig({ tag: o.tag, next: o.next, dark }), owner: "glue", regenerate: true });
  return files;
}
