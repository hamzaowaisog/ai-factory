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
  /** once-a-day notices already sent ("budget:2026-10-01") */
  notices: Record<string, string>;
  log: { at: string; msg: string }[];
}

export function statePath(project: string): string {
  return join(factoryHome(), "watch", `${project}.json`);
}

export function loadState(project: string): WatchState {
  const p = statePath(project);
  if (!existsSync(p)) return { seen: {}, runs: {}, notices: {}, log: [] };
  const s = JSON.parse(readFileSync(p, "utf8")) as Partial<WatchState>;
  return { seen: s.seen ?? {}, runs: s.runs ?? {}, notices: s.notices ?? {}, log: s.log ?? [] };
}

export function saveState(project: string, s: WatchState): void {
  const p = statePath(project);
  mkdirSync(join(factoryHome(), "watch"), { recursive: true, mode: 0o700 });
  const tmp = `${p}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify({ ...s, log: s.log.slice(-500) }, null, 1), { mode: 0o600 });
  renameSync(tmp, p);
}
