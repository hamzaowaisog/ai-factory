// Evidence for the judges: runs on public repos and eval results, scrubbed, into evidence/ (a public repo).
//   npm run eval -- publish <run-id> [--factory-commit <sha>]   one run (by id: real home, an eval home, or an archive);
//                                           --factory-commit for a run older than commit recording (kept on re-publish)
//   npm run eval -- publish --all-public [--from <checkout>]   every paid run on a public repo, plus the eval results
//                                           (--from: the checkout whose bench/*/results the eval runs wrote)
// Only projects on the public allowlist are published; anything else is refused and listed. Every file is scrubbed
// (home paths -> ~, the user and host names, emails, secrets) and checked again before it is kept: client project names
// come from the local project configs (never written into the repo), so a client name can't slip through.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, hostname, tmpdir, userInfo } from "node:os";
import { basename, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { scanText } from "../src/context/secrets.js";
import { replay } from "../src/ledger/state.js";
import { openRun, rowOf, type RunRow } from "./runs/row.js";
import { markdown } from "./runs/run.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const EVIDENCE = join(ROOT, "evidence");
/** Projects whose runs may be published: the public eval repos and the public VSA fork. */
export const PUBLIC_PROJECTS = new Set(["vsa", "vsa-dryrun", "eval-vsa", "eval-todo", "todoapi"]);
export const MAX_ARCHIVE_BYTES = 5 * 1024 * 1024;
const REAL_HOME = join(homedir(), ".factory");
const ARCHIVE = join(homedir(), "factory-archive");

/** Words that must never appear: this machine's user and host, and every non-public local project (read at run time). */
export function forbiddenWords(home = REAL_HOME): string[] {
  const words = new Set([userInfo().username, hostname()].filter((w) => w.length >= 3));
  const dir = join(home, "projects");
  if (existsSync(dir)) {
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".yaml"))) {
      const name = f.replace(/\.yaml$/, "");
      if (PUBLIC_PROJECTS.has(name)) continue;
      words.add(name.split("-")[0]!);
      try {
        const repo = (parse(readFileSync(join(dir, f), "utf8")) as { repo?: string }).repo;
        if (repo) words.add(basename(repo).split(/[.-]/)[0]!);
      } catch { /* an unreadable config adds only its name */ }
    }
  }
  return [...words].filter((w) => w.length >= 3).map((w) => w.toLowerCase());
}

/** Home paths -> ~, the user and host names -> operator / host, emails, then secrets. */
export function scrub(text: string, words: { user: string; host: string } = { user: userInfo().username, host: hostname() }): string {
  let t = text.split(homedir()).join("~").replace(/\/home\/[^/\s"'`]+/g, "~");
  t = t.replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "«email»");
  for (const [w, to] of [[words.user, "operator"], [words.host, "host"]] as const) if (w.length >= 3) t = t.replace(new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi"), to);
  return t.replace(/\b(sk-ant-[A-Za-z0-9_-]{20,}|sk-(proj-)?[A-Za-z0-9_-]{32,}|gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,})\b/g, "«SECRET»");
}

/** Anything in `text` that must not be published: secrets, home paths, emails, forbidden words. */
export function leaksIn(file: string, text: string, forbidden: string[]): string[] {
  const out = scanText(file, text).map((h) => `${file}:${h.line}: secret (${h.rule})`);
  if (/\/home\//.test(text)) out.push(`${file}: a /home/ path`);
  if (/[\w.+-]+@[\w-]+\.[\w.-]+/.test(text.replace(/«email»/g, "")) && /@[\w-]+\.(com|net|org|io|pk)\b/.test(text)) out.push(`${file}: an email address`);
  const low = text.toLowerCase();
  for (const w of forbidden) if (new RegExp(`(?<![a-z0-9])${w}(?![a-z0-9])`).test(low)) out.push(`${file}: "${w}"`);
  return out;
}

const DROP = /(^|\/)(\.env[^/]*|[^/]*token[^/]*|[^/]*cache[^/]*)$/i;

/** A scrubbed copy of a ledger folder; dropped files are listed. Binary files are dropped: they can't be scrubbed. */
export function scrubbedCopy(src: string): { dir: string; dropped: string[] } {
  const dir = mkdtempSync(join(tmpdir(), "evidence-ledger-"));
  const dropped: string[] = [];
  const walk = (rel: string): void => {
    for (const n of readdirSync(join(src, rel))) {
      const r = rel ? `${rel}/${n}` : n;
      const st = statSync(join(src, r));
      if (st.isDirectory()) { walk(r); continue; }
      if (DROP.test(r)) { dropped.push(r); continue; }
      const buf = readFileSync(join(src, r));
      if (buf.includes(0)) { dropped.push(`${r} (binary)`); continue; }
      mkdirSync(dirname(join(dir, r)), { recursive: true });
      writeFileSync(join(dir, r), scrub(buf.toString("utf8")));
    }
  };
  walk("");
  return { dir, dropped };
}

function filesUnder(d: string): string[] {
  return readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? filesUnder(p) : [p]; });
}

/** Where a run's ledger is: an archive, the real home, or an eval home. */
export function findRun(runId: string): string | undefined {
  const tgz = join(ARCHIVE, `${runId}.tar.gz`);
  if (existsSync(tgz)) return tgz;
  if (existsSync(join(REAL_HOME, "ledger", runId, "events.jsonl"))) return join(REAL_HOME, "ledger", runId);
  const evals = join(REAL_HOME, "tmp", "evals");
  for (const h of existsSync(evals) ? readdirSync(evals) : []) if (existsSync(join(evals, h, "ledger", runId, "events.jsonl"))) return join(evals, h, "ledger", runId);
  return undefined;
}

/** The e2e scoring of a run (hidden tests), when an eval made it. */
function e2eRowFor(runId: string): unknown {
  const files = [...(existsSync(ARCHIVE) ? readdirSync(ARCHIVE).filter((f) => f.endsWith(".e2e-result.json")).map((f) => join(ARCHIVE, f)) : []),
    ...(existsSync(join(ROOT, "bench", "e2e", "results")) ? readdirSync(join(ROOT, "bench", "e2e", "results")).filter((f) => f.endsWith("-paid.json")).map((f) => join(ROOT, "bench", "e2e", "results", f)) : [])];
  for (const f of files) {
    const rows = JSON.parse(readFileSync(f, "utf8")) as { run?: { runId?: string } }[];
    const hit = rows.find((r) => r.run?.runId === runId);
    if (hit) return hit;
  }
  return undefined;
}

export interface Published { runId: string; folder?: string; refused?: string; archiveKept: boolean; dropped: string[] }

/** Publish one run. Refuses a run whose project isn't public, and anything that still leaks after scrubbing. */
export function publishRun(runId: string, opts: { forbidden?: string[]; evidence?: string; factoryCommit?: string } = {}): Published {
  const forbidden = opts.forbidden ?? forbiddenWords();
  const root = opts.evidence ?? EVIDENCE;
  const ref = findRun(runId) ?? runId;
  const ledger = openRun(ref);
  const info = replay(ledger.events()).info;
  if (!PUBLIC_PROJECTS.has(info.project)) return { runId, refused: `project is not on the public allowlist (it stays on this machine)`, archiveKept: false, dropped: [] };
  const name = `${(info.runId.match(/^(\d{4})(\d{2})(\d{2})/) ?? []).slice(1).join("-")}-${info.runId.replace(/^\d{8}-/, "")}`;
  const folder = join(root, "runs", name);
  const { dir, dropped } = scrubbedCopy(ledger.dir);
  try {
    // a run older than commit recording takes it from the command line, or keeps what an earlier publish was told
    const before = existsSync(join(folder, "row.json")) ? (JSON.parse(readFileSync(join(folder, "row.json"), "utf8")) as { factoryCommit?: string }).factoryCommit : undefined;
    const row = rowOf(ledger, { factoryCommit: opts.factoryCommit ?? before }) as RunRow & { e2e?: unknown };
    const e2e = e2eRowFor(runId);
    const rowText = scrub(JSON.stringify({ ...row, ...(e2e ? { e2e } : {}) }, null, 2));
    const mdText = scrub(markdown(row));
    const leaks = [...filesUnder(dir).flatMap((f) => leaksIn(relative(dir, f), readFileSync(f, "utf8"), forbidden)), ...leaksIn("row.json", rowText, forbidden), ...leaksIn("record.md", mdText, forbidden)];
    if (leaks.length) return { runId, refused: `still leaks after scrubbing: ${leaks.slice(0, 5).join("; ")}`, archiveKept: false, dropped };
    mkdirSync(folder, { recursive: true });
    const tgz = join(folder, "ledger.tar.gz");
    execFileSync("tar", ["-czf", tgz, "-C", dir, "."]);
    const archiveKept = statSync(tgz).size <= MAX_ARCHIVE_BYTES;
    if (!archiveKept) rmSync(tgz);
    writeFileSync(join(folder, "row.json"), `${rowText}\n`);
    writeFileSync(join(folder, "record.md"), `# ${info.runId}\n\n${mdText}\n${archiveKept ? "\nThe scrubbed ledger is in `ledger.tar.gz` (events, trace, cards, artifacts).\n" : "\nThe scrubbed ledger is over 5 MB: it is attached to a GitHub release instead of this folder.\n"}${dropped.length ? `\nLeft out of the ledger: ${dropped.join(", ")}.\n` : ""}`);
    return { runId, folder: relative(root, folder), archiveKept, dropped };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

/** Every paid run on a public project this machine knows about. */
export function publicPaidRuns(): string[] {
  const ids = new Set<string>();
  const dirs = [join(REAL_HOME, "ledger"), ...(existsSync(join(REAL_HOME, "tmp", "evals")) ? readdirSync(join(REAL_HOME, "tmp", "evals")).map((h) => join(REAL_HOME, "tmp", "evals", h, "ledger")) : [])];
  for (const d of dirs.filter(existsSync)) for (const id of readdirSync(d)) {
    try {
      const first = JSON.parse(readFileSync(join(d, id, "events.jsonl"), "utf8").split("\n")[0]!) as { data?: { project?: string } };
      if (!PUBLIC_PROJECTS.has(first.data?.project ?? "")) continue;
      const cost = replay(openRun(join(d, id)).events()).costUsd;
      if (cost > 0) ids.add(id);
    } catch { /* not a run folder */ }
  }
  return [...ids].sort();
}

/** The eval results kept in the repo: the latest of each kind, scrubbed and checked, with a short table. */
export function publishEvals(opts: { forbidden?: string[]; evidence?: string; from?: string } = {}): string[] {
  const forbidden = opts.forbidden ?? forbiddenWords();
  const root = opts.evidence ?? EVIDENCE;
  const from = opts.from ?? ROOT; // the checkout whose bench/*/results the runs wrote
  const out: string[] = [];
  const latest = (dir: string, suffix: string) => (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(suffix)).sort().map((f) => join(dir, f)) : []);
  const kinds: [string, string[]][] = [
    ["e2e", [...latest(join(from, "bench", "e2e", "results"), "-paid.json"), ...latest(join(from, "bench", "e2e", "results"), "-validate.json").slice(-1)]],
    ["spec", latest(join(from, "bench", "spec", "results"), ".json").slice(-1)],
  ];
  for (const [suite, files] of kinds) for (const f of files) {
    const text = scrub(readFileSync(f, "utf8"));
    const leaks = leaksIn(basename(f), text, forbidden);
    if (leaks.length) { out.push(`skipped ${suite}/${basename(f)}: ${leaks[0]}`); continue; }
    const d = join(root, "evals", suite);
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, basename(f)), text);
    out.push(`${suite}/${basename(f)}`);
  }
  return out;
}

/** The judges' first page: one table of every published run, then the hand-written gaps (evidence/gaps.md). */
export function writeReadme(root = EVIDENCE): void {
  const runsDir = join(root, "runs");
  const rows = (existsSync(runsDir) ? readdirSync(runsDir).sort() : []).flatMap((n) => {
    const f = join(runsDir, n, "row.json");
    if (!existsSync(f)) return [];
    const r = JSON.parse(readFileSync(f, "utf8")) as RunRow & { e2e?: { hidden?: { passed: number; total: number }; outcome?: string; stoppedAt?: string } };
    const hidden = r.e2e?.hidden ? ` · hidden tests ${r.e2e.hidden.passed}/${r.e2e.hidden.total}` : "";
    const result = `${r.e2e?.outcome ?? r.outcome}${hidden}${r.e2e?.stoppedAt ? ` (${r.e2e.stoppedAt})` : ""}`;
    return [`| ${n.slice(0, 10)} | ${r.factoryCommit ?? "not recorded"} | ${r.ticket.replace(/\|/g, "/").slice(0, 70)} | ${result} | $${r.costUsd.toFixed(2)} | ${r.activeMin.toFixed(1)} | [${n}](runs/${n}/) |`];
  });
  // the e2e results, factory and baseline side by side (each a row the harness wrote)
  const e2eDir = join(root, "evals", "e2e");
  const e2e = (existsSync(e2eDir) ? readdirSync(e2eDir).filter((f) => f.endsWith("-paid.json")).sort() : []).flatMap((f) =>
    (JSON.parse(readFileSync(join(e2eDir, f), "utf8")) as { caseId: string; mode: string; outcome: string; stoppedAt?: string; hidden?: { passed: number; total: number }; costUsd: number; minutes: number; prodLines?: number; creepFiles: string[]; run?: { changes?: { testLinesAdded: number } } }[])
      .map((r) => `| ${f.slice(0, 10)} | ${r.caseId} | ${r.mode} | ${r.outcome}${r.stoppedAt ? ` (${r.stoppedAt})` : ""} | ${r.hidden ? `${r.hidden.passed}/${r.hidden.total}` : "-"} | $${r.costUsd.toFixed(2)} | ${r.minutes.toFixed(1)} | ${r.prodLines ?? "-"} | ${r.run?.changes?.testLinesAdded ?? 0} | ${r.creepFiles.length} | [json](evals/e2e/${f}) |`));
  const evals = existsSync(join(root, "evals")) ? readdirSync(join(root, "evals")).sort().flatMap((s) => readdirSync(join(root, "evals", s)).sort().map((f) => `- \`${s}\`: [${f}](evals/${s}/${f})`)) : [];
  const gaps = existsSync(join(root, "gaps.md")) ? readFileSync(join(root, "gaps.md"), "utf8").trim() : "";
  writeFileSync(join(root, "README.md"), [
    "# Evidence",
    "",
    "Runs of the factory on public repos, and eval results. Every ledger here is the run's own record (events, trace, cards,",
    "artifacts), scrubbed of local paths and names. Generated by `npm run eval -- publish`; runs on private client code are never",
    "published.",
    "",
    "| Date | Factory | Ticket | Result | Cost | Active min | Folder |",
    "|---|---|---|---|---|---|---|",
    ...rows,
    "",
    ...(e2e.length ? ["## End-to-end eval: a ticket, scored by hidden tests the factory never saw", "",
      "| Date | Case | Mode | Outcome | Hidden tests | Cost | Minutes | Prod lines | Test lines | Creep files | Result |",
      "|---|---|---|---|---|---|---|---|---|---|---|", ...e2e, ""] : []),
    "## Eval results",
    ...(evals.length ? evals : ["(none yet)"]),
    ...(gaps ? ["", gaps] : []),
    "",
  ].join("\n"));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const ids = args.includes("--all-public") ? publicPaidRuns() : args.filter((a, i) => !a.startsWith("--") && !["--from", "--factory-commit"].includes(args[i - 1] ?? ""));
  if (!ids.length) { console.error("Use: publish <run-id> | publish --all-public"); process.exit(2); }
  const forbidden = forbiddenWords();
  let refused = 0;
  for (const id of ids) {
    const fc = args.indexOf("--factory-commit");
    const p = publishRun(id, { forbidden, ...(fc >= 0 ? { factoryCommit: args[fc + 1] } : {}) });
    if (p.refused) { refused++; console.log(`skipped ${id}: ${p.refused}`); } else console.log(`published ${id} -> evidence/${p.folder}${p.archiveKept ? "" : " (ledger over 5 MB: attach it to a release)"}`);
  }
  const fromIdx = args.indexOf("--from");
  if (args.includes("--all-public")) for (const e of publishEvals({ forbidden, ...(fromIdx >= 0 ? { from: args[fromIdx + 1] } : {}) })) console.log(`eval ${e}`);
  writeReadme();
  // the last word: nothing in evidence/ may leak
  const leaks = filesUnder(EVIDENCE).filter((f) => !f.endsWith(".tar.gz")).flatMap((f) => leaksIn(relative(EVIDENCE, f), readFileSync(f, "utf8"), forbidden));
  if (leaks.length) { console.error(`LEAKS in evidence/:\n${leaks.slice(0, 20).join("\n")}`); process.exit(1); }
  console.log(`\nevidence/ checked: no secrets, home paths, emails or local names${refused ? `; ${refused} run(s) skipped` : ""}.`);
}
