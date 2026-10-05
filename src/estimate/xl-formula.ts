// A small evaluator for the formulas the estimate workbook uses: cell and cross-sheet references,
// SUM and SUBTOTAL(9) over ranges, ROUND, IF, + - * /, and = <> comparisons. Code needs it twice: to fill each formula's
// cached result at export, and to re-check a finished workbook cell by cell (gate E6). Anything outside
// this subset is an error, so a hand-edited formula the lint cannot read fails closed.
export type CellValue = number | string | undefined;
export type GetCell = (sheet: string, address: string) => CellValue;

export function colToNum(col: string): number {
  let n = 0;
  for (const ch of col) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}
export function numToCol(n: number): string {
  let s = "";
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
}
function split(address: string): { col: number; row: number } {
  const m = /^([A-Z]+)(\d+)$/.exec(address);
  if (!m) throw new Error(`bad cell address ${address}`);
  return { col: colToNum(m[1]!), row: Number(m[2]) };
}
export function expandRange(from: string, to: string): string[] {
  const a = split(from), b = split(to);
  const out: string[] = [];
  for (let r = Math.min(a.row, b.row); r <= Math.max(a.row, b.row); r++) {
    for (let c = Math.min(a.col, b.col); c <= Math.max(a.col, b.col); c++) out.push(`${numToCol(c)}${r}`);
  }
  return out;
}

type Tok = { t: "num" | "str" | "id" | "ref" | "op"; v: string };
const REF = /^(?:(?:'([^']+)'|([A-Za-z_][A-Za-z0-9_]*))!)?\$?([A-Z]{1,3})\$?(\d+)(?::\$?([A-Z]{1,3})\$?(\d+))?/;

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const rest = src.slice(i);
    let m: RegExpExecArray | null;
    if (/^\s/.test(rest)) { i++; continue; }
    if ((m = /^"([^"]*)"/.exec(rest))) { out.push({ t: "str", v: m[1]! }); i += m[0].length; continue; }
    if ((m = /^\d+(?:\.\d+)?/.exec(rest))) { out.push({ t: "num", v: m[0] }); i += m[0].length; continue; }
    if ((m = REF.exec(rest)) && !/^[A-Za-z_]+\(/.test(rest)) { out.push({ t: "ref", v: m[0] }); i += m[0].length; continue; }
    if ((m = /^[A-Z]+(?=\()/.exec(rest))) { out.push({ t: "id", v: m[0] }); i += m[0].length; continue; }
    if ((m = /^(<>|[-+*/(),=])/.exec(rest))) { out.push({ t: "op", v: m[0] }); i += m[0].length; continue; }
    throw new Error(`cannot read formula near "${rest.slice(0, 12)}"`);
  }
  return out;
}

type Val = number | string | number[];

/** Evaluate a formula (without the leading "="). `home` is the sheet unqualified references live on. */
export function evalFormula(formula: string, home: string, get: GetCell): number | string {
  const toks = tokenize(formula.replace(/^=/, ""));
  let p = 0;
  const peek = () => toks[p];
  const eat = (v?: string): Tok => {
    const t = toks[p++];
    if (!t || (v !== undefined && t.v !== v)) throw new Error(`expected ${v ?? "more formula"} in ${formula}`);
    return t;
  };
  const num = (v: Val, what: string): number => {
    if (typeof v !== "number") throw new Error(`${what} is not a number in ${formula}`);
    return v;
  };
  const cell = (sheet: string, addr: string): number | string => {
    const v = get(sheet, addr);
    if (v === undefined) throw new Error(`${formula} points at an empty cell ${sheet}!${addr}`);
    return v;
  };

  function primary(): Val {
    const t = eat();
    if (t.t === "num") return Number(t.v);
    if (t.t === "str") return t.v;
    if (t.t === "op" && t.v === "(") { const v = expr(); eat(")"); return v; }
    if (t.t === "op" && t.v === "-") return -num(primary(), "operand");
    if (t.t === "ref") {
      const m = REF.exec(t.v)!;
      const sheet = m[1] ?? m[2] ?? home;
      const from = `${m[3]}${m[4]}`;
      if (!m[5]) return cell(sheet, from);
      // a range: only blank cells are skipped, and an all-blank range is an error
      const nums = expandRange(from, `${m[5]}${m[6]}`).map((a) => get(sheet, a)).filter((v): v is number => typeof v === "number");
      if (nums.length === 0) throw new Error(`${formula} sums a range with no numbers (${t.v})`);
      return nums;
    }
    if (t.t === "id") {
      eat("(");
      const args: Val[] = [];
      if (peek()?.v !== ")") { args.push(expr()); while (peek()?.v === ",") { eat(","); args.push(expr()); } }
      eat(")");
      if (t.v === "SUM") return Math.round(args.flat().reduce<number>((s, v) => s + num(v, "SUM item"), 0) * 100) / 100;
      if (t.v === "ROUND") { const d = num(args[1] ?? 0, "digits"); const f = 10 ** d; return Math.round(num(args[0]!, "ROUND value") * f) / f; }
      // SUBTOTAL(9, range): the sum of the rows a filter shows; read here with every row shown
      if (t.v === "SUBTOTAL") { if (num(args[0]!, "SUBTOTAL function") !== 9) throw new Error(`only SUBTOTAL(9, ...) is supported in ${formula}`); return Math.round(args.slice(1).flat().reduce<number>((s, v) => s + num(v, "SUBTOTAL item"), 0) * 100) / 100; }
      if (t.v === "IF") return (args[0] ? args[1] : args[2]) as Val;
      throw new Error(`unsupported function ${t.v} in ${formula}`);
    }
    throw new Error(`unexpected ${t.v} in ${formula}`);
  }
  function mul(): Val {
    let v = primary();
    while (peek()?.v === "*" || peek()?.v === "/") {
      const op = eat().v; const r = num(primary(), "operand");
      const l = num(v, "operand");
      if (op === "/" && r === 0) throw new Error(`division by zero in ${formula}`);
      v = op === "*" ? l * r : l / r;
    }
    return v;
  }
  function add(): Val {
    let v = mul();
    while (peek()?.v === "+" || peek()?.v === "-") {
      const op = eat().v; const r = num(mul(), "operand");
      v = Math.round((op === "+" ? num(v, "operand") + r : num(v, "operand") - r) * 100) / 100;
    }
    return v;
  }
  function expr(): Val {
    const l = add();
    if (peek()?.v === "=" || peek()?.v === "<>") {
      const op = eat().v; const r = add();
      return (op === "=") === (l === r) ? 1 : 0;
    }
    return l;
  }
  const out = expr();
  if (p !== toks.length) throw new Error(`unexpected trailing formula text in ${formula}`);
  if (Array.isArray(out)) throw new Error(`${formula} returns a range`);
  return out;
}
