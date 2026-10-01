// The Folio3 estimation template (docs/estimates-design.md, open item 3). These always run, on the blanked
// copy the repo ships. To check a different template file (for example the current version from Folio3):
//   FACTORY_ESTIMATE_TEMPLATE=/path/to/Example_Estimation.xlsx npx vitest run src/estimate/template.test.ts
// Decision they support: filling a copy works. The template survives a load and save through ExcelJS with
// its sheets, merges, formulas and styles (only a column width or two on the QA sheet is dropped, and the
// export sets those itself), so every workbook is drawn on a fresh copy of it.
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { BUNDLED_TEMPLATE, buildWorkbook, exportWorkbooks, loadTemplate, MANDATORY_SHEETS, SHEET } from "./export.js";
import { fixture } from "./fixture.js";
import { lintWorkbook, loadWorkbook } from "./workbook-lint.js";

const path = process.env.FACTORY_ESTIMATE_TEMPLATE ?? BUNDLED_TEMPLATE;

/** Stable text of an object: keys sorted, so two equal styles compare equal whatever their key order. */
const stable = (v: unknown): string => JSON.stringify(v, (_k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).filter(([k, y]) => !(k === "shrinkToFit" && y === false)).sort(([a], [b]) => a.localeCompare(b))) : x));

const shape = (wb: ExcelJS.Workbook) => wb.worksheets.map((ws) => {
  let styled = 0, formulas = 0;
  const styles: string[] = [];
  ws.eachRow((row) => row.eachCell((c) => {
    if (c.style && Object.keys(c.style).length) { styled++; styles.push(`${c.address}${stable(c.style)}`); }
    if (c.value && typeof c.value === "object" && "formula" in c.value) formulas++;
  }));
  return {
    name: ws.name, rows: ws.rowCount, styled, formulas, styles,
    merges: Object.keys((ws as unknown as { _merges: object })._merges ?? {}).sort(),
    widths: ws.columns.map((c) => Math.round(c.width ?? 0)),
  };
});

describe("the Folio3 estimation template", () => {
  it("has the sheets the workbook keeps, under the names the export uses", async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(path!);
    const names = wb.worksheets.map((w) => w.name);
    for (const s of MANDATORY_SHEETS.filter((x) => x !== SHEET.other)) expect(names, s).toContain(s);
  });

  it("survives a load and save with its sheets, merges, formulas and styles intact", async () => {
    const a = new ExcelJS.Workbook();
    await a.xlsx.readFile(path!);
    const out = join(await mkdtemp(join(tmpdir(), "factory-template-")), "copy.xlsx");
    await a.xlsx.writeFile(out);
    const b = new ExcelJS.Workbook();
    await b.xlsx.readFile(out);
    const x = shape(a), y = shape(b);
    for (const [i, s] of x.entries()) {
      const t = y[i]!;
      expect({ name: t.name, rows: t.rows, styled: t.styled, formulas: t.formulas, merges: t.merges, styles: t.styles }).toEqual({ name: s.name, rows: s.rows, styled: s.styled, formulas: s.formulas, merges: s.merges, styles: s.styles });
      // a column width ExcelJS drops reads as 0; the rest must match
      s.widths.forEach((w, c) => { if (t.widths[c]) expect(t.widths[c]).toBe(w); });
    }
  });

  it("draws the estimate on a copy of it: same sheets and theme, its styles on our cells, both files lint clean", async () => {
    const input = fixture();
    const dir = await mkdtemp(join(tmpdir(), "factory-template-out-"));
    const files = await exportWorkbooks(input, dir, "on-template", { templatePath: path! });
    const plain = buildWorkbook(input, "team");
    const tpl = await loadTemplate(path!);
    for (const [audience, file] of [["team", files.team], ["client", files.client]] as const) {
      const wb = await loadWorkbook(file);
      expect(lintWorkbook(wb, input.estimate, input.breakdown, audience)).toEqual([]);
      // the template's title styling reached our title cell
      const want = stable(tpl.styles.get("title"));
      expect(stable(wb.getWorksheet(SHEET.backend)!.getCell("B2").style)).toBe(want);
      // and the file is not the plain drawing
      expect(stable(plain.getWorksheet(SHEET.backend)!.getCell("B2").style)).not.toBe(want);
    }
    const team = await loadWorkbook(files.team);
    expect(team.getWorksheet(SHEET.summary)!.getCell("B1").value).toBe("Folio3 Project Estimation");
    // no sample data from the template survives
    const text: string[] = [];
    for (const ws of team.worksheets) ws.eachRow((r) => r.eachCell((c) => { if (typeof c.value === "string") text.push(c.value); }));
    expect(text.join("\n")).not.toMatch(/Singe Safety|Single Safety|Syed Ahsan|\[Project Name\]|Muhammad Usman/);
  });

  it("is the default: an export with no path set is drawn on the shipped copy", async () => {
    const input = fixture();
    const dir = await mkdtemp(join(tmpdir(), "factory-template-default-"));
    const saved = process.env.FACTORY_ESTIMATE_TEMPLATE;
    delete process.env.FACTORY_ESTIMATE_TEMPLATE;
    try {
      const files = await exportWorkbooks(input, dir, "default");
      const wb = await loadWorkbook(files.team);
      expect(lintWorkbook(wb, input.estimate, input.breakdown, "team")).toEqual([]);
      expect(stable(wb.getWorksheet(SHEET.backend)!.getCell("B2").style)).toBe(stable((await loadTemplate(BUNDLED_TEMPLATE)).styles.get("title")));
    } finally { if (saved !== undefined) process.env.FACTORY_ESTIMATE_TEMPLATE = saved; }
  });

  it("refuses a file that is not the template", async () => {
    const dir = await mkdtemp(join(tmpdir(), "factory-template-bad-"));
    const bad = join(dir, "bad.xlsx");
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet("Sheet1");
    await wb.xlsx.writeFile(bad);
    await expect(loadTemplate(bad)).rejects.toThrow(/does not look like the Folio3 estimation template/);
  });
});
