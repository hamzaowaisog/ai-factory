// Where the design toolkit reads files from: a folder on disk, or a commit in a git repo.
// Git reads use the factory's hardened settings (no hooks, no filters, no user config).
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { hardenedEnv } from "../ledger/git.js";

export interface FileSource {
  /** Repo-relative POSIX paths of every file (build output and dependencies skipped). */
  list(): string[];
  /** File text, or undefined when it doesn't exist. */
  read(path: string): string | undefined;
}

export const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next", "out", "coverage", ".turbo", ".vercel", ".contentlayer"]);
/**
 * A file of an approved design package committed into a repo (`.factory/design/<line>/vN/...`, src/design/package.ts): not app
 * code, so it is never read as the app. (PR #11 review, item 12: packages used to go to `design/<line>/vN/`, a shape a client's
 * own folders can have, so that older place is skipped only where a factory manifest says it is a package; see `withoutPackages`.)
 */
export const DESIGN_PACKAGE_PATH = /(^|\/)\.factory\/design\/[^/]+\/v\d+\//;
const LEGACY_MANIFEST = /^((?:.*\/)?design\/[^/]+\/v\d+\/)manifest\.json$/;

/** A listing without design packages: the current place, and the older `design/<line>/vN/` only where its manifest is the factory's. */
export function withoutPackages(files: string[], read: (p: string) => string | undefined): string[] {
  const legacy = files.flatMap((f) => {
    const m = LEGACY_MANIFEST.exec(f);
    if (!m) return [];
    const text = read(f) ?? "";
    return /"designSha"\s*:/.test(text) && /"templateVersion"\s*:/.test(text) ? [m[1]!] : [];
  });
  return files.filter((f) => !DESIGN_PACKAGE_PATH.test(f) && !legacy.some((d) => f.startsWith(d)));
}

const HARDENING = ["-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", "-c", "protocol.file.allow=never"];

/** Read-only git call with the factory's hardening. Throws on a non-zero exit. */
export function gitSync(repo: string, args: string[]): string {
  return execFileSync("git", [...HARDENING, "-C", repo, ...args], {
    encoding: "utf8", env: hardenedEnv(), maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"],
  });
}

export function dirSource(root: string): FileSource {
  let files: string[] | undefined;
  const src: FileSource = {
    list() {
      if (files) return files;
      const out: string[] = [];
      const walk = (dir: string) => {
        let entries;
        try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
        for (const e of entries) {
          if (SKIP_DIRS.has(e.name)) continue;
          const p = join(dir, e.name);
          if (e.isDirectory()) walk(p);
          else if (e.isFile()) out.push(relative(root, p).split("\\").join("/"));
        }
      };
      walk(root);
      files = withoutPackages(out, (f) => src.read(f)).sort();
      return files;
    },
    read(path) {
      const p = join(root, path);
      if (!existsSync(p)) return undefined;
      try { return readFileSync(p, "utf8"); } catch { return undefined; }
    },
  };
  return src;
}

/** Files at a commit, without checking anything out. */
export function gitSource(repo: string, commit: string): FileSource {
  let files: string[] | undefined;
  const cache = new Map<string, string | undefined>();
  const src: FileSource = {
    list() {
      files ??= withoutPackages(gitSync(repo, ["ls-tree", "-r", "--name-only", "-z", commit]).split("\0").filter(Boolean)
        .filter((f) => !f.split("/").some((seg) => SKIP_DIRS.has(seg))), (f) => src.read(f)).sort();
      return files;
    },
    read(path) {
      if (cache.has(path)) return cache.get(path);
      let text: string | undefined;
      try { text = gitSync(repo, ["show", `${commit}:${path}`]); } catch { text = undefined; }
      cache.set(path, text);
      return text;
    },
  };
  return src;
}
