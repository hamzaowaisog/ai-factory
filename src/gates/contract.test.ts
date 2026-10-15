import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { addToContract, contractAuthProblems, contractChange, contractDiff, contractGap, contractMatches, dataModelMatches, contractProblems, contractReadProblem, contractSummary, exampleProblems, readContract } from "./contract.js";
import { DEFAULT_POLICY } from "./policy.js";

// the document a .NET 9 minimal API wrote at build time, with no network (the spike of 2026-10-05)
const builtText = readFileSync(new URL("./fixtures/dotnet9-built.json", import.meta.url), "utf8");
const CONTRACT = `openapi: 3.0.3
info: { title: Clinic portal, version: "1" }
paths:
  /api/sign-in:
    post:
      operationId: signIn
      requestBody: { required: true, content: { application/json: { schema: { $ref: "#/components/schemas/SignIn" } } } }
      responses:
        "200": { description: signed in, content: { application/json: { schema: { $ref: "#/components/schemas/Session" }, example: { message: Signed in, userId: 1 } } } }
        "400": { description: bad email, content: { application/json: { schema: { $ref: "#/components/schemas/Problem" }, example: { error: Enter a valid email } } } }
  /api/appointments/today:
    get:
      operationId: listToday
      responses:
        "200":
          description: today's appointments
          content:
            application/json:
              schema: { type: array, items: { $ref: "#/components/schemas/Appointment" } }
              example: [{ id: 1, patient: Amina Yusuf, time: "09:30", status: Confirmed }]
components:
  schemas:
    SignIn: { type: object, required: [email], properties: { email: { type: string } } }
    Session: { type: object, required: [message, userId], properties: { message: { type: string }, userId: { type: integer } } }
    Problem: { type: object, required: [error], properties: { error: { type: string } } }
    Appointment: { type: object, required: [id, patient, time, status], properties: { id: { type: integer }, patient: { type: string }, time: { type: string }, status: { type: string } } }
`;
const contract = readContract(CONTRACT)!;
const built = () => JSON.parse(builtText) as Record<string, any>;
const gate = (b: string | undefined) => contractMatches.predicate({ contract: { text: CONTRACT }, built: { ...(b === undefined ? {} : { text: b }), path: "Api/openapi/built.json" } }, DEFAULT_POLICY);

describe("the locked API contract", () => {
  it("refuses an example that leaves out a required field or has another type, before the plan is approved (run b587)", () => {
    const doc = { openapi: "3.0.3", paths: {}, components: { schemas: { Plan: { type: "object", required: ["id", "total", "reconciled"], properties: {
      id: { type: "integer" }, total: { type: "number" }, reconciled: { type: "boolean" }, note: { type: "string", nullable: true }, lots: { type: "array", items: { $ref: "#/components/schemas/Lot" } } } },
      Lot: { type: "object", required: ["lb"], properties: { lb: { type: "number" } } } } } };
    const plan = { $ref: "#/components/schemas/Plan" };
    expect(exampleProblems(doc, plan, { id: 1, total: 2, reconciled: true, note: null, lots: [{ lb: 1.5 }] }, "example")).toEqual([]);
    expect(exampleProblems(doc, { type: "array", items: plan }, [{ id: 1, total: 2.5, lots: [{}] }], "example")).toEqual([
      "example[0] has no reconciled, which the schema requires", "example[0].lots[0] has no lb, which the schema requires"]);
    expect(exampleProblems(doc, plan, { id: "1", total: 2, reconciled: true }, "example")).toEqual(["example.id is a string, the schema says integer"]);
    const withBad = readContract(CONTRACT)!;
    const c = withBad.paths["/api/appointments/today"].get.responses["200"].content["application/json"];
    c.example = Array.isArray(c.example) ? [{}] : {};
    expect(contractProblems(withBad).join("\n")).toMatch(/GET \/api\/appointments\/today 200's example does not match its schema: .*which the schema requires/);
  });

  it("reads YAML or JSON, lists its operations for the card, and refuses what is not OpenAPI", () => {
    expect(contractSummary(contract)).toEqual(["POST /api/sign-in -> 200, 400", "GET /api/appointments/today -> 200"]);
    expect(readContract(builtText)).toBeTruthy();
    expect(readContract("just: text")).toBeUndefined();
    expect(readContract("{ not yaml")).toBeUndefined();
  });

  it("must be complete before it is locked: OpenAPI 3.0, an operationId and an example per JSON response", () => {
    expect(contractProblems(contract)).toEqual([]);
    const bad = readContract(CONTRACT.replace("openapi: 3.0.3", "openapi: 3.1.0").replace("      operationId: listToday\n", "").replace(", example: { error: Enter a valid email }", ""))!;
    expect(contractProblems(bad).join("\n")).toMatch(/OpenAPI 3\.1\.0[\s\S]*POST \/api\/sign-in 400 has no example[\s\S]*GET \/api\/appointments\/today has no operationId/);
  });

  it("the document a real .NET 9 build wrote matches: tags, descriptions and int32 formats are not differences", () => {
    expect(contractDiff(contract, built())).toEqual([]);
    expect(gate(builtText)).toMatchObject({ passed: true });
  });

  it("reads a contract's paths under its server: /requests under /api is the API's /api/requests (run e1b5)", () => {
    const under = { ...contract, servers: [{ url: "/api" }] };
    const api = built();
    api.servers = [{ url: "http://localhost:5000/" }];
    api.paths = Object.fromEntries(Object.entries(api.paths).map(([p, v]) => [`/api${p}`, v]));
    expect(contractDiff(under, api)).toEqual([]);
    expect(contractDiff(under, built()).some((d) => d.startsWith("not in the contract"))).toBe(true);
  });

  it("names a renamed field, a changed type, a missing status, a missing route and an extra route", () => {
    const renamed = built();
    const s = renamed.components.schemas.Appointment;
    s.properties.patientName = s.properties.patient; delete s.properties.patient; s.required = ["id", "patientName", "time", "status"];
    expect(contractDiff(contract, renamed)).toEqual([
      "missing in the API: GET /api/appointments/today 200 body[].patient required",
      "missing in the API: GET /api/appointments/today 200 body[].patient",
      "not in the contract: GET /api/appointments/today 200 body[].patientName required",
      "not in the contract: GET /api/appointments/today 200 body[].patientName",
    ]);
    const g = gate(JSON.stringify(renamed));
    expect(g.passed).toBe(false);
    expect(g.failures![0]!.message).toMatch(/does not match the locked contract: missing in the API: .*patient/);

    const typed = built(); typed.components.schemas.Session.properties.userId = { type: "string" };
    expect(contractDiff(contract, typed)).toEqual(["POST /api/sign-in 200 body.userId: the contract says integer, the API has string"]);
    const noStatus = built(); delete noStatus.paths["/api/sign-in"].post.responses["400"];
    expect(contractDiff(contract, noStatus)).toEqual(["missing in the API: POST /api/sign-in 400"]);
    const noRoute = built(); delete noRoute.paths["/api/appointments/today"];
    expect(contractDiff(contract, noRoute)).toEqual(["missing in the API: GET /api/appointments/today"]);
    // a task that is not the last: the route it has not built yet is not a mismatch, but a wrong field in a built one still is
    const part = (b: Record<string, any>) => contractMatches.predicate({ contract: { text: CONTRACT }, built: { text: JSON.stringify(b), path: "x", partial: true } }, DEFAULT_POLICY).passed;
    expect(part(noRoute)).toBe(true);
    expect(part(noStatus)).toBe(false);
    expect(gate(JSON.stringify(noRoute)).passed).toBe(false);
    const more = built(); more.paths["/api/extra"] = { get: { responses: { "200": { description: "OK" } } } };
    expect(contractDiff(contract, more)).toEqual(["not in the contract: GET /api/extra"]);
  });

  it("reads a shared answer, a shared request body and allOf around a pointer as what they point at (runs e8ef, e1b5)", () => {
    // the same contract as CONTRACT, written the way planners write it: the 400 answer and the request body kept once under
    // components, and a field's type given as allOf around a pointer so it can carry a description
    const shared = readContract(CONTRACT)!;
    const post = shared.paths["/api/sign-in"].post;
    shared.components.responses = { BadEmail: post.responses["400"] };
    post.responses["400"] = { $ref: "#/components/responses/BadEmail" };
    shared.components.requestBodies = { SignIn: post.requestBody };
    post.requestBody = { $ref: "#/components/requestBodies/SignIn" };
    shared.components.schemas.Status = { type: "string" };
    shared.components.schemas.Appointment.properties.status = { allOf: [{ $ref: "#/components/schemas/Status" }], description: "Confirmed or not" };
    // an API that says what the contract says matches, either way round
    expect(contractDiff(shared, built())).toEqual([]);
    expect(contractDiff(contract, shared)).toEqual([]);
    expect(contractProblems(shared)).toEqual([]);
    // and the shared answer's body is held: an API that declares the status with no body does not match
    const noBody = built();
    delete noBody.paths["/api/sign-in"].post.responses["400"].content;
    expect(contractDiff(shared, noBody)).toEqual(["missing in the API: POST /api/sign-in 400 body"]);
    // a nullable pointer written as oneOf with "or null" is the type it points at
    const nullable = built();
    nullable.components.schemas.Appointment.properties.status = { oneOf: [{ nullable: true }, { $ref: "#/components/schemas/Status" }] };
    nullable.components.schemas.Status = { type: "string" };
    expect(contractDiff(shared, nullable)).toEqual([]);
  });

  it("reads .NET's pointer to a list's items inside the same schema as that list's items (run 768d, 4 attempts)", () => {
    const doc = (second: object) => JSON.stringify({ openapi: "3.0.1", info: { title: "a", version: "1" },
      paths: { "/load": { post: { operationId: "load", responses: { "200": { description: "ok", content: { "application/json": { schema: { $ref: "#/components/schemas/Load" } } } } } } } },
      components: { schemas: { Outcome: { type: "object", properties: { id: { type: "integer" } } },
        Load: { type: "object", properties: { added: { type: "array", items: { $ref: "#/components/schemas/Outcome" } }, failed: { type: "array", items: second } } } } } });
    const contract = readContract(doc({ $ref: "#/components/schemas/Outcome" }))!;
    expect(contractDiff(contract, readContract(doc({ $ref: "#/components/schemas/#/properties/added/items" }))!)).toEqual([]);
  });

  it("reads a field given only as a list of allowed values as the type of those values (run e8ef, TASK-1 attempt 4)", () => {
    // a .NET enum field comes out of the build as { enum: [...] } with no type; the contract says string
    const listed = built();
    listed.components.schemas.Appointment.properties.status = { enum: ["Confirmed", "Cancelled"] };
    expect(contractDiff(contract, listed)).toEqual([]);
    // values of another type are still a difference, and a list of mixed types is no type at all
    const numbers = built();
    numbers.components.schemas.Appointment.properties.status = { enum: [0, 1] };
    expect(contractDiff(contract, numbers)).toEqual(["GET /api/appointments/today 200 body[].status: the contract says string, the API has integer"]);
    const mixed = built();
    mixed.components.schemas.Appointment.properties.status = { enum: ["Confirmed", 1] };
    expect(contractDiff(contract, mixed)).toEqual(["GET /api/appointments/today 200 body[].status: the contract says string, the API has any"]);
  });

  it("says how much it compared, so a pass can be told from a pass on nothing", () => {
    expect(gate(builtText)).toMatchObject({ passed: true, facts: { operationsInContract: 2, operationsInApi: 2, differences: 0, partial: false } });
  });

  it("fails plainly when the build wrote no document", () => {
    expect(gate(undefined)).toMatchObject({ passed: false, details: expect.stringMatching(/did not write the API's OpenAPI document at Api\/openapi\/built\.json/) });
  });
});

describe("why a text is not an OpenAPI document", () => {
  it("gives the parser's message with the line that broke", () => {
    const broken = "openapi: 3.0.3\npaths:\n  /a: {get: }}\n  /b: {}\n";
    expect(readContract(broken)).toBeUndefined();
    const why = contractReadProblem(broken)!;
    expect(why).toMatch(/^it does not parse at line 3: /);
    expect(why).toContain("(the line reads: /a: {get: }})");
  });

  it("names the missing top-level key, and says nothing of a document that reads", () => {
    expect(contractReadProblem("paths: {}\n")).toMatch(/no top-level "openapi"/);
    expect(contractReadProblem('openapi: "3.0.3"\n')).toBe('it has no top-level "paths"');
    expect(contractReadProblem("- a\n- b\n")).toMatch(/not a mapping/);
    expect(contractReadProblem('openapi: "3.0.3"\npaths: {}\n')).toBeUndefined();
  });
  it("lists for the coding agent the details the gate leaves out: operation ids, parameters, enum values, nullable fields", () => {
    const doc = (o: { id: string; status: Record<string, unknown>; param: Record<string, unknown>; note: Record<string, unknown> }) => JSON.stringify({
      openapi: "3.0.3", info: { title: "t", version: "1" },
      paths: { "/visits": { get: { operationId: o.id, parameters: [o.param], responses: { "200": { description: "ok", content: { "application/json": { schema: { type: "object", required: ["status"], properties: { status: o.status, note: o.note } } } } } } } } },
    });
    const want = doc({ id: "listVisits", status: { type: "string", enum: ["Booked", "Cancelled"] }, param: { name: "day", in: "query", required: true, schema: { type: "string" } }, note: { type: "string", nullable: true } });
    const have = doc({ id: "ListVisits", status: { type: "string" }, param: { name: "day", in: "query", schema: { type: "string" } }, note: { type: "string" } });
    // the gate's comparison sees no difference; the agent's list names all four
    expect(contractDiff(readContract(want)!, readContract(have)!)).toEqual([]);
    expect(contractGap(want, have)).toEqual([
      "GET /visits operationId: the contract says listVisits, the API has ListVisits",
      "GET /visits parameter day (query): the contract says string, required, the API has string, optional",
      "missing in the API: GET /visits 200 body.status values",
      "GET /visits 200 body.note nullable: the contract says yes, the API has no",
    ]);
    expect(contractGap(want, want)).toEqual([]);
    expect(contractGap(want, undefined)).toBeUndefined();
    // the real .NET 9 document against its contract: still no difference the gate would miss being reported as noise
    expect(contractGap(CONTRACT, builtText)!.filter((d) => !/operationId|nullable/.test(d))).toEqual(contractDiff(contract, built()));
  });
});

describe("the built database against the approved data model: what an existing backend already had", () => {
  const t = (name: string, change = "new") => ({ name, purpose: "", change, columns: [{ name: "Id", type: "int", required: true, pk: true }], uniques: [] });
  const text = (tables: unknown[]) => JSON.stringify({ tables });
  const gate = (model: unknown[], built: Record<string, unknown>) => dataModelMatches.predicate({ model: { text: text(model) }, built }, DEFAULT_POLICY);
  const db = (...names: string[]) => ({ tables: names.map((n) => t(n)) });

  it("fails on a table this run made that the model does not name, and not on one that was there before the run", () => {
    // a new product: nothing was there before, so any other table is this run's
    expect(gate([t("Orders")], { model: db("Orders", "Audit"), before: [] }).details).toMatch(/Table Audit is in the database but not in the model/);
    // an existing backend: Users and Audit were there already, Scratch is this run's
    const r = gate([t("Orders")], { model: db("Orders", "users", "Audit", "Scratch"), before: ["Users", "Audit"] });
    expect(r.failures).toHaveLength(1);
    expect(r.details).toMatch(/Table Scratch is in the database but not in the model/);
  });

  it("when what was there before is not known, holds only a model of all-new tables to no other table", () => {
    expect(gate([t("Orders")], { model: db("Orders", "Audit") }).passed).toBe(false);
    expect(gate([t("Orders"), t("Users", "unchanged")], { model: db("Orders", "Users", "Audit") }).passed).toBe(true);
  });

  it("does not hold a backend to creating its database on startup when it never did", () => {
    expect(gate([t("Orders")], { note: "the app started but created no SQLite database file on startup" }).passed).toBe(false);
    const r = gate([t("Orders")], { note: "the app started but created no SQLite database file on startup", noDatabaseBefore: true });
    expect(r.passed).toBe(true);
    expect(r.details).toMatch(/Not compared: the code before this run created no database on startup either/);
  });
});

describe("adding to a locked contract (run 3406)", () => {
  const LOCKED = `openapi: 3.0.3
info: { title: Orders, version: "1" }
# the orders API: comments and layout stay
paths:
  /accounts:
    get:
      operationId: listAccounts
      responses:
        "200": { description: ok, content: { application/json: { schema: { $ref: "#/components/schemas/Account" }, example: { id: 1 } } } }
components:
  schemas:
    Account: { type: object, required: [id], properties: { id: { type: integer } } }
`;
  const SIGN_UP = `paths:
  /auth/sign-up:
    post:
      operationId: signUp
      security: []
      requestBody: { required: true, content: { application/json: { schema: { $ref: "#/components/schemas/SignUp" } } } }
      responses:
        "201": { description: created, content: { application/json: { schema: { $ref: "#/components/schemas/Account" }, example: { id: 2 } } } }
components:
  schemas:
    SignUp: { type: object, required: [email], properties: { email: { type: string } } }
`;

  it("adds new operations and schemas, keeps the rest of the file as it was, and reports only additions", () => {
    const r = addToContract(LOCKED, SIGN_UP);
    expect(r.problems).toEqual([]);
    expect(r.text).toContain("# the orders API: comments and layout stay");
    const doc = readContract(r.text)!;
    expect(contractProblems(doc)).toEqual([]);
    expect(contractChange(readContract(LOCKED)!, doc)).toEqual({ added: ["POST /auth/sign-up"], changed: [] });
    // a new method on a path that is already there is an addition too
    const r2 = addToContract(LOCKED, `paths:\n  /accounts:\n    post: { operationId: createAccount, responses: { "201": { description: created } } }\n`);
    expect(r2.problems).toEqual([]);
    expect(contractChange(readContract(LOCKED)!, readContract(r2.text)!).added).toEqual(["POST /accounts"]);
  });

  it("refuses to replace an operation or a component that is already there", () => {
    const r = addToContract(LOCKED, `paths:\n  /accounts:\n    get: { operationId: listAll, responses: { "200": { description: ok } } }\ncomponents:\n  schemas:\n    Account: { type: object }\n`);
    expect(r.problems.join("\n")).toMatch(/GET \/accounts is already in the contract/);
    expect(r.problems.join("\n")).toMatch(/components.schemas.Account is already in the contract with other content/);
    expect(addToContract(LOCKED, "info: {}").problems[0]).toMatch(/needs "paths"/);
  });

  it("names every change to an operation that was already there", () => {
    const before = readContract(LOCKED)!;
    const after = readContract(LOCKED.replace("operationId: listAccounts", "operationId: accounts").replace('"200":', '"201":'))!;
    const c = contractChange(before, after);
    expect(c.added).toEqual([]);
    expect(c.changed.join("\n")).toMatch(/GET \/accounts operationId: was listAccounts, now accounts/);
    expect(c.changed.join("\n")).toMatch(/removed: GET \/accounts 200/);
    expect(c.changed.join("\n")).toMatch(/added to an operation already in the contract: GET \/accounts 201/);
  });
});

describe("a contract that needs a login says how to get one", () => {
  const doc = (extra: string) => readContract(`openapi: 3.0.3
info:
  title: Shop
  version: "1"
security:
  - bearer: []
components:
  securitySchemes:
    bearer:
      type: http
      scheme: bearer
paths:
  /orders:
    get:
      operationId: listOrders
      responses:
        "200":
          description: ok
${extra}`)!;
  it("fails with no open sign-up or log-in", () => {
    expect(contractAuthProblems(doc(""))[0]).toMatch(/sign up or log in/);
  });
  it("fails when the log-in itself needs a login", () => {
    const d = doc(`  /auth/register:
    post:
      operationId: register
      security: []
      responses:
        "201":
          description: ok
  /auth/login:
    post:
      operationId: login
      responses:
        "200":
          description: ok
`);
    expect(contractAuthProblems(d)[0]).toMatch(/log in: add POST \/auth\/login/);
  });
  it("passes with open register and login, or with no login at all", () => {
    const d = doc(`  /auth/register:
    post:
      operationId: register
      security: []
      responses:
        "201":
          description: ok
  /auth/login:
    post:
      operationId: login
      security: []
      responses:
        "200":
          description: ok
`);
    expect(contractAuthProblems(d)).toEqual([]);
    expect(contractAuthProblems(readContract(`openapi: 3.0.3
info:
  title: Shop
  version: "1"
paths:
  /orders:
    get:
      operationId: listOrders
      responses:
        "200":
          description: ok
`)!)).toEqual([]);
  });
});
