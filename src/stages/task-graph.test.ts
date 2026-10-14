import { describe, expect, it } from "vitest";
import { graphReport, taskGraph, waves, type GraphTask } from "./task-graph.js";

const t = (id: string, fileScope: string[], dependsOn: string[] = [], plannedLoc = 50): GraphTask => ({ id, reqs: [], fileScope, dependsOn, plannedLoc });

describe("which tasks could run side by side", () => {
  it("screens after a foundation task form one wave; a task that changes a shared set-up file waits for all before it", () => {
    const plan = [
      t("TASK-1", ["app/layout.tsx", "package.json", "app/globals.css"]),
      t("TASK-2", ["components/screens/s-1/container.tsx"], ["TASK-1"]),
      t("TASK-3", ["components/screens/s-2/container.tsx"], ["TASK-1"]),
      t("TASK-4", ["components/screens/s-3/container.tsx"]), // the planner forgot the dependency: code adds it (TASK-1 is set-up)
      t("TASK-5", ["package.json", "components/screens/s-4/container.tsx"]),
    ];
    const { edges, problems } = taskGraph(plan);
    expect(problems).toEqual([]);
    expect(waves(plan, edges)).toEqual([["TASK-1"], ["TASK-2", "TASK-3", "TASK-4"], ["TASK-5"]]);
    expect(edges).toContainEqual({ from: "TASK-1", to: "TASK-4", why: "shared set-up file" });
    expect(edges.filter((e) => e.to === "TASK-5").map((e) => e.from)).toEqual(["TASK-1", "TASK-2", "TASK-3", "TASK-4"]);
  });

  it("tasks sharing a file wait for each other; the planner's order is kept; a forward or unknown dependency is a problem", () => {
    const plan = [t("TASK-1", ["src/a.ts"]), t("TASK-2", ["src/b.ts", "src/a.ts"]), t("TASK-3", ["src/c.ts"], ["TASK-2"]), t("TASK-4", ["src/d.ts"], ["TASK-5", "TASK-9"]), t("TASK-5", ["src/e.ts"])];
    const { edges, problems } = taskGraph(plan);
    expect(edges).toContainEqual({ from: "TASK-1", to: "TASK-2", why: "shared file" });
    expect(waves(plan, edges)).toEqual([["TASK-1", "TASK-4", "TASK-5"], ["TASK-2"], ["TASK-3"]]);
    expect(problems).toEqual(["TASK-4 depends on TASK-5, which does not come before it", "TASK-4 depends on unknown TASK-9"]);
  });

  it("an API's tasks that each touch its database context stay in one chain; a layered plan is always one chain", () => {
    const api = [t("TASK-1", ["App.Api/AppDb.cs", "App.Api/Program.cs"]), t("TASK-2", ["App.Api/Endpoints/A.cs", "App.Api/AppDb.cs"]), t("TASK-3", ["App.Api/Endpoints/B.cs"])];
    expect(waves(api, taskGraph(api).edges)).toEqual([["TASK-1"], ["TASK-2"], ["TASK-3"]]);
    const flat = [t("TASK-1", ["a.ts"]), t("TASK-2", ["b.ts"]), t("TASK-3", ["c.ts"])];
    expect(waves(flat, taskGraph(flat).edges)).toEqual([["TASK-1", "TASK-2", "TASK-3"]]);
    expect(waves(flat, taskGraph(flat, true).edges)).toEqual([["TASK-1"], ["TASK-2"], ["TASK-3"]]);
  });

  it("reports the waves and the longest chain against the total for the plan card", () => {
    const plan = [t("TASK-1", ["package.json"], [], 90), t("TASK-2", ["s1.tsx"], ["TASK-1"], 100), t("TASK-3", ["s2.tsx"], ["TASK-1"], 60)];
    expect(graphReport(plan)).toEqual([
      "## Task order (2 waves for 3 tasks; the tasks run one after another today)",
      "- Wave 1: TASK-1",
      "- Wave 2: TASK-2 (after: planner), TASK-3 (after: planner)",
      "Side by side, the longest chain is 190 of 250 planned lines.",
    ]);
  });
});
