// The watcher's own memory, one file per project in ~/.factory/watch/. It is NOT the run ledger: the
// watcher never writes to a run's ledger, so runs behave the same with or without it.
// Written atomically (temp file + rename) so a crash never leaves half a file.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { factoryHome } from "../util/paths.js";

export interface SeenTicket {
  at: string;
  runId?: string;
  /** why it was not started (skip rules); a skipped ticket is not retried */
  skipped?: string;
  /**
   * set (to the time) just before the watcher asks for a run, and kept until the run id is saved: a
   * record with this and no runId means the watcher stopped in between, so it looks for that run
   * before anything else and never starts a second one blindly
   */
  starting?: string;
}

/** A ticket that passed the trust and skip checks but couldn't start yet (busy repo, budget, run limit). */
export interface PendingTicket {
  /** when the watcher first saw it waiting; tickets start oldest first */
  since: string;
  /** the "waiting for the budget" comment was posted (once per ticket) */
  budgetNoted?: boolean;
}

/** One outgoing update (a Jira comment or a Slack message) for one run event. */
export interface Update { status: "intent" | "done" | "failed"; tries: number; error?: string; externalId?: string }

export interface WatchedRun {
  key: string;
  /** ledger events up to this seq have been turned into updates */
  lastSeq: number;
  /** "jira:card:12" → state; the key makes every update once-only */
  updates: Record<string, Update>;
  /** when the watcher last started this run's executor (to avoid double starts) */
  kickedAt?: string;
}

export interface WatchState {
  seen: Record<string, SeenTicket>;
  runs: Record<string, WatchedRun>;
  /**
   * tickets waiting to start. Jira's search only finds recently updated tickets, so a waiting ticket is
   * kept here and looked up by its key every tick until it starts (or is no longer labelled / To Do)
   */
  pending: Record<string, PendingTicket>;
  /** once-a-day notices already sent ("budget:2026-10-01") */
  notices: Record<string, string>;
  log: { at: string; msg: string }[];
}

export function statePath(project: string): string {
  return join(factoryHome(), "watch", `${project}.json`);
}

export function loadState(project: string): WatchState {
  const p = statePath(project);
  if (!existsSync(p)) return { seen: {}, runs: {}, pending: {}, notices: {}, log: [] };
  const s = JSON.parse(readFileSync(p, "utf8")) as Partial<WatchState>;
  return { seen: s.seen ?? {}, runs: s.runs ?? {}, pending: s.pending ?? {}, notices: s.notices ?? {}, log: s.log ?? [] };
}

export function saveState(project: string, s: WatchState): void {
  const p = statePath(project);
  mkdirSync(join(factoryHome(), "watch"), { recursive: true, mode: 0o700 });
  const tmp = `${p}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify({ ...s, log: s.log.slice(-500) }, null, 1), { mode: 0o600 });
  renameSync(tmp, p);
}
