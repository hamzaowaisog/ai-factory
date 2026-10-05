// The guidelines live in factory state, never in the repo: a pull request must not be able to edit
// the rules it is judged by. `protected.ts` already guards .editorconfig and friends for exactly
// that reason, and a guidelines file inside the repo would be a new way around that guard.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Convention } from "../contracts/index.js";
import { sha256 } from "../util/hash.js";
import { factoryHome } from "../util/paths.js";
import { parseGuidelines } from "./markdown.js";

export function guidelinesPath(project: string): string {
  return join(factoryHome(), "projects", project, "conventions.md");
}
const approvalPath = (project: string) => join(factoryHome(), "projects", project, "conventions-approved.json");

/** Writes the file and returns its hash — the hash a person approves. */
export function writeGuidelines(project: string, md: string): string {
  const p = guidelinesPath(project);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, md, { mode: 0o600 });
  return sha256(Buffer.from(md));
}

export function currentSha(project: string): string | undefined {
  const p = guidelinesPath(project);
  return existsSync(p) ? sha256(readFileSync(p)) : undefined;
}

export function recordApproval(project: string, sha: string, by: string): void {
  const p = approvalPath(project);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify({ sha, by, at: new Date().toISOString() }, null, 2), { mode: 0o600 });
}

export type Approved = { conventions: Convention[]; markdown: string; sha: string };

/**
 * Missing, unapproved, edited-since-approval and unparseable are four different things, and each
 * returns its own sentence naming the command that fixes it. None of them returns an empty rule
 * set: a gate that cannot check counts as failed, so the caller must surface the reason rather
 * than quietly proceeding with nothing.
 */
export function readApproved(project: string): Approved | { unapproved: string } {
  const p = guidelinesPath(project);
  if (!existsSync(p)) {
    return { unapproved: `No coding guidelines for ${project}. Build them once: \`factory conventions build --project ${project}\`` };
  }
  const markdown = readFileSync(p, "utf8");
  const sha = sha256(Buffer.from(markdown));
  const ap = approvalPath(project);
  if (!existsSync(ap)) {
    return { unapproved: `The coding guidelines for ${project} were never approved. Read ${p}, then: \`factory conventions approve --project ${project} ${sha.slice(0, 12)}\`` };
  }
  const rec = JSON.parse(readFileSync(ap, "utf8")) as { sha: string; by: string; at: string };
  if (rec.sha !== sha) {
    return { unapproved: `The coding guidelines for ${project} changed since ${rec.by} approved them on ${rec.at.slice(0, 10)}. Read the change, then approve ${sha.slice(0, 12)} again.` };
  }
  try {
    return { conventions: parseGuidelines(markdown).conventions, markdown, sha };
  } catch (e) {
    return { unapproved: `The approved guidelines for ${project} cannot be read: ${(e as Error).message}` };
  }
}
