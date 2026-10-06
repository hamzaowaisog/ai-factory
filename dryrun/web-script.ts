// The web side's scripted model answers and coding agents, for the wrapper's dry run.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentScript } from "../src/runners/claude-agent.js";

// ---------- scripted answers: two screens, two requirements, two tasks ----------
const theme = { mood: "calm clinical", mode: "light", brand: "#1f6feb", neutral: "cool", chrome: "plain", font: "sans", radius: "soft", density: "comfortable", surface: "flat", motion: "lively", reading: { users: "clinic staff", context: "at a desk all day", device: "web", tone: "calm", hero: "the day's appointments", traits: ["dense", "quiet"] }, basis: [{ ref: "Linear", took: "hairlines" }, { ref: "Stripe", took: "one blue action" }] };
const intent = { source: "cli", spans: [{ id: "I-1", text: "staff sign in with their email" }, { id: "I-2", text: "staff see today's appointments" }], changeClass: "feature", risk: "low", riskTags: [], rigor: "light", touchesUi: true };
const REQS = [
  { id: "REQ-1", ears: "When a user gives their email, the portal shall sign them in.", op: "ADDED", sources: ["I-1"], anchors: [], acceptance: [{ id: "AC-1.1", given: "a known email", when: "the user signs in", then: "the screen shows Signed in", level: "unit" }] },
  { id: "REQ-2", ears: "When a signed-in user opens the appointments page, the portal shall list today's appointments.", op: "ADDED", sources: ["I-2"], anchors: [], acceptance: [{ id: "AC-2.1", given: "three appointments today", when: "the user opens the page", then: "the screen shows three rows", level: "unit" }] },
];
const draft = { requirements: REQS, nfrs: [], outOfScope: [], assumptions: [], suggestions: [] };
const signIn = { title: "Sign in", blocks: [{ type: "form", fields: [{ label: "Email", kind: "email" }], submit: "Sign in" }, { type: "actions", buttons: ["Need help"] }], copy: {} };
const list = { title: "Today's appointments", blocks: [{ type: "stats", items: [{ label: "Booked today", value: "3" }] }, { type: "table", columns: ["Patient", "Time", "Status"], rows: [["Amina Yusuf", "09:30", "Confirmed"], ["Daniel Okoro", "10:15", "Waiting"], ["Sara Malik", "11:00", "Confirmed"]] }], copy: {} };
const NAMES = ["Amina Yusuf", "Daniel Okoro", "Sara Malik", "Tomas Reyes", "Hina Baig", "Luca Moretti", "Noor Rahman", "Ivy Chen", "Omar Farouk"];
const listFull = { ...list, blocks: [list.blocks[0], { type: "table", columns: ["Patient", "Time", "Status"], rows: NAMES.map((n, i) => [n, `${String(9 + Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}`, ["Confirmed", "Waiting", "Cancelled"][i % 3]!]) }] };
const DESIGN = { flow: "A user signs in, then sees today's appointments.", theme, noScreen: [], screens: [
  { id: "S-1", route: "/login", file: "app/login/page.tsx", reqs: ["REQ-1"], states: ["error"], size: "new", frames: [], mock: signIn, mockFull: signIn },
  { id: "S-2", route: "/appointments", file: "app/appointments/page.tsx", reqs: ["REQ-2"], states: ["empty"], size: "new", frames: [], mock: list, mockFull: listFull },
] };
// the product's API contract, as the plan writes it (two routes, an example per response)
export const CONTRACT = `openapi: 3.0.3
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
              example: [{ id: 1, patient: Amina Yusuf, time: "09:30", status: Confirmed }, { id: 2, patient: Daniel Okoro, time: "10:15", status: Waiting }]
components:
  schemas:
    SignIn: { type: object, required: [email], properties: { email: { type: string } } }
    Session: { type: object, required: [message, userId], properties: { message: { type: string }, userId: { type: integer } } }
    Problem: { type: object, required: [error], properties: { error: { type: string } } }
    Appointment: { type: object, required: [id, patient, time, status], properties: { id: { type: integer }, patient: { type: string }, time: { type: string }, status: { type: string } } }
`;
// each test calls the API through the generated client, answered by the handler generated from the same contract
export const CALLS = [
  { handler: "getSignInMockHandler", call: `const r = await signIn({ email: "amina@clinic.example" }); expect(r.status).toBe(200); expect((r.data as { message: string }).message).toBe("Signed in");`, fn: "signIn" },
  { handler: "getListTodayMockHandler", call: `const r = await listToday(); expect(r.status).toBe(200); expect(r.data.map((a) => a.patient)).toEqual(["Amina Yusuf", "Daniel Okoro"]);`, fn: "listToday" },
];
export const TESTS = [{ acId: "AC-1.1", file: "tests/sign-in.test.ts", name: "AC_1_1_SignsIn", marker: "SIGNED_IN_MARKER" }, { acId: "AC-2.1", file: "tests/appointments.test.ts", name: "AC_2_1_ListsToday", marker: "APPOINTMENTS_MARKER" }];

const U = { inputTokens: 0, outputTokens: 0, cacheRead: 0, cacheWrite: 0 };
const asked: string[] = [];
const scriptedReview = (user: string) => ({ findings: [], coverage: [...new Set([...user.matchAll(/"id":\s*"(AC-[\w.-]+)"/g)].map((m) => m[1]!))].map((acId) => ({ acId, testId: "", verdict: "proves-it" as const, why: "scripted" })) });
export function webAnswer(system: string, user: string): unknown {
  asked.push(system.slice(0, 50).replace(/\s+/g, " "));
  if (system.includes("plan the implementation")) {
    const containers = [...new Set([...user.matchAll(/"container":\s*"([^"]+)"/g)].map((m) => m[1]!))];
    const ds = /"designSystemTask":\s*\{\s*"fileScope":\s*(\[[^\]]*\])/.exec(user);
    const dsFiles = ds ? (JSON.parse(ds[1]!) as string[]) : [];
    containers.sort();
    console.log(`  [scripted plan: containers ${containers.join(", ")}]`);
    return {
      tasks: [
        { id: "TASK-1", title: "Sign-in screen", reqs: ["REQ-1"], fileScope: [...dsFiles, containers[0]!], exemplars: [], conventions: [], dependsOn: [], plannedLoc: 20, approach: "wire the sign-in form in the screen's container" },
        { id: "TASK-2", title: "Appointments screen", reqs: ["REQ-2"], fileScope: [containers[1]!], exemplars: [], conventions: [], dependsOn: ["TASK-1"], plannedLoc: 20, approach: "list today's appointments from fixture data in the screen's container" },
      ],
      options: [{ id: "O-1", summary: "the screens' containers", simplest: true, tradeoffs: "none" }, { id: "O-2", summary: "a separate data module", simplest: false, tradeoffs: "more code" }],
      chosen: "O-1", adr: "Build it in the containers the scaffold made.", protectedPathsDeclared: [], newDependencies: [],
      stubs: system.includes("API CONTRACT.") ? [{ path: "contracts/openapi.yaml", content: CONTRACT, reason: "the API contract" }] : [],
    };
  }
  if (system.includes("review a finished change")) return scriptedReview(user);
  if (system.includes("intake step")) return intent;
  if (system.includes("Requirements analyst")) return { questions: [], conflicts: [] };
  if (system.includes("independently reading a change request")) return { spans: [{ id: "I-1", behaviours: [{ text: "staff sign in with their email", kind: "happy" }] }, { id: "I-2", behaviours: [{ text: "staff see today's appointments", kind: "happy" }] }] };
  if (system.includes("Three engineers independently")) return { differences: [] };
  if (system.includes("Merge three independent")) return { spec: draft, alignment: REQS.map((r) => ({ mergedReq: r.id, from: [`d1:${r.id}`] })), conflicts: [] };
  if (system.includes("State, as numbered")) return { sentences: [{ n: 1, text: "Staff sign in with their email." }, { n: 2, text: "Staff see today's appointments." }] };
  if (system.includes("Map each restated")) return { mapping: [{ n: 1, spans: ["I-1"], answers: [] }, { n: 2, spans: ["I-2"], answers: [] }] };
  if (system.includes("Senior engineer writing a behaviour spec")) return draft;
  if (system.includes("Adversarial reviewer")) return { findings: [] };
  if (system.includes("drawing the screen inventory")) return DESIGN;
  throw new Error(`unscripted system prompt: ${system.slice(0, 120)}`);
}

const containers = (wt: string) => (readdirSync(wt, { recursive: true, encoding: "utf8" }) as string[]).filter((f) => f.endsWith("container.tsx") && !f.includes("node_modules"));
const containerFor = (wt: string, t: (typeof TESTS)[number]) => containers(wt).sort()[TESTS.indexOf(t)]!;
/** The web side's scripted coding agents, on the run's real worktree. */
export const webAgent = (wt: string, step: string): AgentScript | undefined => {
  if (step === "author-tests") return {
    writes: TESTS.map((t, i) => ({ path: t.file, content: [
      `import { readFileSync } from "node:fs";`, `import { setupServer } from "msw/node";`, `import { afterAll, beforeAll, expect, it } from "vitest";`,
      `import { ${CALLS[i]!.fn} } from "../lib/api/client";`, `import { ${CALLS[i]!.handler} } from "../lib/api/client.msw";`, ``,
      `const server = setupServer(${CALLS[i]!.handler}());`, `beforeAll(() => server.listen({ onUnhandledRequest: "error" }));`, `afterAll(() => server.close());`, ``,
      `it("${t.name}", async () => {`, `  ${CALLS[i]!.call}`, `  expect(readFileSync("${containerFor(wt, t)}", "utf8")).toContain("${t.marker}");`, `});`, ``,
    ].join("\n") })),
    output: { tests: TESTS.map(({ acId, file, name }) => ({ acId, file, name })), characterisation: [], probes: [], notes: "" },
  };
  if (step === "implement") {
    const t = TESTS.find((x) => !readFileSync(join(wt, containerFor(wt, x)), "utf8").includes(x.marker))!;
    const c = containerFor(wt, t);
    return { writes: [{ path: c, content: `${readFileSync(join(wt, c), "utf8")}\n/* ${t.marker} */\n` }], output: { done: true, filesChanged: [c], notes: "" } };
  }
  return undefined;
};
