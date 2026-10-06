// Where the external best practices come from, and in what order.
//
// Two layers. `~/.factory/skills/` is shared by every project on this host — install a skill once
// and every project gets it. `<repo>/.claude/skills/` belongs to one repository and overrides the
// shared copy by name, so a .NET project and a Node project can disagree about what good looks like
// without either having to carry the other's rules.
//
// Reading only the repository layer, which is what this did at first, means a project that does not
// carry its own skills gets NO external best practices at all and never says so.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { factoryHome } from "../util/paths.js";

export interface SkillSource {
  name: string;
  text: string;
  /** The directory it was read from, for the guidelines file's provenance column. */
  dir: string;
  layer: "shared" | "project";
}

export const sharedSkillsDir = (): string => join(factoryHome(), "skills");
export const projectSkillsDir = (repo: string): string => join(repo, ".claude", "skills");

/** Every `<name>/SKILL.md` directly under a directory. A missing directory is not an error. */
export function readSkillDir(dir: string, layer: SkillSource["layer"]): SkillSource[] {
  if (!existsSync(dir)) return [];
  const out: SkillSource[] = [];
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name, "SKILL.md");
    try {
      if (!statSync(join(dir, name)).isDirectory() || !existsSync(p)) continue;
      out.push({ name, text: readFileSync(p, "utf8"), dir, layer });
    } catch { continue; }                       // an unreadable entry is skipped, never fatal
  }
  return out;
}

/**
 * The shared layer first, then the project's, so a project skill of the same name replaces the
 * shared one entirely rather than merging with it. Merging two sets of rules under one name would
 * produce a file nobody wrote and nobody could reason about.
 */
export function readSkills(repo: string, home = sharedSkillsDir()): SkillSource[] {
  const byName = new Map<string, SkillSource>();
  for (const s of readSkillDir(home, "shared")) byName.set(s.name, s);
  for (const s of readSkillDir(projectSkillsDir(repo), "project")) byName.set(s.name, s);
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** What to tell a person when no external rules were found anywhere. */
export function noSkillsNote(repo: string, home = sharedSkillsDir()): string {
  return `No skill files found, so the guidelines will have no external best practices. Put one in ${home}/<name>/SKILL.md to share it across projects, or ${projectSkillsDir(repo)}/<name>/SKILL.md for this project only.`;
}
