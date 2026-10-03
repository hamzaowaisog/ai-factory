import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { Estimate } from "../contracts/index.js";
import type { Breakdown } from "../contracts/index.js";
import { estimateApiCost } from "./cost.js";
import { buildWorkbook, exportWorkbooks, MANDATORY_SHEETS, SHEET, SUMMARY_LABEL, TEAM_SHEETS, type ExportInput } from "./export.js";
import { gateHours } from "./gate-hours.js";
import { sizeTasks } from "./hours.js";
import { computeTotals } from "./totals.js";
import { lintWorkbook, loadWorkbook } from "./workbook-lint.js";
import { evalFormula } from "./xl-formula.js";

import { fixture } from "./fixture.js";

describe("formula evaluator", () => {
  const cells: Record<string, number | string> = { "S!A1": 2, "S!A2": 3, "S!B1": "Yes", "T!C1": 10 };
  const get = (s: string, a: string) => cells[`${s}!${a}`];
  it("handles the subset the workbook uses", () => {
    expect(evalFormula("SUM(A1:A2)+A1", "S", get)).toBe(7);
    expect(evalFormula("ROUND((A1+A2)/3,2)", "S", get)).toBe(1.67);
    expect(evalFormula(`IF(B1="Yes",'T'!C1,0)`, "S", get)).toBe(10);
    expect(evalFormula(`IF(B1="No",T!C1,0)`, "S", get)).toBe(0);
  });
  it("fails on an empty cell, an empty sum, division by zero and unknown functions", () => {
    expect(() => evalFormula("A9+1", "S", get)).toThrow(/empty cell/);
    expect(() => evalFormula("SUM(A8:A9)", "S", get)).toThrow(/no numbers/);
    expect(() => evalFormula("A1/0", "S", get)).toThrow(/division/);
    expect(() => evalFormula("VLOOKUP(A1)", "S", get)).toThrow(/unsupported/);
  });
});

describe("workbook export", () => {
  it("draws every mandatory sheet, and the team sheets only in the team file", () => {
    const team = buildWorkbook(fixture(), "team"), client = buildWorkbook(fixture(), "client");
    for (const s of MANDATORY_SHEETS) { expect(team.getWorksheet(s)).toBeTruthy(); expect(client.getWorksheet(s)).toBeTruthy(); }
    for (const s of TEAM_SHEETS) { expect(team.getWorksheet(s)).toBeTruthy(); expect(client.getWorksheet(s)).toBeUndefined(); }
  });

  it("lints clean for both audiences and both delivery models, design in or out", () => {
    for (const model of ["hitl", "agentic"] as const) {
      for (const design of [true, false]) {
        const input = fixture(model, design);
        for (const aud of ["team", "client"] as const) {
          expect(lintWorkbook(buildWorkbook(input, aud), input.estimate, input.breakdown, aud)).toEqual([]);
        }
      }
    }
  });

  it("puts the estimate's totals on the Summary and links each row to its sheet", () => {
    const input = fixture();
    const S = buildWorkbook(input, "client").getWorksheet("Summary")!;
    let total: { min: unknown; max: unknown } | undefined; let backend: unknown;
    S.eachRow((_r, n) => {
      const label = S.getCell(`B${n}`).value;
      const v = (c: string) => { const x = S.getCell(`${c}${n}`).value; return x && typeof x === "object" && "result" in x ? x.result : x; };
      if (label === "Total") total = { min: v("C"), max: v("D") };
      if (label === SUMMARY_LABEL.backend) backend = S.getCell(`C${n}`).value && (S.getCell(`C${n}`).value as { formula: string }).formula;
    });
    expect(total).toEqual({ min: input.estimate.totals.overall.min, max: input.estimate.totals.overall.max });
    expect(backend).toBe(`'${SHEET.backend}'!D6`);
  });

  it("shows a factory task at zero effort and its size only in the team file", () => {
    const input = fixture();
    const find = (wb: ReturnType<typeof buildWorkbook>) => {
      const ws = wb.getWorksheet(SHEET.web)!; let row = 0;
      ws.eachRow((_r, n) => { if (ws.getCell(`I${n}`).value === "EST-2") row = n; });
      return { ws, row };
    };
    const t = find(buildWorkbook(input, "team")), c = find(buildWorkbook(input, "client"));
    expect(t.ws.getCell(`D${t.row}`).value).toBe(0);
    expect(t.ws.getCell(`J${t.row}`).value).toBe(8);
    expect(c.ws.getCell(`J${c.row}`).value).toBeNull();
  });

  it("marks an empty track as not in scope and keeps its total a real formula", () => {
    const ws = buildWorkbook(fixture(), "team").getWorksheet(SHEET.mobile)!;
    const texts: string[] = [];
    ws.eachRow((_r, n) => { const v = ws.getCell(`B${n}`).value; if (typeof v === "string") texts.push(v); });
    expect(texts).toContain("Not in scope: web app only");
  });

  it("leaves the client file free of internal reasoning", () => {
    const wb = buildWorkbook(fixture(), "client");
    const all: string[] = [];
    for (const ws of wb.worksheets) ws.eachRow((row) => row.eachCell((c) => { if (typeof c.value === "string") all.push(c.value); }));
    const text = all.join("\n");
    expect(text).not.toContain("twice the screens");
    expect(text).not.toContain("typical login form");
    expect(text).toContain("Client provides API keys before build");
  });

  it("puts the task catalogue's status in the team file only", () => {
    const f = fixture();
    const input = { ...f, estimate: { ...f.estimate, catalogue: { version: "2026-10-03.1", status: "draft" as const, stack: "default" } } };
    const textOf = (audience: "team" | "client") => {
      const all: string[] = [];
      for (const ws of buildWorkbook(input, audience).worksheets) ws.eachRow((row) => row.eachCell((c) => { if (typeof c.value === "string") all.push(c.value); }));
      return all.join("\n");
    };
    expect(textOf("team")).toContain("reference hours, not yet measured");
    expect(textOf("client")).not.toMatch(/reference hours|catalogue/i);
  });

  it("carries no supervisor gate rows in the agentic file", () => {
    const input = fixture("agentic");
    const ws = buildWorkbook(input, "team").getWorksheet(SHEET.other)!;
    ws.eachRow((_r, n) => expect(String(ws.getCell(`C${n}`).value)).not.toContain("Supervisor"));
  });
});

describe("gate E6 over a written workbook", () => {
  const dirs: string[] = [];
  afterAll(async () => { for (const d of dirs) await rm(d, { recursive: true, force: true }); });

  it("round-trips both files through disk and still lints clean", async () => {
    const dir = await mkdtemp(join(tmpdir(), "xl-")); dirs.push(dir);
    const input = fixture();
    const out = await exportWorkbooks(input, dir, "portal-hitl");
    expect(lintWorkbook(await loadWorkbook(out.team), input.estimate, input.breakdown, "team")).toEqual([]);
    expect(lintWorkbook(await loadWorkbook(out.client), input.estimate, input.breakdown, "client")).toEqual([]);
  });

  it("catches a typed-in total, a broken link, a dropped task and a leaked sheet", () => {
    const input = fixture();
    // typed-in total on a track sheet
    const a = buildWorkbook(input, "client");
    const B = a.getWorksheet(SHEET.backend)!;
    B.eachRow((_r, n) => { if (String(B.getCell(`C${n}`).value).startsWith("Development Total")) B.getCell(`D${n}`).value = 99; });
    const typed = lintWorkbook(a, input.estimate, input.breakdown, "client").map((i) => i.check);
    expect(typed).toContain("typed-total");

    // a Summary row pointing at the wrong sheet
    const b = buildWorkbook(input, "client");
    const S = b.getWorksheet("Summary")!;
    S.eachRow((_r, n) => { if (S.getCell(`B${n}`).value === SUMMARY_LABEL.backend) S.getCell(`C${n}`).value = { formula: `'${SHEET.web}'!D1`, result: 0 }; });
    expect(lintWorkbook(b, input.estimate, input.breakdown, "client").map((i) => i.check)).toContain("summary-link");

    // a task removed from its sheet
    const c = buildWorkbook(input, "client");
    const W = c.getWorksheet(SHEET.web)!;
    W.eachRow((_r, n) => { if (W.getCell(`I${n}`).value === "EST-2") W.getCell(`I${n}`).value = ""; });
    expect(lintWorkbook(c, input.estimate, input.breakdown, "client").map((i) => i.check)).toContain("task-rows");

    // a team sheet in the client file
    const d = buildWorkbook(input, "client"); d.addWorksheet("Anchors");
    expect(lintWorkbook(d, input.estimate, input.breakdown, "client").map((i) => i.check)).toContain("client-leak");
  });

  it("catches a wrong cached result and a formula over an empty cell", () => {
    const input = fixture();
    const wb = buildWorkbook(input, "client");
    const S = wb.getWorksheet("Summary")!;
    S.eachRow((_r, n) => { if (S.getCell(`B${n}`).value === "Total") S.getCell(`C${n}`).value = { formula: (S.getCell(`C${n}`).value as { formula: string }).formula, result: 1 }; });
    S.getCell("H40").value = { formula: "Z99+1", result: 1 };
    const checks = lintWorkbook(wb, input.estimate, input.breakdown, "client");
    expect(checks.some((i) => i.check === "formula" && /caches 1/.test(i.message))).toBe(true);
    expect(checks.some((i) => i.check === "formula" && /empty cell/.test(i.message))).toBe(true);
  });

  it("catches a workbook that disagrees with the estimate's stored totals", () => {
    const input = fixture();
    const wb = buildWorkbook(input, "client");
    const cooked = { ...input.estimate, totals: { ...input.estimate.totals, overall: { min: 1, max: 2 } } };
    expect(lintWorkbook(wb, cooked, input.breakdown, "client").map((i) => i.check)).toContain("summary-total");
  });
});
