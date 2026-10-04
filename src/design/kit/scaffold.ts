// The scaffold (docs/estimates-design.md, "Kit and scaffold"): the approved design as code in the repo's stack before any agent
// starts. A pure function from the design to files, so the plan knows every path before the stub commit writes them.
//
//   <root>components/ui, blocks, frame, lib     the kit (written when absent; the repo owns it after)
//   <theme>                                      the approved look as a shadcn theme (factory-owned)
//   <root>components/screens/<s-id>/screen.tsx   the page as approved: its blocks, states, layers, messages and links (factory-owned)
//   <root>components/screens/<s-id>/fixtures.ts  the approved sample data, the shape the real data must take (factory-owned)
//   <root>components/screens/<s-id>/container.tsx the page with real data and behaviour: the implement task's file (written when absent)
//   a route per screen (Next: app/<route>/page.tsx; Vite: design-routes.tsx), the frame and its navigation, the translations
//   a fresh app's skeleton (package.json, config, layout) when the repo has none
//
// Every page opens in any state without a backend: ?fixture=S-3:empty (fixture mode), the states the demo showed.
import type { DesignBody as DesignBodySchema } from "../../contracts/artifacts.js";
import type { z } from "zod";

type DesignBody = z.infer<typeof DesignBodySchema>;
import { demoStates, overlayLabel, toastLabel, FULL_DATA } from "../demo.js";
import type { FileSource } from "../source.js";
import { shadcnThemeCss } from "./theme.js";
import { E2E_CONFIG, E2E_DIR, PLAYWRIGHT_VERSION, UNIT_TEST_DIR, VITEST_CONFIG, VITEST_VERSION, e2eFiles } from "./e2e.js";
import { kitFiles, kitTarget, type Kit, type KitTarget } from "./kit.js";

/** The first line of every file the factory owns: a later scaffold may write it again; anything without it is the repo's. */
export const OWNED_MARK = "Written by ai-factory";

export type ScaffoldOwner = "kit" | "theme" | "screen" | "glue" | "app";
export interface ScaffoldFile {
  path: string; text: string; owner: ScaffoldOwner;
  /** written again by a later scaffold (factory-owned), or only when absent (the repo's once written) */
  regenerate: boolean;
}
export interface ScaffoldScreen {
  id: string; title: string; route: string; app?: string;
  /** the page component (screen.tsx's export) and the container the implement task fills in */
  component: string; container: string; containerName: string;
  screen: string; fixtures: string;
  /** the route file (Next) or the route list (Vite) */
  page: string;
  /** the state names in the address (fixture mode), slug to the demo's name */
  states: Record<string, string>;
}
/** A screen an existing app already has (tweak, reuse, design-system): changed in its own page file, not generated. */
export interface InPlaceScreen { id: string; title: string; route: string; size: string; file?: string }
export interface ScaffoldLayout {
  target: KitTarget; kit: { id: string; version: string }; root: string; fresh: boolean;
  /** an existing app's screens that are built in its own page files (the kit is only for its new screens) */
  inPlace: InPlaceScreen[];
  files: ScaffoldFile[];
  /** files the scaffold would have written but the repo already has its own (kept; the design-system task reconciles them) */
  kept: string[];
  screens: ScaffoldScreen[];
  /** screens the design no longer has (a change request): their files stay for the task that removes them */
  removed: string[];
  /** the first task: the stylesheet, the packages, the layout */
  designSystem: { files: string[]; todo: string[] };
  /** every file the implement tasks must not change (the kit as written, the theme, the pages as approved, the glue) */
  protected: string[];
  notes: string[];
}

export interface ScaffoldInput {
  design: Pick<DesignBody, "screens" | "apps" | "theme" | "locale" | "themeSource" | "switcher">;
  kit: Kit; target: KitTarget;
  product: string;
  /** the approved design's tag (designTag): the line every generated file starts with */
  tag: string;
  /** the repo at its base commit; absent or without package.json, a fresh app is written */
  src?: FileSource;
  root?: string; alias?: boolean;
  /** a change request: only these screens' pages are written again; the rest are the repo's as built */
  changed?: string[];
  removed?: string[];
  /** the app ids built with the kit (a phone app is not); absent: every app */
  apps?: string[];
}

const pascal = (s: string): string => s.normalize("NFKD").replace(/[^A-Za-z0-9 ]+/g, " ").split(/\s+/).filter(Boolean).map((w) => w[0]!.toUpperCase() + w.slice(1)).join("").replace(/^\d+/, "") || "Page";
const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "default";
const lit = (v: unknown): string => JSON.stringify(v, null, 2);
const q = (s: string): string => JSON.stringify(s);

/** A design route as the Next.js App Router folder: "/accounts/:id" is app/accounts/[id]. Undefined when it cannot be one. */
export function nextRouteDir(route: string): string | undefined {
  const path = route.split(/[?#]/)[0]!.replace(/\/+$/, "");
  const segs = path.split("/").filter(Boolean).map((s) => (s.startsWith(":") ? `[${s.slice(1)}]` : s));
  if (segs.some((s) => !/^(\[[A-Za-z_]\w*\]|[A-Za-z0-9._~-]+)$/.test(s))) return undefined;
  return segs.join("/");
}
/** A design route for React Router ("/accounts/[id]" written either way). */
export const routerPath = (route: string): string => (route.split(/[?#]/)[0]!.replace(/\[([^\]]+)\]/g, ":$1").replace(/\/+$/, "") || "/");

/** The states a screen opens in by address: the slug, and the demo's name (its layer, its message, its full data). */
export function screenStates(s: DesignBody["screens"][number]): Record<string, { name: string; overlay?: number; toast?: number; full?: boolean }> {
  const out: Record<string, { name: string; overlay?: number; toast?: number; full?: boolean }> = {};
  const overlays = (s.mock?.overlays ?? []).map(overlayLabel), toasts = (s.mock?.toasts ?? []).map(toastLabel);
  for (const name of demoStates(s)) {
    const o = overlays.indexOf(name), t = toasts.indexOf(name);
    out[slug(name)] = { name, ...(o >= 0 ? { overlay: o } : {}), ...(t >= 0 ? { toast: t } : {}), ...(name === FULL_DATA ? { full: true } : {}) };
  }
  return out;
}

const header = (tag: string, what: string): string => `// ${OWNED_MARK} from ${tag}.\n// ${what}\n`;

/** The scaffold for a design: every file, and what each task gets. Pure: reads the repo through `src` only. */
export function scaffold(o: ScaffoldInput): ScaffoldLayout {
  const t = kitTarget(o.kit, o.target);
  const next = t.framework === "next";
  const fresh = !o.src?.read("package.json");
  const root = o.root ?? t.root;
  const alias = fresh ? true : !!o.alias;
  const at = (p: string) => `${root}${p}`;
  const imp = (p: string, from: string) => {
    if (alias) return `@/${p}`;
    const a = from.split("/").slice(0, -1), b = at(p).split("/");
    while (a.length && b.length && a[0] === b[0]) { a.shift(); b.shift(); }
    const rel = [...a.map(() => ".."), ...b].join("/");
    return rel.startsWith(".") ? rel : `./${rel}`;
  };
  const use = next ? `"use client";\n\n` : "";
  const files: ScaffoldFile[] = [];
  const notes: string[] = [];
  // a later file takes an earlier one's place (the scaffold's translations over the kit's empty ones)
  const add = (path: string, text: string, owner: ScaffoldOwner, regenerate: boolean) => {
    const i = files.findIndex((f) => f.path === path);
    if (i >= 0) files.splice(i, 1);
    files.push({ path, text, owner, regenerate });
  };

  // the kit
  for (const f of kitFiles(o.kit, o.target, { root, alias })) add(f.path, f.text, "kit", false);

  // the look: the design's own, or none when the repo's look stays
  const look = o.design.theme && o.design.themeSource !== "repo";
  const themePath = at(t.theme);
  if (look) add(themePath, shadcnThemeCss(o.design.theme!, o.tag), "theme", true);
  else notes.push("the repo's own look stays: no theme written; the kit draws with the repo's shadcn variables");

  // the apps built with the kit and their screens
  const allApps = o.design.apps?.length ? o.design.apps : [{ id: "", name: o.product, device: "web" as const, shell: o.design.theme?.shell ?? "auto", switcher: o.design.switcher }];
  const kitApps = allApps.filter((a) => a.device !== "phone" && (!o.apps || o.apps.includes(a.id)));
  const inApp = (s: DesignBody["screens"][number], a: { id: string }) => allApps.length < 2 || s.app === a.id || ((!s.app || !allApps.some((x) => x.id === s.app)) && a.id === allApps[0]!.id);
  const drawn = o.design.screens.filter((s) => s.mock && kitApps.some((a) => inApp(s, a)));
  // an existing app: a screen it already has (tweak, reuse, a design-system change) is changed in its own page file, as designed;
  // only a new screen is generated with the kit
  const inPlace: InPlaceScreen[] = fresh ? [] : drawn.filter((s) => s.size && s.size !== "new").map((s) => ({ id: s.id, title: s.mock!.title, route: s.route, size: s.size!, ...(s.file ? { file: s.file } : {}) }));
  const screens = drawn.filter((s) => !inPlace.some((x) => x.id === s.id));
  const skipped = o.design.screens.filter((s) => !drawn.includes(s));
  if (skipped.length) notes.push(`not scaffolded (no page drawn, or a phone app): ${skipped.map((s) => s.id).join(", ")}`);
  if (inPlace.length) notes.push(`changed in the app's own pages, not generated: ${inPlace.map((x) => `${x.id} (${x.size}${x.file ? `, ${x.file}` : ""})`).join(", ")}`);
  if (!fresh && !screens.length) {
    notes.push("no new screens: nothing is generated, the kit and theme are not added");
    return { target: o.target, kit: { id: o.kit.manifest.id, version: o.kit.manifest.version }, root, fresh, inPlace, files: [], kept: [], screens: [], removed: o.removed ?? [], designSystem: { files: [], todo: [] }, protected: [], notes };
  }

  const names = new Set<string>();
  const routes = new Set<string>();
  const out: ScaffoldScreen[] = [];
  const changed = o.changed ? new Set(o.changed.map((x) => x.toLowerCase())) : undefined;
  for (const s of screens) {
    const m = s.mock!;
    let base = pascal(m.title);
    if (names.has(base)) base += pascal(s.id);
    names.add(base);
    const dir = at(`components/screens/${s.id.toLowerCase()}`);
    const screenPath = `${dir}/screen.tsx`, fixturesPath = `${dir}/fixtures.ts`, containerPath = `${dir}/container.tsx`;
    const routeDir = next ? nextRouteDir(s.route) : routerPath(s.route);
    let page = next ? at(`app/${routeDir ? `${routeDir}/` : ""}page.tsx`) : at("design-routes.tsx");
    const key = next ? routeDir : routerPath(s.route);
    if (key === undefined || routes.has(key)) {
      notes.push(`${s.id}: route ${s.route} ${key === undefined ? "is not a path the app can serve" : "is another page's"}; its page is not routed (the design-system task routes it)`);
      page = "";
    } else routes.add(key);
    const states = screenStates(s);
    const comp = `${base}Screen`, cont = `${base}Container`;
    out.push({ id: s.id, title: m.title, route: s.route, ...(s.app ? { app: s.app } : {}), component: comp, container: containerPath, containerName: cont, screen: screenPath, fixtures: fixturesPath, page, states: Object.fromEntries(Object.entries(states).map(([k, v]) => [k, v.name])) });
    const write = !changed || changed.has(s.id.toLowerCase());
    if (!write) continue;

    // the approved sample data, in the shape the real data must take
    const dataType = (type: string) => `${pascal(type)}Data`;
    const blocks = m.blocks.map(({ type, ...rest }) => ({ type, rest }));
    const used = [...new Set(blocks.map((b) => dataType(b.type)))].sort();
    const full = s.mockFull?.blocks ?? [];
    const overlayBlocks = (m.overlays ?? []).map((x) => x.blocks ?? []);
    add(fixturesPath, [
      header(o.tag, `${s.id} ${m.title}: the approved sample data. The container passes real data in the same shape.`),
      `import type { Block, ${used.join(", ")} } from "${imp("components/blocks/types", fixturesPath)}";`,
      ``,
      `/** Each block's data, as the lead approved it (${blocks.map((b, i) => `b${i} ${b.type}`).join(", ")}). */`,
      `export const fixture = {`,
      ...blocks.map((b, i) => `  b${i}: ${lit(b.rest).replace(/\n/g, "\n  ")} satisfies ${dataType(b.type)},`),
      `};`,
      `export type ScreenData = typeof fixture;`,
      ``,
      `/** The dense sample data of the "${FULL_DATA}" state. */`,
      `export const full: Block[] = ${lit(full)};`,
      ``,
      `/** What each layer shows inside, by its index in the page's layers. */`,
      `export const overlayBlocks: Block[][] = ${lit(overlayBlocks)};`,
      ``,
    ].join("\n"), "screen", true);

    // the page as approved
    const spec = {
      id: s.id, title: m.title, ...(m.subtitle ? { subtitle: m.subtitle } : {}), ...(m.badge ? { badge: m.badge } : {}), ...(m.crumbs ? { crumbs: m.crumbs } : {}), ...(m.tabs ? { tabs: m.tabs } : {}),
      ...(Object.keys(m.copy ?? {}).length ? { copy: m.copy } : {}),
      ...(m.links?.length ? { links: m.links.map((l) => ({ from: l.from, to: o.design.screens.find((x) => x.id === l.to)?.route ?? l.to })) } : {}),
      ...(m.overlays?.length ? { overlays: m.overlays.map(({ blocks: _b, ...x }) => x) } : {}),
      ...(m.toasts?.length ? { toasts: m.toasts } : {}),
      states,
    };
    const comps = [...new Set(blocks.map((b) => o.kit.manifest.blocks[b.type]?.component ?? "BlockView"))].sort();
    add(screenPath, [
      `${use}${header(o.tag, `${s.id} ${m.title} (${s.route}) as approved: its blocks, states, layers, messages and links. Do not restyle it here: change the design.`)}`,
      `import type { ReactNode } from "react";`,
      `import { BlockView, ${comps.filter((c) => c !== "BlockView").join(", ")} } from "${imp("components/blocks", screenPath)}";`,
      `import { ScreenShell, type Act, type ScreenSpec } from "${imp("components/frame/screen-shell", screenPath)}";`,
      `import { fixture, full, overlayBlocks, type ScreenData } from "./fixtures";`,
      ``,
      `export const SPEC: ScreenSpec = ${lit(spec)};`,
      ``,
      `export interface ${comp}Props {`,
      `  /** the page's data, in the fixtures' shape (default: the approved sample data) */`,
      `  data?: ScreenData;`,
      `  /** a state name from SPEC.states ("default", "empty", "error", ...) */`,
      `  state?: string;`,
      `  /** every button, row, card, menu entry and layer action pressed, by its label, after the page has opened its layer, shown its message or followed its link */`,
      `  onAction?: (label: string) => void;`,
      `  /** what a layer shows inside, by its index in SPEC.overlays (default: the approved sample) */`,
      `  overlayBody?: (index: number, act: Act) => ReactNode;`,
      `}`,
      ``,
      `export function ${comp}({ data = fixture, state = "default", onAction, overlayBody }: ${comp}Props) {`,
      `  const body = overlayBody ?? ((i: number, act: Act) => overlayBlocks[i]?.map((b, k) => <BlockView key={k} block={b} mark={b.type} onAction={act} />));`,
      `  return (`,
      `    <ScreenShell spec={SPEC} state={state} onAction={onAction} overlayBody={body}>`,
      `      {(act, invalid) => SPEC.states?.[state]?.full`,
      `        ? full.map((b, k) => <BlockView key={k} block={b} mark={b.type} onAction={act} invalid={invalid} />)`,
      `        : (`,
      `          <>`,
      ...blocks.map((b, i) => `            <${o.kit.manifest.blocks[b.type]?.component ?? "BlockView"} mark=${q(b.type)} {...data.b${i}} onAction={act} invalid={invalid} />`),
      `          </>`,
      `        )}`,
      `    </ScreenShell>`,
      `  );`,
      `}`,
      ``,
    ].join("\n"), "screen", true);

    // the implement task's file: real data and behaviour, the look left to screen.tsx
    add(containerPath, [
      `${use}// ${s.id} ${m.title} (${s.route}): the approved page with the app's data and behaviour.`,
      `// The look is screen.tsx (the approved design, not edited here); this file loads the data in the fixtures' shape,`,
      `// handles the page's actions, and shows the states (loading, empty, error) the design drew.`,
      `import { ${comp} } from "./screen";`,
      ``,
      `export function ${cont}({ fixture }: { fixture?: string }) {`,
      `  // fixture mode (?fixture=${s.id}:<state>): the approved sample data in that state, no backend`,
      `  if (fixture) return <${comp} state={fixture} />;`,
      `  return <${comp} />;`,
      `}`,
      ``,
    ].join("\n"), "app", false);

    if (next && page) {
      add(page, [
        `// ${s.id} ${m.title}: the route. The page itself is the container.`,
        `import { ${cont} } from "${imp(`components/screens/${s.id.toLowerCase()}/container`, page)}";`,
        `import { fixtureState } from "${imp("lib/fixture", page)}";`,
        ``,
        `export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {`,
        `  const { fixture } = await searchParams;`,
        `  return <${cont} fixture={fixtureState(typeof fixture === "string" ? fixture : undefined, ${q(s.id)})} />;`,
        `}`,
        ``,
      ].join("\n"), "app", false);
    }
  }

  // the frame: each app's navigation (its pages without a record id, in their groups)
  const frameApps = kitApps.map((a) => {
    const own = out.filter((x) => inApp(o.design.screens.find((s) => s.id === x.id)!, a));
    const nav = own.filter((x) => !/[:[]/.test(x.route)).map((x) => ({ label: x.title, route: routerPath(x.route), ...(o.design.screens.find((s) => s.id === x.id)?.group ? { group: o.design.screens.find((s) => s.id === x.id)!.group } : {}) }));
    const shellOf = (): string => {
      if (a.shell && a.shell !== "auto") return a.shell;
      const tool = own.filter((x) => o.design.screens.find((s) => s.id === x.id)?.mock?.blocks.some((b) => b.type === "table" || b.type === "stats")).length;
      return own.length > 0 && tool * 2 >= own.length ? "sidebar" : "topbar";
    };
    const sw = "switcher" in a && a.switcher ? a.switcher : kitApps.length < 2 ? o.design.switcher : undefined;
    return { id: a.id || "app", name: a.name, shell: shellOf(), nav, ...(sw ? { switcher: sw } : {}), routes: own.map((x) => routerPath(x.route)) };
  });
  const lang = o.design.locale?.languages[0] ?? "en";
  const framePath = at("components/screens/frame.ts");
  const providersPath = at("components/screens/providers.tsx");
  // an existing app keeps its own layout and navigation: no frame around it, its new pages are linked from its own
  if (fresh) {
  add(framePath, [
    header(o.tag, "The product's frame: each app, its navigation and its switcher."),
    `import type { FrameApp } from "${imp("components/frame/app-frame", framePath)}";`,
    ``,
    `export const PRODUCT = ${q(o.product)};`,
    `/** the language the product opens in */`,
    `export const LANG = ${q(lang)};`,
    `export const APPS: FrameApp[] = ${lit(frameApps)};`,
    ``,
  ].join("\n"), "glue", true);
  add(providersPath, [
    `${use}${header(o.tag, "Around every page: the translations and the frame.")}`,
    `import type { ReactNode } from "react";`,
    `import { AppFrame } from "${imp("components/frame/app-frame", providersPath)}";`,
    `import { I18nProvider } from "${imp("lib/i18n", providersPath)}";`,
    `import { APPS, LANG, PRODUCT } from "./frame";`,
    ``,
    `export function DesignProviders({ lang = LANG, children }: { lang?: string; children: ReactNode }) {`,
    `  return <I18nProvider lang={lang}><AppFrame product={PRODUCT} apps={APPS}>{children}</AppFrame></I18nProvider>;`,
    `}`,
    ``,
  ].join("\n"), "glue", true);
  }

  // the product's words in its other language
  const other = o.design.locale?.languages.find((l) => !l.startsWith("en"));
  const words: Record<string, string> = {};
  for (const s of o.design.screens) for (const x of [...(s.mock?.tr ?? []), ...(s.mockFull?.tr ?? [])]) words[x.from] = x.to;
  for (const x of o.design.locale?.strings ?? []) words[x.from] = x.to;
  add(at("lib/messages.ts"), [
    header(o.tag, "The product's words in its other language, keyed by the English text the pages show."),
    `export const MESSAGES: Record<string, Record<string, string>> = ${lit(other ? { [other]: words } : {})};`,
    `/** languages written right to left: the page mirrors */`,
    `export const RTL = ["ar", "ur", "fa", "he"];`,
    ``,
  ].join("\n"), "glue", true);

  // Vite: the routes, for the app's router
  if (!next) {
    const rp = at("design-routes.tsx");
    add(rp, [
      header(o.tag, "A route per approved page, each opening in any state with ?fixture=S-3:empty. Add them to the app's router."),
      `import type { ReactNode } from "react";`,
      `import { useSearchParams, type RouteObject } from "react-router";`,
      `import { fixtureState } from "${imp("lib/fixture", rp)}";`,
      ...out.filter((x) => x.page).map((x) => `import { ${x.containerName} } from "${imp(`components/screens/${x.id.toLowerCase()}/container`, rp)}";`),
      ``,
      `function Fixture({ id, page }: { id: string; page: (fixture?: string) => ReactNode }) {`,
      `  const [search] = useSearchParams();`,
      `  return <>{page(fixtureState(search.get("fixture"), id))}</>;`,
      `}`,
      ``,
      `export const designRoutes: RouteObject[] = [`,
      ...out.filter((x) => x.page).map((x) => `  { path: ${q(routerPath(x.route))}, element: <Fixture id=${q(x.id)} page={(f) => <${x.containerName} fixture={f} />} /> },`),
      `];`,
      ``,
    ].join("\n"), "glue", true);
  }

  // the design's tests: a file per screen written, and their config
  for (const f of e2eFiles({ design: o.design, screens: out, write: (id) => !changed || changed.has(id.toLowerCase()), tag: o.tag, next })) add(f.path, f.text, f.owner, f.regenerate);

  // a fresh app's skeleton, or what the design-system task must wire in an existing one
  const kitDeps = { ...o.kit.manifest.dependencies, ...o.kit.manifest.targetDependencies[o.target] };
  const devDeps = o.kit.manifest.devDependencies[o.target] ?? {};
  const stylesheet = at(t.stylesheet);
  const themeImport = `./${t.theme.split("/").pop()}`;
  const css = [`@import "tailwindcss";`, `@import "tw-animate-css";`, ...(look ? [`@import "${themeImport}";`] : []), ``].join("\n");
  const todo: string[] = [];
  const dsFiles: string[] = [];
  if (fresh) {
    const name = o.product.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "app";
    add("package.json", lit({
      name, version: "0.1.0", private: true, type: "module",
      scripts: { ...(next ? { dev: "next dev", build: "next build", start: "next start" } : { dev: "vite", build: "tsc -b && vite build", preview: "vite preview" }), test: "vitest run", "test:design": `playwright test -c ${E2E_CONFIG}` },
      dependencies: sorted(kitDeps), devDependencies: sorted({ ...devDeps, "@playwright/test": PLAYWRIGHT_VERSION, vitest: VITEST_VERSION }),
    }) + "\n", "app", false);
    // the factory's acceptance tests (a build of a new product writes them in tests/): vitest runs those, never the design's Playwright tests
    add(VITEST_CONFIG, [
      `import { fileURLToPath, URL } from "node:url";`, `import { defineConfig } from "vitest/config";`, ``,
      `export default defineConfig({`,
      `  resolve: { alias: { "@": fileURLToPath(new URL(${q(`./${root}`)}, import.meta.url)) } },`,
      `  test: { include: [${q(`${UNIT_TEST_DIR}/**/*.test.ts`)}, ${q(`${UNIT_TEST_DIR}/**/*.test.tsx`)}], exclude: ["node_modules/**", ${q(`${E2E_DIR}/**`)}], passWithNoTests: true },`,
      `});`, ``,
    ].join("\n"), "app", false);
    add(stylesheet, css, "app", false);
    add(".gitignore", `${["node_modules", next ? ".next" : "dist", "*.tsbuildinfo", ...(next ? ["next-env.d.ts"] : [])].join("\n")}\n`, "app", false);
    if (next) {
      add("tsconfig.json", lit({
        compilerOptions: { target: "ES2022", lib: ["dom", "dom.iterable", "esnext"], allowJs: false, skipLibCheck: true, strict: true, noEmit: true, esModuleInterop: true, module: "esnext", moduleResolution: "bundler", resolveJsonModule: true, isolatedModules: true, jsx: "preserve", incremental: true, plugins: [{ name: "next" }], paths: { "@/*": [`./${root}*`] } },
        include: ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"], exclude: ["node_modules", E2E_DIR, E2E_CONFIG],
      }) + "\n", "app", false);
      add("next.config.ts", `import type { NextConfig } from "next";\n\nconst config: NextConfig = {};\n\nexport default config;\n`, "app", false);
      add("postcss.config.mjs", `export default { plugins: { "@tailwindcss/postcss": {} } };\n`, "app", false);
      const layout = at("app/layout.tsx");
      const dir = o.design.locale && /^(ar|ur|fa|he)/.test(lang) ? "rtl" : "ltr";
      add(layout, [
        `import type { Metadata } from "next";`,
        `import { Suspense, type ReactNode } from "react";`,
        `import { DesignProviders } from "${imp("components/screens/providers", layout)}";`,
        `import { PRODUCT } from "${imp("components/screens/frame", layout)}";`,
        `import "./globals.css";`,
        ``,
        `export const metadata: Metadata = { title: PRODUCT };`,
        ``,
        `export default function RootLayout({ children }: { children: ReactNode }) {`,
        `  return (`,
        `    <html lang=${q(lang)} dir=${q(dir)}${o.design.theme?.mode === "dark" ? ` className="dark"` : ""}>`,
        `      <body>`,
        `        {/* the frame reads the address (useSearchParams), so it waits for the request */}`,
        `        <Suspense><DesignProviders>{children}</DesignProviders></Suspense>`,
        `      </body>`,
        `    </html>`,
        `  );`,
        `}`,
        ``,
      ].join("\n"), "app", false);
      dsFiles.push(layout);
    } else {
      add("tsconfig.json", lit({
        compilerOptions: { target: "ES2022", lib: ["ES2022", "DOM", "DOM.Iterable"], module: "ESNext", moduleResolution: "bundler", jsx: "react-jsx", strict: true, skipLibCheck: true, noEmit: true, isolatedModules: true, allowImportingTsExtensions: false, baseUrl: ".", paths: { "@/*": ["./src/*"] }, types: ["vite/client"] },
        include: ["src"],
      }) + "\n", "app", false);
      add("vite.config.ts", [
        `import tailwindcss from "@tailwindcss/vite";`, `import react from "@vitejs/plugin-react";`, `import { fileURLToPath, URL } from "node:url";`, `import { defineConfig } from "vite";`, ``,
        `export default defineConfig({`, `  plugins: [react(), tailwindcss()],`, `  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },`, `});`, ``,
      ].join("\n"), "app", false);
      add("index.html", [
        `<!doctype html>`, `<html lang=${q(lang)}${o.design.theme?.mode === "dark" ? ` class="dark"` : ""}>`, `  <head>`, `    <meta charset="UTF-8" />`, `    <meta name="viewport" content="width=device-width, initial-scale=1.0" />`,
        `    <title>${o.product.replace(/[<&]/g, "")}</title>`, `  </head>`, `  <body>`, `    <div id="root"></div>`, `    <script type="module" src="/src/main.tsx"></script>`, `  </body>`, `</html>`, ``,
      ].join("\n"), "app", false);
      const main = at("main.tsx");
      add(main, [
        `import { StrictMode } from "react";`, `import { createRoot } from "react-dom/client";`, `import { createBrowserRouter, Outlet, RouterProvider } from "react-router";`,
        `import { DesignProviders } from "@/components/screens/providers";`, `import { designRoutes } from "@/design-routes";`, `import "./index.css";`, ``,
        `const router = createBrowserRouter([{ element: <DesignProviders><Outlet /></DesignProviders>, children: designRoutes }]);`, ``,
        `createRoot(document.getElementById("root")!).render(<StrictMode><RouterProvider router={router} /></StrictMode>);`, ``,
      ].join("\n"), "app", false);
      dsFiles.push(main);
    }
    dsFiles.push("package.json", stylesheet);
    todo.push("install the packages and build the app once: the scaffold compiles as written");
  } else {
    const pkg = safeJson(o.src!.read("package.json"));
    const have = { ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) };
    const missing = Object.entries({ ...kitDeps, ...devDeps }).filter(([k]) => !(k in have) && !(next ? ["@tailwindcss/vite", "vite", "@vitejs/plugin-react"] : ["@tailwindcss/postcss"]).includes(k));
    if (missing.length) todo.push(`add the kit's packages to package.json: ${missing.map(([k, v]) => `${k}@${v}`).join(", ")}`);
    if (out.length && !("@playwright/test" in have)) todo.push(`add @playwright/test@${PLAYWRIGHT_VERSION} to the devDependencies and a script \"test:design\": \"playwright test -c ${E2E_CONFIG}\" (the design's tests in ${E2E_DIR})`);
    const sheet = o.src!.list().find((f) => /(^|\/)(globals|index|app|main)\.css$/.test(f) && f.startsWith(root)) ?? stylesheet;
    dsFiles.push("package.json", sheet);
    todo.push(`import the theme and the kit's animations in ${sheet}: @import "tw-animate-css";${look ? ` @import "${relativeCss(sheet, themePath)}";` : ""} (after @import "tailwindcss")`);
    const newPages = out.map((x) => `${x.id} ${x.route}`).join(", ");
    if (next) {
      const layout = [at("app/layout.tsx"), "app/layout.tsx", "src/app/layout.tsx"].find((f) => o.src!.read(f) !== undefined) ?? at("app/layout.tsx");
      dsFiles.push(layout);
      todo.push(`link the new pages (${newPages}) from the app's own navigation in ${layout}: they render inside its existing layout; do not add a new frame or restyle the app`);
    } else {
      const router = o.src!.list().find((f) => /createBrowserRouter|<Routes/.test(o.src!.read(f) ?? "") && /\.(t|j)sx?$/.test(f)) ?? at("main.tsx");
      dsFiles.push(router);
      todo.push(`add designRoutes (design-routes.tsx) to the router in ${router}, inside the app's existing layout route, and link the new pages (${newPages}) from its own navigation; do not add a new frame`);
    }
  }

  // never write over the repo's own files
  const kept: string[] = [];
  const final = files.filter((f) => {
    const there = o.src?.read(f.path);
    if (there === undefined) return true;
    if (f.regenerate && there.includes(OWNED_MARK)) return there !== f.text;
    if (there !== f.text) kept.push(f.path);
    return false;
  });
  const keptKit = kept.filter((p) => files.find((f) => f.path === p)?.owner === "kit");
  if (keptKit.length) todo.push(`the repo has its own ${keptKit.map((p) => p.split("/").pop()).join(", ")}: keep them, and make sure they export what the kit's blocks import (the shadcn/ui names and variants)`);
  const keptOwned = kept.filter((p) => files.find((f) => f.path === p)?.regenerate);
  if (keptOwned.length) notes.push(`not written over (the repo's own file, no ${OWNED_MARK} line): ${keptOwned.join(", ")}`);
  if (o.removed?.length) todo.push(`the design no longer has ${o.removed.join(", ")}: remove their routes and the frame's links to them`);

  return {
    target: o.target, kit: { id: o.kit.manifest.id, version: o.kit.manifest.version }, root, fresh, inPlace,
    files: final, kept, screens: out, removed: o.removed ?? [],
    designSystem: { files: [...new Set(dsFiles)], todo },
    protected: [...new Set([...files.filter((f) => f.owner !== "app").map((f) => f.path), ...out.flatMap((x) => [x.screen, x.fixtures])])].filter((p) => !kept.includes(p)).sort(),
    notes,
  };
}

const sorted = (o: Record<string, string>) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
function safeJson(text: string | undefined): { dependencies?: Record<string, string>; devDependencies?: Record<string, string> } | undefined {
  try { return text ? JSON.parse(text) : undefined; } catch { return undefined; }
}
function relativeCss(from: string, to: string): string {
  const a = from.split("/").slice(0, -1), b = to.split("/");
  while (a.length && b.length > 1 && a[0] === b[0]) { a.shift(); b.shift(); }
  const rel = [...a.map(() => ".."), ...b].join("/");
  return rel.startsWith(".") ? rel : `./${rel}`;
}

/** The scaffold in a few lines, for a prompt and the CLI. */
export function scaffoldSummary(l: ScaffoldLayout): string {
  const by = (o: ScaffoldOwner) => l.files.filter((f) => f.owner === o).length;
  return [
    `UI target ${l.target} (kit ${l.kit.id} ${l.kit.version}), source root "${l.root || "."}"${l.fresh ? ", a fresh app" : ""}`,
    `files: ${by("kit")} kit, ${by("theme")} theme, ${by("screen")} screen, ${by("glue")} frame and routes, ${by("app")} app${l.kept.length ? `; ${l.kept.length} kept (the repo's own)` : ""}`,
    ...l.screens.map((s) => `${s.id} ${s.title} ${s.route}: ${s.container}${s.page ? ` (route ${s.page})` : ""}; states ${Object.keys(s.states).join(", ")}`),
    ...l.inPlace.map((s) => `${s.id} ${s.title} ${s.route}: ${s.size}, changed in the app's own page${s.file ? ` ${s.file}` : ""} as designed`),
    ...l.designSystem.todo.map((x) => `design system: ${x}`),
    ...l.notes.map((x) => `note: ${x}`),
  ].join("\n");
}

