// The API side's scripted model answers and coding agents, on the factory's own skeleton.
import type { AgentScript } from "../src/runners/claude-agent.js";
import { apiDb, apiProgram, HEALTH_LINE } from "../src/fullstack/skeleton.js";

// ---------- what the scripted plan and agents write ----------
const ROUTES = "app.MapSignIn();\napp.MapAppointments();";
const signInRoutes = (body: string) => `namespace App.Api;

public record SignIn(string Email);
public record Session(string Message, int UserId);
public record Problem(string Error);

public static class SignInRoutes
{
    public static void MapSignIn(this WebApplication app)
    {
${body}    }
}
`;
const SIGN_IN = `        app.MapPost("/api/sign-in", (SignIn body) => body.Email.Contains('@') ? Results.Ok(new Session("Signed in", 1)) : Results.BadRequest(new Problem("Enter a valid email")))
            .WithName("signIn").Produces<Session>(200).Produces<Problem>(400);
`;
const appointmentRoutes = (field: string, body: string) => `using Microsoft.EntityFrameworkCore;

namespace App.Api;

public record Appointment(int Id, string ${field}, string Time, string Status);

public static class AppointmentRoutes
{
    public static void MapAppointments(this WebApplication app)
    {
${body}    }
}
`;
const LIST = `        app.MapGet("/api/appointments/today", (AppDb db) =>
        {
            db.Database.EnsureCreated();
            return TypedResults.Ok(db.Appointments.AsNoTracking().OrderBy(a => a.Time).ToArray());
        }).WithName("listToday");
`;
const DB_BODY = `    public DbSet<Appointment> Appointments => Set<Appointment>();

    protected override void OnModelCreating(ModelBuilder model) =>
        model.Entity<Appointment>().HasData(
            new Appointment(1, "Amina Yusuf", "09:30", "Confirmed"),
            new Appointment(2, "Daniel Okoro", "10:15", "Waiting"),
            new Appointment(3, "Sara Malik", "11:00", "Confirmed"));
`;
const TEST_FILE = `using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Xunit;

namespace App.Tests;

public class PortalTests : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory;
    public PortalTests(WebApplicationFactory<Program> factory) => _factory = factory;

    [Fact]
    public async Task AC_1_1_SignsInWithEmail()
    {
        var res = await _factory.CreateClient().PostAsJsonAsync("/api/sign-in", new { email = "amina@clinic.example" });
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        Assert.Contains("Signed in", await res.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task AC_2_1_ListsTodaysAppointments()
    {
        var res = await _factory.CreateClient().GetAsync("/api/appointments/today");
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        Assert.Contains("Amina Yusuf", await res.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task CHAR_ApiStillUp()
    {
        var res = await _factory.CreateClient().GetAsync("/");
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
    }
}
`;

export const UNUSED_REQUEST = "The clinic portal's API: staff sign in with their email, and the portal lists today's appointments from the local database. Follow the API contract in contracts/openapi.yaml.";
const intent = { source: "cli", spans: [{ id: "I-1", text: "staff sign in with their email" }, { id: "I-2", text: "the portal lists today's appointments from the local database" }], changeClass: "feature", risk: "low", riskTags: [], rigor: "light", touchesUi: false };
// DRYRUN_DATABASE=postgres: the same script on the PostgreSQL skeleton (the lab then starts a PostgreSQL beside the tests)
export const DRYRUN_DB = process.env.DRYRUN_DATABASE === "postgres" ? "postgres" as const : "sqlite" as const;
const ANCHOR = { path: "App.Api/Program.cs", lineStart: apiProgram("", DRYRUN_DB).split("\n").indexOf(HEALTH_LINE) + 1, lineEnd: apiProgram("", DRYRUN_DB).split("\n").indexOf(HEALTH_LINE) + 1, quote: HEALTH_LINE };
const REQS = [
  { id: "REQ-1", ears: "When a user posts their email to /api/sign-in, the API shall respond with 200 and a Signed in message.", op: "ADDED", sources: ["I-1"], anchors: [], acceptance: [{ id: "AC-1.1", given: "a valid email", when: "POST /api/sign-in is called", then: "the response status is 200", level: "api" }] },
  { id: "REQ-2", ears: "When /api/appointments/today is requested, the API shall respond with 200 and today's appointments.", op: "ADDED", sources: ["I-2"], anchors: [], acceptance: [{ id: "AC-2.1", given: "three appointments stored", when: "GET /api/appointments/today is called", then: "the response status is 200 with the stored rows", level: "api" }] },
];
const draft = { requirements: REQS, nfrs: [], outOfScope: [], assumptions: [], suggestions: [] };
const U = { inputTokens: 0, outputTokens: 0, cacheRead: 0, cacheWrite: 0 };
const scriptedReview = (user: string) => ({ findings: [], coverage: [...new Set([...user.matchAll(/"id":\s*"(AC-[\w.-]+)"/g)].map((m) => m[1]!))].map((acId) => ({ acId, testId: "", verdict: "proves-it" as const, why: "scripted" })) });
export function apiAnswer(system: string, user = ""): unknown {
  if (system.includes("intake step")) return intent;
  if (system.includes("grounding step")) return { claims: [{ id: "C-1", text: "The API has only a health route today; it has no sign-in and no appointments route", spans: ["I-1", "I-2"], anchors: [{ ...ANCHOR, symbol: "MapGet /" }] }], notFound: [] };
  // the spec's open problems are settled by questions in a build too: none to ask here, so they are carried as open risks
  if (system.includes("these problems are still open")) return { questions: [], inRequest: [] };
  if (system.includes("Requirements analyst")) return { questions: [], conflicts: [] };
  if (system.includes("independently reading a change request")) return { spans: [{ id: "I-1", behaviours: [{ text: "POST /api/sign-in answers 200", kind: "happy" }] }, { id: "I-2", behaviours: [{ text: "GET /api/appointments/today answers 200 with rows", kind: "happy" }] }] };
  if (system.includes("Three engineers independently")) return { differences: [] };
  if (system.includes("Merge three independent")) return { spec: draft, alignment: REQS.map((r) => ({ mergedReq: r.id, from: [`d1:${r.id}`] })), conflicts: [] };
  if (system.includes("State, as numbered")) return { sentences: [{ n: 1, text: "Staff sign in with their email." }, { n: 2, text: "The portal lists today's appointments from the local database." }] };
  if (system.includes("Map each restated")) return { mapping: [{ n: 1, spans: ["I-1"], answers: [] }, { n: 2, spans: ["I-2"], answers: [] }] };
  if (system.includes("Senior engineer writing a behaviour spec")) return draft;
  if (system.includes("Adversarial reviewer")) return { findings: [] };
  if (system.includes("plan the implementation")) {
    console.log(`  [plan prompt names the locked contract: ${system.includes("API CONTRACT (locked, contracts/openapi.yaml)")}]`);
    return {
      tasks: [
        { id: "TASK-1", title: "Sign in", reqs: ["REQ-1"], fileScope: ["App.Api/Program.cs", "App.Api/SignInRoutes.cs"], exemplars: [], conventions: [], dependsOn: [], plannedLoc: 15, approach: "map POST /api/sign-in as the contract says" },
        { id: "TASK-2", title: "Today's appointments", reqs: ["REQ-2"], fileScope: ["App.Api/AppointmentRoutes.cs", "App.Api/AppDb.cs"], exemplars: [], conventions: [], dependsOn: ["TASK-1"], plannedLoc: 30, approach: "store appointments in SQLite, map GET /api/appointments/today as the contract says" },
      ],
      options: [{ id: "O-1", summary: "one routes file per feature", simplest: true, tradeoffs: "none" }, { id: "O-2", summary: "controllers", simplest: false, tradeoffs: "more code" }],
      chosen: "O-1", adr: "Minimal API routes in one file per feature; SQLite through the existing DbContext.", protectedPathsDeclared: [], newDependencies: [],
      dataModel: { tables: [{ name: "Appointments", purpose: "today's appointments at the front desk", columns: [
        { name: "Id", type: "int", required: true, pk: true }, { name: "Patient", type: "string", required: true },
        { name: "Time", type: "string", required: true }, { name: "Status", type: "string", required: true }] }] },
      stubs: [
        { path: "App.Api/Program.cs", content: apiProgram(ROUTES, DRYRUN_DB), reason: "calls the two route groups" },
        { path: "App.Api/SignInRoutes.cs", content: signInRoutes(""), reason: "compiles before TASK-1" },
        { path: "App.Api/AppointmentRoutes.cs", content: appointmentRoutes("Patient", ""), reason: "compiles before TASK-2" },
      ],
    };
  }
  if (system.includes("review a finished change")) return scriptedReview(user);
  throw new Error(`unscripted system prompt: ${system.slice(0, 120)}`);
}
let implementCalls = 0;
export const apiAgent = (step: string): AgentScript | undefined => {
  if (step === "author-tests") return {
    writes: [{ path: "App.Tests/PortalTests.cs", content: TEST_FILE }],
    output: {
      tests: [{ acId: "AC-1.1", file: "App.Tests/PortalTests.cs", name: "AC_1_1_SignsInWithEmail" }, { acId: "AC-2.1", file: "App.Tests/PortalTests.cs", name: "AC_2_1_ListsTodaysAppointments" }],
      characterisation: [{ target: "GET /", file: "App.Tests/PortalTests.cs", name: "CHAR_ApiStillUp" }],
      probes: [{ acId: "AC-2.1", method: "GET", path: "/api/appointments/today", expectStatus: 200 }], notes: "",
    },
  };
  if (step === "implement") {
    implementCalls++;
    if (implementCalls === 1) return { writes: [{ path: "App.Api/SignInRoutes.cs", content: signInRoutes(SIGN_IN) }], output: { done: true, filesChanged: ["App.Api/SignInRoutes.cs"], notes: "" } };
    // --wrong-field: the first try names the field PatientName; the tests still pass (the names are in the rows), only the contract gate can tell
    const field = implementCalls === 2 ? "PatientName" : "Patient";
    console.log(`  [scripted implementer: the appointment's name field is "${field}"]`);
    return { writes: [{ path: "App.Api/AppointmentRoutes.cs", content: appointmentRoutes(field, LIST) }, { path: "App.Api/AppDb.cs", content: apiDb(DB_BODY) }], output: { done: true, filesChanged: ["App.Api/AppointmentRoutes.cs", "App.Api/AppDb.cs"], notes: "" } };
  }
  return undefined;
};
