// Who is on our side of a meeting (docs/superpowers/specs/2026-10-14-transcript-intent-design.md §4). ~/.factory/team.yaml is shared
// by every project on this machine; ~/.factory/projects/<project>/team.yaml adds that project's people. A speaker on neither is the
// client. A role set on the intent card wins for that run only. `factory team` edits these files; nothing else writes them.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parse, stringify } from "yaml";
import type { SpeakerRole } from "../contracts/index.js";
import { factoryHome } from "../util/paths.js";

export interface Member { name: string; aliases?: string[]; note?: string }
export interface Roster { members: Member[]; domains: string[]; found: boolean }

const key = (n: string) => n.toLowerCase().replace(/\s+/g, " ").trim();
export const rosterPath = (project?: string): string => project ? join(factoryHome(), "projects", project, "team.yaml") : join(factoryHome(), "team.yaml");

/** One layer of the roster: the shared one, or one project's. A missing file is an empty roster. */
export function readRoster(project?: string): Omit<Roster, "found"> {
  const p = rosterPath(project);
  if (!existsSync(p)) return { members: [], domains: [] };
  const y = (parse(readFileSync(p, "utf8")) ?? {}) as { members?: Member[]; domains?: string[] };
  return { members: y.members ?? [], domains: y.domains ?? [] };
}

function write(r: Omit<Roster, "found">, project?: string): void {
  const p = rosterPath(project);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, `# Our team, for meeting transcripts: a speaker listed here is the team, anyone else the client. Edit with factory team.\n${stringify(r)}`);
}

/** Adds a member, or updates the one with the same name (the fields given replace theirs). */
export function addMember(m: Member, project?: string): void {
  const r = readRoster(project);
  const at = r.members.findIndex((x) => key(x.name) === key(m.name));
  const merged: Member = at < 0 ? m : { ...r.members[at]!, ...Object.fromEntries(Object.entries(m).filter(([, v]) => v !== undefined)) };
  write({ ...r, members: at < 0 ? [...r.members, merged] : r.members.map((x, i) => (i === at ? merged : x)) }, project);
}

/** False when nobody by that name was on this layer of the roster. */
export function removeMember(name: string, project?: string): boolean {
  const r = readRoster(project);
  const left = r.members.filter((x) => key(x.name) !== key(name));
  if (left.length === r.members.length) return false;
  write({ ...r, members: left }, project);
  return true;
}

/** The shared roster with the project's (a project entry replaces a shared one of the same name). */
export function loadRoster(project: string | undefined): Roster {
  const shared = readRoster(), own = project ? readRoster(project) : { members: [], domains: [] };
  const byName = new Map<string, Member>();
  for (const m of [...shared.members, ...own.members]) byName.set(key(m.name), m);
  return {
    members: [...byName.values()], domains: [...new Set([...shared.domains, ...own.domains])],
    found: existsSync(rosterPath()) || (!!project && existsSync(rosterPath(project))),
  };
}

export function rolesFor(speakers: string[], roster: Roster, cardRoles: Record<string, "client" | "team"> = {}): SpeakerRole[] {
  const team = new Set(roster.members.flatMap((m) => [m.name, ...(m.aliases ?? [])]).map(key));
  return speakers.map((name): SpeakerRole => cardRoles[name] ? { name, role: cardRoles[name]!, source: "card" }
    : team.has(key(name)) ? { name, role: "team", source: "roster" }
    : { name, role: "client", source: "default" });
}
