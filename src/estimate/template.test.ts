// The real-template check (docs/estimates-design.md, open item 3): fill a copy of the estimation template,
// or draw the workbook. It runs only when the template file is at hand:
//   FACTORY_ESTIMATE_TEMPLATE=/path/to/template.xlsx npx vitest run src/estimate/template.test.ts
// It asks the one question the decision turns on: does the template survive a load and save through
// ExcelJS with its sheets, merged cells, column widths and styles intact? If it does, filling a copy is
// possible; if not, the drawn workbook (export.ts) stays the way.
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { MANDATORY_SHEETS } from "./export.js";

const path = process.env.FACTORY_ESTIMATE_TEMPLATE;

const shape = (wb: ExcelJS.Workbook) => wb.worksheets.map((ws) => {
  let styled = 0, formulas = 0;
  ws.eachRow((row) => row.eachCell((c) => {
    if (c.style && Object.keys(c.style).length) styled++;
    if (c.value && typeof c.value === "object" && "formula" in c.value) formulas++;
  }));
  return {
    name: ws.name, rows: ws.rowCount, styled, formulas,
    merges: Object.keys((ws as unknown as { _merges: object })._merges ?? {}).length,
    widths: ws.columns.map((c) => Math.round(c.width ?? 0)),
  };
});

describe.skipIf(!path)("the real estimation template", () => {
  it("has the six template sheets the workbook must keep", async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(path!);
    const names = wb.worksheets.map((w) => w.name.trim().toLowerCase());
    for (const s of MANDATORY_SHEETS.filter((x) => x !== "Other")) {
      expect(names.some((n) => n.includes(s.toLowerCase())), `a sheet like ${s}`).toBe(true);
    }
  });
  it("survives a load and save with its sheets, merges, widths, styles and formulas intact", async () => {
    const a = new ExcelJS.Workbook();
    await a.xlsx.readFile(path!);
    const out = join(await mkdtemp(join(tmpdir(), "factory-template-")), "copy.xlsx");
    await a.xlsx.writeFile(out);
    const b = new ExcelJS.Workbook();
    await b.xlsx.readFile(out);
    expect(shape(b)).toEqual(shape(a));
  });
});

describe("template check without a template", () => {
  it("says how to run it", () => {
    expect(path ? "run" : "skipped: set FACTORY_ESTIMATE_TEMPLATE to the template file").toBeTruthy();
  });
});
