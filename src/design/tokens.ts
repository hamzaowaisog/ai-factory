// The approved look as design tokens for the build (docs/estimates-design.md, "Design baseline"). The lead approved the demo,
// so the build gets the very values the demo drew with (themeValues), under names a developer reads: colours per mode, the body
// and heading type, corners, spacing, shadows and motion, plus the same set as CSS variables ready for a stylesheet.
import type { DesignTheme } from "../contracts/artifacts.js";
import { themeValues } from "./demo.js";

// the demo's short colour names, as the build's token names
const COLOUR_NAMES: Record<string, string> = {
  bg: "background", sf: "surface", sf2: "surface-muted", edge: "border", edge2: "border-strong",
  ink: "text", ink2: "text-secondary", mut: "text-muted", br: "brand", on: "on-brand", a1: "brand-text", a2: "accent-text",
  ok: "success", bad: "danger", warn: "warning", info: "info",
};

export interface DesignTokens {
  /** Colours by name for each mode the product has ("auto" follows the viewer's setting, so it has both). */
  colour: { light?: Record<string, string>; dark?: Record<string, string> };
  type: { body: string; heading: string; headingWeight: number; headingTracking: string };
  radiusPx: number;
  space: { padPx: number; rowPx: number };
  shadow: { light?: { card: string; raised: string }; dark?: { card: string; raised: string } };
  /** The backdrop blur behind a see-through (glass) surface; "none" otherwise. */
  surfaceBlur: string;
  motion: { ease: string; spring: string; risePx: number; calm: boolean };
  /** The same tokens as CSS custom properties (`--color-brand`, `--radius`, ...), with a dark block when the mode is auto, and `data-theme` blocks for an in-app switch. */
  css: string;
}

const named = (p: Record<string, string>): Record<string, string> => Object.fromEntries(Object.entries(p).map(([k, v]) => [COLOUR_NAMES[k] ?? k, v]));

export function designTokens(theme: DesignTheme): DesignTokens {
  const v = themeValues(theme), mode = v.theme.mode;
  const modes = (mode === "auto" ? ["light", "dark"] : [mode]) as ("light" | "dark")[];
  const colour = Object.fromEntries(modes.map((m) => [m, named(v.colours(m === "dark"))]));
  const shadow = Object.fromEntries(modes.map((m) => [m, { card: v.shadow(m === "dark"), raised: v.lift(m === "dark") }]));
  const vars = (m: "light" | "dark") => [
    ...Object.entries(colour[m]!).map(([k, c]) => `--color-${k}:${c}`), `--shadow-card:${shadow[m]!.card}`, `--shadow-raised:${shadow[m]!.raised}`,
  ];
  const shared = [
    `--font-body:${v.font}`, `--font-heading:${v.head.family === "inherit" ? "var(--font-body)" : v.head.family}`, `--font-heading-weight:${v.head.weight}`, `--font-heading-tracking:${v.head.tracking}`,
    `--radius:${v.radius}px`, `--surface-blur:${v.blur}`, `--space-pad:${v.pad}px`, `--space-row:${v.row}px`, `--ease:${v.ease}`, `--ease-spring:${v.spring}`,
  ];
  const block = (lines: string[]) => lines.map((l) => `  ${l};`).join("\n");
  const css = mode === "auto"
    // the viewer's setting first, then the one picked in the app (`data-theme` on the root element)
    ? `:root {\n${block([...shared, ...vars("light")])}\n}\n@media (prefers-color-scheme: dark) {\n  :root {\n${block(vars("dark")).replace(/^/gm, "  ")}\n  }\n}\n`
      + `:root[data-theme="light"] {\n${block(["color-scheme:light", ...vars("light")])}\n}\n:root[data-theme="dark"] {\n${block(["color-scheme:dark", ...vars("dark")])}\n}\n`
    : `:root {\n${block([...shared, ...vars(modes[0]!)])}\n}\n`;
  return {
    colour, shadow, surfaceBlur: v.blur,
    type: { body: v.font, heading: v.head.family === "inherit" ? v.font : v.head.family, headingWeight: v.head.weight, headingTracking: v.head.tracking },
    radiusPx: v.radius, space: { padPx: v.pad, rowPx: v.row },
    motion: { ease: v.ease, spring: v.spring, risePx: v.rise, calm: v.theme.motion === "calm" },
    css,
  };
}
