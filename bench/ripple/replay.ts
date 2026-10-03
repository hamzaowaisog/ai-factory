// Commit replay: does the ripple code layer find the other files a real commit changed? Free (git + code, no model).
//   npx tsx bench/ripple/replay.ts [--per-repo 6] [--cache ~/.factory/bench-repos]
// For each pinned public repo, walk its history back from the pin and take commits that changed 2-15 existing
// code files. Truth = files the commit modified or deleted (added files can't be found by any search), minus docs,
// lockfiles, assets and build/package files (.csproj, .props: version bumps no code search links). Commits whose
// subject says update/bump/upgrade/deps/format are skipped: sweeps, not ripples. Seed = the commit's most-changed non-test code file, standing in for ground (which needs a model).
//   ground-only recall = seed found / truth          (ground finds the primary file, nothing else)
//   code-layer recall  = (seed ∪ candidates) / truth
//   precision          = candidates in truth / candidates (also @10: the first 10 candidates, as the card shows 8)
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";
import { candidateFiles, rippleCandidates } from "../../src/context/ripple.js";

const arg = (name: string, def: string) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1]! : def; };
const PER_REPO = Number(arg("per-repo", "6"));
const CACHE = arg("cache", join(homedir(), ".factory", "bench-repos"));
const repos = parse(readFileSync(new URL("./repos.yaml", import.meta.url), "utf8")) as Record<string, { url: string; commit: string }>;

const NOT_CODE = /\.(md|txt|png|jpe?g|gif|svg|ico|lock|snap)$|(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|packages\.lock\.json|LICENSE[^/]*|\.gitignore|\.editorconfig)$|(^|\/)(docs?|\.github)\//i;
const BUILD = /\.(csproj|props|targets|sln|slnx)$|(^|\/)(global\.json|\.aspire\/|\.config\/dotnet-tools\.json)/i;
const SWEEP = /\b(update|bump|upgrade|deps|dependenc|format|lint|rename|cleanup|clean up|merge)\b/i;
const CODE = /\.(cs|ts|tsx|js|jsx|razor|cshtml|json|csproj|props|targets|sql|ya?ml)$/i;

// ground anchors point at production code, so the stand-in seed is never a test file
const isTest = (p: string) => /(^|\/)tests?\/|\.Tests?[./]|Tests?\.cs$|\.(test|spec)\.[tj]sx?$/i.test(p);
const git = (cwd: string, ...a: string[]) => execFileSync("git", a, { cwd, encoding: "utf8", maxBuffer: 256 << 20 });

function clone(name: string, url: string, pin: string): string {
  const dir = join(CACHE, name);
  if (!existsSync(dir)) { mkdirSync(CACHE, { recursive: true }); execFileSync("git", ["clone", "--quiet", "--no-checkout", url, dir], { stdio: "inherit" }); }
  git(dir, "cat-file", "-e", pin);
  return dir;
}

interface Pick { sha: string; parent: string; seed: string; truth: string[] }

function pickCommits(dir: string, pin: string): Pick[] {
  const out: Pick[] = [];
  const shas = git(dir, "rev-list", "--no-merges", "--min-parents=1", "--max-count=400", pin).trim().split("\n");
  for (const sha of shas) {
    if (out.length >= PER_REPO) break;
    if (SWEEP.test(git(dir, "log", "-1", "--format=%s", sha))) continue;
    const parent = git(dir, "rev-parse", `${sha}^`).trim();
    // --numstat with --name-status-like info: status from one call, line counts from another
    const status = git(dir, "diff", "--name-status", "--no-renames", parent, sha).trim().split("\n").filter(Boolean).map((l) => l.split("\t") as [string, string]);
    const truth = status.filter(([s, p]) => (s === "M" || s === "D") && CODE.test(p) && !NOT_CODE.test(p) && !BUILD.test(p)).map(([, p]) => p);
    if (truth.length < 2 || status.length > 15) continue;
    const lines = new Map(git(dir, "diff", "--numstat", "--no-renames", parent, sha).trim().split("\n").map((l) => l.split("\t")).map(([a, d, p]) => [p!, Number(a) + Number(d)]));
    const seed = [...truth].filter((p) => /\.(cs|ts|tsx|js|jsx)$/.test(p) && !isTest(p)).sort((a, b) => (lines.get(b) ?? 0) - (lines.get(a) ?? 0))[0];
    if (!seed) continue;
    out.push({ sha, parent, seed, truth });
  }
  return out;
}

const pct = (n: number, d: number) => (d ? `${Math.round((100 * n) / d)}%` : "-");
const rows: { repo: string; sha: string; truth: number; ground: number; layer: number; cands: number; hits: number; hits10: number }[] = [];

for (const [name, r] of Object.entries(repos)) {
  const dir = clone(name, r.url, r.commit);
  for (const p of pickCommits(dir, r.commit)) {
    git(dir, "checkout", "--quiet", "--force", "--detach", p.parent);
    const files = git(dir, "ls-files").trim().split("\n");
    const read = (f: string) => { try { return readFileSync(join(dir, f), "utf8"); } catch { return undefined; } };
    const cands = candidateFiles(rippleCandidates({ files, read }, [{ path: p.seed }]));
    const truth = new Set(p.truth);
    const hits = cands.filter((c) => truth.has(c));
    rows.push({ repo: name, sha: p.sha.slice(0, 8), truth: truth.size, ground: 1, layer: 1 + hits.length, cands: cands.length, hits: hits.length, hits10: cands.slice(0, 10).filter((c) => truth.has(c)).length });
  }
}

console.log("repo     commit    truth  ground-only  code-layer  candidates  precision  prec@10");
for (const x of rows) console.log(`${x.repo.padEnd(8)} ${x.sha}  ${String(x.truth).padStart(5)}  ${pct(x.ground, x.truth).padStart(11)}  ${pct(x.layer, x.truth).padStart(10)}  ${String(x.cands).padStart(10)}  ${pct(x.hits, x.cands).padStart(9)}  ${pct(x.hits10, Math.min(10, x.cands)).padStart(7)}`);
const sum = (k: keyof (typeof rows)[number]) => rows.reduce((n, x) => n + (x[k] as number), 0);
console.log(`\n${rows.length} commits, ${sum("truth")} truth files (pooled)`);
console.log(`ground-only recall ${pct(sum("ground"), sum("truth"))}, code-layer recall ${pct(sum("layer"), sum("truth"))}`);
console.log(`code-layer: ${sum("hits")} of ${sum("cands")} candidates are in truth (precision ${pct(sum("hits"), sum("cands"))}); first 10: ${pct(sum("hits10"), rows.reduce((n, x) => n + Math.min(10, x.cands), 0))}`);
const meanRecall = (k: "ground" | "layer") => Math.round((100 * rows.reduce((n, x) => n + x[k] / x.truth, 0)) / (rows.length || 1));
console.log(`mean per-commit recall: ground-only ${meanRecall("ground")}%, code-layer ${meanRecall("layer")}%`);
