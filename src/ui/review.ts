// The UI's Review tab: what the review agent (the merge gate) last concluded about a run's pull request, each
// pass it made, every gate's latest verdict, and a job that runs one pass now. The pass is `factory review-open-prs`
// for this one pull request: it may start a container, call a model, push a repair commit and write a status and a
// comment to the pull request, and on a project with `forge.autoMerge` it merges a pull request that passes. It can never
// waive a gate, and it is never forced: `--force` stays in the terminal.
import { loadProject } from "../config/project.js";
import { secret } from "../config/env.js";
import { readApproved } from "../conventions/store.js";
import type { Ledger } from "../ledger/ledger.js";
import { replay } from "../ledger/state.js";
import { standingWaivers } from "../merge/adapters.js";
import { COOLDOWN_MS, MAX_ATTEMPTS_PER_PR } from "../merge/repair.js";

export interface ReviewPass {
  at: string;
  /** what moved: a drift class, or `error` when the pass threw before a verdict */
  cls: string;
  conclusion?: string;
  headSha?: string; baseSha?: string;
  title?: string; why?: string;
  repaired?: boolean;
  error?: string;
}

export interface ReviewGate { id: string; passed: boolean; details: string; safety: boolean; step: string; at: string; byReview: boolean; waived?: { by: string; reason: string } }

export interface ReviewJob {
  id: string; runId: string; pr: number; status: "running" | "done" | "failed"; startedAt: string;
  lines: string[];
  result?: { conclusion: string; cls: string; why: string; repaired: boolean };
  error?: string;
}

const PR_NUMBER = /\/pull\/(\d+)(?:[/?#].*)?$/;
const PASSES_SHOWN = 20;

/** What the Review tab shows for one run, or why it has nothing to show. */
export function reviewView(ledger: Ledger, jobs: ReviewJob[] = []) {
  const events = ledger.events();
  const s = replay(events);
  const mine = jobs.filter((j) => j.runId === ledger.runId);
  const job = mine[0];
  const d = (s.steps.get("deliver")?.data ?? {}) as { branch?: string; head?: string; prUrl?: string; local?: boolean };
  const delivered = s.steps.get("deliver")?.status === "completed";
  const pr = d.prUrl ? Number(PR_NUMBER.exec(d.prUrl)?.[1]) : NaN;
  if (!delivered || !d.prUrl || !Number.isInteger(pr)) {
    const none = !delivered ? "The review agent judges a run's pull request. This run has not delivered one yet."
      : "This run was delivered to a local branch, with no pull request, so there is nothing for the review agent to judge.";
    return { runId: ledger.runId, none };
  }

  const passes: ReviewPass[] = [];
  for (const ev of events) {
    if (ev.type !== "step.completed" || ev.key !== "reverify") continue;
    const x = (ev.data ?? {}) as Record<string, unknown>;
    const text = (k: string) => (typeof x[k] === "string" ? { [k]: x[k] as string } : {});
    passes.push({
      at: typeof x.at === "number" ? new Date(x.at).toISOString() : ev.ts, cls: String(x.cls ?? ""),
      ...(x.cls === "error" ? {} : text("conclusion")), ...text("headSha"), ...text("baseSha"), ...text("title"), ...text("why"), ...text("error"),
      ...(x.repaired === true ? { repaired: true } : {}),
    });
  }
  const lastData = (s.steps.get("reverify")?.data ?? {}) as { attemptsThisPr?: number; at?: number; errors?: number };

  // every gate's newest verdict: the review agent replays the build's verdict of a gate whose inputs did not move
  const gates = new Map<string, ReviewGate>();
  for (const ev of events) {
    if (ev.type !== "gate.result") continue;
    const g = (ev.data ?? {}) as { gateId?: string; passed?: boolean; details?: string; safety?: boolean; step?: string };
    if (!g.gateId) continue;
    gates.set(g.gateId, { id: g.gateId, passed: g.passed === true, details: String(g.details ?? ""), safety: g.safety === true, step: g.step ?? "", at: ev.ts, byReview: g.step === "reverify" });
  }

  // a failed gate a person accepted during the build: the review agent replays it as accepted while its inputs stand
  for (const [id, w] of standingWaivers(events as never)) {
    const g = gates.get(id);
    if (g) g.waived = w;
  }
  const rank = (g: ReviewGate) => (g.passed ? 2 : g.waived ? 1 : 0);

  const last = passes.at(-1);
  const verdict = [...passes].reverse().find((p) => p.conclusion);
  const nextAt = typeof lastData.at === "number" && lastData.at + COOLDOWN_MS > Date.now() ? new Date(lastData.at + COOLDOWN_MS).toISOString() : undefined;
  return {
    runId: ledger.runId,
    pr: { number: pr, url: d.prUrl, branch: d.branch ?? "", head: d.head ?? "" },
    ...setupOf(s.info.project),
    ...(verdict ? { verdict } : {}),
    ...(last?.cls === "error" ? { lastError: { at: last.at, error: last.error ?? "", inARow: Number(lastData.errors ?? 1) } } : {}),
    passes: passes.reverse().slice(0, PASSES_SHOWN),
    gates: [...gates.values()].sort((a, b) => rank(a) - rank(b) || Number(b.byReview) - Number(a.byReview) || a.id.localeCompare(b.id)),
    repairs: { used: Number(lastData.attemptsThisPr ?? 0), max: MAX_ATTEMPTS_PER_PR },
    ...(nextAt ? { nextAt } : {}),
    ...(job ? { job } : {}),
  };
}

/** The project's side of the set-up: which stack and repository, and what would stop a pass or fail every one. */
function setupOf(project: string): { stack?: string; repository?: string; autoMerge?: boolean; blocked?: string; warnings: string[] } {
  let cfg;
  try { cfg = loadProject(project); } catch (e) {
    return { blocked: `The project ${project} could not be read: ${(e as Error).message.split("\n")[0]}`, warnings: [] };
  }
  const warnings: string[] = [];
  const guidelines = readApproved(project);
  if ("unapproved" in guidelines) warnings.push(`${guidelines.unapproved.replace(/[.\s]*$/, "")}. Until then the conventions.followed gate fails every pass.`);
  if (!cfg.forge) return { stack: cfg.stack, blocked: `The project ${project} has no forge configured, so its pull requests cannot be read.`, warnings };
  const blocked = secret(cfg.forge.tokenEnv) ? undefined : `${cfg.forge.tokenEnv} is missing in ~/.factory/.env, so the pull request cannot be read or written to.`;
  return { stack: cfg.stack, repository: cfg.forge.repo, autoMerge: cfg.forge.autoMerge, ...(blocked ? { blocked } : {}), warnings };
}

/** One pass of the review agent over one pull request, as the poller runs it (never forced, only this host's runs). */
export async function reviewOnce(project: string, pr: number, log: (line: string) => void): Promise<NonNullable<ReviewJob["result"]>> {
  const { reviewOnce: pass } = await import("../merge/once.js");
  const r = await pass(loadProject(project), pr, log);
  return { conclusion: r.conclusion, cls: r.cls, why: r.why, repaired: r.repaired };
}

/** Review passes started from one UI server: one at a time per run, kept in memory (each verdict is in the run's ledger). */
export class ReviewJobs {
  private jobs: ReviewJob[] = [];
  private n = 0;
  /** what runs the pass; a test swaps it */
  constructor(private run: typeof reviewOnce = reviewOnce) {}

  list(): ReviewJob[] { return this.jobs; }

  /** Start a pass; refused while the run already has one going. Resolves `done` when it ends (tests wait on it). */
  start(runId: string, project: string, pr: number): { job: ReviewJob; done: Promise<void> } {
    if (this.jobs.some((j) => j.runId === runId && j.status === "running")) throw Object.assign(new Error("A review of this pull request is already running."), { status: 409 });
    const job: ReviewJob = { id: `r${++this.n}`, runId, pr, status: "running", startedAt: new Date().toISOString(), lines: [] };
    this.jobs = [job, ...this.jobs].slice(0, 50);
    const done = Promise.resolve().then(() => this.run(project, pr, (m) => { job.lines = [...job.lines, m.trim()].filter(Boolean).slice(-20); }))
      .then((r) => { job.status = "done"; job.result = { ...r, why: r.why.slice(0, 4000) }; })
      .catch((e: Error) => { job.status = "failed"; job.error = e.message.split("\n")[0]!.slice(0, 300); });
    return { job, done };
  }
}

/** Start a pass for a run from the UI: only a delivered pull request of a project that is set up. */
export function startReview(ledger: Ledger, jobs: ReviewJobs): { status: number; json: unknown } {
  const v = reviewView(ledger);
  if (!("pr" in v) || !v.pr) return { status: 409, json: { error: v.none } };
  if (v.blocked) return { status: 409, json: { error: v.blocked } };
  try {
    const { job } = jobs.start(ledger.runId, replay(ledger.events()).info.project, v.pr.number);
    return { status: 202, json: { job } };
  } catch (e) {
    return { status: (e as { status?: number }).status ?? 400, json: { error: (e as Error).message } };
  }
}
