// `factory watch`: a Jira ticket labelled by an allowed person starts a run; Jira and Slack hear about
// it as the run goes. A side process: it reads run ledgers and keeps its own state file, never writes to
// a ledger, never answers or approves (cards stay terminal-only), and makes no model calls. What costs
// credits is the runs it starts, so every start passes the guards below first.
import { isLockFree } from "../ledger/exec-lock.js";
import { Ledger } from "../ledger/ledger.js";
import { replay, type RunState } from "../ledger/state.js";
import type { ProjectConfig } from "../config/project.js";
import { adfToText, allowedPerson, type JiraPerson } from "../sources/jira.js";
import { adfParagraphs, JiraHttpError, type JiraClient, type JiraIssue } from "./jira-client.js";
import type { Notice, Notifier } from "./notify.js";
import { loadState, saveState, type Update, type WatchState } from "./state.js";

type JiraCfg = NonNullable<ProjectConfig["jira"]>;
export type JiraApi = Pick<JiraClient, "labelledTickets" | "issue" | "lastLabelAdd" | "comments" | "addComment" | "transition" | "base">;

export interface WatcherDeps {
  jira: JiraApi;
  notifiers: Notifier[];
  /** create the run exactly like `factory start --jira KEY` and start its executor; returns the run id */
  start(key: string): Promise<string>;
  /** start a run's executor in the background (runDetached) */
  execute(runId: string): void;
  lockFree?(project: string): Promise<boolean>;
  now?(): Date;
}

export const MAX_UPDATE_TRIES = 3;
/** don't start an executor again for a run we started less than this long ago (it may still be booting) */
const KICK_GRACE_MS = 3 * 60_000;

export type RunPhase = "active" | "waiting" | "parked" | "paused" | "delivered" | "closed";

export function phaseOf(s: RunState): RunPhase {
  if (typeof s.status === "object") return "closed";
  if (s.status === "delivered") return "delivered";
  if (s.status === "parked") return "parked";
  if (s.status === "paused") return "paused";
  if (s.openCard) return "waiting";
  return "active";
}

/** Jira writes "2026-09-30T10:22:29.297+0500"; make it a time JS parses the same everywhere. */
export const jiraTime = (t: string): number => Date.parse(t.replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));

const dayOf = (iso: string | undefined) => (iso ?? "").slice(0, 10);
const monthOf = (iso: string | undefined) => (iso ?? "").slice(0, 7);

export interface TickResult { started?: string; skipped: string[]; sent: number; failed: number; resumed: string[]; blocked?: string; retryAfterSec?: number }

export class Watcher {
  private readonly now: () => Date;
  private readonly lockFree: (p: string) => Promise<boolean>;

  constructor(private readonly project: string, private readonly cfg: JiraCfg, private readonly deps: WatcherDeps) {
    this.now = deps.now ?? (() => new Date());
    this.lockFree = deps.lockFree ?? isLockFree;
  }

  private log(s: WatchState, msg: string): void {
    s.log.push({ at: this.now().toISOString(), msg });
  }

  private runState(runId: string): RunState | undefined {
    try { return Ledger.exists(runId) ? replay(Ledger.open(runId).events()) : undefined; } catch { return undefined; }
  }

  async tick(): Promise<TickResult> {
    const s = loadState(this.project);
    const out: TickResult = { skipped: [], sent: 0, failed: 0, resumed: [] };
    try {
      this.resolveStarting(s);
      await this.sendUpdates(s, out);
      await this.resumeReady(s, out);
      await this.maybeStart(s, out);
    } catch (e) {
      if (e instanceof JiraHttpError && e.status === 429) { out.retryAfterSec = e.retryAfterSec; this.log(s, `Jira rate limit: waiting ${e.retryAfterSec}s`); }
      else { this.log(s, `tick failed: ${(e as Error).message}`); throw e; }
    } finally {
      saveState(this.project, s);
    }
    return out;
  }

  // ---------- 1. updates: Jira comments and Slack messages for the watcher's own runs ----------

  /** What people should hear about a ledger event, if anything. */
  private noticeFor(runId: string, key: string, ev: { seq: number; type: string; data?: unknown }, st: RunState): { id: string; notice: Notice; jira: string[]; transition?: string } | undefined {
    const d = (ev.data ?? {}) as Record<string, unknown>;
    const ticket = `${this.deps.jira.base}/browse/${key}`;
    switch (ev.type) {
      case "run.created":
        return {
          id: "started", transition: this.cfg.transitions.started,
          notice: { title: `${key}: the factory started a run`, lines: [`Run \`${runId}\`, limited to $${this.cfg.maxCostPerRun}.`, "It stops for questions and for plan approval. Questions can be answered in the terminal or on the run page in `factory ui`; plan approval stays in the terminal."], command: `factory logs ${runId} --follow`, links: [{ text: key, url: ticket }] },
          jira: [`The AI factory started run \`${runId}\` for this ticket (cost limit $${this.cfg.maxCostPerRun}).`, `It will stop for questions and for plan approval. A person answers questions in their terminal or on the run page in \`factory ui\`, and approves the plan in the terminal. Follow it with \`factory logs ${runId} --follow\`.`, `factory-run:${runId}:started`],
        };
      case "human.requested": {
        const kind = String(d.kind ?? "card");
        const cmd = `factory show-card ${runId}`;
        return {
          id: `card:${ev.seq}`,
          notice: { title: `${key}: a ${kind} card is waiting for you`, lines: [kind === "question" ? `Run \`${runId}\` is paused for answers: type them in the terminal, or on the run page in \`factory ui\`.` : `Run \`${runId}\` is paused until someone decides in the terminal.`], command: cmd, links: [{ text: key, url: ticket }] },
          jira: [`The factory run is waiting for a person: a ${kind} card. ${kind === "question" ? "Answer it in the terminal (or on the run page in `factory ui`)" : "Answer it in the terminal"}: \`${cmd}\`.`, `factory-run:${runId}:card:${ev.seq}`],
        };
      }
      case "run.parked": {
        const reason = String(d.reason ?? "").replace(/\s+/g, " ").slice(0, 200);
        return {
          id: `parked:${ev.seq}`,
          notice: { title: `${key}: the run stopped and needs a person`, lines: [reason], command: `factory report ${runId}`, links: [{ text: key, url: ticket }] },
          jira: [`The factory run stopped and needs a person to look: ${reason}`, `Details: \`factory report ${runId}\`.`, `factory-run:${runId}:parked:${ev.seq}`],
        };
      }
      case "run.delivered": {
        const branch = String(d.branch ?? "");
        const pr = typeof d.prUrl === "string" ? d.prUrl : undefined;
        const passed = st.gates.filter((g) => g.passed).length;
        const summary = `Cost $${st.costUsd.toFixed(2)} · ${passed} of ${st.gates.length} checks passed.`;
        return {
          id: "delivered", transition: this.cfg.transitions.delivered,
          notice: { title: `${key}: delivered`, lines: [pr ? `Pull request ready for review.` : `Branch \`${branch}\` is ready locally.`, summary], links: [...(pr ? [{ text: "Pull request", url: pr }] : []), { text: key, url: ticket }] },
          jira: [pr ? `The factory delivered a pull request: ${pr}` : `The factory delivered branch \`${branch}\` (local; no pull request).`, summary, `factory-run:${runId}:delivered`],
        };
      }
      case "run.stopped":
        return {
          id: "stopped",
          notice: { title: `${key}: the run was stopped`, lines: [`Run \`${runId}\` was stopped by a person.`], links: [{ text: key, url: ticket }] },
          jira: [`The factory run \`${runId}\` was stopped by a person.`, `factory-run:${runId}:stopped`],
        };
      default: return undefined;
    }
  }

  private async sendUpdates(s: WatchState, out: TickResult): Promise<void> {
    for (const [runId, run] of Object.entries(s.runs)) {
      if (!Ledger.exists(runId)) continue;
      const ledger = Ledger.open(runId);
      const events = ledger.events();
      const st = replay(events);
      const pending: { id: string; notice: Notice; jira: string[]; transition?: string }[] = [];
      for (const ev of events.filter((e) => e.seq > run.lastSeq)) {
        const n = this.noticeFor(runId, run.key, ev, st);
        if (n) pending.push(n);
      }
      // record intent for every new update before sending anything (once-only across crashes)
      for (const p of pending) {
        if (!run.updates[`jira:${p.id}`]) run.updates[`jira:${p.id}`] = { status: "intent", tries: 0 };
        for (const nt of this.deps.notifiers) if (!run.updates[`${nt.name}:${p.id}`]) run.updates[`${nt.name}:${p.id}`] = { status: "intent", tries: 0 };
      }
      run.lastSeq = events.at(-1)?.seq ?? run.lastSeq;
      // notices can be rebuilt from the ledger, so retries of older updates don't need them stored
      const byId = new Map<string, { notice: Notice; jira: string[]; transition?: string }>();
      for (const ev of events) { const n = this.noticeFor(runId, run.key, ev, st); if (n) byId.set(n.id, n); }
      for (const [uid, u] of Object.entries(run.updates)) {
        if (u.status === "done" || u.tries >= MAX_UPDATE_TRIES) continue;
        const [channel, ...rest] = uid.split(":");
        const n = byId.get(rest.join(":"));
        if (!n) continue;
        await this.deliverUpdate(s, run.key, runId, channel!, n, u, out);
      }
    }
  }

  private async deliverUpdate(s: WatchState, key: string, runId: string, channel: string, n: { notice: Notice; jira: string[]; transition?: string }, u: Update, out: TickResult): Promise<void> {
    u.tries++;
    u.status = "intent";
    saveState(this.project, s);
    try {
      if (channel === "jira") {
        const marker = n.jira[n.jira.length - 1]!;
        // look-up first: a comment posted before a crash is found by its marker, never posted twice
        const existing = (await this.deps.jira.comments(key)).find((c) => c.text.includes(marker));
        u.externalId = existing?.id ?? await this.deps.jira.addComment(key, adfParagraphs(n.jira));
        if (n.transition) {
          const moved = await this.deps.jira.transition(key, n.transition).catch(() => false);
          if (!moved) this.log(s, `${key}: no "${n.transition}" transition available; left as is`);
        }
      } else {
        const nt = this.deps.notifiers.find((x) => x.name === channel);
        if (!nt) return;
        await nt.send(n.notice);
      }
      u.status = "done";
      delete u.error;
      out.sent++;
    } catch (e) {
      if (e instanceof JiraHttpError && e.status === 429) throw e;
      // a failed update never touches the run: note it, retry next tick, give up after a few tries
      u.status = "failed";
      u.error = (e as Error).message.slice(0, 200);
      out.failed++;
      this.log(s, `${key}: ${channel} update failed (try ${u.tries}/${MAX_UPDATE_TRIES}): ${u.error}`);
    }
  }

  // ---------- 2. runs that are ready but have no executor (e.g. an approval came in while another run held the repo) ----------

  private async resumeReady(s: WatchState, out: TickResult): Promise<void> {
    if (!(await this.lockFree(this.project))) return;
    for (const [runId, run] of Object.entries(s.runs)) {
      const st = this.runState(runId);
      if (!st || phaseOf(st) !== "active") continue;
      if (run.kickedAt && this.now().getTime() - Date.parse(run.kickedAt) < KICK_GRACE_MS) continue;
      run.kickedAt = this.now().toISOString();
      this.deps.execute(runId);
      out.resumed.push(runId);
      this.log(s, `${run.key}: started the executor for ${runId} again (it was ready with nothing running it)`);
      return; // one at a time: the repo takes one executor
    }
  }

  // ---------- 3 + 4. guards, then at most one new ticket ----------

  /** Why nothing may start right now, or undefined. */
  private async blocked(s: WatchState): Promise<string | undefined> {
    const today = dayOf(this.now().toISOString()), month = monthOf(this.now().toISOString());
    let runsToday = 0, spentToday = 0, spentMonth = 0;
    for (const runId of Object.keys(s.runs)) {
      const st = this.runState(runId);
      if (!st) continue;
      const phase = phaseOf(st);
      if (phase === "active") return `run ${runId} is still working; the next ticket waits for it`;
      if (dayOf(st.info.createdAt) === today) { runsToday++; spentToday += st.costUsd; }
      if (monthOf(st.info.createdAt) === month) spentMonth += st.costUsd;
    }
    if (!(await this.lockFree(this.project))) return "another run holds this repo";
    if (runsToday >= this.cfg.maxRunsPerDay) return `the daily limit of ${this.cfg.maxRunsPerDay} runs is reached`;
    if (spentToday >= this.cfg.dailyBudgetUsd) return `today's budget of $${this.cfg.dailyBudgetUsd} is used ($${spentToday.toFixed(2)})`;
    if (spentMonth >= this.cfg.monthlyBudgetUsd) return `this month's budget of $${this.cfg.monthlyBudgetUsd} is used ($${spentMonth.toFixed(2)})`;
    return undefined;
  }

  /** Free rules, checked before anything costs money. */
  skipReason(t: JiraIssue): string | undefined {
    if (t.hierarchyLevel > 0 || /^epic$/i.test(t.issueType)) return "it's an epic; the factory works on single tickets";
    if (t.subtask) return "it's a sub-task; label the parent ticket instead";
    const text = adfToText(t.description).trim();
    if (text.length < this.cfg.minDescriptionChars) return `its description is too short (${text.length} characters; at least ${this.cfg.minDescriptionChars} are needed to know what to build)`;
    return undefined;
  }

  private allowed(who: JiraPerson | undefined): boolean {
    return allowedPerson(this.cfg.allowedReporters)(who);
  }

  private async comment(key: string, paragraphs: string[], marker: string): Promise<void> {
    const found = (await this.deps.jira.comments(key)).some((c) => c.text.includes(marker));
    if (!found) await this.deps.jira.addComment(key, adfParagraphs([...paragraphs, marker]));
  }

  /** A run the watcher created for this ticket at or after `since` that it isn't tracking yet. */
  private findRun(s: WatchState, key: string, since: string): string | undefined {
    const from = Date.parse(since) - 60_000; // the ledger's clock and ours may differ a little
    for (const runId of Ledger.listRuns()) {
      if (s.runs[runId]) continue;
      const st = this.runState(runId);
      if (!st || st.info.project !== this.project || st.info.operator !== "factory watch") continue;
      if (!st.info.sources?.some((x) => x.kind === "jira" && x.key === key)) continue;
      if (Date.parse(st.info.createdAt) >= from) return runId;
    }
    return undefined;
  }

  private track(s: WatchState, key: string, runId: string): void {
    s.seen[key] = { at: this.now().toISOString(), runId };
    // lastSeq -1: the run's first event (seq 0, run.created) still needs its "started" update
    s.runs[runId] = { key, lastSeq: -1, updates: {}, kickedAt: this.now().toISOString() };
  }

  /**
   * A "starting" record without a run id: the watcher stopped between asking for a run and saving it.
   * If the run exists it's tracked from here; if not, the ticket is NOT started again on its own (that
   * could be a second paid run): it's left for a person, and only the log says so.
   */
  private resolveStarting(s: WatchState): void {
    for (const [key, seen] of Object.entries(s.seen)) {
      if (!seen.starting || seen.runId) continue;
      const runId = this.findRun(s, key, seen.starting);
      if (runId) {
        this.track(s, key, runId);
        this.log(s, `${key}: found run ${runId}, started just before the watcher stopped; following it now`);
      } else {
        s.seen[key] = { at: seen.at, skipped: "the watcher stopped while starting it and no run was found; remove and add the label again to start it" };
        this.log(s, `${key}: the watcher stopped while starting a run and no run was found; not starting it again on its own (remove and add the "${this.cfg.label}" label to retry)`);
      }
    }
  }

  private async maybeStart(s: WatchState, out: TickResult): Promise<void> {
    // the search finds tickets labelled in the last few minutes; tickets already waiting are read by key
    const found = await this.deps.jira.labelledTickets(this.cfg.project, this.cfg.label);
    const byKey = new Map(found.map((t) => [t.key, t]));
    for (const key of Object.keys(s.pending)) {
      if (byKey.has(key)) continue;
      const t = await this.deps.jira.issue(key);
      const gone = !t ? "it can't be found any more" : !t.labels.includes(this.cfg.label) ? `the "${this.cfg.label}" label was removed` : t.toDo === false ? "it isn't in a To Do status any more" : undefined;
      if (gone) { delete s.pending[key]; this.log(s, `${key}: no longer waiting to start, ${gone}`); continue; }
      byKey.set(key, t!);
    }
    // waiting tickets first, oldest first; then new ones in Jira's order (oldest created first)
    const waiting = Object.entries(s.pending).filter(([k]) => byKey.has(k)).sort((a, b) => a[1].since.localeCompare(b[1].since)).map(([k]) => k);
    const order = [...waiting, ...found.map((t) => t.key).filter((k) => !s.pending[k])];

    const ready: { t: JiraIssue; by: JiraPerson | undefined; via: string }[] = [];
    for (const key of order) {
      const t = byKey.get(key)!;
      const seen = s.seen[key];
      const add = await this.deps.jira.lastLabelAdd(key, this.cfg.label);
      if (seen) {
        // a seen ticket starts again only if the label was re-added after it was last handled,
        // and its earlier run is finished (so editing a ticket never re-runs it)
        const prev = seen.runId ? this.runState(seen.runId) : undefined;
        const prevDone = !prev || ["delivered", "closed"].includes(phaseOf(prev));
        if (!(add && jiraTime(add.at) > Date.parse(seen.at) && prevDone)) { delete s.pending[key]; continue; }
      }
      const by = add?.by ?? t.reporter;
      const via = add ? "added the label" : "reported it (the label history wasn't available)";
      // trust first: a ticket labelled by someone not on the list gets no comment, no notice, nothing
      if (!this.allowed(by)) {
        s.seen[key] = { at: this.now().toISOString(), skipped: `the person who ${via} isn't on the allowed list` };
        delete s.pending[key];
        out.skipped.push(key);
        this.log(s, `${key}: not started, the person who ${via} (${by?.displayName ?? by?.emailAddress ?? "unknown"}) isn't on the allowed list`);
        continue;
      }
      const skip = this.skipReason(t);
      if (skip) {
        s.seen[key] = { at: this.now().toISOString(), skipped: skip };
        delete s.pending[key];
        out.skipped.push(key);
        this.log(s, `${key}: skipped, ${skip}`);
        await this.comment(key, [`The AI factory didn't start this ticket: ${skip}. Fix that, then remove and add the "${this.cfg.label}" label again.`], `factory-skip:${key}:${s.seen[key]!.at}`).catch((e: Error) => this.log(s, `${key}: skip comment failed: ${e.message}`));
        continue;
      }
      ready.push({ t, by, via });
    }
    if (!ready.length) return;
    // everything that passed the checks waits in the state until it starts; Jira's search may not find it again
    for (const { t } of ready) s.pending[t.key] ??= { since: this.now().toISOString() };

    const why = await this.blocked(s);
    if (why) {
      out.blocked = why;
      if (/budget|daily limit/.test(why)) {
        for (const { t } of ready) {
          const p = s.pending[t.key]!;
          if (p.budgetNoted) continue;
          try {
            await this.comment(t.key, [`The AI factory didn't start this ticket yet: ${why}. It will start when the budget allows; nothing else is needed.`], `factory-budget:${t.key}`);
            p.budgetNoted = true;
          } catch (e) { this.log(s, `${t.key}: budget comment failed: ${(e as Error).message}`); }
        }
        const day = dayOf(this.now().toISOString());
        if (!s.notices[`budget:${day}`]) {
          s.notices[`budget:${day}`] = this.now().toISOString();
          const keys = Object.keys(s.pending).join(", ");
          this.log(s, `not starting ${keys}: ${why}`);
          for (const nt of this.deps.notifiers) await nt.send({ title: "The factory paused new runs", lines: [`${why}.`, `Waiting: ${keys}.`] }).catch((e: Error) => this.log(s, `${nt.name} budget notice failed: ${e.message}`));
        }
      }
      return; // tickets wait in the state: they start once the guard clears
    }

    const { t, by, via } = ready[0]!;
    const prevSeen = s.seen[t.key], prevPending = s.pending[t.key];
    // a "starting" record goes to disk before the run is asked for, so a crash in between can't lead to a second run
    const reserved = this.now().toISOString();
    s.seen[t.key] = { at: reserved, starting: reserved };
    delete s.pending[t.key];
    saveState(this.project, s);
    let runId: string;
    try {
      runId = await this.deps.start(t.key);
    } catch (e) {
      const made = this.findRun(s, t.key, reserved);
      if (!made) {
        // no run was created: the ticket goes to the back of the queue; after 3 failed starts it's dropped
        // (re-adding the label tries again), so one broken ticket can't block the others
        if (prevSeen) s.seen[t.key] = prevSeen; else delete s.seen[t.key];
        const failedStarts = (prevPending?.failedStarts ?? 0) + 1;
        if (failedStarts >= 3) s.seen[t.key] = { at: reserved, skipped: `couldn't start: ${(e as Error).message}`.slice(0, 200) };
        else s.pending[t.key] = { ...(prevPending ?? {}), since: reserved, failedStarts };
        this.log(s, `${t.key}: couldn't start a run (${failedStarts}/3): ${(e as Error).message}`);
        saveState(this.project, s);
        throw e;
      }
      runId = made;
    }
    this.track(s, t.key, runId);
    out.started = runId;
    this.log(s, `${t.key}: started run ${runId} (${by?.displayName ?? by?.emailAddress ?? "someone"} ${via})`);
    await this.sendUpdates(s, out);
    // one new run per tick, one run per repo at a time
  }
}
