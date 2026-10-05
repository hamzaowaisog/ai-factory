// buildPack (context-builder §2.5): resolve → check trust → redact → wrap → order → count
// → trim (pointer tail, map depth only) → fit or fail → record.
import type { ContextPack, PackClass, SectionSpec, StageName } from "../contracts/index.js";
import { BUDGETS, LOCAL_PACK_CAP } from "../contracts/index.js";
import { hashJson, stableStringify } from "../util/hash.js";
import type { Redactor } from "./secrets.js";
import { estimateTokens } from "./tokens.js";
import { IMAGE_TOKENS, MAX_PACK_IMAGES } from "../util/image.js";

/** Steps that can write (container A). Untrusted text is a build error here, not config. */
export const WRITING_STAGES: ReadonlySet<StageName> = new Set([
  "author-tests", "implement", "conflict-resolve", "scaffold", "design-mock", "prototype",
]);

export class PackBuildError extends Error {}
export class PackOverBudgetError extends Error {
  constructor(readonly packTokens: number, readonly budget: number, readonly biggest: string) {
    super(`Pack is ${packTokens} tokens, over the ${budget} budget; biggest section: ${biggest}`);
  }
}

export interface ResolvedSection {
  spec: SectionSpec;
  content: string;
  /** for pointers sections */
  pointers?: { path: string; reason: string }[];
  /** for untrusted docs */
  docId?: string;
  source?: string;
  /** for artifacts */
  artifactKind?: string;
  artifactSha?: string;
  /** for images: the ledger artifact holding the bytes (sent to the model in pack order) */
  imageSha?: string;
}

export interface BuildPackInput {
  stage: StageName;
  cls: PackClass;
  budgetTokens?: number;
  model: string;
  local?: boolean;
  recipeVersion: string;
  sections: ResolvedSection[];
  tools: string[];
  /** Which tree the repo tools read. Omitted or "base" keeps the historic behaviour exactly. */
  toolsAt?: "base" | "under-review";
  redactor: Redactor;
}

const ORDER: SectionSpec["source"][] = ["template", "stackpack", "profile", "rules", "artifact", "doc", "image", "pointers", "feedback", "task", "recap"];

// the wrapper's own tags inside untrusted text are defanged (< → &lt;) so the text can't close it early
const defang = (text: string) => text.replace(/<(\s*\/?\s*untrusted_document\b)/gi, "&lt;$1");
const attr = (v: string) => v.replace(/"/g, "&quot;");

/**
 * A file's contents are data, exactly like an untrusted document handed over in a section. Until a
 * reviewer had repo tools this did not matter, because only steps that already trusted the repo
 * could call them — so tool results went to the model raw while packed sections were wrapped and
 * defanged. Wrapping both the same way means one convention for "this is not addressed to you",
 * and the defanging stops a file closing the wrapper and writing outside it.
 */
export function wrapToolResult(tool: string, input: unknown, text: string): string {
  const src = attr(JSON.stringify(input ?? {}).slice(0, 120));
  return `<untrusted_document id="${attr(tool)}" source="${src}">\n${defang(text)}\n</untrusted_document>`;
}

function wrap(s: ResolvedSection, text: string, imageN?: number): string {
  switch (s.spec.source) {
    case "doc":
      return `<untrusted_document id="${attr(s.docId ?? s.spec.id)}" source="${attr(s.source ?? "unknown")}">\n${defang(text)}\n</untrusted_document>`;
    case "artifact":
      return `<artifact id="${s.spec.id}" kind="${s.artifactKind ?? s.spec.ref ?? ""}" sha="${(s.artifactSha ?? "").slice(0, 12)}">\n${text}\n</artifact>`;
    case "pointers":
      return `<pointers>\n${text}\n</pointers>`;
    case "feedback":
      return `<failures>\n${text}\n</failures>`;
    case "recap":
      return `<recap>\n${text}\n</recap>`;
    case "image":
      // the marker names the image; the picture itself goes beside the text as "Image n"
      return `<untrusted_image n="${imageN ?? "?"}" id="${s.spec.id}" source="${s.source ?? "unknown"}">${text ? `\n${text}\n` : ""}</untrusted_image>`;
    default:
      return text;
  }
}

function pointersText(ps: { path: string; reason: string }[]): string {
  return ps.map((p) => `- ${p.path}: ${p.reason}`).join("\n");
}

export function buildPack(inp: BuildPackInput): ContextPack {
  // 2. check
  if (WRITING_STAGES.has(inp.stage)) {
    const bad = inp.sections.filter((s) => s.spec.trust === "untrusted" || s.spec.source === "doc" || s.spec.source === "image");
    if (bad.length) throw new PackBuildError(`Stage ${inp.stage} can write, so it can't take untrusted sections: ${bad.map((b) => b.spec.id).join(", ")}`);
  }
  for (const s of inp.sections) {
    if (s.spec.trust === "untrusted" && s.spec.placement === "system") throw new PackBuildError(`Untrusted section ${s.spec.id} can't go in the system prompt`);
    if (s.spec.source === "image" && (s.spec.trust !== "untrusted" || s.spec.placement !== "user" || !s.imageSha)) throw new PackBuildError(`Image section ${s.spec.id} must be untrusted, in the user message, with its stored image`);
  }
  const imageCount = inp.sections.filter((s) => s.spec.source === "image").length;
  if (imageCount > MAX_PACK_IMAGES) throw new PackBuildError(`${imageCount} images; a briefing takes at most ${MAX_PACK_IMAGES}`);
  let budget = inp.budgetTokens ?? BUDGETS[inp.cls];
  if (inp.local) budget = Math.min(budget, LOCAL_PACK_CAP);

  // 3–5. redact, wrap, order
  let redactions = 0;
  const prepared = inp.sections.map((s) => {
    const raw = s.spec.source === "pointers" ? pointersText(s.pointers ?? []) : s.content;
    const r = inp.redactor.redact(raw);
    redactions += r.hits.length;
    return { s, text: r.text, trimmed: false, pointers: s.pointers ? [...s.pointers] : undefined, imageN: undefined as number | undefined };
  }).sort((a, b) => ORDER.indexOf(a.s.spec.source) - ORDER.indexOf(b.s.spec.source));
  // images are numbered in the order they are sent, after the sort
  const images = prepared.filter((p) => p.s.spec.source === "image").map((p, i) => { p.imageN = i + 1; return p.s.imageSha!; });

  const render = () => {
    const sys = prepared.filter((p) => p.s.spec.placement === "system").map((p) => wrap(p.s, p.text, p.imageN));
    const usr = prepared.filter((p) => p.s.spec.placement === "user").map((p) => wrap(p.s, p.text, p.imageN));
    return { system: sys.join("\n\n"), user: usr.join("\n\n") };
  };
  const count = () => {
    const r = render();
    return estimateTokens(r.system + r.user, inp.model) + images.length * IMAGE_TOKENS;
  };

  // 6–8. count, trim (a) pointer tail (b) map depth, fit
  let tokens = count();
  for (const p of prepared) {
    if (tokens <= budget) break;
    if (p.s.spec.trimmable === "pointers-tail" && p.pointers) {
      while (tokens > budget && p.pointers.length > 1) {
        p.pointers.pop();
        p.text = pointersText(p.pointers);
        p.trimmed = true;
        tokens = count();
      }
    }
  }
  for (const p of prepared) {
    if (tokens <= budget) break;
    if (p.s.spec.trimmable === "map-depth") {
      const lines = p.text.split("\n");
      while (tokens > budget && lines.length > 10) {
        lines.splice(Math.floor(lines.length * 0.75));
        p.text = lines.join("\n") + "\n… (map trimmed; use search)";
        p.trimmed = true;
        tokens = count();
      }
    }
  }
  if (tokens > budget) {
    const biggest = [...prepared].sort((a, b) => b.text.length - a.text.length)[0]?.s.spec.id ?? "?";
    throw new PackOverBudgetError(tokens, budget, biggest);
  }

  const { system, user } = render();
  const pointers = prepared.flatMap((p) => p.pointers ?? []);
  const sections = prepared.map((p) => ({ id: p.s.spec.id, tokens: estimateTokens(p.text, inp.model) + (p.imageN ? IMAGE_TOKENS : 0), trimmed: p.trimmed, trust: p.s.spec.trust }));
  // the field is left out when it is "base", so every pack built before it existed hashes the same
  const body = { system, user, images, pointers, tools: inp.tools, ...(inp.toolsAt && inp.toolsAt !== "base" ? { toolsAt: inp.toolsAt } : {}) };
  const manifest = {
    stage: inp.stage, model: inp.model, recipeVersion: inp.recipeVersion, sections,
    packTokens: tokens, budgetTokens: budget, countMethod: "proxy" as const, redactions,
    packSha: hashJson({ ...body, stage: inp.stage, model: inp.model, recipeVersion: inp.recipeVersion }),
  };
  return { ...body, manifest };
}

/** Deterministic serialisation for storing a pack in the ledger. */
export function serialisePack(p: ContextPack): string {
  return stableStringify(p);
}
