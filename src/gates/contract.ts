// The locked API contract (an OpenAPI document written at plan time and approved on the plan card): what it says, and whether
// the document a built API produces says the same. Pure code: no model, no network.
import { parse } from "yaml";
import { defineGate, failure, verdict } from "./engine.js";

type Obj = Record<string, any>;
const METHODS = ["get", "put", "post", "delete", "patch"];
const JSON_TYPE = "application/json";

/** The document as an object (YAML or JSON), or undefined when it is not an OpenAPI document. */
export function readContract(text: string): Obj | undefined {
  try {
    const d = parse(text) as Obj;
    return d && typeof d === "object" && typeof d.openapi === "string" && d.paths && typeof d.paths === "object" ? d : undefined;
  } catch { return undefined; }
}

const operations = (doc: Obj): { op: string; def: Obj }[] =>
  Object.entries(doc.paths as Obj).flatMap(([path, item]) => METHODS.filter((m) => (item as Obj)?.[m]).map((m) => ({ op: `${m.toUpperCase()} ${path}`, def: (item as Obj)[m] as Obj })));

/** One line per operation with its status codes, for the approval card. */
export const contractSummary = (doc: Obj): string[] => operations(doc).map(({ op, def }) => `${op} -> ${Object.keys(def.responses ?? {}).join(", ")}`);

/** Why a plan's contract cannot be locked: both sides are generated from and checked against it, so it must be complete. */
export function contractProblems(doc: Obj): string[] {
  const bad: string[] = [];
  if (!/^3\.0\./.test(doc.openapi)) bad.push(`The contract is OpenAPI ${doc.openapi}; write it as 3.0.3.`);
  const ops = operations(doc);
  if (!ops.length) bad.push("The contract has no operation.");
  for (const { op, def } of ops) {
    if (!def.operationId) bad.push(`${op} has no operationId (the generated client names its function after it).`);
    const rs = Object.entries((def.responses ?? {}) as Obj);
    if (!rs.length) bad.push(`${op} has no response.`);
    for (const [code, r] of rs) {
      const c = (r as Obj)?.content?.[JSON_TYPE] as Obj | undefined;
      if (c && c.example === undefined && !c.examples) bad.push(`${op} ${code} has no example (the frontend's tests run against it).`);
    }
  }
  return bad;
}

/** A schema as flat facts ("body.items[].id" -> "integer"), following $ref; what a generator adds (format, description) is left out. */
function facts(doc: Obj, schema: Obj | undefined, at: string, out: Map<string, string>, depth = 0): void {
  if (!schema || depth > 12) return;
  if (typeof schema.$ref === "string") return facts(doc, schema.$ref.split("/").slice(1).reduce((o: Obj | undefined, k: string) => o?.[k], doc), at, out, depth + 1);
  const type = Array.isArray(schema.type) ? [...schema.type].sort().join("|") : schema.type ?? (schema.properties ? "object" : "any");
  if (type === "array") return facts(doc, schema.items, `${at}[]`, out, depth + 1);
  if (type !== "object") { out.set(at, String(type)); return; }
  out.set(at, "object");
  for (const [name, p] of Object.entries((schema.properties ?? {}) as Obj)) {
    out.set(`${at}.${name} required`, (schema.required ?? []).includes(name) ? "yes" : "no");
    facts(doc, p as Obj, `${at}.${name}`, out, depth + 1);
  }
}

function contractFacts(doc: Obj): Map<string, string> {
  const out = new Map<string, string>();
  for (const { op, def } of operations(doc)) {
    out.set(op, "exists");
    facts(doc, def.requestBody?.content?.[JSON_TYPE]?.schema, `${op} request`, out);
    for (const [code, r] of Object.entries((def.responses ?? {}) as Obj)) {
      out.set(`${op} ${code}`, "exists");
      facts(doc, (r as Obj)?.content?.[JSON_TYPE]?.schema, `${op} ${code} body`, out);
    }
  }
  return out;
}

/** Where a built API's document differs from the contract: paths, methods, status codes and request/response fields. Empty when they match. */
export function contractDiff(contract: Obj, built: Obj): string[] {
  const want = contractFacts(contract), have = contractFacts(built);
  const out: string[] = [];
  // a missing operation or object is named once, not once per field under it
  const under = (k: string, gone: string[]) => gone.some((g) => k.startsWith(`${g} `) || k.startsWith(`${g}.`) || k.startsWith(`${g}[`));
  const missing: string[] = [], extra: string[] = [];
  for (const [k, v] of want) {
    if (!have.has(k)) { if (!under(k, missing)) { missing.push(k); out.push(`missing in the API: ${k}`); } }
    else if (have.get(k) !== v) out.push(`${k}: the contract says ${v}, the API has ${have.get(k)}`);
  }
  for (const k of have.keys()) if (!want.has(k) && !under(k, extra)) { extra.push(k); out.push(`not in the contract: ${k}`); }
  return out;
}

/** The API's own OpenAPI document, written by its build, says what the locked contract says. */
export const contractMatches = defineGate<{ contract: { text: string }; built: { text?: string; path: string; partial?: boolean } }>({
  id: "contract.matches", after: "implement", safety: false, waiver: "none",
  predicate: ({ contract, built }) => {
    const want = readContract(contract.text);
    if (!want) return verdict([failure("contract", "The locked contract is not an OpenAPI document")], "");
    const have = built.text === undefined ? undefined : readContract(built.text);
    if (!have) return verdict([failure("contract", `The build did not write the API's OpenAPI document at ${built.path}. Keep the project's build-time OpenAPI settings and the AddOpenApi() call.`)], "");
    // one task of several: an operation no task has built yet is not a mismatch; what is built must match, and nothing extra
    const diff = contractDiff(want, have).filter((d) => !built.partial || !/^missing in the API: [A-Z]+ \S+$/.test(d));
    return verdict(diff.slice(0, 20).map((d) => failure("contract", `The API does not match the locked contract: ${d}`)), "The API matches the locked contract");
  },
});
