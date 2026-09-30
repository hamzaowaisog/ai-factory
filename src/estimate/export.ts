// The estimate workbook, drawn from the Estimate and Breakdown (docs/estimates-design.md, "The workbook").
// Two files come from one data model: the team file and the client file. Every total is a formula over
// exact ranges and gets its cached result from the same formula evaluator the E6 lint uses, so a cell
// can never carry a number that its formula does not produce.
import ExcelJS from "exceljs";
import type { Breakdown, BreakdownTask, Estimate, Track } from "../contracts/index.js";
import { DEFAULT_ASSUMPTIONS, type Assumptions } from "./assumptions.js";
import { effortHours } from "./hours.js";
import { evalFormula, type CellValue } from "./xl-formula.js";

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
}

/** Sheets every workbook carries, in order. "Other" holds GD, PM, PDM and cross-cutting time. */
export const MANDATORY_SHEETS = ["Summary", "Backend", "Mobile", "Web", "QA", "Design", "Other"] as const;
export const TEAM_SHEETS = ["Confidence", "Anchors", "Traceability", "Parameters"] as const;

interface Section { key: string; title: string; tracks: Track[]; cross?: boolean }
const SHEETS: { name: string; sections: Section[] }[] = [
  { name: "Backend", sections: [{ key: "backend", title: "Backend", tracks: ["backend"] }] },
  { name: "Mobile", sections: [{ key: "mobile", title: "Mobile", tracks: ["mobile"] }] },
  { name: "Web", sections: [{ key: "web", title: "Web / Admin", tracks: ["web"] }] },
  { name: "QA", sections: [{ key: "qa", title: "QA", tracks: ["qa"] }] },
  { name: "Design", sections: [{ key: "design", title: "Design", tracks: ["design"] }] },
  { name: "Other", sections: [
    { key: "gd", title: "GD", tracks: ["gd"] }, { key: "pm", title: "PM", tracks: ["pm"] },
    { key: "pdm", title: "PDM", tracks: ["pdm"] }, { key: "cross", title: "Cross-cutting", tracks: [], cross: true },
  ] },
];

const BOLD = { bold: true } as const;
const HEAD_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9E1F2" } };
const NUM = "0.00";

export function buildWorkbook(input: ExportInput, audience: Audience): ExcelJS.Workbook {
  const { estimate: e, breakdown: b } = input;
  const a = input.assumptions ?? DEFAULT_ASSUMPTIONS;
  const wb = new ExcelJS.Workbook();
  wb.creator = "AI Factory";
  const team = audience === "team";
  const sized = new Map(e.tasks.map((t) => [t.taskId, t]));

  const sheets = new Map<string, ExcelJS.Worksheet>();
  const sheet = (name: string) => sheets.get(name) ?? (sheets.set(name, wb.addWorksheet(name)), sheets.get(name)!);
  for (const n of MANDATORY_SHEETS) sheet(n);

  const head = (ws: ExcelJS.Worksheet, row: number, labels: Record<string, string>) => {
    for (const [col, text] of Object.entries(labels)) {
      const c = ws.getCell(`${col}${row}`);
      c.value = text; c.font = BOLD; c.fill = HEAD_FILL;
    }
  };
  const f = (ws: ExcelJS.Worksheet, addr: string, formula: string) => { ws.getCell(addr).value = { formula } as ExcelJS.CellFormulaValue; ws.getCell(addr).numFmt = NUM; };
  const n = (ws: ExcelJS.Worksheet, addr: string, v: number) => { ws.getCell(addr).value = v; ws.getCell(addr).numFmt = NUM; };

  // ---------- track sheets ----------
  const totalCell = new Map<string, { sheet: string; row: number }>(); // section key -> its total row
  const featureTitle = new Map(b.features.map((x) => [x.id, x.title]));
  const tasksOf = (s: Section): BreakdownTask[] => b.tasks.filter((t) => s.tracks.includes(t.track));

  for (const def of SHEETS) {
    const ws = sheet(def.name);
    ws.getColumn("B").width = 7; ws.getColumn("C").width = 46;
    for (const c of ["D", "E"]) ws.getColumn(c).width = 10;
    ws.getColumn("F").width = 60; ws.getColumn("G").width = 11; ws.getColumn("H").width = 22; ws.getColumn("I").width = 9;
    for (const c of ["J", "K"]) ws.getColumn(c).width = 12;
    ws.getCell("B1").value = `${def.name} estimate`; ws.getCell("B1").font = { bold: true, size: 14 };
    let row = 3;
    for (const sec of def.sections) {
      const tasks = tasksOf(sec);
      const overheads = e.overheads.filter((o) => (sec.cross ? !o.track : o.track && sec.tracks.includes(o.track)));
      const gates = e.gateHours.filter((g) => (sec.cross ? !g.track : g.track && sec.tracks.includes(g.track)));
      if (def.sections.length > 1) { ws.getCell(`B${row}`).value = sec.title; ws.getCell(`B${row}`).font = { bold: true, size: 12 }; row++; }
      const empty = tasks.length === 0 && overheads.length === 0 && gates.length === 0;
      if (empty && !sec.cross) {
        const why = input.notInScope?.[sec.tracks[0]!] ?? "no work in this estimate";
        ws.getCell(`B${row}`).value = `Not in scope: ${why}`; ws.getCell(`B${row}`).font = { italic: true }; row++;
      }
      const labels: Record<string, string> = { B: "S.No", C: "Task", D: "Min (h)", E: "Max (h)", F: "Comments", G: "Executor", H: "Requirement id(s)", I: "Task id" };
      if (team) Object.assign(labels, { J: "Sized min (h)", K: "Sized max (h)" });
      head(ws, row, labels); row++;

      const partTotals: number[] = [];
      const block = (title: string, rows: { name: string; min: number; max: number; comment: string; executor?: string; reqs?: string; id?: string; sized?: { min: number; max: number } }[]) => {
        ws.getCell(`C${row}`).value = title; ws.getCell(`C${row}`).font = BOLD; row++;
        const first = row;
        let i = 1;
        for (const r of rows.length ? rows : [{ name: "None", min: 0, max: 0, comment: "", sized: { min: 0, max: 0 } }]) {
          ws.getCell(`B${row}`).value = i++; ws.getCell(`C${row}`).value = r.name;
          n(ws, `D${row}`, r.min); n(ws, `E${row}`, r.max);
          ws.getCell(`F${row}`).value = r.comment; ws.getCell(`G${row}`).value = r.executor ?? ""; ws.getCell(`H${row}`).value = r.reqs ?? ""; ws.getCell(`I${row}`).value = r.id ?? "";
          if (team && r.sized) { n(ws, `J${row}`, r.sized.min); n(ws, `K${row}`, r.sized.max); }
          row++;
        }
        ws.getCell(`C${row}`).value = `${title} total`; ws.getCell(`C${row}`).font = BOLD;
        f(ws, `D${row}`, `SUM(D${first}:D${row - 1})`); f(ws, `E${row}`, `SUM(E${first}:E${row - 1})`);
        if (team) { f(ws, `J${row}`, `SUM(J${first}:J${row - 1})`); f(ws, `K${row}`, `SUM(K${first}:K${row - 1})`); }
        partTotals.push(row); row += 2;
      };

      // modules: the breakdown's features, in order
      for (const feat of b.features) {
        const own = tasks.filter((t) => t.featureId === feat.id);
        if (!own.length) continue;
        block(featureTitle.get(feat.id) ?? feat.id, own.map((t) => {
          const s = sized.get(t.id);
          const eff = s ? effortHours(s) : { min: 0, max: 0 };
          const why = team && s ? ` (${s.reason})` : "";
          return {
            name: t.title, min: eff.min, max: eff.max, executor: t.executor[0]!.toUpperCase() + t.executor.slice(1), reqs: t.reqs.join(", "), id: t.id,
            comment: (t.overhead ? t.overhead : t.items.join("; ")) + why, sized: s?.hours,
          };
        }));
      }
      // other development activities: named overheads and, for the tracks that carry them, gate time
      const acts = [
        ...overheads.map((o) => ({ name: o.name, min: o.hours.min, max: o.hours.max, comment: o.reason, sized: o.hours })),
        ...gates.map((g) => ({ name: `Supervisor: ${g.source}`, min: g.hours.min, max: g.hours.max, comment: "assumed, editable", sized: g.hours })),
      ];
      if (acts.length || partTotals.length === 0) block("Other activities", acts);

      ws.getCell(`C${row}`).value = `${sec.title} TOTAL`; ws.getCell(`C${row}`).font = { bold: true, size: 12 };
      f(ws, `D${row}`, partTotals.map((r) => `D${r}`).join("+")); f(ws, `E${row}`, partTotals.map((r) => `E${r}`).join("+"));
      totalCell.set(sec.key, { sheet: def.name, row });
      row += 3;
    }
  }

  // ---------- summary ----------
  const S = sheet("Summary");
  S.getColumn("B").width = 30;
  for (const c of ["C", "D", "E", "F", "G", "H"]) S.getColumn(c).width = 14;
  S.getCell("B1").value = "Estimate summary"; S.getCell("B1").font = { bold: true, size: 14 };
  const kv = (row: number, k: string, v: string | number) => { S.getCell(`B${row}`).value = k; S.getCell(`B${row}`).font = BOLD; S.getCell(`C${row}`).value = v; };
  kv(3, "Client", input.header.client); kv(4, "Project", input.header.project); kv(5, "PM", input.header.pm);
  kv(6, "Date", input.header.date); kv(7, "Version", input.header.version);
  kv(8, "Delivery model", e.deliveryModel === "hitl" ? "HITL (supervisor + agents)" : "Solely agentic");
  if (team) kv(9, "Size band", e.band);
  S.getCell("B11").value = "Parameters"; S.getCell("B11").font = { bold: true, size: 12 };
  kv(12, "Include Design in total", e.settings.designInTotal ? "Yes" : "No");
  kv(13, "Hours per week", a.hoursPerWeek);
  kv(14, "Feedback rounds", e.settings.feedbackRounds);
  kv(15, "Stack chosen by", e.settings.stackSource);
  const DESIGN_SWITCH = "$C$12", HPW = "$C$13";

  const TABLE = 18;
  S.getCell(`B${TABLE - 1}`).value = "Task summary"; S.getCell(`B${TABLE - 1}`).font = { bold: true, size: 12 };
  head(S, TABLE, { B: "Track", C: "Min (h)", D: "Max (h)", E: "Avg (h)", F: "Resources", G: "Weeks min", H: "Weeks max" });
  const rows: { label: string; key: string; track?: Track }[] = [
    { label: "Backend", key: "backend", track: "backend" }, { label: "Mobile", key: "mobile", track: "mobile" },
    { label: "Web / Admin", key: "web", track: "web" }, { label: "QA", key: "qa", track: "qa" },
    { label: "GD", key: "gd", track: "gd" }, { label: "PM", key: "pm", track: "pm" }, { label: "PDM", key: "pdm", track: "pdm" },
    { label: "Cross-cutting", key: "cross" }, { label: "Design", key: "design", track: "design" },
  ];
  const rowOf = new Map<string, number>();
  rows.forEach((r, i) => {
    const row = TABLE + 1 + i;
    rowOf.set(r.key, row);
    const link = totalCell.get(r.key)!;
    S.getCell(`B${row}`).value = r.label;
    f(S, `C${row}`, `'${link.sheet}'!D${link.row}`); f(S, `D${row}`, `'${link.sheet}'!E${link.row}`);
    f(S, `E${row}`, `ROUND((C${row}+D${row})/2,2)`);
    S.getCell(`F${row}`).value = (r.track && input.resources?.[r.track]) || 1;
    f(S, `G${row}`, `ROUND(C${row}/${HPW}/F${row},2)`); f(S, `H${row}`, `ROUND(D${row}/${HPW}/F${row},2)`);
  });
  const first = TABLE + 1, last = TABLE + rows.length, design = rowOf.get("design")!, tot = last + 1;
  S.getCell(`B${tot}`).value = "Total"; S.getCell(`B${tot}`).font = { bold: true, size: 12 };
  // the design row is the last one, so the plain sum stops one row above it
  for (const c of ["C", "D"]) f(S, `${c}${tot}`, `SUM(${c}${first}:${c}${design - 1})+IF(${DESIGN_SWITCH}="Yes",${c}${design},0)`);
  f(S, `E${tot}`, `ROUND((C${tot}+D${tot})/2,2)`);

  let r = tot + 3;
  S.getCell(`B${r}`).value = "API credit cost (USD)"; S.getCell(`B${r}`).font = { bold: true, size: 12 }; r++;
  head(S, r, { B: "Phase", C: "Min ($)", D: "Max ($)" }); r++;
  const c0 = r;
  for (const p of e.apiCost.phases) { S.getCell(`B${r}`).value = p.phase; n(S, `C${r}`, p.usd.min); n(S, `D${r}`, p.usd.max); r++; }
  if (r === c0) { S.getCell(`B${r}`).value = "none"; n(S, `C${r}`, 0); n(S, `D${r}`, 0); r++; }
  S.getCell(`B${r}`).value = "API credit cost total"; S.getCell(`B${r}`).font = BOLD;
  f(S, `C${r}`, `SUM(C${c0}:C${r - 1})`); f(S, `D${r}`, `SUM(D${c0}:D${r - 1})`);
  r++;
  S.getCell(`B${r}`).value = "Confidence"; S.getCell(`C${r}`).value = `${e.apiCost.confidence} (${e.apiCost.records} measured record${e.apiCost.records === 1 ? "" : "s"})`; r += 2;

  S.getCell(`B${r}`).value = "Elapsed time"; S.getCell(`B${r}`).font = { bold: true, size: 12 }; r++;
  S.getCell(`B${r}`).value = "Planning (minutes)"; n(S, `C${r}`, e.elapsed.planningMinutes); r++;
  S.getCell(`B${r}`).value = "Build critical path (days)"; n(S, `C${r}`, e.elapsed.criticalPathDays.min); n(S, `D${r}`, e.elapsed.criticalPathDays.max); r += 2;

  const list = (title: string, items: string[]) => {
    if (!items.length) return;
    S.getCell(`B${r}`).value = title; S.getCell(`B${r}`).font = { bold: true, size: 12 }; r++;
    for (const it of items) { S.getCell(`B${r}`).value = it; r++; }
    r++;
  };
  list("Assumptions", e.assumptions);
  list("Suggested, not included", e.suggested.map((s) => `${s.title}: ${s.reason}`));
  list("Scenarios", e.scenarios.map((s) => `${s.name}: ${s.changes} (${s.totals.min}-${s.totals.max} h)`));

  // ---------- team-only sheets ----------
  if (team) {
    const C = sheet("Confidence");
    C.getColumn("B").width = 30; C.getColumn("C").width = 50;
    const ck = (row: number, k: string, v: string | number) => { C.getCell(`B${row}`).value = k; C.getCell(`B${row}`).font = BOLD; C.getCell(`C${row}`).value = v; };
    ck(2, "Delivery model", e.deliveryModel); ck(3, "Size band", e.band); ck(4, "Uncertainty", e.uncertainty);
    ck(5, "Cost confidence", e.apiCost.confidence); ck(6, "Benchmark records", e.apiCost.records);
    ck(7, "Flagged tasks (estimators disagree)", e.tasks.filter((t) => t.flagged).length);
    ck(8, "Spec sha", e.specSha); ck(9, "Breakdown sha", e.breakdownSha);

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
    P.getCell(`B${pr + 1}`).value = "No waiver log yet: gates are not wired into the run. Cost overlay: no rates were given.";
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

export async function exportWorkbooks(input: ExportInput, dir: string, base: string): Promise<{ team: string; client: string }> {
  const { mkdir } = await import("node:fs/promises");
  const { join } = await import("node:path");
  await mkdir(dir, { recursive: true });
  const out = { team: join(dir, `${base}-team.xlsx`), client: join(dir, `${base}-client.xlsx`) };
  await buildWorkbook(input, "team").xlsx.writeFile(out.team);
  await buildWorkbook(input, "client").xlsx.writeFile(out.client);
  return out;
}
