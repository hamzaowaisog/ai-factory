import { describe, expect, it } from "vitest";
import { resolveAnswer, scoreQuestions, selectQuestions, verifyDifferences, type ClarifierQuestion, type Sketch } from "./clarify.js";
import { Defaults, loadDefaults, topicsText } from "../estimate/defaults.js";
import { checkMerge, criticBlocks, criticTemplate, lostCoverage, problems, roundTripCheck, sameProblems } from "./specpipe.js";
import { lintSpec, mentions, requestExcluded, sizeNote } from "./speclint.js";

const sketch = (texts: string[]): Sketch => ({ spans: [{ id: "I-1", behaviours: texts.map((t) => ({ text: t, kind: "happy" as const })) }] });
const q = (over: Partial<ClarifierQuestion>): ClarifierQuestion => ({
  id: "q", category: "scope", text: "t", options: ["a", "b"], recommended: "a", reason: "r", spans: ["I-1"], impact: 2, impactReason: "", ...over,
});
const cb = { claims: [{ id: "C-1", text: "", spans: ["I-1"], anchors: [{ path: "a", lineStart: 1, lineEnd: 1, quote: "x" }] }], notFound: [{ span: "I-2", searched: ["x"] }] };

describe("clarify rules", () => {
  it("keeps only differences that cite real behaviours in two sketches", () => {
    const sk = [sketch(["x"]), sketch(["y"]), sketch(["x"])];
    const good = { id: "D-1", span: "I-1", topic: "", readings: [{ sketch: 1, behaviour: 0, summary: "" }, { sketch: 2, behaviour: 0, summary: "" }] };
    const sameSketch = { ...good, id: "D-2", readings: [{ sketch: 1, behaviour: 0, summary: "" }, { sketch: 1, behaviour: 0, summary: "" }] };
    const invented = { ...good, id: "D-3", readings: [{ sketch: 1, behaviour: 0, summary: "" }, { sketch: 2, behaviour: 7, summary: "" }] };
    expect(verifyDifferences([good, sameSketch, invented], sk).map((d) => d.id)).toEqual(["D-1"]);
  });

  it("scores uncertainty from outside the model and asks only impact × uncertainty ≥ 4", () => {
    const diffs = [{ id: "D-1", span: "I-1", topic: "", readings: [] }];
    const scored = scoreQuestions([
      q({ id: "a", impact: 2, difference: "D-1" }),          // 2×3 = 6 → ask
      q({ id: "b", impact: 3, spans: ["I-2"] }),             // 3×2 = 6 → ask (grounding found nothing)
      q({ id: "c", impact: 3, spans: ["I-9"], category: "terminology" }), // no anchor → 2 → 6
      q({ id: "d", impact: 1, difference: "D-1" }),          // 1×3 = 3 → assumption
    ], diffs, cb);
    expect(scored.map((s) => s.score)).toEqual([6, 6, 6, 3]);
    const { asked, assumptions } = selectQuestions(scored, 2);
    expect(asked.map((a) => a.id)).toEqual(["Q-1", "Q-2"]);
    expect(asked[0]!.category).toBe("scope");            // goal/scope first at equal score
    expect(assumptions.map((a) => [a.fromQuestion, a.risk])).toEqual([["c", "high"], ["d", "low"]]);
  });

  it("assumes a standard topic's table answer in place of the model's pick, the same for every wording", () => {
    const d = loadDefaults();
    expect(d).not.toHaveProperty("signedOffBy");
    const scored = scoreQuestions([
      q({ id: "a", text: "Do users log in with Google?", topic: "sign-in", options: ["Google", "email"], recommended: "Google" }),
      q({ id: "b", text: "Which sign-in methods are allowed?", topic: "sign-in", options: ["SSO", "email"], recommended: "SSO" }),
      q({ id: "c", text: "Is the logo blue?", topic: "not-a-topic" }),
      q({ id: "e", text: "Which colour scheme?" }),
    ], [], cb);
    const { assumptions } = selectQuestions(scored, 0, 1, d);
    const std = "Email and password, with a reset link by email; no social or single sign-on.";
    expect(assumptions.slice(0, 2).map((x) => [x.text, x.fromDefault])).toEqual([
      // the text the client reads is a plain assumption; which standard answer it came from stays internal (fromDefault)
      [`Do users log in with Google? → assumed: ${std}`, "sign-in"],
      [`Which sign-in methods are allowed? → assumed: ${std}`, "sign-in"],
    ]);
    // an unknown topic or none keeps the model's recommendation
    expect(assumptions.slice(2).map((x) => [x.text, x.fromDefault])).toEqual([["Is the logo blue? → assumed: a", undefined], ["Which colour scheme? → assumed: a", undefined]]);
    expect(topicsText(d)).toMatch(/^- sign-in: How do users sign in\?$/m);
  });

  it("rejects a defaults table with a duplicate topic", () => {
    const d = loadDefaults();
    expect(() => Defaults.parse({ ...d, topics: [d.topics[0], d.topics[0]] })).toThrow(/listed twice/);
  });

  it("reads letter answers", () => {
    const s = scoreQuestions([q({ options: ["keep", "drop"] })], [], cb)[0]!;
    expect(resolveAnswer(s, "b")).toBe("drop");
    expect(resolveAnswer(s, "only guests")).toBe("only guests");
  });
});

describe("spec rules", () => {
  const req = (id: string, extra = {}) => ({ id, ears: "When a name is given, the Greeter shall return Hello and the name.", op: "ADDED" as const, sources: ["I-1"], acceptance: [{ id: `AC-${id.slice(4)}.1`, given: "a name", when: "greet", then: "the response is Hello Ann", level: "api" as const }], ...extra });
  const spec = (reqs: ReturnType<typeof req>[]) => ({ requirements: reqs, nfrs: [], outOfScope: ["x"], assumptions: [] });

  it("merge: every source must exist; stability = drafts / 3", () => {
    const drafts = [spec([req("REQ-1")]), spec([req("REQ-1")]), spec([req("REQ-1"), req("REQ-2")])];
    const m = { spec: spec([req("REQ-1"), req("REQ-2")]), alignment: [{ mergedReq: "REQ-1", from: ["d1:REQ-1", "d2:REQ-1", "d3:REQ-1"] }, { mergedReq: "REQ-2", from: ["d3:REQ-2"] }], conflicts: [] };
    expect(checkMerge(m, drafts)).toEqual({ errors: [], stability: { "REQ-1": 1, "REQ-2": 1 / 3 } });
    const bad = { ...m, alignment: [{ mergedReq: "REQ-1", from: ["d1:REQ-9"] }] };
    expect(checkMerge(bad, drafts).errors).toEqual(["REQ-1 cites a draft requirement that doesn't exist: d1:REQ-9", "REQ-2 has no source draft"]);
  });

  it("round trip: finds dropped spans and inventions", () => {
    const r = roundTripCheck(["I-1", "I-2"], ["Q-1"], spec([req("REQ-1")]),
      [{ n: 1, text: "greets with Hello" }, { n: 2, text: "adds an admin page" }],
      [{ n: 1, spans: ["I-1"], answers: [] }, { n: 2, spans: [], answers: [] }]);
    expect(r).toEqual({ droppedSpans: ["I-2"], inventedCapabilities: ["adds an admin page"] });
  });

  it("critic blocking is derived from severity", () => {
    expect(criticBlocks({ severity: "high" })).toBe(true);
    expect(criticBlocks({ severity: "medium" })).toBe(false);
  });

  it("lint catches format problems", () => {
    const bad = spec([req("REQ-1", { ears: "The system should be fast.", sources: [], acceptance: [] })]);
    const failed = lintSpec(bad, { spans: ["I-1"], changeClass: "feature", anchorOk: () => true }).filter((l) => !l.passed).map((l) => l.check);
    expect(failed).toEqual(["L2 req-ac", "L3 ears", "L4 vague", "L10 trace"]);
    const good = lintSpec(spec([req("REQ-1")]), { spans: ["I-1"], changeClass: "feature", anchorOk: () => true }).filter((l) => !l.passed);
    expect(good).toEqual([]);
  });
});

describe("only people put scope out of scope", () => {
  const req = (id: string, sources = ["I-1"]) => ({ id, ears: "When a name is given, the Greeter shall return Hello and the name.", op: "ADDED" as const, sources, acceptance: [{ id: `AC-${id.slice(4)}.1`, given: "a name", when: "greet", then: "the response is Hello Ann", level: "api" as const }] });
  const spec = (outOfScope: string[], reqs = [req("REQ-1")]) => ({ requirements: reqs, nfrs: [], outOfScope, assumptions: [] });
  const trace = (sp: ReturnType<typeof spec>, spans: string[], decisions: string[] = [], excluded: string[] = []) =>
    lintSpec(sp, { spans, changeClass: "feature", anchorOk: () => true, decisions, excluded }).find((l) => l.check === "L10 trace")!;

  it("matches span ids as exact tokens: I-1 isn't in I-12", () => {
    expect(mentions("I-12 later (Q-1)", "I-1")).toBe(false);
    expect(mentions("I-1, I-12 later (Q-1)", "I-1")).toBe(true);
    expect(mentions("ASM-10", "ASM-1")).toBe(false);
    // L10: only I-12 is named, so I-1 (uncovered here) is still dropped
    const t = trace(spec(["I-12 SMS reminders (Q-1)"], [req("REQ-1", ["I-2"])]), ["I-1", "I-2", "I-12"], ["Q-1"]);
    expect(t.details).toContain("intent span I-1 isn't covered");
    expect(t.details).not.toContain("I-12");
  });

  it("out of scope with no answer or assumption cited counts as dropped", () => {
    const t = trace(spec(["I-2 bulk reminders (deferred to run 2)"]), ["I-1", "I-2"], ["Q-1", "ASM-1"]);
    expect(t).toMatchObject({ passed: false, blocking: true, details: "intent span I-2 was moved out of scope without a decision from you; cover it or ask" });
    // citing an id the run doesn't have doesn't count either
    expect(trace(spec(["I-2 bulk reminders (Q-9)"]), ["I-1", "I-2"], ["Q-1"]).passed).toBe(false);
    const rt = roundTripCheck(["I-1", "I-2"], ["Q-1"], spec(["I-2 deferred to run 2"]), [{ n: 1, text: "greets" }], [{ n: 1, spans: ["I-1"], answers: [] }]);
    expect(rt.droppedSpans).toEqual(["I-2"]);
  });

  it("out of scope citing an answer or assumption, or excluded by the request, counts as covered", () => {
    expect(trace(spec(["I-2 bulk reminders (Q-1: not now)"]), ["I-1", "I-2"], ["Q-1"]).passed).toBe(true);
    expect(trace(spec(["I-2 bulk reminders per ASM-3"]), ["I-1", "I-2"], ["ASM-3"]).passed).toBe(true);
    expect(requestExcluded([{ id: "I-1", text: "remind by email" }, { id: "I-2", text: "no need for SMS" }, { id: "I-3", text: "users don't get duplicate reminders" }])).toEqual(["I-2"]);
    expect(trace(spec(["I-2 SMS, as the request says"]), ["I-1", "I-2"], [], ["I-2"]).passed).toBe(true);
    const rt = roundTripCheck(["I-1", "I-2"], ["Q-1"], spec(["I-2 (Q-1)"]), [{ n: 1, text: "greets" }], [{ n: 1, spans: ["I-1"], answers: [] }]);
    expect(rt.droppedSpans).toEqual([]);
  });

  const big = spec(["x"], Array.from({ length: 21 }, (_, n) => req(`REQ-${n + 1}`)));
  it("size: skipped in estimate mode", () => {
    expect(lintSpec(big, { spans: ["I-1"], changeClass: "feature", anchorOk: () => true, estimate: true }).map((l) => l.check)).not.toContain("L9 size");
  });

  it("size: never sent to repair, shown on the approval card instead", async () => {
    const lint = lintSpec(big, { spans: ["I-1"], changeClass: "feature", anchorOk: () => true });
    expect(lint.find((l) => l.check === "L9 size")).toMatchObject({ passed: false, blocking: false });
    expect(problems({ lint, critic: [], roundTrip: { droppedSpans: [], inventedCapabilities: [] } })).toEqual([]);
    const note = sizeNote(big, "feature")!;
    expect(note).toBe("This spec has 21 requirements, about 2 runs' worth of work for a feature; approve it as one run or reject with which part to cut.");
    expect(sizeNote(spec(["x"]), "feature")).toBeUndefined();
    const { approvalCard } = await import("./spec.js");
    const ctx = { runId: "r1", state: { costUsd: 0, info: { request: "remind" } } } as never;
    const card = approvalCard(ctx, {
      intent: { source: "cli", spans: [{ id: "I-1", text: "remind" }], changeClass: "feature", risk: "low", riskTags: [], rigor: "full", touchesUi: false },
      spec: big, plan: { tasks: [], options: [], chosen: "O-1", adr: "", protectedPathsDeclared: [], newDependencies: [], stubs: [], complexity: "L" } as never,
      critic: { findings: [] }, cb: { claims: [], notFound: [] }, risk: "low", clar: { answers: [], assumptions: [], conflicts: [] }, open: [], size: note,
    });
    expect(card).toContain(`**${note}**`);
  });

  it("a repair that drops a covered span is caught; identical problems stop repairs", () => {
    expect(lostCoverage(spec([], [req("REQ-1", ["I-1"]), req("REQ-2", ["I-2", "Q-1"])]), spec(["I-2 later"], [req("REQ-1", ["I-1"])]), ["I-1", "I-2"])).toEqual(["I-2"]);
    expect(lostCoverage(spec([], [req("REQ-1", ["I-1", "I-2"])]), spec([], [req("REQ-1", ["I-1"]), req("REQ-2", ["I-2"])]), ["I-1", "I-2"])).toEqual([]);
    expect(sameProblems(["[critic high] REQ-1 No empty path.", "[lint L3 ears] x"], ["[lint L3 ears] x", "[critic high]  REQ-1 no empty path"])).toBe(true);
    expect(sameProblems(["[lint L3 ears] x"], ["[lint L3 ears] x", "[round trip] span I-2 isn't covered by the spec"])).toBe(false);
  });

  it("critic: a repo-less run gets no existing-code rubric", () => {
    const none = criticTemplate(false), repo = criticTemplate(true);
    expect(repo).toContain("5 claims about existing behaviour without anchors");
    expect(repo).toContain("6 state transitions and existing data");
    expect(none.split("\n")[1]).not.toMatch(/anchors|existing data|\b5 |\b6 /);
    expect(none).toContain("There is no existing codebase: this is new work. Don't flag missing anchors, unknown existing data or missing repository.");
  });
});

describe("audit fixes: model-less steps", () => {
  it("deterministic steps get a retry-only ladder instead of crashing", async () => {
    const { availableRungs } = await import("./routing.js");
    const { ProjectConfig } = await import("../config/project.js");
    const p = ProjectConfig.parse({ project: "x", repo: "/r", stack: "dotnet" });
    for (const st of ["discover", "stub-commit", "integrate", "accept", "deliver", "clarify", "approve"]) {
      expect([...availableRungs(p, st, false)]).toEqual(["retry"]);
    }
    expect([...availableRungs(p, "implement", false)]).toEqual(["retry", "raise-effort", "stronger-model"]);
  });
});

describe("audit fixes: test IDs are looked up, not guessed", () => {
  it("maps method names to the real IDs, theory rows included", async () => {
    const { resolveTestIds } = await import("./build.js");
    const ids = ["Shop.Tests::Shop.Tests.Orders.AC_1_1_Returns404", "Shop.Tests::Shop.Tests.Orders.AC_1_2_Validates(qty: 0)", "Shop.Tests::Shop.Tests.Orders.AC_1_2_Validates(qty: -1)", "Shop.Tests::Shop.Tests.Old.CHAR_Totals"];
    const r = resolveTestIds(["AC_1_1_Returns404", "AC_1_2_Validates", "CHAR_Totals", "AC_2_1_Missing"], ids);
    expect(r.ids["AC_1_2_Validates"]).toHaveLength(2);
    expect(r.ids["CHAR_Totals"]).toEqual(["Shop.Tests::Shop.Tests.Old.CHAR_Totals"]);
    expect(r.missing).toEqual(["AC_2_1_Missing"]);
    // a prefix of another name doesn't count
    expect(resolveTestIds(["AC_1_1_Returns"], ids).missing).toEqual(["AC_1_1_Returns"]);
  });
});

describe("deliver targets", () => {
  it("refuses a non-GitHub forge at start, allows none or GitHub", async () => {
    const { assertDeliverable } = await import("./executor.js");
    const { ProjectConfig } = await import("../config/project.js");
    const base = { project: "x", repo: "/r", stack: "dotnet" };
    expect(() => assertDeliverable(ProjectConfig.parse({ ...base, forge: { kind: "bitbucket", repo: "o/r" } }))).toThrow(/GitHub only/);
    expect(() => assertDeliverable(ProjectConfig.parse({ ...base, forge: { kind: "github", repo: "o/r" } }))).not.toThrow();
    expect(() => assertDeliverable(ProjectConfig.parse(base))).not.toThrow();
  });
});

describe("acceptance criteria ownership", () => {
  it("gives each criterion to the last task that works on its requirement", async () => {
    const { acOwners } = await import("./build.js");
    const req = (id: string, acs: string[]) => ({ id, ears: "", op: "ADDED" as const, sources: [], acceptance: acs.map((a) => ({ id: a, given: "", when: "", then: "", level: "api" as const })) });
    const spec = { requirements: [req("REQ-1", ["AC-1.1", "AC-1.2"]), req("REQ-2", ["AC-2.1"])] };
    const plan = { tasks: [{ id: "TASK-1", reqs: ["REQ-1"] }, { id: "TASK-2", reqs: ["REQ-1", "REQ-2"] }] };
    const o = acOwners(plan, spec);
    expect([...o.entries()]).toEqual([["AC-1.1", "TASK-2"], ["AC-1.2", "TASK-2"], ["AC-2.1", "TASK-2"]]);
    // TASK-1 owns nothing: it must only keep characterisation tests and the baseline green
    expect([...o.values()].includes("TASK-1")).toBe(false);
  });
});
