// Gate E6, cell level: read a finished workbook back and check it against the estimate it came from.
// Every formula is recomputed from the cells it points at; every total row must be a formula; the
// Summary must link to each sheet's own total; and the figures must match what the estimate stores.
import ExcelJS from "exceljs";
import type { Breakdown, Estimate } from "../contracts/index.js";
import { agentHours } from "./durations.js";
import { effortHours } from "./hours.js";
import { evalFormula, type CellValue } from "./xl-formula.js";
import { ALL_TASKS_SHEET, DESIGN_SWITCH_LABEL, MANDATORY_SHEETS, OPTIONAL_TEAM_SHEETS, SHEET, SUMMARY_LABEL, TEAM_SHEETS, type Audience } from "./export.js";
import type { LintIssue } from "./lint.js";

const EPS = 0.011;
/** Rows whose figures must be formulas: the template's total rows and the Other sheet's "<section> TOTAL". */
const TOTAL_LABEL = /^\s*(grand total|development total|post development activities total|research total|total)\b|\bTOTAL$/i;
const near = (a: number, b: number): boolean => Math.abs(a - b) <= EPS;

function plain(v: ExcelJS.CellValue): CellValue {
  if (v === null || v === undefined || v === "") return undefined;
  if (typeof v === "number" || typeof v === "string") return v;
  if (typeof v === "object" && "formula" in v) {
    // ExcelJS drops a cached result of 0, so a formula with no stored result reads as 0
    return typeof v.result === "number" || typeof v.result === "string" ? v.result : 0;
  }
  if (typeof v === "object" && "richText" in v) return v.richText.map((x) => x.text).join("");
  return undefined;
}

export async function loadWorkbook(path: string): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path);
  return wb;
}

export function lintWorkbook(wb: ExcelJS.Workbook, e: Estimate, b: Pick<Breakdown, "tasks">, audience: Audience): LintIssue[] {
  const issues: LintIssue[] = [];
  const bad = (check: string, message: string) => issues.push({ check, message });

  for (const s of [...MANDATORY_SHEETS, ALL_TASKS_SHEET]) if (!wb.getWorksheet(s)) bad("sheet-missing", `sheet ${s} is missing`);
  for (const s of TEAM_SHEETS) {
    const has = !!wb.getWorksheet(s);
    if (audience === "client" && has) bad("client-leak", `the client file carries the team sheet ${s}`);
    if (audience === "team" && !has) bad("sheet-missing", `the team file lacks sheet ${s}`);
  }
  if (audience === "client") for (const s of OPTIONAL_TEAM_SHEETS) if (wb.getWorksheet(s)) bad("client-leak", `the client file carries the team sheet ${s}`);
  if (issues.some((i) => i.check === "sheet-missing")) return issues;

  const read = (sheet: string, addr: string): CellValue => {
    const ws = wb.getWorksheet(sheet);
    return ws ? plain(ws.getCell(addr).value) : undefined;
  };

  // every formula recomputes to its cached result; a total row is a formula, never a typed number
  for (const ws of wb.worksheets) {
    ws.eachRow((row, rowNo) => {
      row.eachCell((cell) => {
        const v = cell.value;
        if (v && typeof v === "object" && "formula" in v) {
          try {
            const again = evalFormula(v.formula!, ws.name, read);
            const cached = plain(v);
            if (typeof again === "number" && (typeof cached !== "number" || !near(again, cached))) bad("formula", `${ws.name}!${cell.address} caches ${cached ?? "nothing"}, recomputes to ${again}`);
          } catch (err) { bad("formula", `${ws.name}!${cell.address}: ${(err as Error).message}`); }
        }
      });
      const label = [plain(ws.getCell(`B${rowNo}`).value), plain(ws.getCell(`C${rowNo}`).value)].find((x) => typeof x === "string" && TOTAL_LABEL.test(x));
      if (label) {
        const cols = ws.name === "Summary" ? ["C", "D"] : ["D", "E"];
        for (const c of cols) {
          const v = ws.getCell(`${c}${rowNo}`).value;
          if (typeof v === "number") bad("typed-total", `${ws.name}!${c}${rowNo} (${String(label)}) is a typed number, not a formula`);
        }
      }
    });
  }

  // every breakdown task appears exactly once, on a track sheet, at its effort hours and its agent hours
  const sized = new Map(e.tasks.map((t) => [t.taskId, t]));
  const task = new Map(b.tasks.map((t) => [t.id, t]));
  const seen = new Map<string, number>();
  for (const ws of wb.worksheets) {
    if (ws.name === "Summary" || ws.name === ALL_TASKS_SHEET || (TEAM_SHEETS as readonly string[]).includes(ws.name) || (OPTIONAL_TEAM_SHEETS as readonly string[]).includes(ws.name)) continue;
    ws.eachRow((_row, rowNo) => {
      const id = plain(ws.getCell(`I${rowNo}`).value);
      if (typeof id !== "string" || !/^EST-\d+$/.test(id)) return;
      seen.set(id, (seen.get(id) ?? 0) + 1);
      const s = sized.get(id);
      const min = plain(ws.getCell(`D${rowNo}`).value), max = plain(ws.getCell(`E${rowNo}`).value);
      if (s) {
        const eff = effortHours(s);
        if (typeof min !== "number" || typeof max !== "number" || !near(min, eff.min) || !near(max, eff.max)) bad("task-hours", `${id} on ${ws.name} shows ${min}-${max}, the estimate says ${eff.min}-${eff.max}`);
        const t = task.get(id);
        if (t) {
          const ag = agentHours(s, t, e.elapsed.basis);
          const amin = plain(ws.getCell(`J${rowNo}`).value), amax = plain(ws.getCell(`K${rowNo}`).value);
          if (typeof amin !== "number" || typeof amax !== "number" || !near(amin, ag.min) || !near(amax, ag.max)) bad("agent-hours", `${id} on ${ws.name} shows agent ${amin}-${amax}, the estimate says ${ag.min}-${ag.max}`);
        }
      }
    });
  }
  for (const t of b.tasks) {
    const n = seen.get(t.id) ?? 0;
    if (n !== 1) bad("task-rows", `${t.id} appears ${n} times in the workbook, expected once`);
  }

  // Summary rows link to their sheet's own total, and match the stored totals
  const S = wb.getWorksheet("Summary")!;
  const links: Record<string, { sheet: string; track?: keyof Estimate["totals"]["byTrack"] }> = {
    [SUMMARY_LABEL.backend]: { sheet: SHEET.backend, track: "backend" }, [SUMMARY_LABEL.mobile]: { sheet: SHEET.mobile, track: "mobile" }, [SUMMARY_LABEL.web]: { sheet: SHEET.web, track: "web" },
    [SUMMARY_LABEL.qa]: { sheet: SHEET.qa, track: "qa" }, [SUMMARY_LABEL.gd]: { sheet: SHEET.other, track: "gd" }, [SUMMARY_LABEL.pm]: { sheet: SHEET.other, track: "pm" }, [SUMMARY_LABEL.pdm]: { sheet: SHEET.other, track: "pdm" },
    [SUMMARY_LABEL.cross]: { sheet: SHEET.other }, [SUMMARY_LABEL.design]: { sheet: SHEET.design, track: "design" },
  };
  let sumMin = 0, sumMax = 0, designMin = 0, designMax = 0, totalRow = 0;
  S.eachRow((_row, rowNo) => {
    const label = plain(S.getCell(`B${rowNo}`).value);
    if (label === "Total") totalRow = rowNo;
    if (typeof label !== "string" || !(label in links)) return;
    const want = links[label]!;
    const fm = S.getCell(`C${rowNo}`).value;
    if (typeof fm === "string") return; // a settings row that shares the label (e.g. PM: a person's name), not a track row
    const ok = fm && typeof fm === "object" && "formula" in fm && new RegExp(`^'${want.sheet}'!D\\d+$`).test(fm.formula!);
    if (!ok) bad("summary-link", `Summary row ${label} does not link to the ${want.sheet} sheet's own total`);
    const min = plain(S.getCell(`C${rowNo}`).value), max = plain(S.getCell(`D${rowNo}`).value);
    if (typeof min !== "number" || typeof max !== "number") return;
    if (want.track) {
      const stored = e.totals.byTrack[want.track] ?? { min: 0, max: 0 };
      if (!near(min, stored.min) || !near(max, stored.max)) bad("summary-track", `${label}: workbook ${min}-${max}, estimate ${stored.min}-${stored.max}`);
    }
    if (want.track === "design") { designMin = min; designMax = max; } else { sumMin += min; sumMax += max; }
  });
  if (!totalRow) bad("summary-total", "Summary has no Total row");
  else {
    const tMin = plain(S.getCell(`C${totalRow}`).value), tMax = plain(S.getCell(`D${totalRow}`).value);
    let switchRow = 0;
    S.eachRow((_row, rowNo) => { if (plain(S.getCell(`B${rowNo}`).value) === DESIGN_SWITCH_LABEL) switchRow = rowNo; });
    const inc = switchRow > 0 && plain(S.getCell(`C${switchRow}`).value) === "Yes";
    if (inc !== e.settings.designInTotal) bad("design-switch", `the Design switch says ${inc ? "Yes" : "No"}, the estimate says ${e.settings.designInTotal ? "Yes" : "No"}`);
    const wantMin = sumMin + (inc ? designMin : 0), wantMax = sumMax + (inc ? designMax : 0);
    if (typeof tMin !== "number" || typeof tMax !== "number" || !near(tMin, wantMin) || !near(tMax, wantMax)) bad("summary-total", `Total ${tMin}-${tMax} is not the sum of its rows ${wantMin}-${wantMax}`);
    if (typeof tMin === "number" && typeof tMax === "number" && (!near(tMin, e.totals.overall.min) || !near(tMax, e.totals.overall.max))) bad("summary-total", `Total ${tMin}-${tMax} differs from the estimate's overall ${e.totals.overall.min}-${e.totals.overall.max}`);
  }

  // API cost total
  let costRow = 0;
  S.eachRow((_row, rowNo) => { if (plain(S.getCell(`B${rowNo}`).value) === "API credit cost total") costRow = rowNo; });
  if (!costRow) bad("cost-total", "Summary has no API credit cost total");
  else {
    const min = plain(S.getCell(`C${costRow}`).value), max = plain(S.getCell(`D${costRow}`).value);
    if (typeof min !== "number" || typeof max !== "number" || !near(min, e.apiCost.total.min) || !near(max, e.apiCost.total.max)) bad("cost-total", `API cost in the workbook ${min}-${max}, estimate ${e.apiCost.total.min}-${e.apiCost.total.max}`);
  }
  return issues;
}
