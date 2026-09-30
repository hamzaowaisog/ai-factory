// Per-module specify (docs/estimates-design.md, "Inputs"). The spec pipeline steps (drafts, merge,
// specify) are reused unchanged: `scoped` runs one of them over a single module by giving it a view of
// the run in which the request is the module's text, the intent holds only the module's spans, and its
// own earlier outputs answer to their plain names. `combineSpecsStep` then joins the module specs into
// the one spec that breakdown and estimate read, under the key "specify".
import type { z } from "zod";
import { IntentBody, type Spec } from "../contracts/index.js";
import type { Module } from "../estimate/modules.js";
import type { Ledger } from "../ledger/ledger.js";
import type { RunState } from "../ledger/state.js";
import { header, type StepContext, type StepDef, type StepOutcome } from "./framework.js";
import { draftsStep, mergeStep, specifyStep } from "./specpipe.js";

type Intent = z.infer<typeof IntentBody>;

/** The module each intent span belongs to: the first module whose text quotes it; else the first. */
export function spansOf(intent: Pick<Intent, "spans">, modules: Module[], m: Module): Intent["spans"] {
  const norm = (t: string) => t.toLowerCase().replace(/\s+/g, " ").trim();
  const texts = modules.map((x) => norm(x.text));
  return intent.spans.filter((s) => {
    const at = texts.findIndex((t) => t.includes(norm(s.text)));
    return modules[at < 0 ? 0 : at]!.id === m.id;
  });
}

/** The run as one module's steps see it. */
export function moduleView(state: RunState, ledger: Ledger, modules: Module[], m: Module): RunState {
  const steps = new Map(state.steps);
  for (const [k, rec] of state.steps) if (k.endsWith(`:${m.id}`)) steps.set(k.slice(0, -m.id.length - 1), rec);
  // the module's own drafts/merge/specify are not yet done when the plain key still holds another module's
  for (const base of ["drafts", "merge", "specify"]) if (!state.steps.has(`${base}:${m.id}`)) steps.delete(base);
  const intake = steps.get("intake");
  if (intake?.status === "completed") {
    const intent = ledger.getJson<Intent>(intake.outputs[0]!)!;
    const sha = ledger.putJson({ ...intent, spans: spansOf(intent, modules, m) });
    steps.set("intake", { ...intake, outputs: [sha, ...intake.outputs.slice(1)] });
  }
  return { ...state, info: { ...state.info, request: m.text }, steps };
}

export function scoped(def: StepDef, modules: Module[], m: Module): StepDef {
  return {
    ...def,
    key: `${def.key}:${m.id}`,
    inputs: (s, l) => def.inputs(moduleView(s, l, modules, m), l),
    run: (ctx: StepContext) => def.run({ ...ctx, state: moduleView(ctx.state, ctx.ledger, modules, m), log: (msg) => ctx.log(`[${m.id}] ${msg}`) }),
  };
}

export const moduleSteps = (modules: Module[]): StepDef[] =>
  modules.flatMap((m) => [scoped(draftsStep, modules, m), scoped(mergeStep, modules, m), scoped(specifyStep, modules, m)]);

// ---------- combine ----------

type Req = Spec["requirements"][number];

/** REQ-3 → REQ-<n>, AC-3.2 → AC-<n>.2: requirements and their criteria are numbered again across modules. */
export function combineSpecs(specs: Spec[], modules: Module[]): { spec: Omit<Spec, "header">; idMap: Map<string, string>[] } {
  let n = 0, nfr = 0;
  const idMap = specs.map(() => new Map<string, string>());
  const requirements: Req[] = specs.flatMap((s, k) => s.requirements.map((r): Req => {
    const id = `REQ-${++n}`;
    idMap[k]!.set(r.id, id);
    const num = /^REQ-(.+)$/.exec(r.id)?.[1];
    return {
      ...r, id,
      acceptance: r.acceptance.map((a) => ({ ...a, id: num !== undefined && a.id.startsWith(`AC-${num}.`) ? `AC-${n}.${a.id.slice(`AC-${num}.`.length)}` : `AC-${n}.${a.id}` })),
    };
  }));
  const lintNames = [...new Set(specs.flatMap((s) => s.lint.map((l) => l.check)))];
  return {
    idMap,
    spec: {
      requirements,
      nfrs: specs.flatMap((s) => s.nfrs).map((x) => ({ ...x, id: `NFR-${++nfr}` })),
      outOfScope: [...new Set(specs.flatMap((s) => s.outOfScope))],
      assumptions: [...new Set(specs.flatMap((s) => s.assumptions))],
      lint: lintNames.map((check) => {
        const all = specs.flatMap((s, k) => s.lint.filter((l) => l.check === check).map((l) => ({ ...l, m: modules[k]!.id })));
        const bad = all.filter((l) => !l.passed);
        return { check, passed: bad.length === 0, details: bad.length ? bad.map((l) => `[${l.m}] ${l.details}`).join("; ") : all[0]?.details ?? "" };
      }),
      critic: specs.flatMap((s, k) => s.critic.map((f) => ({ ...f, ...(f.reqId ? { reqId: idMap[k]!.get(f.reqId) ?? f.reqId } : {}) }))),
      roundTrip: {
        droppedSpans: [...new Set(specs.flatMap((s) => s.roundTrip.droppedSpans))],
        inventedCapabilities: specs.flatMap((s) => s.roundTrip.inventedCapabilities),
      },
    },
  };
}

export function combineSpecsStep(modules: Module[]): StepDef {
  const keys = modules.map((m) => `specify:${m.id}`);
  return {
    key: "specify", stage: "specify", templateVersion: "1",
    inputs: (s) => (keys.every((k) => s.steps.get(k)?.status === "completed") ? { specs: keys.map((k) => s.steps.get(k)!.outputs[0]) } : undefined),
    async run(ctx): Promise<StepOutcome> {
      const recs = keys.map((k) => ctx.state.steps.get(k)!);
      const specs = recs.map((r) => ctx.ledger.getJson<Spec>(r.outputs[0]!)!);
      const { spec, idMap } = combineSpecs(specs, modules);
      const critics = recs.map((r, k) => {
        const c = ctx.ledger.getJson<{ findings: { reqId?: string }[]; note?: string }>(r.outputs[1]!)!;
        return { findings: c.findings.map((f) => ({ ...f, ...(f.reqId ? { reqId: idMap[k]!.get(f.reqId) ?? f.reqId } : {}) })), note: c.note };
      });
      const specSha = ctx.ledger.putJson({ header: header(ctx.runId, "spec", "specify", ""), ...spec });
      const criticSha = ctx.ledger.putJson({ findings: critics.flatMap((c) => c.findings), note: critics.map((c) => c.note).filter(Boolean).join(" ") || undefined });
      const d = (k: string) => recs.map((r) => r.data?.[k]);
      return {
        kind: "done", outputs: { spec: specSha, critic: criticSha },
        data: {
          modules: modules.map((m) => m.id), repairs: (d("repairs") as number[]).reduce((a, b) => a + (b ?? 0), 0),
          openFindings: (d("openFindings") as string[][]).flat().filter(Boolean), conflicts: (d("conflicts") as string[][]).flat().filter(Boolean),
          manualUi: (d("manualUi") as string[][]).flat().filter(Boolean), lane: "full",
        },
      };
    },
  };
}
