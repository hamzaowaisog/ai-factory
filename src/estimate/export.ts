// The estimate workbook, drawn from the Estimate and Breakdown (docs/estimates-design.md, "The workbook").
// Two files come from one data model: the team file and the client file. The layout is Folio3's estimation
// template (v 0.5): its sheet names, its Summary rows and columns, and on each development sheet the title
// block, the Grand Total at the top, numbered modules, Other Development Activities and Research. When the
// template file is given, it is loaded as the base so its theme, fonts, column widths and cell styles carry
// over; without it the same layout is drawn in plain styles. Every total is a formula over exact ranges and
// gets its cached result from the same evaluator the E6 lint uses, so a cell can never carry a number that
// its formula does not produce.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";
import type { Breakdown, BreakdownTask, Estimate, Track } from "../contracts/index.js";
import { DEFAULT_ASSUMPTIONS, type Assumptions, type Range } from "./assumptions.js";
import type { Consideration, ConsiderationKey } from "./considerations.js";
import { agentHours } from "./durations.js";
import { effortHours, ZERO } from "./hours.js";
import { evalFormula, type CellValue } from "./xl-formula.js";
import { catalogueStatusText } from "./catalogue-status.js";

export type Audience = "team" | "client";

export interface ExportInput {
  estimate: Estimate;
  breakdown: Pick<Breakdown, "features" | "tasks">;
  header: { client: string; project: string; pm: string; date: string; version: string };
  /** requirement titles for the traceability sheet (team file) */
  requirements?: { id: string; title: string }[];
  /** resources per track for the weeks formulas; defaults to 1 */
  resources?: Partial<Record<Track, number>>;
  /** why a track has no work: shown as "Not in scope: <reason>" */
  notInScope?: Partial<Record<Track, string>>;
  assumptions?: Assumptions;
  /** hourly rates in USD per track, plus "default" for cross-cutting time: adds the team file's Cost sheet */
  rates?: Partial<Record<Track | "default", number>>;
  /** waivers a lead gave, and the estimate gates' latest results: the team file's Gates sheet */
  waivers?: { step: string; gateIds: string[]; human: string; reason: string }[];
  gateLog?: { gateId: string; passed: boolean; details: string }[];
  /** what the client's clarify answers say on each special-consideration topic; a topic with no answer reads "Not specified" */
  considerations?: Partial<Record<ConsiderationKey, Consideration>>;
  /** the Folio3 estimation template, loaded by `loadTemplate`: its styling and theme carry over */
  template?: Template;
}

/** The sheets every workbook carries, in order, under the names the Folio3 template uses. "Other" holds GD, PM, PDM and cross-cutting time. */
export const SHEET = {
  summary: "Summary", backend: "Dev Backend Estimates", mobile: "Dev Mobile Estimates", web: "Dev Web Estimates",
  qa: "QA Estimates", design: "Design Estimates", other: "Other Estimates",
} as const;
export const MANDATORY_SHEETS = Object.values(SHEET);
export const TEAM_SHEETS = ["Confidence", "Anchors", "Traceability", "Parameters", "Gates"] as const;
/** Team sheets that exist only when their input does. */
export const OPTIONAL_TEAM_SHEETS = ["Cost"] as const;
/** Every task on one sheet with a filter on each column, in both files: the track sheets keep the template's layout, this one is for sorting and filtering. */
export const ALL_TASKS_SHEET = "All Tasks";
/** The template's Minimum and Maximum columns: the hours people spend (the factory's own hours sit beside them, in J and K). */
export const HUMAN_HEAD = { min: "Human min (h)", max: "Human max (h)" } as const;

/** Summary row labels, as the template words them. */
export const SUMMARY_LABEL = {
  backend: "Backend Development Estimates", mobile: "Mobile Development Estimates", web: "Admin Development Estimates", qa: "QA Estimates",
  gd: "GD Estimates", pm: "PM Estimates", pdm: "PDM Estimates", cross: "Cross-cutting Estimates", design: "Design Estimates",
} as const;
export const DESIGN_SWITCH_LABEL = "Include Design in total";

// ---------- QA sheet categories ----------

/** The template's QA "Estimation Summary" items. Validation testing (4) is drawn as cycles, from its own detail table. */
export const QA_ITEMS = [
  { no: 1, label: "Test Plan/Strategy", comment: "Test planning, with the test plan, strategy and traceability matrix as outputs" },
  { no: 2, label: "Set up of Test Environments", comment: "Setting up code and white box test environments" },
  { no: 3, label: "Validation and Smoke test cases", comment: "Test cases to execute while debugging and white box testing" },
  { no: 4, label: "Validation testing", comment: "Testing cycles; the detail is below" },
  { no: 5, label: "Smoke testing", comment: "Smoke testing after each deployment, including preparation" },
  { no: 6, label: "Multi Browser Compatibility testing", comment: "Browser, OS and device compatibility" },
  { no: 7, label: "UAT", comment: "Client user acceptance testing support" },
  { no: 8, label: "Misc. Optional testing", comment: "Other testing named in the breakdown, and supervisor gate time" },
] as const;

/** Which QA item a task belongs to, and for validation testing which cycle. Plain words in the title decide; a feature test with requirements is validation cycle 1. */
export function qaPlace(t: { title: string; reqs: string[]; overhead?: string }): { item: number; cycle?: number } {
  const x = `${t.title} ${t.overhead ?? ""}`;
  if (/test\s*(plan|strateg)|\brtm\b|traceability matrix/i.test(x)) return { item: 1 };
  if (/environment|test data|test set\s*-?up/i.test(x)) return { item: 2 };
  if (/\buat\b|user acceptance/i.test(x)) return { item: 7 };
  if (/browser|compatib|cross[- ]platform|device matrix/i.test(x)) return { item: 6 };
  if (/test[- ]cases?|write.*tests?|author.*tests?/i.test(x)) return { item: 3 };
  if (/smoke/i.test(x)) return { item: 5 };
  const m = /(?:cycle|round)\s*(\d+)/i.exec(x);
  if (m) return { item: 4, cycle: Math.max(1, Number(m[1])) };
  if (/regression/i.test(x)) return { item: 4, cycle: 2 };
  if (/performance|load test|security test|penetration|accessib|exploratory|misc/i.test(x)) return { item: 8 };
  return t.reqs.length ? { item: 4, cycle: 1 } : { item: 8 };
}

// ---------- the template ----------

/** The template the repo ships: Folio3's v 0.5 with its text cleared, so only styles, theme, widths and sheet names remain. */
export const BUNDLED_TEMPLATE = fileURLToPath(new URL("./assets/estimation-template.xlsx", import.meta.url));

type Style = Partial<ExcelJS.Style>;
export interface Template { wb: ExcelJS.Workbook; styles: Map<string, Style> }

/** Where each style comes from in the Folio3 template v 0.5: [sheet, cell]. */
const PROTO: Record<string, [string, string]> = {
  title: [SHEET.web, "B2"], date: [SHEET.web, "B3"], by: [SHEET.web, "B4"],
  grandLabel: [SHEET.web, "C6"], grandValue: [SHEET.web, "D6"], grandNote: [SHEET.web, "F6"],
  headB: [SHEET.web, "B8"], headC: [SHEET.web, "C8"], headD: [SHEET.web, "D8"], headE: [SHEET.web, "E8"], headF: [SHEET.web, "F8"],
  modB: [SHEET.web, "B9"], modC: [SHEET.web, "C9"], modD: [SHEET.web, "D9"], modE: [SHEET.web, "E9"], modF: [SHEET.web, "F9"],
  taskB: [SHEET.web, "B10"], taskC: [SHEET.web, "C10"], taskD: [SHEET.web, "D10"], taskE: [SHEET.web, "E10"], taskF: [SHEET.web, "F10"],
  totC: [SHEET.web, "C37"], totD: [SHEET.web, "D37"], totE: [SHEET.web, "E37"], totF: [SHEET.web, "F37"],
  sumTitle: [SHEET.summary, "B1"], sumProject: [SHEET.summary, "B2"], sumSub: [SHEET.summary, "B3"], sumLabel: [SHEET.summary, "B5"], sumValue: [SHEET.summary, "C5"],
  sumEff: [SHEET.summary, "C9"],
  sumHeadB: [SHEET.summary, "B10"], sumHeadC: [SHEET.summary, "C10"], sumHeadD: [SHEET.summary, "D10"], sumHeadE: [SHEET.summary, "E10"], sumHeadH: [SHEET.summary, "H10"], sumHeadI: [SHEET.summary, "I10"], sumHeadJ: [SHEET.summary, "J10"],
  sumRowB: [SHEET.summary, "B11"], sumRowC: [SHEET.summary, "C11"], sumRowD: [SHEET.summary, "D11"], sumRowE: [SHEET.summary, "E11"], sumRowH: [SHEET.summary, "H11"], sumRowI: [SHEET.summary, "I11"], sumRowJ: [SHEET.summary, "J11"],
  sumTotB: [SHEET.summary, "B19"], sumTotC: [SHEET.summary, "C19"], sumTotD: [SHEET.summary, "D19"],
  consHead: [SHEET.summary, "B28"], consTh: [SHEET.summary, "B29"], consB: [SHEET.summary, "B30"], consC: [SHEET.summary, "C30"], consE: [SHEET.summary, "E30"],
};

/**
 * Load the Folio3 estimation template as the base of a workbook. Its styles are read first, then every sheet
 * is emptied (merges, rows) but keeps its name, column widths and theme. Load it once per workbook: a
 * workbook is changed as it is drawn.
 */
export async function loadTemplate(path: string): Promise<Template> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path);
  const missing = [SHEET.summary, SHEET.backend, SHEET.web, SHEET.qa, SHEET.design].filter((n) => !wb.getWorksheet(n));
  if (missing.length) throw new Error(`${path} does not look like the Folio3 estimation template: no sheet named ${missing.join(", ")}.`);
  const styles = new Map<string, Style>();
  for (const [role, [sheet, addr]] of Object.entries(PROTO)) styles.set(role, structuredClone(wb.getWorksheet(sheet)!.getCell(addr).style) as Style);
  // keep each sheet's column widths, then rebuild the sheets empty and in order: emptying a sheet row by row
  // leaves stray cells behind in ExcelJS, and the workbook's theme and style table stay with the workbook
  const widths = new Map<string, (number | undefined)[]>();
  for (const ws of wb.worksheets) widths.set(ws.name, ws.columns.map((c) => c.width));
  for (const ws of [...wb.worksheets]) wb.removeWorksheet(ws.id);
  for (const name of MANDATORY_SHEETS) {
    const ws = wb.addWorksheet(name);
    (widths.get(name) ?? widths.get(SHEET.web) ?? []).forEach((w, i) => { if (w) ws.getColumn(i + 1).width = w; });
  }
  return { wb, styles };
}

const BOLD = { bold: true } as const;
const HEAD_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9E1F2" } };
const NUM = "0.00";

/** Where a phase's API figure comes from. The client file says measured or assumed; the team file also names the sources. */
export function costBasisText(b: { ledger: number; eval: number }, team: boolean): string {
  const runs = b.ledger + b.eval;
  if (!runs) return "assumed: no measured runs yet (cold-start figure)";
  const src = [b.ledger ? `${b.ledger} ledger` : "", b.eval ? `${b.eval} eval` : ""].filter(Boolean).join(", ");
  return `measured: p10-p90 of ${runs} run${runs === 1 ? "" : "s"}` + (team ? ` (${src})` : "");
}

/** Where the agent hours come from: measured task classes, or the sized hours (cold-start). */
export function agentBasisText(basis: Estimate["elapsed"]["basis"]): string {
  const measured = (basis?.byClass ?? []).filter((c) => c.minutes);
  if (!measured.length) return "cold-start: each task's sized hours, a reference size, until this factory has built enough tasks of its class (3 or more)";
  return `measured for ${measured.map((c) => `${c.taskClass} (${c.records} builds)`).join(", ")}; other tasks use their sized hours (cold-start)`;
}

export function buildWorkbook(input: ExportInput, audience: Audience): ExcelJS.Workbook {
  const { estimate: e, breakdown: b } = input;
  const a = input.assumptions ?? DEFAULT_ASSUMPTIONS;
  const skin = input.template;
  const wb = skin?.wb ?? new ExcelJS.Workbook();
  wb.creator = "AI Factory";
  const team = audience === "team";
  const sized = new Map(e.tasks.map((t) => [t.taskId, t]));
  const taskById = new Map(b.tasks.map((t) => [t.id, t]));
  /** the factory's own hours on a task, beside the human hours in D and E: none on a human task */
  const agentOf = (id: string): Range => { const s = sized.get(id), t = taskById.get(id); return s && t ? agentHours(s, t, e.elapsed.basis) : ZERO; };
  // every line of every task sheet: the factory's hours (J, K) and, on estimates that have it, what it spends in API credits (L, M).
  // Every line carries a number in each (0 when it has none), so each total is a plain sum over its rows.
  const perTask = e.tasks.some((t) => t.apiUsd);
  const REST = ["J", "K", ...(perTask ? ["L", "M"] : [])];
  const extraHead: Record<string, string> = { G: "Executor", H: "Requirement id(s)", I: "Task id", J: "Agent min (h)", K: "Agent max (h)", ...(perTask ? { L: "API min ($)", M: "API max ($)" } : {}) };
  const restCells = (ws: ExcelJS.Worksheet, row: number, agent: Range, usd?: Range) => {
    n(ws, `J${row}`, agent.min); n(ws, `K${row}`, agent.max);
    if (perTask) { n(ws, `L${row}`, usd?.min ?? 0); n(ws, `M${row}`, usd?.max ?? 0); }
  };
  const sumCols = (ws: ExcelJS.Worksheet, row: number, from: number, to: number) => {
    for (const c of REST) f(ws, `${c}${row}`, `SUM(${c}${from}:${c}${to})`);
  };
  /** the rest columns of a total over separate rows (module rows, cycle totals): the rows added up, or 0 */
  const addCols = (ws: ExcelJS.Worksheet, row: number, rows: number[]) => {
    for (const c of REST) f(ws, `${c}${row}`, rows.length ? rows.map((x) => `${c}${x}`).join("+") : "0", undefined, { font: BOLD });
  };
  /** a sheet's agent total beside its Grand Total */
  const agentGrand = (ws: ExcelJS.Worksheet, formula: (col: string) => string) => {
    put(ws, "I6", "Agent total (h)", "grandLabel", { font: BOLD });
    f(ws, "J6", formula("J"), "grandValue", { font: BOLD }); f(ws, "K6", formula("K"), "grandValue", { font: BOLD });
  };

  const sheets = new Map<string, ExcelJS.Worksheet>();
  const sheet = (name: string) => sheets.get(name) ?? (sheets.set(name, wb.getWorksheet(name) ?? wb.addWorksheet(name)), sheets.get(name)!);
  for (const n of MANDATORY_SHEETS) sheet(n);

  /** Give a cell a template style, or the plain fallback when there is no template. */
  const put = (ws: ExcelJS.Worksheet, addr: string, value: ExcelJS.CellValue, role: string, plain: Style = {}) => {
    const c = ws.getCell(addr);
    c.value = value;
    const s = skin?.styles.get(role);
    c.style = structuredClone(s && Object.keys(s).length ? s : plain) as ExcelJS.Style;
    return c;
  };
  const plainHead: Style = { font: BOLD, fill: HEAD_FILL };
  const head = (ws: ExcelJS.Worksheet, row: number, labels: Record<string, string>) => {
    for (const [col, text] of Object.entries(labels)) put(ws, `${col}${row}`, text, "", plainHead);
  };
  const f = (ws: ExcelJS.Worksheet, addr: string, formula: string, role?: string, plain: Style = {}) => {
    const c = put(ws, addr, { formula } as ExcelJS.CellFormulaValue, role ?? "", plain);
    c.numFmt = NUM;
    return c;
  };
  const n = (ws: ExcelJS.Worksheet, addr: string, v: number, role?: string, plain: Style = {}) => {
    const c = put(ws, addr, v, role ?? "", plain);
    c.numFmt = NUM;
    return c;
  };
  const merge = (ws: ExcelJS.Worksheet, range: string) => { try { ws.mergeCells(range); } catch { /* already merged */ } };
  const widths = (ws: ExcelJS.Worksheet, w: Record<string, number>) => { for (const [col, x] of Object.entries(w)) if (!skin || !ws.getColumn(col).width || col > "F") ws.getColumn(col).width = x; };

  const PREFIX: Record<string, string> = { backend: "Development Estimates for", mobile: "Development Estimates for", web: "Development Estimates for", qa: "QA Estimates for", design: "Design Estimates for" };
  const SHEETS: { name: string; key: string; title: string; tracks: Track[] }[] = [
    { name: SHEET.backend, key: "backend", title: "Backend", tracks: ["backend"] },
    { name: SHEET.mobile, key: "mobile", title: "Mobile", tracks: ["mobile"] },
    { name: SHEET.web, key: "web", title: "Web / Admin", tracks: ["web"] },
    { name: SHEET.qa, key: "qa", title: "QA", tracks: ["qa"] },
    { name: SHEET.design, key: "design", title: "Design", tracks: ["design"] },
  ];
  const tasksOf = (tracks: Track[]): BreakdownTask[] => b.tasks.filter((t) => tracks.includes(t.track));
  const featureTitle = new Map(b.features.map((x) => [x.id, x.title]));
  const totalCell = new Map<string, { sheet: string; row: number }>(); // section key -> the cell its Summary row links to

  // the template's Assumptions & Constraints and Risks blocks, closing each track sheet that has work
  const trackOf = new Map(b.tasks.map((t) => [t.id, t]));
  const notes = (ws: ExcelJS.Worksheet, start: number, tracks: Track[]): void => {
    const flagged = team ? e.tasks.filter((t) => t.flagged && tracks.includes(trackOf.get(t.taskId)?.track as Track)).map((t) => `${t.taskId} ${trackOf.get(t.taskId)?.title ?? ""}: the estimators disagree, so its range is wide`) : [];
    const block = (row: number, title: string, lines: string[]): number => {
      put(ws, `B${row}`, "S.No", "headB", plainHead); put(ws, `C${row}`, title, "headC", plainHead); merge(ws, `C${row}:F${row}`);
      lines.forEach((text, i) => {
        const r = row + 1 + i;
        put(ws, `B${r}`, i + 1, "taskB"); put(ws, `C${r}`, text, "taskC", { alignment: { wrapText: true, vertical: "top" } }); merge(ws, `C${r}:F${r}`);
      });
      return row + lines.length + 3;
    };
    const next = block(start, "Assumptions & Constraints", e.assumptions.length ? e.assumptions : ["None recorded beyond the requirements"]);
    block(next, "Risks", ["Estimates will increase in case of change in requirement", ...flagged]);
  };

  // the QA sheet in the template's own shape: an Estimation Summary of eight items, then the validation detail by testing cycle
  const drawQa = (ws: ExcelJS.Worksheet, tasks: BreakdownTask[], overheads: Estimate["overheads"], gates: Estimate["gateHours"]): void => {
    type Line = { name: string; min: number; max: number; comment: string; agent: Range; task?: BreakdownTask };
    const lineOf = (t: BreakdownTask): Line => {
      const s = sized.get(t.id); const eff = s ? effortHours(s) : ZERO;
      return { name: t.title, min: eff.min, max: eff.max, comment: (t.overhead ? t.overhead : t.items.join("; ")) + (team && s ? ` (${s.reason})` : ""), agent: agentOf(t.id), task: t };
    };
    const items = new Map<number, Line[]>(QA_ITEMS.map((i) => [i.no, []]));
    const cycles = new Map<number, BreakdownTask[]>();
    for (const t of tasks) {
      const at = qaPlace(t);
      if (at.item === 4) cycles.set(at.cycle ?? 1, [...(cycles.get(at.cycle ?? 1) ?? []), t]);
      else items.get(at.item)!.push(lineOf(t));
    }
    for (const o of overheads) {
      const at = qaPlace({ title: o.name, reqs: [], overhead: o.reason }).item;
      items.get(at === 4 ? 8 : at)!.push({ name: o.name, min: o.hours.min, max: o.hours.max, comment: o.reason, agent: ZERO });
    }
    for (const g of gates) items.get(8)!.push({ name: `Supervisor: ${g.source}`, min: g.hours.min, max: g.hours.max, comment: "assumed, editable", agent: ZERO });
    const cycleNos = [...cycles.keys()].sort((x, y) => x - y);
    if (!cycleNos.length) cycleNos.push(1);

    const extras = (row: number, l: Line) => {
      if (l.task) { ws.getCell(`G${row}`).value = l.task.executor[0]!.toUpperCase() + l.task.executor.slice(1); ws.getCell(`H${row}`).value = l.task.reqs.join(", "); ws.getCell(`I${row}`).value = l.task.id; }
      restCells(ws, row, l.agent, l.task ? sized.get(l.task.id)?.apiUsd : undefined);
    };
    const line = (row: number, no: number | "", l: Line) => {
      put(ws, `B${row}`, no, "taskB"); put(ws, `C${row}`, l.name, "taskC"); n(ws, `D${row}`, l.min, "taskD"); n(ws, `E${row}`, l.max, "taskE"); put(ws, `F${row}`, l.comment, "taskF"); extras(row, l);
    };
    const sum = (row: number, from: number, to: number, role: [string, string]) => {
      f(ws, `D${row}`, `SUM(D${from}:D${to})`, role[0], { font: BOLD }); f(ws, `E${row}`, `SUM(E${from}:E${to})`, role[1], { font: BOLD });
      sumCols(ws, row, from, to);
    };
    const sumOf = (row: number, rows: number[], role: [string, string]) => {
      for (const c of ["D", "E"] as const) f(ws, `${c}${row}`, rows.length ? rows.map((x) => `${c}${x}`).join("+") : "0", c === "D" ? role[0] : role[1], { font: BOLD });
      addCols(ws, row, rows);
    };

    // positions first: the summary's cycle rows link to the detail's cycle totals below it
    const SUMMARY_AT = 9;
    const summaryRows = QA_ITEMS.reduce((k, i) => k + 1 + (i.no === 4 ? cycleNos.length : items.get(i.no)!.length), 0);
    const totalRow = SUMMARY_AT + summaryRows;
    let r = totalRow + 3;

    // detail: validation testing by cycle, each feature a numbered module
    put(ws, `B${r}`, "S.No", "headB", plainHead); put(ws, `C${r}`, "Validation Testing", "headC", plainHead);
    put(ws, `D${r}`, HUMAN_HEAD.min, "headD", plainHead); put(ws, `E${r}`, HUMAN_HEAD.max, "headE", plainHead); put(ws, `F${r}`, "Comments", "headF", plainHead);
    for (const [col, text] of Object.entries(extraHead)) put(ws, `${col}${r}`, text, "headF", plainHead);
    r++;
    const cycleTotal = new Map<number, number>();
    for (const c of cycleNos) {
      put(ws, `C${r}`, `Testing Cycle ${c}`, "modC", { font: BOLD }); r++;
      const inCycle = cycles.get(c) ?? [];
      const mods: number[] = [];
      let no = 1;
      for (const feat of b.features) {
        const own = inCycle.filter((t) => t.featureId === feat.id);
        if (!own.length) continue;
        if (own.length === 1) { line(r, no++, lineOf(own[0]!)); mods.push(r); r++; continue; }
        const modRow = r++;
        mods.push(modRow);
        put(ws, `B${modRow}`, no++, "modB", { font: BOLD }); put(ws, `C${modRow}`, featureTitle.get(feat.id) ?? feat.id, "modC", { font: BOLD }); put(ws, `F${modRow}`, "", "modF");
        const first = r;
        for (const t of own) { line(r, "", lineOf(t)); r++; }
        sum(modRow, first, r - 1, ["modD", "modE"]);
      }
      put(ws, `C${r}`, `Total Testing Cycle ${c}`, "totC", { font: BOLD }); put(ws, `B${r}`, "", "totC"); put(ws, `F${r}`, `Sum of testing cycle ${c}`, "totF");
      sumOf(r, mods, ["totD", "totE"]);
      cycleTotal.set(c, r);
      r += 3;
    }

    // summary
    let row = SUMMARY_AT;
    put(ws, "B8", "S.No", "headB", plainHead); put(ws, "C8", "Estimation Summary", "headC", plainHead);
    put(ws, "D8", HUMAN_HEAD.min, "headD", plainHead); put(ws, "E8", HUMAN_HEAD.max, "headE", plainHead); put(ws, "F8", "Comments", "headF", plainHead);
    for (const [col, text] of Object.entries(extraHead)) put(ws, `${col}8`, text, "headF", plainHead);
    const itemRows: number[] = [];
    for (const it of QA_ITEMS) {
      const itemRow = row++;
      itemRows.push(itemRow);
      put(ws, `B${itemRow}`, it.no, "modB", { font: BOLD }); put(ws, `C${itemRow}`, it.label, "modC", { font: BOLD });
      const lines = items.get(it.no)!;
      put(ws, `F${itemRow}`, it.no === 4 || lines.length ? it.comment : `${it.comment}. Not sized in this estimate`, "modF");
      if (it.no === 4) {
        const first = row;
        for (const c of cycleNos) {
          put(ws, `C${row}`, `Testing Cycle ${c}`, "taskC");
          f(ws, `D${row}`, `D${cycleTotal.get(c)}`, "taskD"); f(ws, `E${row}`, `E${cycleTotal.get(c)}`, "taskE");
          for (const col of REST) f(ws, `${col}${row}`, `${col}${cycleTotal.get(c)}`);
          row++;
        }
        sum(itemRow, first, row - 1, ["modD", "modE"]);
        continue;
      }
      if (!lines.length) { n(ws, `D${itemRow}`, 0, "modD", { font: BOLD }); n(ws, `E${itemRow}`, 0, "modE", { font: BOLD }); for (const col of REST) n(ws, `${col}${itemRow}`, 0); continue; }
      const first = row;
      for (const l of lines) { line(row, "", l); row++; }
      sum(itemRow, first, row - 1, ["modD", "modE"]);
    }
    if (row !== totalRow) throw new Error("the QA summary layout disagrees with its computed length");
    put(ws, `C${totalRow}`, "Total QA Efforts", "totC", { font: BOLD }); put(ws, `B${totalRow}`, "", "totC"); put(ws, `F${totalRow}`, "Total hours of QA", "totF");
    sumOf(totalRow, itemRows, ["totD", "totE"]);
    put(ws, "C6", "Grand Total Efforts (in hours)", "grandLabel", { font: BOLD }); put(ws, "F6", "Sum of QA and Misc.", "grandNote");
    f(ws, "D6", `D${totalRow}`, "grandValue", { font: BOLD }); f(ws, "E6", `E${totalRow}`, "grandValue", { font: BOLD });
    agentGrand(ws, (c) => `${c}${totalRow}`);
    if (tasks.length || overheads.length || gates.length) notes(ws, r, ["qa"]);
  };

  // ---------- track sheets (the template's layout: title block, Grand Total at the top, modules, other activities, research) ----------
  for (const def of SHEETS) {
    const ws = sheet(def.name);
    widths(ws, { B: 7, C: 46, D: 12, E: 12, F: 60, G: 11, H: 22, I: 9, J: 12, K: 12, L: 12, M: 12 });
    const tasks = tasksOf(def.tracks);
    const overheads = e.overheads.filter((o) => o.track && def.tracks.includes(o.track));
    const gates = e.gateHours.filter((g) => g.track && def.tracks.includes(g.track));
    put(ws, "B2", `${PREFIX[def.key]} ${input.header.project}`, "title", { font: { bold: true, size: 14 } }); merge(ws, "B2:F2");
    put(ws, "B3", input.header.date, "date"); merge(ws, "B3:F3");
    put(ws, "B4", `by ${input.header.pm}`, "by"); merge(ws, "B4:F4");
    const empty = tasks.length === 0 && overheads.length === 0 && gates.length === 0;
    if (empty) put(ws, "B5", `Not in scope: ${input.notInScope?.[def.tracks[0]!] ?? "no work in this estimate"}`, "", { font: { italic: true } });
    put(ws, "C6", "Grand Total (in hours)", "grandLabel", { font: BOLD });
    put(ws, "F6", "Sum of development, other activities and research efforts.", "grandNote");

    if (def.key === "qa") { drawQa(ws, tasks, overheads, gates); totalCell.set(def.key, { sheet: def.name, row: 6 }); continue; }

    const header = (row: number, title: string) => {
      put(ws, `B${row}`, "S.No", "headB", plainHead); put(ws, `C${row}`, title, "headC", plainHead);
      put(ws, `D${row}`, HUMAN_HEAD.min, "headD", plainHead); put(ws, `E${row}`, HUMAN_HEAD.max, "headE", plainHead); put(ws, `F${row}`, "Comments", "headF", plainHead);
      for (const [col, text] of Object.entries(extraHead)) put(ws, `${col}${row}`, text, "headF", plainHead);
    };
    header(8, "Task");
    let row = 9;

    // modules: the breakdown's features, in order; a module's row carries its own total over its task rows
    const moduleRows: number[] = [];
    let no = 1;
    for (const feat of b.features) {
      const own = tasks.filter((t) => t.featureId === feat.id);
      if (!own.length) continue;
      const modRow = row++;
      moduleRows.push(modRow);
      put(ws, `B${modRow}`, no++, "modB", { font: BOLD }); put(ws, `C${modRow}`, featureTitle.get(feat.id) ?? feat.id, "modC", { font: BOLD });
      const first = row;
      for (const t of own) {
        const s = sized.get(t.id);
        const eff = s ? effortHours(s) : ZERO;
        const why = team && s ? ` (${s.reason})` : "";
        put(ws, `B${row}`, "", "taskB"); put(ws, `C${row}`, t.title, "taskC");
        n(ws, `D${row}`, eff.min, "taskD"); n(ws, `E${row}`, eff.max, "taskE");
        put(ws, `F${row}`, (t.overhead ? t.overhead : t.items.join("; ")) + why, "taskF");
        ws.getCell(`G${row}`).value = t.executor[0]!.toUpperCase() + t.executor.slice(1); ws.getCell(`H${row}`).value = t.reqs.join(", "); ws.getCell(`I${row}`).value = t.id;
        restCells(ws, row, agentOf(t.id), s?.apiUsd);
        row++;
      }
      f(ws, `D${modRow}`, `SUM(D${first}:D${row - 1})`, "modD", { font: BOLD }); f(ws, `E${modRow}`, `SUM(E${first}:E${row - 1})`, "modE", { font: BOLD });
      put(ws, `F${modRow}`, "", "modF");
      sumCols(ws, modRow, first, row - 1);
      row++;
    }
    if (!moduleRows.length) { put(ws, `C${row}`, "None", "taskC"); n(ws, `D${row}`, 0, "taskD"); n(ws, `E${row}`, 0, "taskE"); restCells(ws, row, ZERO); moduleRows.push(row); row += 2; }
    const total = (r: number, label: string, parts: (string | number)[] | { from: number; to: number }) => {
      put(ws, `C${r}`, label, "totC", { font: BOLD }); put(ws, `B${r}`, "", "totC");
      for (const col of ["D", "E", ...REST]) {
        const role = col === "D" ? "totD" : col === "E" ? "totE" : "";
        f(ws, `${col}${r}`, Array.isArray(parts) ? parts.map((p) => `${col}${p}`).join("+") : `SUM(${col}${parts.from}:${col}${parts.to})`, role, { font: BOLD });
      }
      put(ws, `F${r}`, "", "totF");
    };
    const devRow = row++;
    total(devRow, "Development Total Efforts (in hours)", moduleRows);
    row += 2;

    // other development activities: named overheads and, for the tracks that carry them, supervisor gate time
    header(row, "Other Development Activities"); row++;
    const acts = [
      ...overheads.map((o) => ({ name: o.name, min: o.hours.min, max: o.hours.max, comment: o.reason })),
      ...gates.map((g) => ({ name: `Supervisor: ${g.source}`, min: g.hours.min, max: g.hours.max, comment: "assumed, editable" })),
    ];
    const actsFirst = row;
    let k = 1;
    for (const r of acts.length ? acts : [{ name: "None", min: 0, max: 0, comment: "" }]) {
      put(ws, `B${row}`, k++, "taskB"); put(ws, `C${row}`, r.name, "taskC"); n(ws, `D${row}`, r.min, "taskD"); n(ws, `E${row}`, r.max, "taskE"); put(ws, `F${row}`, r.comment, "taskF");
      restCells(ws, row, ZERO);
      row++;
    }
    const postRow = row++;
    total(postRow, "Post Development Activities Total Efforts (in hours)", { from: actsFirst, to: postRow - 1 });
    row += 2;

    header(row, "Research Task (if any)"); row++;
    const resFirst = row;
    put(ws, `B${row}`, 1, "taskB"); put(ws, `C${row}`, "None", "taskC"); n(ws, `D${row}`, 0, "taskD"); n(ws, `E${row}`, 0, "taskE"); put(ws, `F${row}`, "No research task in this estimate", "taskF"); restCells(ws, row, ZERO); row++;
    const resRow = row++;
    total(resRow, "Research Total Efforts (in hours)", { from: resFirst, to: resRow - 1 });

    if (!empty) notes(ws, resRow + 3, def.tracks);
    f(ws, "D6", `D${devRow}+D${postRow}+D${resRow}`, "grandValue", { font: BOLD }); f(ws, "E6", `E${devRow}+E${postRow}+E${resRow}`, "grandValue", { font: BOLD });
    agentGrand(ws, (c) => `${c}${devRow}+${c}${postRow}+${c}${resRow}`);
    totalCell.set(def.key, { sheet: def.name, row: 6 });
  }

  // ---------- other: GD, PM, PDM and cross-cutting time, one section each with its own total ----------
  {
    const ws = sheet(SHEET.other);
    widths(ws, { B: 7, C: 46, D: 12, E: 12, F: 60, G: 11, H: 22, I: 9, J: 12, K: 12, L: 12, M: 12 });
    put(ws, "B2", `Other Estimates for ${input.header.project}`, "title", { font: { bold: true, size: 14 } }); merge(ws, "B2:F2");
    put(ws, "B3", input.header.date, "date"); merge(ws, "B3:F3");
    put(ws, "B4", `by ${input.header.pm}`, "by"); merge(ws, "B4:F4");
    let row = 6;
    const sections: { key: string; title: string; tracks: Track[]; cross?: boolean }[] = [
      { key: "gd", title: "GD", tracks: ["gd"] }, { key: "pm", title: "PM", tracks: ["pm"] }, { key: "pdm", title: "PDM", tracks: ["pdm"] }, { key: "cross", title: "Cross-cutting", tracks: [], cross: true },
    ];
    for (const sec of sections) {
      const tasks = tasksOf(sec.tracks);
      const overheads = e.overheads.filter((o) => (sec.cross ? !o.track : o.track && sec.tracks.includes(o.track)));
      const gates = e.gateHours.filter((g) => (sec.cross ? !g.track : g.track && sec.tracks.includes(g.track)));
      put(ws, `B${row}`, sec.title, "modC", { font: { bold: true, size: 12 } }); row++;
      if (tasks.length === 0 && overheads.length === 0 && gates.length === 0 && !sec.cross) {
        put(ws, `B${row}`, `Not in scope: ${input.notInScope?.[sec.tracks[0]!] ?? "no work in this estimate"}`, "", { font: { italic: true } }); row++;
      }
      put(ws, `B${row}`, "S.No", "headB", plainHead); put(ws, `C${row}`, "Task", "headC", plainHead); put(ws, `D${row}`, HUMAN_HEAD.min, "headD", plainHead); put(ws, `E${row}`, HUMAN_HEAD.max, "headE", plainHead); put(ws, `F${row}`, "Comments", "headF", plainHead);
      for (const [col, text] of Object.entries(extraHead)) put(ws, `${col}${row}`, text, "headF", plainHead);
      row++;
      const rows = [
        ...tasks.map((t) => { const s = sized.get(t.id); const eff = s ? effortHours(s) : ZERO; return { name: t.title, min: eff.min, max: eff.max, executor: t.executor[0]!.toUpperCase() + t.executor.slice(1), reqs: t.reqs.join(", "), id: t.id, comment: (t.overhead ? t.overhead : t.items.join("; ")) + (team && s ? ` (${s.reason})` : ""), agent: agentOf(t.id) }; }),
        ...overheads.map((o) => ({ name: o.name, min: o.hours.min, max: o.hours.max, executor: "", reqs: "", id: "", comment: o.reason, agent: ZERO })),
        ...gates.map((g) => ({ name: `Supervisor: ${g.source}`, min: g.hours.min, max: g.hours.max, executor: "", reqs: "", id: "", comment: "assumed, editable", agent: ZERO })),
      ];
      const first = row;
      let i = 1;
      for (const r of rows.length ? rows : [{ name: "None", min: 0, max: 0, executor: "", reqs: "", id: "", comment: "", agent: ZERO }]) {
        put(ws, `B${row}`, i++, "taskB"); put(ws, `C${row}`, r.name, "taskC"); n(ws, `D${row}`, r.min, "taskD"); n(ws, `E${row}`, r.max, "taskE"); put(ws, `F${row}`, r.comment, "taskF");
        ws.getCell(`G${row}`).value = r.executor; ws.getCell(`H${row}`).value = r.reqs; ws.getCell(`I${row}`).value = r.id;
        restCells(ws, row, r.agent, sized.get(r.id)?.apiUsd);
        row++;
      }
      put(ws, `C${row}`, `${sec.title} TOTAL`, "totC", { font: BOLD });
      f(ws, `D${row}`, `SUM(D${first}:D${row - 1})`, "totD", { font: BOLD }); f(ws, `E${row}`, `SUM(E${first}:E${row - 1})`, "totE", { font: BOLD });
      for (const c of REST) f(ws, `${c}${row}`, `SUM(${c}${first}:${c}${row - 1})`, undefined, { font: BOLD });
      totalCell.set(sec.key, { sheet: SHEET.other, row });
      row += 3;
    }
  }

  // ---------- summary (the template's rows: 11.. one per track, then Total and Avg) ----------
  const S = sheet(SHEET.summary);
  widths(S, { B: 34, C: 14, D: 14, E: 40, H: 12, I: 12, J: 12 });
  S.getColumn("F").width = 14; S.getColumn("G").width = 14;
  put(S, "B1", "Folio3 Project Estimation", "sumTitle", { font: { bold: true, size: 14 } });
  put(S, "B2", input.header.project, "sumProject", { font: { bold: true, size: 12 } }); merge(S, "B2:E2");
  put(S, "B3", "Summary of Estimates", "sumSub", { font: BOLD }); merge(S, "B3:E3");
  const kv = (row: number, k: string, v: string | number) => { put(S, `B${row}`, k, "sumLabel", { font: BOLD }); put(S, `C${row}`, v, "sumValue"); };
  kv(5, "Client Name", input.header.client); kv(6, "Project Manager", input.header.pm); kv(7, "Date", input.header.date); kv(8, "Version", input.header.version);
  put(S, "C9", "Human effort (in hours)", "sumEff", { font: BOLD }); merge(S, "C9:D9");
  put(S, "F9", "Agent (in hours)", "sumEff", { font: BOLD }); merge(S, "F9:G9");
  const sumHead = { B: ["Task Summary", "sumHeadB"], C: [HUMAN_HEAD.min, "sumHeadC"], D: [HUMAN_HEAD.max, "sumHeadD"], E: ["Comments", "sumHeadE"], F: ["Agent min (h)", "sumHeadC"], G: ["Agent max (h)", "sumHeadD"], H: ["Avg", "sumHeadH"], I: ["Resources", "sumHeadI"], J: ["Weeks", "sumHeadJ"] } as const;
  for (const [col, [text, role]] of Object.entries(sumHead)) put(S, `${col}10`, text, role, plainHead);

  // parameters sit below the tables; the formulas above refer to them
  const PARAM = 46;
  const DESIGN_SWITCH = `$C$${PARAM + 1}`, HPW = `$C$${PARAM + 2}`;

  const rows: { label: string; key: string; track?: Track; comment: string }[] = [
    { label: SUMMARY_LABEL.backend, key: "backend", track: "backend", comment: "Grand total of the Backend sheet" },
    { label: SUMMARY_LABEL.mobile, key: "mobile", track: "mobile", comment: "Grand total of the Mobile sheet" },
    { label: SUMMARY_LABEL.web, key: "web", track: "web", comment: "Grand total of the Web / Admin sheet" },
    { label: SUMMARY_LABEL.qa, key: "qa", track: "qa", comment: "Grand total of the QA sheet" },
    { label: SUMMARY_LABEL.gd, key: "gd", track: "gd", comment: "Other Estimates sheet" },
    { label: SUMMARY_LABEL.pm, key: "pm", track: "pm", comment: "Other Estimates sheet" },
    { label: SUMMARY_LABEL.pdm, key: "pdm", track: "pdm", comment: "Other Estimates sheet" },
    { label: SUMMARY_LABEL.cross, key: "cross", comment: "Other Estimates sheet: deployment, documentation and the like" },
    { label: SUMMARY_LABEL.design, key: "design", track: "design", comment: "Counted in the total only when Design is switched on below" },
  ];
  const TABLE = 10;
  const rowOf = new Map<string, number>();
  rows.forEach((r, i) => {
    const row = TABLE + 1 + i;
    rowOf.set(r.key, row);
    const link = totalCell.get(r.key)!;
    put(S, `B${row}`, r.label, "sumRowB");
    f(S, `C${row}`, `'${link.sheet}'!D${link.row}`, "sumRowC"); f(S, `D${row}`, `'${link.sheet}'!E${link.row}`, "sumRowD");
    put(S, `E${row}`, r.comment, "sumRowE");
    f(S, `F${row}`, `'${link.sheet}'!J${link.row}`, "sumRowC"); f(S, `G${row}`, `'${link.sheet}'!K${link.row}`, "sumRowD");
    f(S, `H${row}`, `ROUND((C${row}+D${row})/2,2)`, "sumRowH");
    n(S, `I${row}`, (r.track && input.resources?.[r.track]) || 1, "sumRowI");
    f(S, `J${row}`, `ROUND(H${row}/(${HPW}*I${row}),2)`, "sumRowJ");
  });
  const first = TABLE + 1, last = TABLE + rows.length, design = rowOf.get("design")!, tot = last + 1;
  put(S, `B${tot}`, "Total", "sumTotB", { font: { bold: true, size: 12 } });
  // the design row is the last one, so the plain sum stops one row above it
  for (const c of ["C", "D", "F", "G"]) f(S, `${c}${tot}`, `SUM(${c}${first}:${c}${design - 1})+IF(${DESIGN_SWITCH}="Yes",${c}${design},0)`, c === "C" || c === "F" ? "sumTotC" : "sumTotD", { font: BOLD });
  f(S, `H${tot}`, `ROUND((C${tot}+D${tot})/2,2)`, "sumTotD", { font: BOLD });

  // special considerations (the template's block): what this estimate knows, and what it does not
  let r = tot + 3;
  put(S, `B${r}`, "List of Special Considerations, where applicable:", "consHead", { font: { bold: true, size: 12 } }); r++;
  put(S, `B${r}`, "Tasks", "consTh", plainHead); put(S, `C${r}`, "Action", "consTh", plainHead); put(S, `D${r}`, "", "consTh", plainHead); put(S, `E${r}`, "Comments", "consTh", plainHead); r++;
  const present = (["backend", "mobile", "web"] as Track[]).filter((t) => tasksOf([t]).length);
  const cons = (k: ConsiderationKey): [string, string] => { const c = input.considerations?.[k]; return c ? [c.answer, c.from.startsWith("ASM-") ? `Factory assumption ${c.from}, confirm with the client` : `Clarify answer ${c.from}`] : ["Not specified", "Confirm with the client"]; };
  const considerations: [string, string, string][] = [
    ["Application type (mobile, desktop, web)", present.map((t) => (t === "web" ? "Web" : t === "mobile" ? "Mobile" : "Backend")).join(" + ") || "Not specified", "From the tracks that have work"],
    ["Platforms/OS supported", ...cons("platforms")], ["Browsers supported", ...cons("browsers")],
    ["Deployment (cloud, dedicated server, enterprise internal network)", ...cons("deployment")],
    ["Performance, Load requirements", ...cons("performance")], ["Security requirements", ...cons("security")],
    ["Documentation requirements", ...cons("documentation")], ["Other custom?", "No", ""],
  ];
  for (const [t, act, why] of considerations) { put(S, `B${r}`, t, "consB"); put(S, `C${r}`, act, "consC"); put(S, `E${r}`, why, "consE"); r++; }
  if (r > PARAM - 1) throw new Error("the Summary considerations overran the parameters block");

  r = PARAM;
  put(S, `B${r}`, "Parameters", "consHead", { font: { bold: true, size: 12 } }); r++;
  const pk = (row: number, k: string, v: string | number) => { put(S, `B${row}`, k, "sumLabel", { font: BOLD }); put(S, `C${row}`, v, "sumValue"); };
  pk(PARAM + 1, DESIGN_SWITCH_LABEL, e.settings.designInTotal ? "Yes" : "No");
  pk(PARAM + 2, "Hours per week", a.hoursPerWeek);
  pk(PARAM + 3, "Feedback rounds", e.settings.feedbackRounds);
  pk(PARAM + 4, "Stack chosen by", e.settings.stackSource);
  pk(PARAM + 5, "Delivery model", e.deliveryModel === "hitl" ? "HITL (supervisor + agents)" : "Solely agentic");
  if (team) pk(PARAM + 6, "Size band", e.band);

  r = PARAM + 9;
  put(S, `B${r}`, "API credit cost (USD)", "consHead", { font: { bold: true, size: 12 } }); r++;
  put(S, `B${r}`, "Phase", "consTh", plainHead); put(S, `C${r}`, "Min ($)", "consTh", plainHead); put(S, `D${r}`, "Max ($)", "consTh", plainHead); put(S, `E${r}`, "Based on", "consTh", plainHead); r++;
  const c0 = r;
  for (const p of e.apiCost.phases) { put(S, `B${r}`, p.phase, "consB"); n(S, `C${r}`, p.usd.min); n(S, `D${r}`, p.usd.max); if (p.basis) put(S, `E${r}`, costBasisText(p.basis, team), "consE"); r++; }
  if (r === c0) { put(S, `B${r}`, "none", "consB"); n(S, `C${r}`, 0); n(S, `D${r}`, 0); r++; }
  put(S, `B${r}`, "API credit cost total", "sumLabel", { font: BOLD });
  f(S, `C${r}`, `SUM(C${c0}:C${r - 1})`, undefined, { font: BOLD }); f(S, `D${r}`, `SUM(D${c0}:D${r - 1})`, undefined, { font: BOLD });
  r++;
  put(S, `B${r}`, "Confidence", "sumLabel", { font: BOLD }); put(S, `C${r}`, `${e.apiCost.confidence} (${e.apiCost.records} measured record${e.apiCost.records === 1 ? "" : "s"})`, "sumValue"); r++;
  if (perTask) { put(S, `B${r}`, "Per task", "sumLabel", { font: BOLD }); put(S, `C${r}`, "API min and max ($) on each task sheet: the task's share of build and verification, by its hours. A human task costs nothing; planning, design, breakdown and estimate are spent once per run.", "sumValue"); r++; }
  r++;

  put(S, `B${r}`, "Agent hours", "consHead", { font: { bold: true, size: 12 } }); r++;
  put(S, `B${r}`, "The factory's own hours on each task, in J and K of every task sheet and in F and G above. A factory task has agent hours and no human hours; a joint task has both; a human task (client UAT, design approval, PM) has human hours only. Human hours are what people spend and what the totals count.", "consB"); r++;
  put(S, `B${r}`, "Agent hours basis", "consB"); put(S, `C${r}`, agentBasisText(e.elapsed.basis), "sumValue"); r += 2;

  put(S, `B${r}`, "Elapsed time", "consHead", { font: { bold: true, size: 12 } }); r++;
  put(S, `B${r}`, "Planning (minutes)", "consB"); n(S, `C${r}`, e.elapsed.planningMinutes); r++;
  put(S, `B${r}`, "Build critical path (days)", "consB"); n(S, `C${r}`, e.elapsed.criticalPathDays.min); n(S, `D${r}`, e.elapsed.criticalPathDays.max); r += 2;

  const list = (title: string, items: string[]) => {
    if (!items.length) return;
    put(S, `B${r}`, title, "consHead", { font: { bold: true, size: 12 } }); r++;
    for (const it of items) { put(S, `B${r}`, it, "consB"); r++; }
    r++;
  };
  list("Assumptions", e.assumptions);
  list("Suggested, not included", e.suggested.map((s) => `${s.title}: ${s.reason}`));
  list("Scenarios", e.scenarios.map((s) => `${s.name}: ${s.changes} (${s.totals.min}-${s.totals.max} h)`));

  // ---------- every task on one sheet, with a filter on each column ----------
  {
    const X = sheet(ALL_TASKS_SHEET);
    X.getCell("B1").value = `All tasks: ${input.header.project}`; X.getCell("B1").font = { bold: true, size: 14 };
    X.getCell("B2").value = "Filter or sort any column. The Total row adds up only the rows the filter shows.";
    const cols: [string, string, number][] = [
      ["B", "Task id", 9], ["C", "Task", 46], ["D", "Track", 10], ["E", "Module", 30], ["F", "Executor", 10], ["G", "Requirement id(s)", 22],
      ["H", HUMAN_HEAD.min, 13], ["I", HUMAN_HEAD.max, 13], ["J", "Agent min (h)", 13], ["K", "Agent max (h)", 13],
      ...(perTask ? [["L", "API min ($)", 12], ["M", "API max ($)", 12]] as [string, string, number][] : []),
    ];
    for (const [c, , w] of cols) X.getColumn(c).width = w;
    head(X, 4, Object.fromEntries(cols.map(([c, t]) => [c, t])));
    const TRACK_NAME: Record<string, string> = { backend: "Backend", mobile: "Mobile", web: "Web", qa: "QA", design: "Design", gd: "GD", pm: "PM", pdm: "PDM" };
    let xr = 5;
    for (const t of b.tasks) {
      const s = sized.get(t.id); const eff = s ? effortHours(s) : ZERO; const ag = agentOf(t.id);
      X.getCell(`B${xr}`).value = t.id; X.getCell(`C${xr}`).value = t.title; X.getCell(`D${xr}`).value = TRACK_NAME[t.track] ?? t.track;
      X.getCell(`E${xr}`).value = featureTitle.get(t.featureId) ?? t.featureId; X.getCell(`F${xr}`).value = t.executor[0]!.toUpperCase() + t.executor.slice(1);
      X.getCell(`G${xr}`).value = t.reqs.join(", ");
      n(X, `H${xr}`, eff.min); n(X, `I${xr}`, eff.max); n(X, `J${xr}`, ag.min); n(X, `K${xr}`, ag.max);
      if (perTask) { n(X, `L${xr}`, s?.apiUsd?.min ?? 0); n(X, `M${xr}`, s?.apiUsd?.max ?? 0); }
      xr++;
    }
    const lastCol = cols[cols.length - 1]![0];
    X.getCell(`C${xr}`).value = "Total (rows shown)"; X.getCell(`C${xr}`).font = BOLD;
    for (const [c] of cols.slice(6)) f(X, `${c}${xr}`, `SUBTOTAL(9,${c}5:${c}${xr - 1})`, undefined, { font: BOLD });
    X.autoFilter = `B4:${lastCol}${xr - 1}`;
    X.views = [{ state: "frozen", ySplit: 4 }];
  }

  // ---------- team-only sheets ----------
  if (team) {
    const C = sheet("Confidence");
    C.getColumn("B").width = 30; C.getColumn("C").width = 50;
    const ck = (row: number, k: string, v: string | number) => { C.getCell(`B${row}`).value = k; C.getCell(`B${row}`).font = BOLD; C.getCell(`C${row}`).value = v; };
    ck(2, "Delivery model", e.deliveryModel); ck(3, "Size band", e.band); ck(4, "Uncertainty", e.uncertainty);
    ck(5, "Cost confidence", e.apiCost.confidence); ck(6, "Benchmark records", e.apiCost.records);
    ck(7, "Flagged tasks (estimators disagree)", e.tasks.filter((t) => t.flagged).length);
    ck(8, "Spec sha", e.specSha); ck(9, "Breakdown sha", e.breakdownSha);
    // internal only: where the hours came from and how far they are measured (never on the client's copy)
    if (e.catalogue) { ck(10, "Task catalogue", `${e.catalogue.version} (stack ${e.catalogue.stack})`); ck(11, "Catalogue status", catalogueStatusText(e.catalogue)); }
    ck(12, "Agent hours basis", agentBasisText(e.elapsed.basis));
    // where each phase's API figure comes from: this factory's ledgers, its paid eval runs, or the cold-start assumption
    head(C, 14, { B: "API cost by phase", C: "Based on", D: "Ledger runs", E: "Eval runs" });
    C.getColumn("D").width = 12; C.getColumn("E").width = 12;
    let cr = 15;
    for (const p of e.apiCost.phases) {
      C.getCell(`B${cr}`).value = `${p.phase} ($${p.usd.min}-${p.usd.max})`;
      C.getCell(`C${cr}`).value = p.basis ? costBasisText(p.basis, true) : "not recorded (estimate made before 2026-10-06)";
      if (p.basis) { C.getCell(`D${cr}`).value = p.basis.ledger; C.getCell(`E${cr}`).value = p.basis.eval; }
      cr++;
    }

    const A = sheet("Anchors");
    A.getColumn("B").width = 10; A.getColumn("C").width = 40; A.getColumn("D").width = 10; A.getColumn("E").width = 10; A.getColumn("F").width = 60;
    A.getCell("B1").value = "Anchors"; A.getCell("B1").font = { bold: true, size: 14 };
    head(A, 2, { B: "Task", C: "Title", D: "Min (h)", E: "Max (h)", F: "Why a fair reference" });
    const title = new Map(b.tasks.map((t) => [t.id, t.title]));
    let ar = 3;
    for (const x of e.anchors) { A.getCell(`B${ar}`).value = x.taskId; A.getCell(`C${ar}`).value = title.get(x.taskId) ?? ""; n(A, `D${ar}`, x.hours.min); n(A, `E${ar}`, x.hours.max); A.getCell(`F${ar}`).value = x.reason; ar++; }
    ar += 2;
    head(A, ar, { B: "Task", C: "Title", D: "Anchor", E: "Ratio", F: "Reason", G: "Min (h)", H: "Max (h)", I: "Executor", J: "Flagged" }); ar++;
    for (const t of e.tasks) {
      A.getCell(`B${ar}`).value = t.taskId; A.getCell(`C${ar}`).value = title.get(t.taskId) ?? ""; A.getCell(`D${ar}`).value = t.anchorId; A.getCell(`E${ar}`).value = t.ratio;
      A.getCell(`F${ar}`).value = t.reason; n(A, `G${ar}`, t.hours.min); n(A, `H${ar}`, t.hours.max); A.getCell(`I${ar}`).value = t.executor; A.getCell(`J${ar}`).value = t.flagged ? "yes" : ""; ar++;
    }

    const T = sheet("Traceability");
    T.getColumn("B").width = 14; T.getColumn("C").width = 50; T.getColumn("D").width = 40;
    T.getCell("B1").value = "Requirements and traceability"; T.getCell("B1").font = { bold: true, size: 14 };
    head(T, 2, { B: "Requirement", C: "Title", D: "Tasks" });
    const reqIds = new Set<string>(); for (const t of b.tasks) for (const q of t.reqs) reqIds.add(q);
    const known = new Map((input.requirements ?? []).map((q) => [q.id, q.title]));
    for (const q of known.keys()) reqIds.add(q);
    let tr = 3;
    for (const q of [...reqIds].sort()) {
      T.getCell(`B${tr}`).value = q; T.getCell(`C${tr}`).value = known.get(q) ?? "";
      T.getCell(`D${tr}`).value = b.tasks.filter((t) => t.reqs.includes(q)).map((t) => t.id).join(", ") || "NOT COVERED"; tr++;
    }
    tr += 2;
    T.getCell(`B${tr}`).value = "Tasks with no requirement (named overheads)"; T.getCell(`B${tr}`).font = BOLD; tr++;
    for (const t of b.tasks.filter((x) => x.reqs.length === 0)) { T.getCell(`B${tr}`).value = t.id; T.getCell(`C${tr}`).value = t.title; T.getCell(`D${tr}`).value = t.overhead ?? "no reason given"; tr++; }

    const P = sheet("Parameters");
    P.getColumn("B").width = 42; P.getColumn("C").width = 12; P.getColumn("D").width = 12; P.getColumn("E").width = 40;
    P.getCell("B1").value = "Assumed parameters and gate time (all editable, all assumed)"; P.getCell("B1").font = { bold: true, size: 14 };
    head(P, 2, { B: "Parameter", C: "Min", D: "Max" });
    const range = (k: string, x: { min: number; max: number }, row: number) => { P.getCell(`B${row}`).value = k; P.getCell(`C${row}`).value = x.min; P.getCell(`D${row}`).value = x.max; };
    let pr = 3;
    for (const [k, v] of [
      ["Clarify minutes per question", a.gates.clarifyMinutesPerQuestion], ["Approval minutes per section", a.gates.approvalMinutesPerSection],
      ["PR review minutes, low risk", a.gates.prReviewMinutes.low], ["PR review minutes, medium risk", a.gates.prReviewMinutes.medium], ["PR review minutes, high risk", a.gates.prReviewMinutes.high],
      ["Parked-run rate", a.gates.parkedRunRate], ["Parked-run intervention minutes", a.gates.parkedInterventionMinutes], ["Waiver minutes", a.gates.waiverMinutes],
      ["Cold-start dollars per task", a.cost.coldStartUsdPerTask],
    ] as [string, { min: number; max: number }][]) range(k, v, pr++);
    for (const [k, v] of [["Estimator tolerance", a.estimatorTolerance], ["Tasks per PR", a.tasksPerPr], ["Hours per day", a.hoursPerDay], ["Hours per week", a.hoursPerWeek], ["Agentic build factor", a.cost.agenticBuildFactor]] as [string, number][]) {
      P.getCell(`B${pr}`).value = k; P.getCell(`C${pr}`).value = v; pr++;
    }
    pr += 2;
    P.getCell(`B${pr}`).value = "Gate hours in this estimate"; P.getCell(`B${pr}`).font = BOLD; pr++;
    if (e.gateHours.length === 0) { P.getCell(`B${pr}`).value = e.deliveryModel === "agentic" ? "None: the solely agentic model has no supervisor gates" : "None"; pr++; }
    for (const g of e.gateHours) { range(g.source, g.hours, pr); P.getCell(`E${pr}`).value = "assumed"; pr++; }
    P.getCell(`B${pr + 1}`).value = input.rates ? "Hourly rates are on the Cost sheet." : "No rates were given, so there is no cost overlay.";

    // ---------- gate and waiver log ----------
    const G = sheet("Gates");
    G.getColumn("B").width = 36; G.getColumn("C").width = 10; G.getColumn("D").width = 90;
    G.getCell("B1").value = "Estimate gates and waivers"; G.getCell("B1").font = { bold: true, size: 14 };
    head(G, 2, { B: "Gate", C: "Result", D: "Details" });
    let gr = 3;
    for (const x of input.gateLog ?? []) { G.getCell(`B${gr}`).value = x.gateId; G.getCell(`C${gr}`).value = x.passed ? "passed" : "FAILED"; G.getCell(`D${gr}`).value = x.details; gr++; }
    if (!input.gateLog?.length) { G.getCell(`B${gr}`).value = "No gate results were recorded for this estimate."; gr++; }
    gr += 2;
    G.getCell(`B${gr}`).value = "Waivers"; G.getCell(`B${gr}`).font = BOLD; gr++;
    head(G, gr, { B: "Gates", C: "Step", D: "Waived by and why" }); gr++;
    for (const w of input.waivers ?? []) { G.getCell(`B${gr}`).value = w.gateIds.join(", "); G.getCell(`C${gr}`).value = w.step; G.getCell(`D${gr}`).value = `${w.human}: ${w.reason}`; gr++; }
    if (!input.waivers?.length) { G.getCell(`B${gr}`).value = "None"; gr++; }

    // ---------- cost overlay (only when rates were given) ----------
    if (input.rates && Object.keys(input.rates).length) {
      const K = sheet("Cost");
      K.getColumn("B").width = 22; for (const c of ["C", "D", "E", "F", "G"]) K.getColumn(c).width = 14;
      K.getCell("B1").value = "Cost overlay (USD, indicative: hours x the given rate, not a quote)"; K.getCell("B1").font = { bold: true, size: 14 };
      head(K, 2, { B: "Track", C: "Rate ($/h)", D: "Cost min ($)", E: "Cost max ($)", F: "Hours min", G: "Hours max" });
      let kr = 3;
      const k0 = kr;
      for (const row of rows) {
        const sr = rowOf.get(row.key)!;
        K.getCell(`B${kr}`).value = row.label;
        n(K, `C${kr}`, (row.track && input.rates[row.track]) ?? input.rates.default ?? 0);
        f(K, `F${kr}`, `Summary!C${sr}`); f(K, `G${kr}`, `Summary!D${sr}`);
        // the Design row follows the same switch as the hours total
        const inc = row.key === "design" ? (x: string) => `IF(Summary!${DESIGN_SWITCH}="Yes",${x},0)` : (x: string) => x;
        f(K, `D${kr}`, inc(`F${kr}*C${kr}`)); f(K, `E${kr}`, inc(`G${kr}*C${kr}`));
        kr++;
      }
      K.getCell(`B${kr}`).value = "Total"; K.getCell(`B${kr}`).font = BOLD;
      f(K, `D${kr}`, `SUM(D${k0}:D${kr - 1})`); f(K, `E${kr}`, `SUM(E${k0}:E${kr - 1})`);
      kr += 2;
      K.getCell(`B${kr}`).value = "API credits are separate: see Summary. Rates apply to effort hours only.";
    }
  }

  fillResults(wb);
  return wb;
}

/** Fill every formula's cached result by evaluating it over the workbook. */
export function fillResults(wb: ExcelJS.Workbook): void {
  const memo = new Map<string, number | string>();
  const read = (sheet: string, addr: string): CellValue => {
    const key = `${sheet}!${addr}`;
    if (memo.has(key)) return memo.get(key);
    const ws = wb.getWorksheet(sheet);
    if (!ws) throw new Error(`no sheet ${sheet}`);
    const v = ws.getCell(addr).value;
    if (v === null || v === undefined || v === "") return undefined;
    if (typeof v === "object" && "formula" in v) {
      const r = evalFormula(v.formula!, sheet, read);
      memo.set(key, r);
      return r;
    }
    return typeof v === "number" || typeof v === "string" ? v : undefined;
  };
  for (const ws of wb.worksheets) {
    ws.eachRow((row) => row.eachCell((cell) => {
      const v = cell.value;
      if (v && typeof v === "object" && "formula" in v) {
        cell.value = { formula: v.formula!, result: evalFormula(v.formula!, ws.name, read) } as ExcelJS.CellFormulaValue;
      }
    }));
  }
}

/**
 * Write the team and client files. Each is drawn on a fresh copy of the Folio3 estimation template, so it
 * carries the template's styling: the path given, else FACTORY_ESTIMATE_TEMPLATE, else the copy the repo ships.
 */
export async function exportWorkbooks(input: ExportInput, dir: string, base: string, opts: { templatePath?: string } = {}): Promise<{ team: string; client: string }> {
  const { mkdir } = await import("node:fs/promises");
  const { join } = await import("node:path");
  await mkdir(dir, { recursive: true });
  const templatePath = opts.templatePath ?? process.env.FACTORY_ESTIMATE_TEMPLATE ?? (input.template || !existsSync(BUNDLED_TEMPLATE) ? undefined : BUNDLED_TEMPLATE);
  const out = { team: join(dir, `${base}-team.xlsx`), client: join(dir, `${base}-client.xlsx`) };
  for (const audience of ["team", "client"] as const) {
    const template = templatePath ? await loadTemplate(templatePath) : input.template;
    await buildWorkbook({ ...input, ...(template ? { template } : {}) }, audience).xlsx.writeFile(out[audience]);
  }
  return out;
}
