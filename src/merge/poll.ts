// The trigger. `factory review-pr` is a command, so until something runs it a pull request opens and
// nothing happens. The documented trigger is a Harness Delegate on this host; this is the same thing
// without Harness: ask the forge which pull requests are open and gate each one.
//
// It deliberately keeps NO memory of what it has already reviewed. Remembering the head SHA would
// skip a pull request whose head is unchanged but whose BASE moved, which is the single case the
// merge gate exists for. Re-gating every tick is safe and nearly free instead, because `reviewPr`
// already decides that for itself: an unchanged tree replays its recorded verdicts, starts no
// container and spends no tokens, and its status is posted only when the commit does not already
// carry it, so a tick that changes nothing writes nothing new.

export interface PollDeps {
  /** Open pull requests on the configured repository. */
  openPrs(): Promise<{ number: number; draft: boolean; headSha: string }[]>;
  /** One full gate. Throws rather than returning a verdict it could not reach. */
  review(pr: number): Promise<{ conclusion: string; cls: string }>;
  log(s: string): void;
}

export interface PollResult {
  reviewed: { pr: number; conclusion: string; cls: string }[];
  /** drafts: the factory marks its own pull request ready once it has posted its review */
  skipped: { pr: number; why: string }[];
  failed: { pr: number; why: string }[];
}

export async function pollOnce(deps: PollDeps): Promise<PollResult> {
  const out: PollResult = { reviewed: [], skipped: [], failed: [] };
  const prs = await deps.openPrs();

  // oldest first, so a queue of pull requests is gated in the order they were opened
  for (const pr of [...prs].reverse()) {
    if (pr.draft) {
      out.skipped.push({ pr: pr.number, why: "still a draft" });
      continue;
    }
    try {
      const r = await deps.review(pr.number);
      out.reviewed.push({ pr: pr.number, conclusion: r.conclusion, cls: r.cls });
      deps.log(`  #${pr.number}: ${r.conclusion} (${r.cls})`);
    } catch (e) {
      // one pull request's failure must not stop the others: a bad ledger, a deleted branch or a
      // container that would not start on #3 says nothing about #4
      const why = (e as Error).message.slice(0, 300);
      out.failed.push({ pr: pr.number, why });
      deps.log(`  #${pr.number}: could not gate — ${why}`);
    }
  }
  return out;
}

/** One line for the log, in the shape `factory watch` already uses. */
export function pollSummary(r: PollResult): string {
  const bits = [
    r.reviewed.length && `${r.reviewed.length} gated`,
    r.failed.length && `${r.failed.length} failed`,
    r.skipped.length && `${r.skipped.length} draft`,
  ].filter(Boolean);
  return bits.length ? bits.join(" · ") : "no open pull requests";
}
