// The UI kits, the shadcn theme and the scaffold (docs/estimates-design.md, "Kit and scaffold").
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ScaffoldLayout } from "./scaffold.js";

export * from "./kit.js";
export * from "./scaffold.js";
export { shadcnThemeCss, SHADCN_COLOURS } from "./theme.js";
export { sampleDesign } from "./sample.js";

/** Write a scaffold's files under a folder (a worktree, or `--out`). Returns the paths written. */
export function writeScaffold(layout: ScaffoldLayout, dir: string): string[] {
  for (const f of layout.files) {
    const p = join(dir, f.path);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, f.text);
  }
  return layout.files.map((f) => f.path);
}
