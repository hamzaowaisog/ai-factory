import { describe, expect, it } from "vitest";
import { checkStartBudget, stepBudgetUsd } from "../ledger/caps.js";
import type { RunState } from "../ledger/state.js";
import { timeSplit } from "../report.js";
import { complexityOf, LANE, lightBuild, lightSpec, specLane, testWriterTurns } from "./lane.js";
import { downgradeUi } from "./specpipe.js";
import { authorIntro, testsScreens } from "./stack-text.js";

describe("light lane", () => {
  it("small low-risk work, and bug fixes that aren't high risk, take it", () => {
    expect(lightSpec({ risk: "low", rigor: "light", changeClass: "feature" })).toBe(true);
    expect(lightSpec({ risk: "low", rigor: "full", changeClass: "bugfix" })).toBe(true);
    expect(lightSpec({ risk: "low", rigor: "full", changeClass: "feature" })).toBe(false);
    // a bug fix that isn't high risk is light (a medium "double booking" fix spent $3.40 of $6 on the full spec lane)
    expect(lightSpec({ risk: "medium", rigor: "full", changeClass: "bugfix" })).toBe(true);
    expect(lightSpec({ risk: "medium", rigor: "light", changeClass: "feature" })).toBe(false);
    expect(lightSpec({ risk: "high", rigor: "light", changeClass: "bugfix" })).toBe(false);
    expect(lightBuild({ risk: "low", rigor: "light", changeClass: "bugfix" }, "S")).toBe(true);
    expect(lightBuild({ risk: "low", rigor: "light", changeClass: "bugfix" }, "M")).toBe(false);
    expect(lightBuild({ risk: "medium", rigor: "light", changeClass: "bugfix" }, "S")).toBe(true);
    expect(lightBuild({ risk: "medium", rigor: "light", changeClass: "feature" }, "S")).toBe(false);
  });

  it("the test writer gets more turns when a criterion needs a test host", () => {
    expect(testWriterTurns(true, ["unit", "unit"])).toBe(25);
    expect(testWriterTurns(true, ["unit", "api"])).toBe(40);
    expect(testWriterTurns(true, ["job"])).toBe(40);
    expect(testWriterTurns(false, ["unit"])).toBe(60);
    expect(testWriterTurns(false, ["api"])).toBe(60);
  });

  it("the full lane keeps what every run had before", () => {
    expect(LANE.full).toMatchObject({ drafts: 3, maxRepairs: 3, groundTurns: 12, testWriterTurns: 60, criticEffort: undefined });
    expect(LANE.light).toMatchObject({ drafts: 1, maxRepairs: 1, groundTurns: 8, testWriterTurns: 25, criticEffort: "medium", maxCharacterisation: 2 });
  });

  it("an estimate or design run writes one draft and repairs once; a small change keeps the light lane", () => {
    const big = { risk: "high", rigor: "full", changeClass: "feature" } as const;
    for (const mode of ["estimate", "design"]) expect(specLane(big, mode)).toEqual({ drafts: 1, maxRepairs: 1, criticEffort: "medium", name: "requirements" });
    for (const mode of ["brownfield", "greenfield", undefined]) expect(specLane(big, mode)).toMatchObject({ drafts: 3, maxRepairs: 3, criticEffort: undefined, name: "full" });
    expect(specLane({ risk: "low", rigor: "light", changeClass: "feature" }, "estimate")).toMatchObject({ drafts: 1, name: "light" });
  });
});

describe("ui criteria become manual checks", () => {
  it("downgrades only ui, and says which", () => {
    const ac = (id: string, level: "unit" | "api" | "job" | "ui" | "manual") => ({ id, given: "g", when: "w", then: "the value is shown", level });
    const spec = { requirements: [{ id: "REQ-1", ears: "e", op: "MODIFIED" as const, sources: ["I-1"], acceptance: [ac("AC-1.1", "unit"), ac("AC-1.2", "ui"), ac("AC-1.3", "api")] }], nfrs: [], outOfScope: [], assumptions: [] };
    const d = downgradeUi(spec);
    expect(d.downgraded).toEqual(["AC-1.2"]);
    expect(d.spec.requirements[0]!.acceptance.map((a) => a.level)).toEqual(["unit", "manual", "api"]);
    expect(downgradeUi(d.spec).downgraded).toEqual([]);
  });

  it("leaves them alone where the lab tests screens: the test writer gives each a screen test", () => {
    const ac = (id: string, level: "unit" | "ui" | "manual") => ({ id, given: "g", when: "w", then: "the value is shown", level });
    const spec = { requirements: [{ id: "REQ-1", ears: "e", op: "ADDED" as const, sources: ["I-1"], acceptance: [ac("AC-1.1", "ui"), ac("AC-1.2", "manual")] }], nfrs: [], outOfScope: [], assumptions: [] };
    const d = downgradeUi(spec as never, testsScreens("node"));
    expect(d.downgraded).toEqual([]);
    expect(d.spec).toBe(spec);
    expect(testsScreens("dotnet")).toBe(false);
  });

  it("gives the test writer the longer turn limit for a screen test, and its rules only when the checkout can run one", () => {
    expect(testWriterTurns(true, ["unit", "ui"])).toBe(LANE.light.testWriterTurnsApi);
    expect(testWriterTurns(true, ["unit"])).toBe(LANE.light.testWriterTurns);
    const ready = authorIntro("node", true), not = authorIntro("node");
    // split so vitest does not read the marker in THIS file and look for jsdom here
    expect(ready).toContain(`"// @vitest-${"environment"} jsdom"`);
    expect(ready).toContain("./support/screen");
    expect(ready).not.toContain("don't render components");
    expect(not).toContain("don't render components");
    expect(not).toContain('"unit" and "ui" criteria call the module directly');
    expect(authorIntro("dotnet", true)).toBe(authorIntro("dotnet"));
  });
});

describe("a step's budget", () => {
  const state = (costUsd: number, over: Partial<RunState["info"]> = {}) =>
    ({ costUsd, capOverrides: {}, info: { changeClass: "bugfix", complexity: "S", spendAtPlan: 2.5, ...over } }) as unknown as RunState;
  it("is its own limit, but never more than what's left of the run's limit", () => {
    // cap after the plan: $2.50 + $5 (S) = $7.50
    expect(stepBudgetUsd(state(3), 4)).toBe(4);
    expect(stepBudgetUsd(state(5), 4)).toBeCloseTo(2.5);
    // --max-cost 5 with $2.55 spent: the first real run's test writer would have had $2.45, not $4
    expect(stepBudgetUsd(state(2.55, { maxCostUsd: 5 }), 4)).toBeCloseTo(2.45);
    // nothing left: a small floor, so the step runs out and the cap card follows
    expect(stepBudgetUsd(state(5.2, { maxCostUsd: 5 }), 4)).toBe(0.25);
  });

  it("is checked before the step starts: too little left raises the limit card first", () => {
    const st = (costUsd: number) => state(costUsd, { changeClass: "feature", complexity: "M", spendAtPlan: 0 } as never); // limit $10
    // the real run: the test writer's first attempt used $2.84, and $0.96 was left for the second
    const hit = checkStartBudget(st(9.04), [{ key: "author-tests", needsUsd: 1, attemptsUsd: [2.84] }])!;
    expect(hit).toMatchObject({ kind: "cost", waivable: true, proposal: { costUsd: 20 } });
    expect(hit.reason).toBe("Not enough left to run author-tests: $0.96 of the $10.00 limit is left, and its last attempt used $2.84");
    // half of the dearest attempt is enough to start a retry (it keeps the earlier work)
    expect(checkStartBudget(st(8.5), [{ key: "author-tests", needsUsd: 1, attemptsUsd: [0.4, 2.84] }])).toBeUndefined();
    // a coding agent's first attempt needs its minimum; a step with no minimum and no failed attempt always starts
    expect(checkStartBudget(st(9.5), [{ key: "implement/TASK-1", needsUsd: 1, attemptsUsd: [] }])!.reason).toMatch(/\$0\.50 of the \$10\.00 limit is left, and it needs about \$1\.00 to start$/);
    expect(checkStartBudget(st(9.99), [{ key: "plan", attemptsUsd: [] }])).toBeUndefined();
    // side by side, the steps split what is left
    expect(checkStartBudget(st(8.5), [{ key: "a", needsUsd: 1, attemptsUsd: [] }, { key: "b", needsUsd: 1, attemptsUsd: [] }])!.reason).toMatch(/\$0\.75 of the \$10\.00 limit is left for each step/);
  });
});

describe("time split", () => {
  it("model turns, the agent's container and the lab, per step", () => {
    const ev = (ts: number, step: string, kind: string, msg = "", data?: Record<string, unknown>) => ({ ts: new Date(ts * 1000).toISOString(), elapsedMs: 0, step, kind, msg, data });
    const t = timeSplit([
      ev(0, "plan", "model.turn", "", { ms: 8200 }), ev(9, "plan", "model.turn", "", { ms: 1800 }),
      ev(10, "author-tests", "agent.start"), ev(610, "author-tests", "agent.end"),
      ev(611, "author-tests", "lab.restore", "lab: restore ok (6s)"), ev(680, "author-tests", "lab.build", "lab: build ok (62s)"),
      ev(700, "author-tests", "lab.tests", "lab: tests ran: 15 (3 passed, 12 failed), exit 1 (10s)"), ev(701, "author-tests", "lab.rerun", "lab: re-running 12"),
    ]);
    expect(t.get("plan")).toEqual({ modelSec: 10, agentSec: 0, labSec: 0 });
    expect(t.get("author-tests")).toEqual({ modelSec: 0, agentSec: 600, labSec: 78 });
  });
});

describe("plan size comes from the change, not the task count", () => {
  const task = (fileScope: string[], plannedLoc: number) => ({ id: "TASK-1", title: "", reqs: [], fileScope, exemplars: [], conventions: [], dependsOn: [], plannedLoc, approach: "" });
  it("the 2026-10-04 run: 3 tasks, 14 lines, 4 files is S (it was M, and took the full build lane)", () => {
    const plan = { tasks: [task(["src/A/Cancel.cs", "src/A/Complete.cs"], 6), task(["src/A/Endpoints.cs"], 2), task(["src/Common/Problem.cs"], 6)] };
    expect(complexityOf(plan)).toBe("S");
    expect(lightBuild({ risk: "low", rigor: "light", changeClass: "bugfix" } as never, complexityOf(plan))).toBe(true);
  });
  it("lines and files set the size; a glob counts as 3 files", () => {
    expect(complexityOf({ tasks: [task(["a.cs"], 151)] })).toBe("M");
    expect(complexityOf({ tasks: [task(["a.cs", "b.cs", "c.cs", "d.cs", "e.cs", "f.cs", "g.cs"], 20)] })).toBe("M");
    expect(complexityOf({ tasks: [task(["src/Orders/**", "src/Billing/**"], 40)] })).toBe("S");
    expect(complexityOf({ tasks: [task(["src/Orders/**", "src/Billing/**", "x.cs"], 40)] })).toBe("M");
    expect(complexityOf({ tasks: [task(["a.cs"], 601)] })).toBe("L");
    expect(complexityOf({ tasks: Array.from({ length: 8 }, (_, i) => task([`f${i}.cs`, `g${i}.cs`, `h${i}.cs`], 10)) })).toBe("L"); // 24 files
  });
});
