// The packages a commit adds or changes, read from the project files themselves, and the gate that holds them to the plan.
// The session's hook already refuses the install commands (docker/agent/run-agent.mjs); this catches a package written
// straight into a project file. Pure code: no model.
import type { Plan } from "../contracts/index.js";
import { defineGate, failure, verdict } from "./engine.js";

/** One package a commit added (`was` unset) or moved to another version. */
export interface PackageChange { file: string; name: string; version: string; was?: string }
export interface PackageChanges { kind: "packages"; from: string; to: string; changes: PackageChange[] }

const NPM_SECTIONS = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"] as const;

/** True for a file that names packages: a .NET project or props file, or a package.json of the repo's own. */
export function isPackageManifest(path: string): boolean {
  if (/(^|\/)node_modules\//.test(path)) return false;
  return /\.(cs|fs|vb)proj$|\.props$|\.targets$/i.test(path) || /(^|\/)package\.json$/.test(path);
}

/** The packages a manifest names, by name (lowercase for NuGet, which ignores case) with the version as written. */
export function manifestPackages(path: string, text: string): Map<string, { name: string; version: string }> {
  const out = new Map<string, { name: string; version: string }>();
  if (/(^|\/)package\.json$/.test(path)) {
    let j: Record<string, unknown>;
    try { j = JSON.parse(text) as Record<string, unknown>; } catch { return out; }
    for (const s of NPM_SECTIONS) {
      const deps = j[s];
      if (!deps || typeof deps !== "object") continue;
      for (const [name, version] of Object.entries(deps as Record<string, unknown>)) out.set(name, { name, version: String(version) });
    }
    return out;
  }
  // <PackageReference Include="X" Version="1.2.3" />, the attributes in any order, or the version as a child element
  for (const m of text.matchAll(/<Package(?:Reference|Version)\b([^>]*?)(\/?)>(?:\s*<Version>([^<]*)<\/Version>)?/g)) {
    const name = /\b(?:Include|Update)\s*=\s*"([^"]+)"/.exec(m[1]!)?.[1];
    if (!name) continue;
    const version = /\bVersion(?:Override)?\s*=\s*"([^"]*)"/.exec(m[1]!)?.[1] ?? (m[2] ? "" : (m[3] ?? "")).trim();
    out.set(name.toLowerCase(), { name, version });
  }
  return out;
}

/** What `after` names that `before` did not, or names at another version. */
export function changedPackages(file: string, before: string | undefined, after: string | undefined): PackageChange[] {
  if (after === undefined) return [];
  const was = before === undefined ? new Map<string, { name: string; version: string }>() : manifestPackages(file, before);
  const out: PackageChange[] = [];
  for (const [key, p] of manifestPackages(file, after)) {
    const old = was.get(key);
    if (!old) out.push({ file, name: p.name, version: p.version });
    else if (old.version !== p.version) out.push({ file, name: p.name, version: p.version, was: old.version });
  }
  return out;
}

/**
 * A task adds no package, and changes no package's version, unless the plan lists that package (newDependencies, approved
 * with the plan). A safety gate: a new dependency is code nobody here reviewed, fetched on the next restore.
 */
export const packagesPlanned = defineGate<{ packages: PackageChanges; plan: Pick<Plan, "newDependencies"> }>({
  id: "task.packages-planned", after: "implement", safety: true, waiver: "none",
  predicate: ({ packages, plan }) => {
    const planned = new Set((plan.newDependencies ?? []).map((d) => d.name.toLowerCase()));
    return verdict(
      packages.changes.filter((c) => !planned.has(c.name.toLowerCase())).map((c) => failure("packages-planned",
        c.was === undefined
          ? `${c.file} adds the package ${c.name}${c.version ? ` ${c.version}` : ""}, which the approved plan does not list. Take it out and use what the project already references.`
          : `${c.file} changes the package ${c.name} from ${c.was || "no version"} to ${c.version || "no version"}, which the approved plan does not list. Put the version back.`,
        { location: c.file })),
      "No package was added or changed that the plan does not list",
    );
  },
});
