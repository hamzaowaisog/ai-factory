// A person's edits on the client-intent card (docs/superpowers/specs/2026-10-14-transcript-intent-design.md §5). Edits are recorded as
// `edit` decisions and applied here by code, in order, to the checked model answer, so a resumed step never asks the model again.
// Also the brief the approved intent becomes (intake's request) and the card's markdown.
import { IntentStatus, type ClientIntentBody } from "../contracts/index.js";
import type { RunState } from "../ledger/state.js";

export const INTENT_CARD = "intent-";
export interface IntentEdit { status?: Record<string, IntentStatus>; remove?: string[]; add?: string[]; roles?: Record<string, "client" | "team">; by: string; reason: string }
type Changes = Omit<IntentEdit, "by" | "reason">;
type Requirement = ClientIntentBody["requirements"][number];

/** All edit decisions on intent cards, oldest first. */
export function intentEditsOf(state: Pick<RunState, "decisions">): IntentEdit[] {
  return state.decisions
    .filter((d) => d.cardId.startsWith(INTENT_CARD) && d.decision === "edit")
    .map((d) => {
      const x = d as unknown as { edits?: Changes; reason?: string };
      return { ...(x.edits ?? {}), by: d.by, reason: String(x.reason ?? "").trim() };
    });
}

/** Problems with an edit against the intent the card shows; empty when it can be applied. */
export function checkIntentEdit(e: Changes, intent: ClientIntentBody): string[] {
  const out: string[] = [];
  const ids = intent.requirements.map((r) => r.id), names = intent.speakers.map((s) => s.name);
  for (const id of [...Object.keys(e.status ?? {}), ...(e.remove ?? [])]) if (!ids.includes(id)) out.push(`${id} is not a requirement (${ids.join(", ")})`);
  for (const s of Object.values(e.status ?? {})) if (!IntentStatus.safeParse(s).success) out.push(`${s} is not a status (${IntentStatus.options.join(", ")})`);
  for (const n of Object.keys(e.roles ?? {})) if (!names.includes(n)) out.push(`${n} is not a speaker (${names.join(", ")})`);
  for (const t of e.add ?? []) if (!t.trim()) out.push("an added requirement needs words");
  const n = Object.keys(e.status ?? {}).length + (e.remove?.length ?? 0) + (e.add?.length ?? 0) + Object.keys(e.roles ?? {}).length;
  if (!n) out.push("the edit changes nothing");
  return out;
}

const nextId = (rs: { id: string }[]) => `R-${Math.max(0, ...rs.map((r) => Number(/^R-(\d+)$/.exec(r.id)?.[1] ?? 0))) + 1}`;

/** The intent with every edit applied, in order. Roles come from `intent.speakers` (the step applies role edits there, via rolesFor). */
export function applyIntentEdits(intent: ClientIntentBody, edits: IntentEdit[]): ClientIntentBody {
  let rs: Requirement[] = intent.requirements.map((r) => ({ ...r }));
  // ids already shown on the card (dropped and removed items too) are never given to an added one
  const used = [...intent.requirements, ...intent.dropped].map((r) => ({ id: r.id }));
  for (const e of edits) {
    rs = rs.filter((r) => !e.remove?.includes(r.id)).map((r) => (e.status?.[r.id] ? { ...r, status: e.status[r.id]! } : r));
    for (const text of e.add ?? []) {
      const id = nextId([...used, ...rs]);
      used.push({ id });
      rs.push({ id, text: text.trim(), status: "decided", addedBy: { by: e.by, note: e.reason } });
    }
  }
  const roleOf = new Map(intent.speakers.map((s) => [s.name, s.role]));
  rs = rs.map((r) => (r.speaker && roleOf.has(r.speaker) ? { ...r, role: roleOf.get(r.speaker)! } : r));
  return { ...intent, requirements: rs, edits: intent.edits + edits.length };
}

/** The approved intent as intake's request: decided items in, open ones to confirm, deferred and excluded out of scope. */
export function renderBrief(intent: ClientIntentBody, date?: string): string {
  const by = (s: IntentStatus) => intent.requirements.filter((r) => r.status === s);
  const lines = [`# ${intent.project.name ?? "Client request"}${date ? ` (from meeting ${date})` : ""}`, ``, `Goal: ${intent.project.goal}`, ``, `## Requirements`, ...by("decided").map((r) => `- ${r.id}: ${r.text}`)];
  const confirm = [...by("open").map((r) => `- ${r.id}: ${r.text}`), ...intent.openQuestions.map((q) => `- ${q.id}: ${q.text}`)];
  if (confirm.length) lines.push(``, `## To confirm`, ...confirm);
  if (intent.constraints.length) lines.push(``, `## Constraints`, ...intent.constraints.map((c) => `- ${c.id}: ${c.text}`));
  const out = [...by("deferred"), ...by("excluded")];
  if (out.length) lines.push(``, `## Out of scope`, ...out.map((r) => `- ${r.id} (${r.status}): ${r.text}`));
  return lines.join("\n");
}

/** The intent card: warnings first, then speakers, requirements by status with their evidence, and the commands. */
export function intentCard(runId: string, intent: ClientIntentBody, hash: string): string {
  const ev = (r: Requirement) => r.quote ? ` - "${r.quote}" (${r.turn}, ${r.speaker ?? "?"}, ${r.role ?? "?"})` : r.addedBy ? ` - added by ${r.addedBy.by}: ${r.addedBy.note}` : "";
  const group = (s: IntentStatus) => intent.requirements.filter((r) => r.status === s).map((r) => `- ${r.id}: ${r.text}${ev(r)}`);
  return [
    `# Client intent: ${intent.project.name ?? "(no project name)"}`, ``,
    ...(intent.warnings.length ? [`## Warnings`, ...intent.warnings.map((w) => `- ${w}`), ``] : []),
    `Goal: ${intent.project.goal}`, ``,
    `## Speakers`, ...intent.speakers.map((s) => `- ${s.name}: ${s.role} (${s.source})`), ``,
    `## Requirements`,
    ...(["decided", "open", "deferred", "excluded"] as const).flatMap((s) => { const g = group(s); return g.length ? [`### ${s}`, ...g] : []; }), ``,
    ...(intent.constraints.length ? [`## Constraints`, ...intent.constraints.map((c) => `- ${c.id}: ${c.text}`), ``] : []),
    ...(intent.openQuestions.length ? [`## Open questions`, ...intent.openQuestions.map((q) => `- ${q.id}: ${q.text}`), ``] : []),
    ...(intent.dropped.length ? [`## Dropped (quote not found)`, ...intent.dropped.map((d) => `- ${d.id}: ${d.text} - ${d.why}`), ``] : []),
    `## Decide`,
    `  factory edit-intent ${runId} ${hash} --status R-3=deferred --remove R-7 --add "text" --role "Name=team" --reason "why"`,
    `  factory approve ${runId} ${hash}`,
    `  factory reject  ${runId} ${hash} --reason "what is wrong"`,
    ``, `Card hash: ${hash}`,
  ].join("\n");
}

/**
 * The run page's edit (spec §5c) → an edit: statuses (an empty one means unchanged), removals, added requirements one per line,
 * speaker roles. Throws on a malformed body; whether the ids and names exist is checkIntentEdit's job, as for the CLI.
 */
export function webIntentEdit(input: unknown): Changes {
  const o = (input ?? {}) as { status?: unknown; remove?: unknown; add?: unknown; roles?: unknown };
  const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
  const status: Record<string, IntentStatus> = {}, roles: Record<string, "client" | "team"> = {};
  if (o.status !== undefined) {
    if (!isRecord(o.status)) throw new Error("status must map requirement ids to a status");
    for (const [id, s] of Object.entries(o.status)) {
      if (s === "" || s === undefined || s === null) continue;
      if (!IntentStatus.safeParse(s).success) throw new Error(`${String(s)} is not a status (${IntentStatus.options.join(", ")})`);
      status[id] = s as IntentStatus;
    }
  }
  if (o.remove !== undefined && (!Array.isArray(o.remove) || o.remove.some((x) => typeof x !== "string"))) throw new Error("remove must be a list of requirement ids");
  if (o.add !== undefined && typeof o.add !== "string") throw new Error("add must be text, one requirement per line");
  if (typeof o.add === "string" && o.add.length > 2000) throw new Error("The added requirements are too long (2000 characters at most).");
  if (o.roles !== undefined) {
    if (!isRecord(o.roles)) throw new Error("roles must map speaker names to client or team");
    for (const [name, r] of Object.entries(o.roles)) {
      if (r !== "client" && r !== "team") throw new Error(`${name}: a role is client or team`);
      roles[name] = r;
    }
  }
  const remove = (o.remove as string[] | undefined) ?? [];
  const add = typeof o.add === "string" ? o.add.split("\n").map((l) => l.trim()).filter(Boolean) : [];
  return {
    ...(Object.keys(status).length ? { status } : {}), ...(remove.length ? { remove } : {}),
    ...(add.length ? { add } : {}), ...(Object.keys(roles).length ? { roles } : {}),
  };
}

/** `factory edit-intent` flags → an edit; throws naming the argument it cannot read. */
export function parseIntentEditArgs(o: { status?: string[]; remove?: string[]; add?: string[]; role?: string[] }): Changes {
  const status: Record<string, IntentStatus> = {}, roles: Record<string, "client" | "team"> = {};
  for (const s of o.status ?? []) {
    const m = /^(R-\d+)=(\w+)$/.exec(s.trim());
    if (!m) throw new Error(`--status "${s}": use R-3=deferred`);
    status[m[1]!] = m[2] as IntentStatus;
  }
  for (const r of o.role ?? []) {
    const m = /^(.+)=(client|team)$/.exec(r.trim());
    if (!m) throw new Error(`--role "${r}": use "Name=client" or "Name=team"`);
    roles[m[1]!.trim()] = m[2] as "client" | "team";
  }
  return {
    ...(Object.keys(status).length ? { status } : {}), ...(o.remove?.length ? { remove: o.remove } : {}),
    ...(o.add?.length ? { add: o.add } : {}), ...(Object.keys(roles).length ? { roles } : {}),
  };
}
