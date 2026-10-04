// The e2e harness's free parts: no containers, no model.
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { hiddenClasses, loadE2ECases, patchSize } from "./case.js";
import { hiddenMethods, lockedCopies } from "./fake.js";
import { formatRows } from "./run.js";
import { leaksOf, type E2ERow } from "./run-case.js";

describe("e2e cases", () => {
  const cases = loadE2ECases();

  it("five backend cases on pinned repos, each with hidden tests in a test folder and a reference within 50 lines", () => {
    expect(cases.map((c) => `${c.id}:${c.kind}`)).toEqual([
      "todo-clear-completed:feature", "todo-create-complete-ignored:bugfix", "vsa-patient-double-booking:bugfix", "vsa-specialty-filter:feature", "vsa-state-conflict-409:bugfix"]);
    for (const c of cases) {
      const ref = patchSize(c.reference);
      expect(ref.lines, c.id).toBeGreaterThan(0);
      expect(ref.lines, c.id).toBeLessThanOrEqual(50);
      expect(patchSize(c.broken).lines, c.id).toBeGreaterThan(0);
      expect(hiddenMethods(c).length, c.id).toBeGreaterThanOrEqual(2);
      // the ticket states its contract: a route the hidden tests call
      expect(c.request, c.id).toMatch(/(GET|POST|DELETE|PUT) \/(api|todos)/);
      expect(c.facts.length, c.id).toBeGreaterThan(0);
      // hidden tests speak HTTP and JSON only: never the application's own types
      for (const text of Object.values(c.hidden)) expect(text, c.id).not.toMatch(/\b(BookAppointment|CancelAppointment|CompleteAppointment|GetAppointments|AppointmentDto|TodoItem)\b/);
    }
  });

  it("patch size counts production lines and files, not tests or the evidence manifest", () => {
    const p = ["diff --git a/src/A.cs b/src/A.cs", "--- a/src/A.cs", "+++ b/src/A.cs", "@@ -1,2 +1,2 @@", "-old", "+new", " same",
      "diff --git a/tests/A.Tests/T.cs b/tests/A.Tests/T.cs", "--- a/tests/A.Tests/T.cs", "+++ b/tests/A.Tests/T.cs", "@@ -0,0 +1 @@", "+[Fact]",
      "diff --git a/.factory/evidence-manifest.json b/.factory/evidence-manifest.json", "--- /dev/null", "+++ b/.factory/evidence-manifest.json", "@@ -0,0 +1 @@", "+{}"].join("\n");
    expect(patchSize(p)).toEqual({ lines: 2, files: ["src/A.cs"] });
  });

  it("the fake test writer's copies carry no hidden name or header, and name each test after its criterion", () => {
    for (const c of cases) {
      const { writes, tests } = lockedCopies(c);
      for (const w of writes) {
        for (const cl of hiddenClasses(c)) expect(w.content).not.toContain(cl);
        expect(w.content).not.toContain("Hidden acceptance tests");
        expect(w.path).not.toContain("Hidden_");
      }
      expect(tests.map((t) => t.name)).toEqual(hiddenMethods(c).map((m, i) => `AC_1_${i + 1}_${m.method}`));
    }
  });

  it("the leak check finds hidden test names or the case folder anywhere the run could read", () => {
    const home = mkdtempSync(join(tmpdir(), "e2e-leak-"));
    process.env.FACTORY_HOME = home;
    const c = cases[0]!;
    mkdirSync(join(home, "ledger", "r1"), { recursive: true });
    writeFileSync(join(home, "ledger", "r1", "events.jsonl"), "nothing to see\n");
    expect(leaksOf(c, "r1")).toEqual([]);
    mkdirSync(join(home, "wt", "x"), { recursive: true });
    writeFileSync(join(home, "wt", "x", "T.cs"), `class ${hiddenClasses(c)[0]} {}`);
    expect(leaksOf(c, "r1")).toEqual([`wt/x/T.cs: ${hiddenClasses(c)[0]}`]);
  });
});

describe("reporting", () => {
  const row = (repeat: number, pass: boolean, flaky = false): E2ERow => ({
    caseId: "vsa-x", repeat, mode: "factory", outcome: "delivered", costUsd: 2.2, minutes: 15, prodLines: 4, linesVsReference: 1, creepFiles: [], cardsAnswered: 1, leaks: [],
    hidden: { tests: {}, passed: pass ? 3 : 2, total: 3, pass, flaky, brokeExisting: [] },
  });

  it("reports each case and its repeats on its own, flags disagreeing repeats and flaky tests, and has no overall percentage", () => {
    const text = formatRows([row(1, true), row(2, false, true)]);
    expect(text).toContain("vsa-x (factory): passed 1 of 2  ← repeats disagree  ← a hidden test was flaky");
    expect(text).not.toMatch(/overall|total pass/i);
    expect(formatRows([row(1, true), row(2, true)])).toContain("passed 2 of 2;");
  });

});

describe("the double-booking case's facts answer what the first paid run asked", () => {
  it("the database question gets 'no database changes'; time changes and cancelled bookings get their own facts", async () => {
    const { answerCard } = await import("../spec/oracle.js");
    const c = loadE2ECases().find((x) => x.id === "vsa-patient-double-booking")!;
    // the questions the clarifier asked on the first paid run (2026-10-04)
    const asked = [
      { id: "Q-1", text: "Should the patient overlap rule also apply to other ways of changing an appointment's time (such as rescheduling)?", options: ["Only new bookings", "All time changes"], recommended: "Only new bookings" },
      { id: "Q-2", text: "Should the database itself enforce the patient rule, or is a check in the application code enough?", options: ["Check in the application code only", "Also add a unique index on (PatientId, StartUtc, EndUtc)"], recommended: "Also add a unique index on (PatientId, StartUtc, EndUtc)" },
      { id: "Q-5", text: "Should a cancelled appointment block a new booking for the same patient?", options: ["No", "Yes"], recommended: "No" },
    ];
    const { log } = answerCard(asked as never, c.facts);
    expect(log.map((a) => [a.question, a.fact])).toEqual([["Q-1", "F4"], ["Q-2", "F3"], ["Q-5", "F2"]]);
  });
});
