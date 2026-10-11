// CodexRunner: OpenAI's Codex agent in container A, for a GPT model on a coding step. The container, its masks, its
// network, the step's proxy token and its spending cap are the Claude runner's (claude-agent.ts); this file holds what differs.
//
// Codex has no hook that runs before an edit. So the file rules are part of the briefing, and when the session ends
// the core puts back every file Codex edited that the rules do not allow: the checkout that reaches the gates is the
// one a refused edit would have left.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import type { Usage } from "../contracts/index.js";
import { git } from "../ledger/git.js";
import { matchesAny } from "../util/glob.js";
import type { ContainerRuntime } from "../verify/runtime.js";
import { ClaudeAgentRunner, readProgress, type AgentJobExtras } from "./claude-agent.js";
import { OPENAI_BASE_URL, PROXY_SPEND_URL } from "./netinfra.js";
import { costUsd } from "./pricing.js";
import { family, type Job, type Runner } from "./types.js";

type Json = Record<string, unknown>;

/**
 * A zod schema as OpenAI's strict structured output takes it: every property is required and no object takes extra
 * keys, so a field the schema leaves optional becomes one that may be null (`withoutNulls` reads the answer back).
 */
export function toStrictJsonSchema(schema: z.ZodType): Json {
  const { $schema: _drop, ...rest } = z.toJSONSchema(schema, { target: "draft-7", io: "input" }) as Json;
  void _drop;
  return strict(rest) as Json;
}

function strict(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(strict);
  if (!node || typeof node !== "object") return node;
  const { default: _default, ...n } = node as Json;
  void _default;
  const out: Json = {};
  for (const [k, v] of Object.entries(n)) out[k] = k === "properties" ? Object.fromEntries(Object.entries(v as Json).map(([name, s]) => [name, strict(s)])) : k === "required" || k === "enum" || k === "const" ? v : strict(v);
  if (n.additionalProperties && typeof n.additionalProperties === "object") throw new Error("A coding step's answer cannot hold a free-form map: OpenAI's strict output has no shape for it");
  if (n.properties && typeof n.properties === "object") {
    const required = new Set(Array.isArray(n.required) ? (n.required as string[]) : []);
    const props = out.properties as Json;
    for (const name of Object.keys(props)) if (!required.has(name)) props[name] = { anyOf: [props[name], { type: "null" }] };
    out.required = Object.keys(props);
    out.additionalProperties = false;
  }
  return out;
}

/** An answer with its null fields left out: what a strict answer gives for a field the schema leaves optional. */
export function withoutNulls(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(withoutNulls);
  if (!v || typeof v !== "object") return v;
  return Object.fromEntries(Object.entries(v).filter(([, x]) => x !== null).map(([k, x]) => [k, withoutNulls(x)]));
}

/** The rules the Claude session's hook enforces, as text for a session that has no hook. */
export function fileRulesText(fileScope: string[], protectedGlobs: string[]): string {
  return [
    "## File rules",
    "These are checked when you finish. Any change to a file they do not allow is undone before your work is tested, so do not depend on one.",
    fileScope.length ? `- Change files only inside this task's file scope: ${fileScope.join(", ")}` : "",
    protectedGlobs.length ? `- Never change, create or delete a locked or protected file: ${protectedGlobs.join(", ")}` : "",
    "- No git, no network calls and no package installs. A new package must be declared in the plan.",
  ].filter(Boolean).join("\n");
}

/** Paths that differ from HEAD or are untracked. Undefined when the folder is not a git checkout (doctor's throwaway folder). */
async function dirty(wt: string): Promise<Set<string> | undefined> {
  try {
    const { stdout } = await git(wt, ["status", "--porcelain", "--no-renames", "-uall", "-z"]);
    return new Set(stdout.split("\0").filter(Boolean).map((l) => l.slice(3)));
  } catch {
    return undefined;
  }
}

export class CodexRunner extends ClaudeAgentRunner {
  override readonly kind: Runner["kind"] = "codex";

  protected override jobFields<T>(job: Job<T>, protectedGlobs: string[]): Record<string, unknown> {
    return {
      agent: "codex",
      effort: job.effort ?? "high",
      system: `${job.pack.system}\n\n${fileRulesText(this.extras.fileScope, protectedGlobs)}`,
      schema: toStrictJsonSchema(job.schema),
    };
  }

  protected override modelEnv(token: string): Record<string, string> {
    // not a key: the proxy swaps it for the real one
    return { OPENAI_BASE_URL, FACTORY_STEP_TOKEN: token, FACTORY_SPEND_URL: PROXY_SPEND_URL, HOME: "/tmp/home", CODEX_HOME: "/tmp/codex" };
  }

  /** Before the session: what the rules protect and was already changed is kept aside. After it: every edit the rules do not allow is put back. */
  protected override async sessionGuard(workdir: string, protectedGlobs: string[]): Promise<(progressFile: string) => Promise<void>> {
    const x = this.extras;
    const refused = (p: string): boolean => p.startsWith("/") || p.startsWith("..") || matchesAny(p, protectedGlobs) || (x.fileScope.length > 0 && !matchesAny(p, x.fileScope));
    const before = await dirty(workdir);
    if (!before) return async () => undefined;
    const kept = new Map<string, Buffer | undefined>();
    for (const p of before) if (refused(p)) kept.set(p, existsSync(join(workdir, p)) ? readFileSync(join(workdir, p)) : undefined);
    return async (progressFile) => {
      const edited = new Set(readProgress(progressFile, 0).lines.filter((p) => p.kind === "tool" && (p.tool === "Write" || p.tool === "Edit") && p.target).map((p) => p.target!));
      const now = await dirty(workdir) ?? new Set<string>();
      for (const p of edited) {
        if (!refused(p) || p.startsWith("/") || p.startsWith("..")) continue;
        const file = join(workdir, p);
        if (kept.has(p)) {
          const was = kept.get(p), is = existsSync(file) ? readFileSync(file) : undefined;
          if (was && is ? was.equals(is) : was === is) continue;
          if (was) { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, was); } else rmSync(file, { force: true });
        } else if (!now.has(p)) continue; // edited and put back by the agent itself
        else if (await git(workdir, ["checkout", "HEAD", "--", p]).then(() => false, () => true)) rmSync(file, { force: true }); // not in HEAD: the session made it
        x.onProgress?.({ ts: Date.now(), kind: "tool", tool: "Undone (file rules)", target: p });
      }
    };
  }

  /** The table's price for what Codex used: the proxy's own count is a flat rate, for its cap only. */
  protected override spent(model: string, u: Usage): number {
    return costUsd(model, u);
  }

  protected override parse<T>(job: Job<T>, output: unknown): { success: true; data: T } | { success: false; error: { message: string } } {
    const asIs = job.schema.safeParse(output);
    return asIs.success ? asIs : job.schema.safeParse(withoutNulls(output));
  }
}

/** The runner a coding step uses for this model: Codex for a GPT model, the Claude agent for any other. */
export function codingRunner(rt: ContainerRuntime, extras: AgentJobExtras, model: string): Runner {
  return family(model) === "openai" ? new CodexRunner(rt, extras) : new ClaudeAgentRunner(rt, extras);
}
