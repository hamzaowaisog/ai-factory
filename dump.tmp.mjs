import ExcelJS from "exceljs";
const [f, sheet, max] = process.argv.slice(2);
const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(f);
const ws = wb.getWorksheet(sheet);
console.log("merges:", Object.keys(ws._merges).join(" "));
ws.eachRow((r, n) => { if (n > Number(max)) return; const out=[]; r.eachCell((c)=>{ let v=c.value; if (v&&typeof v==="object"){ v = v.formula? "="+v.formula : v.richText? v.richText.map(t=>t.text).join(""): JSON.stringify(v);} if(v!==null&&v!=="") out.push(`${c.address}:${String(v).slice(0,70)}`)}); if(out.length) console.log(out.join(" | ")); });
