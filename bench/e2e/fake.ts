// Fake mode for the e2e eval: a scripted model and scripted coding agent that "write" a given patch, so a whole run
// (spec, plan, tests first, code, checks, delivery) and its scoring are proven for $0. The scripted test writer locks
// renamed copies of the hidden tests (a plumbing proof only: a real run never sees them, and the leak check looks for
// the hidden names and header, which the copies don't carry).
import type { Conversation, Provider, Turn } from "../../src/runners/api.js";
import type { AgentScript } from "../../src/runners/claude-agent.js";
import { fakeAnswer as specFake, fakeSpans } from "../spec/fake.js";
import type { EvalCase } from "../spec/case.js";
import { patchSize, type E2ECase } from "./case.js";

const USAGE = { inputTokens: 0, outputTokens: 0, cacheRead: 0, cacheWrite: 0 };

/** The hidden test methods, in file order: each becomes one acceptance criterion and one locked test. */
export function hiddenMethods(c: Pick<E2ECase, "hidden">): { file: string; method: string }[] {
  return Object.entries(c.hidden).flatMap(([file, text]) => [...text.matchAll(/\[Fact\][\s\S]*?public\s+async\s+Task\s+(\w+)\(/g)].map((m) => ({ file, method: m[1]! })));
}

/** The scripted test writer's files: the hidden tests renamed (Locked_ classes, AC_1_<n>_ methods) without their header. */
export function lockedCopies(c: Pick<E2ECase, "hidden">): { writes: { path: string; content: string }[]; tests: { acId: string; file: string; name: string }[] } {
  const methods = hiddenMethods(c);
  const writes = Object.entries(c.hidden).map(([file, text]) => {
    let out = text.replace(/^\/\/ Hidden acceptance tests[^\n]*\n(\/\/[^\n]*\n)*/, "// Locked tests written by the fake test writer (e2e dry run)\n").replace(/\bHidden_/g, "Locked_");
    for (const [i, m] of methods.entries()) if (m.file === file) out = out.replace(new RegExp(`(public\\s+async\\s+Task\\s+)${m.method}\\(`), `$1AC_1_${i + 1}_${m.method}(`);
    return { path: file.replace(/Hidden_/g, "Locked_"), content: out };
  });
  const tests = methods.map((m, i) => ({ acId: `AC-1.${i + 1}`, file: m.file.replace(/Hidden_/g, "Locked_"), name: `AC_1_${i + 1}_${m.method}` }));
  return { writes, tests };
}

function spec(c: E2ECase) {
  return {
    requirements: [{
      id: "REQ-1", op: "ADDED", sources: fakeSpans(c.request).map((x) => x.id), anchors: [], ears: `The system shall do what the request asks: ${c.request.replace(/\s+/g, " ").slice(0, 160)}`,
      acceptance: hiddenMethods(c).map((m, i) => ({ id: `AC-1.${i + 1}`, given: "the seeded data", when: `the client calls the API (${m.method})`, then: "the response is as the request says", level: "api" })),
    }],
    nfrs: [], outOfScope: ["Nothing else changes."], assumptions: [], suggestions: [],
  };
}

export function e2eAnswer(c: E2ECase, patch: string, system: string): unknown {
  if (system.includes("Senior engineer writing a behaviour spec")) return spec(c);
  if (system.includes("Merge three independent")) { const { suggestions: _s, ...s } = spec(c); void _s; return { spec: s, alignment: [{ mergedReq: "REQ-1", from: ["d1:REQ-1", "d2:REQ-1", "d3:REQ-1"] }], conflicts: [] }; }
  if (system.includes("plan the implementation")) {
    const files = patchSize(patch).files;
    return {
      tasks: [{ id: "TASK-1", title: "Make the change", reqs: ["REQ-1"], fileScope: files, exemplars: [], conventions: [], dependsOn: [], plannedLoc: Math.max(1, patchSize(patch).lines), approach: "the scripted change" }],
      options: [{ id: "O-1", summary: "the scripted change", simplest: true, tradeoffs: "none" }, { id: "O-2", summary: "anything else", simplest: false, tradeoffs: "more" }],
      chosen: "O-1", adr: "Scripted (e2e dry run).", protectedPathsDeclared: [], newDependencies: [], stubs: [],
    };
  }
  // a verdict per criterion: each one has its locked copy of a hidden test
  if (system.includes("review a finished change")) return { findings: [], coverage: lockedCopies(c).tests.map((t) => ({ acId: t.acId, testId: t.name, verdict: "proves-it", why: "the locked test asserts what the criterion asks" })) };
  return specFake({ ...c, gaps: [], expect: [], forbid: [] } as unknown as EvalCase, system);
}

export function e2eProvider(c: () => E2ECase, patch: () => string): Provider {
  return {
    start(_m, _e, system): Conversation {
      return { async next(): Promise<Turn> { return { calls: [{ id: "s", name: "submit_result", input: e2eAnswer(c(), patch(), system) }], text: "", stop: "tool_use", usage: USAGE }; }, toolResults() {}, say() {} };
    },
  };
}

/** The scripted coding agent: the test writer locks the renamed copies; the implementer writes the patched files. */
export function e2eAgent(c: () => E2ECase, patched: () => Record<string, string>): (step: string) => AgentScript | undefined {
  return (step) => {
    if (step === "author-tests") {
      const { writes, tests } = lockedCopies(c());
      return { writes, output: { tests, characterisation: [], probes: [], notes: "" } };
    }
    if (step === "implement") {
      const files = patched();
      return { writes: Object.entries(files).map(([path, content]) => ({ path, content })), output: { done: true, filesChanged: Object.keys(files), notes: "" } };
    }
    return undefined;
  };
}
