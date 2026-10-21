// The locked API contract (an OpenAPI document written at plan time and approved on the plan card): what it says, and whether
// the document a built API produces says the same. Pure code: no model, no network.
import { DataModel } from "../contracts/index.js";
import { DATA_MODEL_FILE, dataModelDiff } from "./data-model.js";
import { parse, parseDocument } from "yaml";
import { defineGate, failure, verdict } from "./engine.js";

type Obj = Record<string, any>;
const METHODS = ["get", "put", "post", "delete", "patch"];
const JSON_TYPE = "application/json";

/** The document as an object (YAML or JSON), or undefined when it is not an OpenAPI document. */
export function readContract(text: string): Obj | undefined {
  try {
    const d = parse(text) as Obj;
    if (!(d && typeof d === "object" && typeof d.openapi === "string" && d.paths && typeof d.paths === "object")) return undefined;
    for (const [name, s] of Object.entries((d.components?.schemas ?? {}) as Obj)) selfRefs(s, `#/components/schemas/${name}/`);
    return d;
  } catch { return undefined; }
}

/**
 * .NET's generator writes a second use of one type inside a schema as "#/components/schemas/#/properties/a/items", meaning
 * "#/properties/a/items" of that schema (run 768d: list fields read as missing on 4 attempts). Written out in full, it resolves.
 */
function selfRefs(o: unknown, at: string): void {
  if (!o || typeof o !== "object") return;
  const x = o as Obj;
  if (typeof x.$ref === "string" && x.$ref.startsWith("#/components/schemas/#/")) x.$ref = at + x.$ref.slice("#/components/schemas/#/".length);
  for (const v of Object.values(x)) selfRefs(v, at);
}

/**
 * Why a text is not an OpenAPI document, in words its writer can act on: the parser's own message with the line and the text
 * of that line, or the top-level key that is missing. Undefined when it is one.
 */
export function contractReadProblem(text: string): string | undefined {
  let d: unknown;
  try { d = parse(text); } catch (e) {
    const err = e as { message?: string; linePos?: { line: number; col: number }[] };
    const line = err.linePos?.[0]?.line;
    const first = String(err.message ?? e).split("\n")[0]!.replace(/\s+at line \d+, column \d+:?\s*$/, "").trim();
    const src = line ? text.split("\n")[line - 1]?.trim().slice(0, 120) : undefined;
    return `it does not parse${line ? ` at line ${line}` : ""}: ${first}${src ? ` (the line reads: ${src})` : ""}`;
  }
  if (!d || typeof d !== "object" || Array.isArray(d)) return "it is not a mapping: an OpenAPI document starts with the keys \"openapi\" and \"paths\"";
  const o = d as Obj;
  const missing = [typeof o.openapi === "string" ? "" : "\"openapi\" (a version string such as \"3.0.3\")", o.paths && typeof o.paths === "object" ? "" : "\"paths\""].filter(Boolean);
  return missing.length ? `it has no top-level ${missing.join(" or ")}` : undefined;
}

/**
 * The path every operation of a document sits under: its first server's path ("/api" of `servers: [{ url: /api }]`, or of
 * a full address), "" when it has none. A contract with paths under a server and an API that maps the full paths are the
 * same routes: read without it, a correct API was told GET /api/requests is not in the contract (run e1b5).
 */
export function basePath(doc: Obj): string {
  const url = (doc.servers as Obj[] | undefined)?.[0]?.url;
  if (typeof url !== "string") return "";
  let path = url;
  if (!url.startsWith("/")) { try { path = new URL(url).pathname; } catch { return ""; } }
  return path.replace(/\/+$/, "");
}

const operations = (doc: Obj): { op: string; def: Obj }[] => {
  const base = basePath(doc);
  return Object.entries(doc.paths as Obj).flatMap(([path, item]) => METHODS.filter((m) => (item as Obj)?.[m]).map((m) => ({ op: `${m.toUpperCase()} ${base}${path}`, def: (item as Obj)[m] as Obj })));
};

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
      const c = deref(doc, r as Obj)?.content?.[JSON_TYPE] as Obj | undefined;
      if (c && c.example === undefined && !c.examples) bad.push(`${op} ${code} has no example (the frontend's tests run against it).`);
      // the generated test handlers answer with the example, typed by the schema: one that leaves out a required field does not
      // compile, and was found only when the test writers had been paid for (run b587)
      const examples = c ? (c.example !== undefined ? [c.example] : Object.values((c.examples ?? {}) as Obj).map((x) => (x as Obj)?.value)) : [];
      const wrong = examples.flatMap((x) => (x === undefined ? [] : exampleProblems(doc, c!.schema, x, "example")));
      if (wrong.length) bad.push(`${op} ${code}'s example does not match its schema: ${[...new Set(wrong)].slice(0, 5).join("; ")}. Give every example every field its schema requires, with the schema's types.`);
    }
  }
  return bad;
}

/** A security requirement list that asks for something: [] or [{}] asks for none. */
const asksLogin = (sec: unknown): boolean => Array.isArray(sec) && sec.some((r) => r && typeof r === "object" && Object.keys(r).length > 0);
const SIGN_IN_OP = /log-?in|sign-?in|token|sessions?\b|authenticate/i;
const SIGN_UP_OP = /sign-?up|register|registration/i;

/**
 * A new product's contract that needs a login must also say how to get one: an open (no login) POST to sign up and one to log
 * in. A greenfield run built JWT checks on every operation and no way to get a token, so every call failed.
 */
export function contractAuthProblems(doc: Obj): string[] {
  const base = basePath(doc);
  const ops = Object.entries((doc.paths ?? {}) as Obj).flatMap(([path, item]) => METHODS.filter((m) => (item as Obj)?.[m]).map((m) => ({ m, path, def: (item as Obj)[m] as Obj })));
  const needs = (def: Obj) => (def.security !== undefined ? asksLogin(def.security) : asksLogin(doc.security));
  if (!ops.some((o) => needs(o.def))) return [];
  const open = ops.filter((o) => o.m === "post" && !needs(o.def));
  const named = (re: RegExp) => open.some((o) => re.test(o.path) || re.test(String(o.def.operationId ?? "")));
  const missing = [...(named(SIGN_UP_OP) ? [] : [`POST ${base}/auth/register (operationId register)`]), ...(named(SIGN_IN_OP) ? [] : [`POST ${base}/auth/login (operationId login, answering with the token)`])];
  return missing.length
    ? [`The contract asks for a login on its operations, but has no open operation to ${missing.length === 2 ? "sign up or log in" : missing[0]!.includes("register") ? "sign up" : "log in"}: add ${missing.join(" and ")}, each with "security: []", or every call that needs a login fails.`]
    : [];
}

/** Where an example differs from its schema: a required field it leaves out, or a value of another type. */
export function exampleProblems(doc: Obj, schema: Obj | undefined, value: unknown, at: string, depth = 0): string[] {
  const s = whole(doc, schema);
  if (!s || depth > 12) return [];
  if (value === null) return s.nullable === true || s.type === "null" || (Array.isArray(s.type) && s.type.includes("null")) ? [] : [`${at} is null and the schema does not allow it`];
  const type = Array.isArray(s.type) ? s.type.find((t: string) => t !== "null") : s.type ?? (s.properties ? "object" : undefined);
  const kind = Array.isArray(value) ? "array" : typeof value === "number" ? (Number.isInteger(value) ? "integer" : "number") : typeof value;
  if (type && !(type === kind || (type === "number" && kind === "integer"))) return [`${at} is ${kind === "object" ? "an object" : `${kind === "array" ? "a list" : `a ${kind}`}`}, the schema says ${type}`];
  if (kind === "array") return (value as unknown[]).slice(0, 3).flatMap((v, i) => exampleProblems(doc, s.items, v, `${at}[${i}]`, depth + 1));
  if (kind !== "object") return [];
  const o = value as Obj;
  const missing = ((s.required ?? []) as string[]).filter((k) => !(k in o)).map((k) => `${at} has no ${k}, which the schema requires`);
  return [...missing, ...Object.entries((s.properties ?? {}) as Obj).filter(([k]) => k in o).flatMap(([k, p]) => exampleProblems(doc, p as Obj, o[k], `${at}.${k}`, depth + 1))];
}

/** What a "$ref" points at, followed to its end: a schema, or a whole answer, request body or parameter kept under components. */
function deref(doc: Obj, o: Obj | undefined): Obj | undefined {
  for (let i = 0; o && typeof o.$ref === "string" && i < 12; i++) o = o.$ref.split("/").slice(1).reduce((x: Obj | undefined, k: string) => x?.[k], doc);
  return o;
}

/**
 * A schema with its wrappers taken off, so both ways of writing one thing read the same: "allOf" around a pointer (how a
 * contract adds a description to a shared type) is that type, several "allOf" parts are one object, and "oneOf"/"anyOf" with
 * one real member (the other says only "or null") is that member.
 */
function whole(doc: Obj, schema: Obj | undefined, depth = 0): Obj | undefined {
  const s = deref(doc, schema);
  if (!s || depth > 12) return s;
  if (Array.isArray(s.allOf) && s.allOf.length) {
    const parts = s.allOf.map((p: Obj) => whole(doc, p, depth + 1) ?? {});
    const { allOf: _, ...own } = s;
    return { ...Object.assign({}, ...parts), ...own, properties: Object.assign({}, ...parts.map((p: Obj) => p.properties), own.properties), required: [...parts.flatMap((p: Obj) => p.required ?? []), ...(own.required ?? [])] };
  }
  const real = (s.oneOf ?? s.anyOf)?.filter((m: Obj) => m?.type !== "null" && !(m && Object.keys(m).every((k) => k === "nullable")));
  if (s.type === undefined && !s.properties && real?.length === 1) return whole(doc, real[0], depth + 1);
  return s;
}

/** The one type every value of an enum has, when it has one: "string", "integer", "number" or "boolean". */
function enumType(values: unknown): string | undefined {
  if (!Array.isArray(values)) return undefined;
  const real = values.filter((v) => v !== null);
  const kinds = new Set(real.map((v) => (typeof v === "number" ? (Number.isInteger(v) ? "integer" : "number") : typeof v)));
  if (kinds.size === 2 && kinds.has("integer") && kinds.has("number")) return "number";
  const [only] = kinds;
  return real.length && kinds.size === 1 && (only === "string" || only === "integer" || only === "number" || only === "boolean") ? only : undefined;
}

/** A schema as flat facts ("body.items[].id" -> "integer"), following $ref; what a generator adds (format, description) is left out. */
function facts(doc: Obj, schema: Obj | undefined, at: string, out: Map<string, string>, depth = 0, detail = false): void {
  schema = whole(doc, schema);
  if (!schema || depth > 12) return;
  // a list of allowed values with no type (how .NET writes an enum sent as text) has the type its values have (run e8ef:
  // `role` was { enum: ["employee", "administrator"] } and was read as "any" against the contract's "string")
  const type = Array.isArray(schema.type) ? [...schema.type].sort().join("|") : schema.type ?? (schema.properties ? "object" : enumType(schema.enum) ?? "any");
  if (type === "array") return facts(doc, schema.items, `${at}[]`, out, depth + 1, detail);
  if (detail && Array.isArray(schema.enum)) out.set(`${at} values`, schema.enum.map(String).sort().join(", "));
  if (detail && at.includes(".")) out.set(`${at} nullable`, schema.nullable === true ? "yes" : "no");
  if (type !== "object") { out.set(at, String(type)); return; }
  out.set(at, "object");
  for (const [name, p] of Object.entries((schema.properties ?? {}) as Obj)) {
    out.set(`${at}.${name} required`, (schema.required ?? []).includes(name) ? "yes" : "no");
    facts(doc, p as Obj, `${at}.${name}`, out, depth + 1, detail);
  }
}

function contractFacts(doc: Obj, detail = false): Map<string, string> {
  const out = new Map<string, string>();
  for (const { op, def } of operations(doc)) {
    out.set(op, "exists");
    if (detail) {
      out.set(`${op} operationId`, String(def.operationId ?? "none"));
      for (const p of ((def.parameters ?? []) as Obj[]).map((x) => deref(doc, x) ?? {})) out.set(`${op} parameter ${p.name} (${p.in})`, `${whole(doc, p.schema)?.type ?? "any"}, ${p.required ? "required" : "optional"}`);
    }
    // an answer or a request body may be a pointer to a shared one under components (run e8ef: 53 shared error answers were read as having no body)
    facts(doc, deref(doc, def.requestBody)?.content?.[JSON_TYPE]?.schema, `${op} request`, out, 0, detail);
    for (const [code, r] of Object.entries((def.responses ?? {}) as Obj)) {
      out.set(`${op} ${code}`, "exists");
      facts(doc, deref(doc, r as Obj)?.content?.[JSON_TYPE]?.schema, `${op} ${code} body`, out, 0, detail);
    }
  }
  return out;
}

/**
 * Where a built API's document differs from the contract: paths, methods, status codes and request/response fields. Empty when they match.
 * `detail` adds what the gate does not hold the API to but a run's own contract tests usually do: operation ids, parameters,
 * enum values and nullable fields. It is for the coding agent's list (contractGap), never for the gate.
 */
export function contractDiff(contract: Obj, built: Obj, detail = false): string[] {
  const want = contractFacts(contract, detail), have = contractFacts(built, detail);
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

/**
 * A locked contract with a plan's new operations added: `additions` is YAML (or JSON) with `paths` (the new operations) and,
 * when they need them, new `components` (schemas, responses, parameters, request bodies). Only what is not there yet goes in:
 * an operation, or a component of the same name with other content, already in the contract is a problem, not a replacement.
 * The rest of the file keeps its own layout and comments, so the change reads as an addition in the pull request.
 */
export function addToContract(contractText: string, additions: string): { text: string; problems: string[] } {
  let add: Obj;
  try { add = parse(additions) as Obj; } catch (e) { return { text: contractText, problems: [`contractAdditions is not YAML: ${(e as Error).message.split("\n")[0]}`] }; }
  if (!add || typeof add !== "object" || !add.paths || typeof add.paths !== "object") return { text: contractText, problems: ['contractAdditions needs "paths": the new operations, under their paths'] };
  const json = contractText.trimStart().startsWith("{");
  const doc = json ? undefined : parseDocument(contractText);
  const old = (json ? JSON.parse(contractText) : doc!.toJS()) as Obj;
  const problems: string[] = [];
  const put = (keys: string[], value: unknown) => {
    if (doc) doc.setIn(keys, doc.createNode(value));
    else { let o = old; for (const k of keys.slice(0, -1)) o = (o[k] ??= {}); o[keys.at(-1)!] = value; }
  };
  for (const [path, item] of Object.entries(add.paths as Obj)) {
    const had = (old.paths as Obj | undefined)?.[path] as Obj | undefined;
    for (const m of METHODS.filter((m) => (item as Obj)?.[m])) {
      if (had?.[m]) problems.push(`${m.toUpperCase()} ${path} is already in the contract: give only new operations; one already there stays as it is`);
      else put(["paths", path, m], (item as Obj)[m]);
    }
  }
  for (const [kind, named] of Object.entries((add.components ?? {}) as Obj)) {
    for (const [name, value] of Object.entries((named ?? {}) as Obj)) {
      const had = (old.components as Obj | undefined)?.[kind]?.[name];
      if (had === undefined) put(["components", kind, name], value);
      else if (JSON.stringify(had) !== JSON.stringify(value)) problems.push(`components.${kind}.${name} is already in the contract with other content: give the new one another name`);
    }
  }
  return { text: doc ? doc.toString({ lineWidth: 0 }) : JSON.stringify(old, null, 2) + "\n", problems };
}

/**
 * What a brownfield plan's new version of a locked contract does to it: the operations it adds, and everything else it
 * changes (an operation removed, a field, status code, parameter or operation id changed or added to an operation that was
 * already there). The web app is built against the old version, so only `added` may pass without the spec asking for it
 * (run 3406: an auth flow needed four operations the locked contract lacked, and the plan could not give them).
 */
export function contractChange(before: Obj, after: Obj): { added: string[]; changed: string[] } {
  const was = contractFacts(before, true), now = contractFacts(after, true);
  const oldOps = new Set(operations(before).map((o) => o.op));
  const added = operations(after).map((o) => o.op).filter((op) => !oldOps.has(op));
  const under = (k: string, ops: string[]) => ops.some((g) => k === g || k.startsWith(`${g} `) || k.startsWith(`${g}.`) || k.startsWith(`${g}[`));
  const changed: string[] = [], removed: string[] = [];
  for (const [k, v] of was) {
    if (!now.has(k)) { if (!under(k, removed)) { removed.push(k); changed.push(`removed: ${k}`); } }
    else if (now.get(k) !== v) changed.push(`${k}: was ${v}, now ${now.get(k)}`);
  }
  const grown: string[] = [];
  for (const k of now.keys()) if (!was.has(k) && !under(k, added) && !under(k, grown)) { grown.push(k); changed.push(`added to an operation already in the contract: ${k}`); }
  return { added, changed };
}

/** An operation that declares no request body and no answer with a body: what an interface stub looks like in the built document. */
const isStub = (doc: Obj, def: Obj): boolean =>
  !deref(doc, def.requestBody)?.content && Object.values((def.responses ?? {}) as Obj).every((r) => !deref(doc, r as Obj)?.content);

/** The API's own OpenAPI document, written by its build, says what the locked contract says. */
export const contractMatches = defineGate<{ contract: { text: string }; built: { text?: string; path: string; partial?: boolean } }>({
  id: "contract.matches", after: "implement", safety: false, waiver: "none",
  predicate: ({ contract, built }) => {
    const want = readContract(contract.text);
    if (!want) return verdict([failure("contract", "The locked contract is not an OpenAPI document")], "");
    const have = built.text === undefined ? undefined : readContract(built.text);
    if (!have) return verdict([failure("contract", `The build did not write the API's OpenAPI document at ${built.path}. Keep the project's build-time OpenAPI settings and the AddOpenApi() call.`)], "");
    // one task of several: an operation no task has built yet is not a mismatch; what is built must match, and nothing extra
    const all = contractDiff(want, have);
    // a stub is not built yet either: the interface stubs put every operation in the API from the start, with no body or request
    // declared (run 9071: each task lost its first attempt to a later task's stubbed operations, "missing … 200 body / 401")
    const planned = new Set(operations(want).map(({ op }) => op));
    const stubs = built.partial ? operations(have).filter(({ op, def }) => planned.has(op) && isStub(have, def)).map(({ op }) => op) : [];
    const ofStub = (d: string) => { const k = d.replace(/^(missing in the API|not in the contract): /, ""); return stubs.some((s) => k === s || k.startsWith(`${s} `)); };
    const diff = all.filter((d) => !built.partial || (!/^missing in the API: [A-Z]+ \S+$/.test(d) && !ofStub(d)));
    const inContract = operations(want).length, inApi = operations(have).length;
    return {
      ...verdict(diff.slice(0, 20).map((d) => failure("contract", `The API does not match the locked contract: ${d}`)), "The API matches the locked contract"),
      // what was compared, so a pass can be told from a check that had little to look at
      facts: { operationsInContract: inContract, operationsInApi: inApi, notBuiltYetLeftOut: all.length - diff.length, differences: diff.length, differencesShown: Math.min(diff.length, 20), partial: !!built.partial },
    };
  },
});

/** What is left between a built document and the contract, in full detail, for the coding agent to work down. */
export function contractGap(contractText: string, builtText: string | undefined): string[] | undefined {
  const want = readContract(contractText), have = builtText ? readContract(builtText) : undefined;
  return want && have ? contractDiff(want, have, true) : undefined;
}

/** A difference a single task cannot be blamed for: something the model has that the database lacks may be another task's to build. */
const EXTRA_TABLE = /^Table (.+) is in the database but not in the model$/;
const NOT_BUILT_YET = /is in the model but not in the database$|the database has no foreign key there$|, the database does not$/;

/**
 * The database the built app creates has the tables, keys and relations of the approved data model. A column the model does
 * not name is allowed (code may keep its own bookkeeping); a task checks only that what exists so far is not wrong.
 */
export const dataModelMatches = defineGate<{ model: { text: string }; built: { model?: unknown; file?: string; note?: string; partial?: boolean; before?: string[]; noDatabaseBefore?: boolean; /** no approved model: `model` is the database as it was before the run */ asBefore?: boolean } }>({
  id: "data-model.matches", after: "implement", safety: false, waiver: "none",
  predicate: ({ model, built }) => {
    let want: ReturnType<typeof DataModel.safeParse>;
    try { want = DataModel.safeParse(parse(model.text)); } catch { return verdict([failure("data-model", `${DATA_MODEL_FILE} is not a data model`)], ""); }
    if (!want.success) return verdict([failure("data-model", `${DATA_MODEL_FILE} is not a data model`)], "");
    const have = DataModel.safeParse(built.model);
    if (!have.success) {
      if (built.partial) return verdict([], `No database to compare yet (${built.note ?? "none read"})`);
      // an existing backend that never made its database on startup (migrations run some other way): nothing to compare, and not this run's to change
      if (built.noDatabaseBefore) return verdict([], `Not compared: the code before this run created no database on startup either (${built.note ?? "none read"})`);
      return verdict([failure("data-model", `The database could not be compared with ${built.asBefore ? "what it was before this run" : "the approved data model"}: ${built.note ?? "no schema was read"}. The database must come from the code: created when the app starts (for example EnsureCreated or Migrate in startup) or by the repo's EF Core migrations, in the project's own database (a SQLite file, or the PostgreSQL connection it is given).`)], "");
    }
    // a table the model does not name fails only when this run made it: one that was there before the run is the backend's own.
    // When what was there before is not known, only a model of all-new tables (a new product) is held to "no other table".
    const before = built.before?.map((t) => t.toLowerCase());
    const allNew = want.data.tables.every((t) => t.change === "new");
    const own = (d: string) => { const t = EXTRA_TABLE.exec(d)?.[1]?.toLowerCase(); return t !== undefined && (before ? before.includes(t) : !allNew); };
    const diff = dataModelDiff(want.data, have.data).differences.filter((d) => !own(d) && (!built.partial || !NOT_BUILT_YET.test(d)));
    if (built.asBefore) {
      const said = (d: string) => d.replace(/\bthe model\b/g, "the database before this run").replace(/\bin the model\b/g, "in the database before this run").replace(/\bthe database\b(?! before)/g, "the database now");
      return verdict(diff.slice(0, 20).map((d) => failure("data-model", `This plan has no data model, so the database must stay as it was, and it did not: ${said(d)}. A change to stored data needs a plan that says so (its data model is approved with it).`)), `The database (${built.file ?? "built"}) has the tables, keys and relations it had before this run`);
    }
    return verdict(diff.slice(0, 20).map((d) => failure("data-model", `The database does not match the approved data model: ${d}`)), `The database (${built.file ?? "built"}) matches the approved data model`);
  },
});
