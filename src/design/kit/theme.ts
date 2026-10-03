// The approved look as a shadcn/ui theme (docs/estimates-design.md, "Kit and scaffold"): the design tokens under the variable names
// shadcn components read (--background, --primary, --muted-foreground, ...), the design's own extras (success, warning, info, the
// card and raised shadows, the padding and row height, the heading type), and Tailwind v4 `@theme inline` so every name is a class.
// The values are the demo's (designTokens), so the built pages draw with the colours the lead approved.
import type { DesignTheme } from "../../contracts/artifacts.js";
import { designTokens } from "../tokens.js";

/** shadcn's variable, and the design token it takes its colour from. */
export const SHADCN_COLOURS: [string, string][] = [
  ["background", "background"], ["foreground", "text"],
  ["card", "surface"], ["card-foreground", "text"],
  ["popover", "surface"], ["popover-foreground", "text"],
  ["primary", "brand"], ["primary-foreground", "on-brand"],
  ["secondary", "surface-muted"], ["secondary-foreground", "text"],
  ["muted", "surface-muted"], ["muted-foreground", "text-muted"],
  ["accent", "surface-muted"], ["accent-foreground", "text"],
  ["destructive", "danger"],
  ["border", "border"], ["input", "border-strong"], ["ring", "brand"],
  ["success", "success"], ["warning", "warning"], ["info", "info"],
  ["brand-text", "brand-text"], ["accent-text", "accent-text"], ["text-secondary", "text-secondary"],
  ["chart-1", "brand"], ["chart-2", "accent-text"], ["chart-3", "info"], ["chart-4", "success"], ["chart-5", "warning"],
  ["sidebar", "surface"], ["sidebar-foreground", "text"], ["sidebar-primary", "brand"], ["sidebar-primary-foreground", "on-brand"],
  ["sidebar-accent", "surface-muted"], ["sidebar-accent-foreground", "text"], ["sidebar-border", "border"], ["sidebar-ring", "brand"],
];

// "none" in a shadow variable empties the whole box-shadow list Tailwind composes (the focus ring with it), so no shadow is written
// as a shadow that draws nothing
const noShadow = (v: string): string => (v.trim() === "none" ? "0 0 #0000" : v);

/**
 * The stylesheet the kit's components draw with. `tag` names the approved design it came from. Light mode is `:root`; a dark
 * product is `:root` in dark; a product in both follows the viewer's setting and the `dark` class or `data-theme` an app sets.
 */
export function shadcnThemeCss(theme: DesignTheme, tag: string): string {
  const t = designTokens(theme);
  const modes = Object.keys(t.colour) as ("light" | "dark")[];
  const vars = (m: "light" | "dark") => [
    ...SHADCN_COLOURS.map(([k, from]) => `--${k}: ${t.colour[m]![from]};`),
    `--shadow-card: ${noShadow(t.shadow[m]!.card)};`, `--shadow-raised: ${noShadow(t.shadow[m]!.raised)};`,
  ];
  const shared = [
    `--radius: ${t.radiusPx}px;`, `--font-body: ${t.type.body};`, `--font-heading: ${t.type.heading};`,
    `--font-heading-weight: ${t.type.headingWeight};`, `--font-heading-tracking: ${t.type.headingTracking};`,
    `--space-pad: ${t.space.padPx}px;`, `--space-row: ${t.space.rowPx}px;`, `--ease: ${t.motion.ease};`, `--ease-spring: ${t.motion.spring};`,
  ];
  const block = (sel: string, lines: string[], pad = "") => [`${pad}${sel} {`, ...lines.map((l) => `${pad}  ${l}`), `${pad}}`];
  const both = modes.length > 1;
  const first = modes[0]!;
  const out = [
    `/* ${tag} */`,
    `/* The approved look as a shadcn/ui theme. Written by ai-factory; change the design, not this file. */`,
    ...block(":root", [...shared, ...(both || first === "dark" ? [`color-scheme: ${both ? "light dark" : "dark"};`] : []), ...vars(first)]),
    ...(both ? [
      `@media (prefers-color-scheme: dark) {`, ...block(':root:not(.light):not([data-theme="light"])', vars("dark"), "  "), `}`,
      ...block('.dark, [data-theme="dark"]', ["color-scheme: dark;", ...vars("dark")]),
      ...block('.light, [data-theme="light"]', ["color-scheme: light;", ...vars("light")]),
    ] : []),
    ``,
    `@custom-variant dark (&:is(.dark *, [data-theme="dark"] *));`,
    ``,
    `@theme inline {`,
    ...SHADCN_COLOURS.map(([k]) => `  --color-${k}: var(--${k});`),
    `  --font-sans: var(--font-body);`, `  --font-body: var(--font-body);`, `  --font-heading: var(--font-heading);`,
    `  --radius-sm: max(0px, calc(var(--radius) - 4px));`, `  --radius-md: max(0px, calc(var(--radius) - 2px));`,
    `  --radius-lg: var(--radius);`, `  --radius-xl: calc(var(--radius) + 4px);`,
    // Tailwind's other steps land on the design's (the fidelity check allows only these corners and shadows)
    `  --radius-xs: var(--radius-sm);`, `  --radius-2xl: var(--radius-xl);`, `  --radius-3xl: var(--radius-xl);`, `  --radius-4xl: var(--radius-xl);`,
    `  --spacing-pad: var(--space-pad);`, `  --spacing-row: var(--space-row);`,
    `  --shadow-card: var(--shadow-card);`, `  --shadow-raised: var(--shadow-raised);`,
    `  --shadow-2xs: var(--shadow-card);`, `  --shadow-xs: var(--shadow-card);`, `  --shadow-sm: var(--shadow-card);`, `  --shadow: var(--shadow-card);`,
    `  --shadow-md: var(--shadow-raised);`, `  --shadow-lg: var(--shadow-raised);`, `  --shadow-xl: var(--shadow-raised);`, `  --shadow-2xl: var(--shadow-raised);`,
    `  --ease-standard: var(--ease);`, `  --ease-spring: var(--ease-spring);`,
    `}`,
    ``,
    `@layer base {`,
    `  * { border-color: var(--border); outline-color: color-mix(in srgb, var(--ring) 50%, transparent); }`,
    `  body { background: var(--background); color: var(--foreground); font-family: var(--font-body); -webkit-font-smoothing: antialiased; }`,
    `  h1, h2, h3, h4, .font-heading { font-family: var(--font-heading); font-weight: var(--font-heading-weight); letter-spacing: var(--font-heading-tracking); }`,
    `}`,
    ``,
  ];
  return out.join("\n");
}
