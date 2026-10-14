// The rules for reading a meeting (docs/superpowers/specs/2026-10-14-transcript-intent-design.md §8). Ours, reviewed in PRs, so not pinned
// by hash; its sha256 is recorded with every client intent and is part of the distill step's cache key. Lookup order matches
// src/conventions/skills.ts: the repo's copy, then the shared one, then the one shipped with the factory.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { projectSkillsDir, sharedSkillsDir } from "../conventions/skills.js";

export const DISTILL_SKILL = "transcript-distill";
/** From src/stages or dist/stages, two levels up is the factory's root. */
export const BUILTIN_DISTILL_SKILL = fileURLToPath(new URL(`../../.agents/skills/${DISTILL_SKILL}/SKILL.md`, import.meta.url));

export function loadDistillSkill(repo: string | undefined, builtin = BUILTIN_DISTILL_SKILL): { text: string; sha256: string; path: string } | undefined {
  const candidates = [...(repo ? [join(projectSkillsDir(repo), DISTILL_SKILL, "SKILL.md")] : []), join(sharedSkillsDir(), DISTILL_SKILL, "SKILL.md"), builtin];
  const path = candidates.find((p) => existsSync(p));
  if (!path) return undefined;
  const text = readFileSync(path, "utf8");
  return { text, sha256: createHash("sha256").update(text.replace(/\r\n/g, "\n")).digest("hex"), path };
}
