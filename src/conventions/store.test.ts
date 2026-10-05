// The guidelines live outside the repo, behind a hash-bound human approval.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { guidelinesPath, readApproved, recordApproval, writeGuidelines } from "./store.js";
import { renderGuidelines } from "./markdown.js";
import type { Convention } from "../contracts/index.js";

let home: string;
const prev = process.env.FACTORY_HOME;
beforeAll(() => { home = mkdtempSync(join(tmpdir(), "conv-")); process.env.FACTORY_HOME = home; });
afterAll(() => { process.env.FACTORY_HOME = prev; rmSync(home, { recursive: true, force: true }); });

const rule: Convention = {
  id: "CV-a1b2", appliesTo: ["src/**/*.cs"], rule: "No raw SQL strings in services",
  exemplar: "src/Orders/OrderRepo.cs:34",
  evidence: { matching: 40, total: 41, recentMatching: 12, recentTotal: 12 },
  status: "confirmed", source: "mined", check: { tool: "grep", ref: "SELECT\\s" },
};
const md = (r = rule) => renderGuidelines({ project: "shop", builtAt: "2026-10-05", conventions: [r], conflicts: [] });

describe("the guidelines store", () => {
  it("is a .md file, outside the repository, where the coding container cannot reach it", () => {
    expect(guidelinesPath("shop")).toBe(join(home, "projects", "shop", "conventions.md"));
  });

  it("a missing file says so distinctly, naming the build command", () => {
    expect(readApproved("nothing-here")).toEqual({ unapproved: expect.stringMatching(/conventions build/) });
  });

  it("an unapproved file does not read as empty — it reads as unapproved, with the command to fix it", () => {
    writeGuidelines("shop", md());
    expect(readApproved("shop")).toEqual({ unapproved: expect.stringMatching(/never approved/) });
  });

  it("returns the parsed rules AND the markdown: the gate needs one, the reviewer reads the other", () => {
    const sha = writeGuidelines("shop", md());
    recordApproval("shop", sha, "tester");
    const got = readApproved("shop");
    expect(got).toMatchObject({ sha, markdown: expect.stringContaining("# Coding guidelines") });
    expect("conventions" in got && got.conventions[0]!.id).toBe("CV-a1b2");
  });

  it("an approval is bound to the file's hash, so editing a rule unapproves it", () => {
    const sha = writeGuidelines("shop", md());
    recordApproval("shop", sha, "tester");
    expect(readApproved("shop")).toMatchObject({ sha });

    writeGuidelines("shop", md({ ...rule, rule: "No raw SQL anywhere" }));
    expect(readApproved("shop")).toEqual({ unapproved: expect.stringMatching(/changed since tester approved/) });
  });

  it("an approved but unparseable file is unapproved, not silently empty", () => {
    const sha = writeGuidelines("shop", md());
    recordApproval("shop", sha, "tester");
    writeFileSync(guidelinesPath("shop"), "# Coding guidelines — shop\n\nsomebody deleted the tables\n");
    expect(readApproved("shop")).toEqual({ unapproved: expect.stringMatching(/changed since|no rule tables/) });
  });

  it("re-approving the edited file makes it usable again", () => {
    const sha = writeGuidelines("shop", md({ ...rule, rule: "No raw SQL at all" }));
    recordApproval("shop", sha, "someone-else");
    const got = readApproved("shop");
    expect("conventions" in got && got.conventions[0]!.rule).toBe("No raw SQL at all");
  });
});
