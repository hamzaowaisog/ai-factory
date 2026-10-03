import { describe, expect, it } from "vitest";
import { Estimate } from "../contracts/index.js";
import type { Breakdown } from "../contracts/index.js";
import { considerationsFrom } from "./considerations.js";
import { estimateApiCost } from "./cost.js";
import { buildWorkbook, qaPlace, type ExportInput } from "./export.js";
import { gateHours } from "./gate-hours.js";
import { sizeTasks } from "./hours.js";
import { computeTotals } from "./totals.js";
import { lintWorkbook } from "./workbook-lint.js";

const sha = "a".repeat(64);
const t = (id: string, title: string, featureId: string, track: string, extra: object = {}) =>
  ({ id, title, featureId, reqs: ["R-1"], items: ["case a"], track, executor: "human", dependsOn: [], complexity: "standard", ...extra });
const breakdown = {
  features: [{ id: "F-1", title: "Login", reqs: ["R-1"] }, { id: "F-2", title: "Reports", reqs: ["R-2"] }],
  tasks: [
    t("EST-1", "Login API", "F-1", "backend", { executor: "factory" }),
    t("EST-2", "Test plan and strategy", "F-1", "qa", { reqs: [], overhead: "planning" }),
    t("EST-3", "Set up test environments", "F-1", "qa", { reqs: [], overhead: "environment" }),
    t("EST-4", "Test login", "F-1", "qa"),
    t("EST-5", "Test report filters", "F-2", "qa", { reqs: ["R-2"] }),
    t("EST-6", "Test report export", "F-2", "qa", { reqs: ["R-2"] }),
    t("EST-7", "Regression pass", "F-2", "qa"),
    t("EST-8", "Client UAT support", "F-2", "qa", { reqs: [], overhead: "client uat" }),
  ],
} as unknown as Pick<Breakdown, "features" | "tasks">;

function input(): ExportInput {
  const sizing = sizeTasks([{ taskId: "EST-1", hours: { min: 4, max: 8 } }], breakdown.tasks.map((x, i) => ({
    taskId: x.id, anchorId: "EST-1", ratio: i === 0 ? 1 : 0.5, reason: i === 0 ? "anchor" : "smaller", executor: x.executor,
  })));
  const gates = gateHours("hitl", { questions: 2, approvalSections: 2, prs: { low: 1, medium: 0, high: 0 }, factoryTasks: 1, waivers: 0 });
  const totals = computeTotals(breakdown.tasks, sizing, [], gates, true);
  const estimate = Estimate.parse({
    header: { kind: "estimate", schemaVersion: 1, runId: "r", producedBy: { stage: "estimate" }, inputsHash: sha, createdAt: "2026-09-30T00:00:00Z" },
    deliveryModel: "hitl", band: "M", uncertainty: "medium", breakdownSha: sha, specSha: sha,
    anchors: [{ taskId: "EST-1", hours: { min: 4, max: 8 }, reason: "typical" }], tasks: sizing, overheads: [], gateHours: gates, totals,
    apiCost: estimateApiCost({ planning: 1, build: 4, verification: 4 }, [], "hitl"),
    elapsed: { planningMinutes: 20, criticalPathDays: { min: 1, max: 2 } },
    settings: { stackSource: "client", designInTotal: true, feedbackRounds: 2 }, assumptions: ["QA gets a running build"],
  });
  return { estimate, breakdown, header: { client: "Acme", project: "Portal", pm: "A. Lead", date: "2026-09-30", version: "v1" } };
}

describe("QA sheet", () => {
  it("places tasks in the template's eight items and cycles", () => {
    expect(qaPlace({ title: "Test plan and strategy", reqs: [] }).item).toBe(1);
    expect(qaPlace({ title: "Set up test environments", reqs: [] }).item).toBe(2);
    expect(qaPlace({ title: "Write test cases", reqs: ["R-1"] }).item).toBe(3);
    expect(qaPlace({ title: "Smoke test after deploy", reqs: [] }).item).toBe(5);
    expect(qaPlace({ title: "Cross browser checks", reqs: [] }).item).toBe(6);
    expect(qaPlace({ title: "Client UAT support", reqs: [] }).item).toBe(7);
    expect(qaPlace({ title: "Regression pass", reqs: ["R-1"] })).toEqual({ item: 4, cycle: 2 });
    expect(qaPlace({ title: "Testing cycle 3", reqs: ["R-1"] })).toEqual({ item: 4, cycle: 3 });
    expect(qaPlace({ title: "Test login", reqs: ["R-1"] })).toEqual({ item: 4, cycle: 1 });
    expect(qaPlace({ title: "Load test", reqs: [] }).item).toBe(8);
  });

  it("draws the Estimation Summary, the cycle detail and the notes, and lints clean in both files", () => {
    const i = input();
    for (const audience of ["team", "client"] as const) {
      const wb = buildWorkbook(i, audience);
      expect(lintWorkbook(wb, i.estimate, i.breakdown, audience)).toEqual([]);
      const ws = wb.getWorksheet("QA Estimates")!;
      const col = (c: string) => { const out: string[] = []; ws.eachRow((_r, n) => { const v = ws.getCell(`${c}${n}`).value; if (typeof v === "string") out.push(v); }); return out; };
      const c = col("C");
      for (const label of ["Estimation Summary", "Test Plan/Strategy", "Set up of Test Environments", "Validation and Smoke test cases", "Validation testing", "Smoke testing",
        "Multi Browser Compatibility testing", "UAT", "Misc. Optional testing", "Total QA Efforts", "Validation Testing", "Testing Cycle 1", "Testing Cycle 2", "Total Testing Cycle 1", "Total Testing Cycle 2", "Assumptions & Constraints", "Risks"]) {
        expect(c, label).toContain(label);
      }
      expect(c).toContain("Reports"); // two tests of one feature form a numbered module
      expect(c).toContain("QA gets a running build");
      expect(c).toContain("Test login"); // a feature with one test is a single row
    }
  });

  it("the grand total is the sum of the eight items and equals the QA track total", () => {
    const i = input();
    const wb = buildWorkbook(i, "client");
    const ws = wb.getWorksheet("QA Estimates")!;
    const want = i.estimate.totals.byTrack.qa!;
    const v = ws.getCell("D6").value as { formula: string; result: number };
    expect(v.result).toBeCloseTo(want.min, 2);
    expect((ws.getCell("E6").value as { result: number }).result).toBeCloseTo(want.max, 2);
  });
});

describe("special considerations", () => {
  const rounds = [{ asked: [{ id: "Q-1", text: "Which browsers must the admin site support?" }, { id: "Q-2", text: "Is this hosted on AWS or on the client's servers?" }, { id: "Q-3", text: "Who can approve a refund?" }], answers: { "Q-1": "Latest Chrome and Safari", "Q-2": "AWS", "Q-3": "Managers" } }];
  it("fills a topic from the question that names it, and leaves the rest alone", () => {
    const c = considerationsFrom(rounds);
    expect(c.browsers).toEqual({ answer: "Latest Chrome and Safari", from: "Q-1" });
    expect(c.deployment).toEqual({ answer: "AWS", from: "Q-2" });
    expect(c.security).toBeUndefined();
    expect(c.platforms).toBeUndefined();
  });
  it("a hands-off run: the factory's assumptions fill the topics nobody was asked about, answers first", () => {
    const handsOff = [{ asked: [], assumedBy: "factory", assumptions: [{ id: "ASM-1", text: "Which browsers must be supported? → assumed: Latest Chrome" }, { id: "ASM-2", text: "Single sign-on? → assumed: no" }] }];
    const c = considerationsFrom(handsOff);
    expect(c.browsers).toEqual({ answer: "Assumed: Latest Chrome", from: "ASM-1" });
    expect(Object.keys(c)).toEqual(["browsers"]);
    // assumptions of a reviewed run stay out (a person chose not to answer them), and an answer wins over an assumption
    expect(considerationsFrom([{ ...handsOff[0]!, assumedBy: undefined }])).toEqual({});
    expect(considerationsFrom([...rounds, ...handsOff]).browsers).toEqual({ answer: "Latest Chrome and Safari", from: "Q-1" });
    const S = buildWorkbook({ ...input(), considerations: c }, "client").getWorksheet("Summary")!;
    let found = "";
    S.eachRow((_r, n) => { if (String(S.getCell(`B${n}`).value).startsWith("Browsers supported")) found = `${S.getCell(`C${n}`).value} | ${S.getCell(`E${n}`).value}`; });
    expect(found).toBe("Assumed: Latest Chrome | Factory assumption ASM-1, confirm with the client");
  });
  it("reaches the Summary sheet", () => {
    const i = { ...input(), considerations: considerationsFrom(rounds) };
    const S = buildWorkbook(i, "client").getWorksheet("Summary")!;
    let found = "";
    S.eachRow((_r, n) => { if (String(S.getCell(`B${n}`).value).startsWith("Browsers supported")) found = `${S.getCell(`C${n}`).value} | ${S.getCell(`E${n}`).value}`; });
    expect(found).toBe("Latest Chrome and Safari | Clarify answer Q-1");
  });
});
