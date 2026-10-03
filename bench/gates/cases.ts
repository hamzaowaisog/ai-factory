// Seeded-defect cases. Each case names a gate, an input, and what the gate must do with it.
//   must-fail  the defect is real: the gate has to catch it (a pass here is a MISS)
//   must-pass  the input is clean: the gate has to let it through (a fail here is a FALSE POSITIVE)
// Gates that aren't registered yet report "pending", so this file can grow ahead of the gates.
import type { DiffSummary } from "../../src/gates/predicates.js";
import { ESTIMATE_CASES } from "./estimate-cases.js";

export interface GateCase {
  id: string;
  gateId: string;
  description: string;
  expect: "must-fail" | "must-pass";
  input: unknown;
}

// ---------- existing gates: prove the harness on gates that already exist ----------

const diff = (paths: string[]): DiffSummary => ({
  from: "a", to: "b", files: paths.map((path) => ({ status: "M", path, added: [], removed: [] })), lockedNow: {},
});
const task = { fileScope: ["src/orders/**"] };

const existing: GateCase[] = [
  { id: "diff-in-scope/clean", gateId: "task.diff-in-scope", description: "change stays inside the task's file scope", expect: "must-pass", input: { diff: diff(["src/orders/list.ts"]), task } },
  { id: "diff-in-scope/outside", gateId: "task.diff-in-scope", description: "change touches a file outside the scope", expect: "must-fail", input: { diff: diff(["src/orders/list.ts", "src/billing/invoice.ts"]), task } },
  { id: "lock-set/clean", gateId: "task.lock-set-unchanged", description: "locked test file untouched", expect: "must-pass", input: { diff: { ...diff([]), lockedNow: { "t.test.ts": "s1" } }, tests: { lock: [{ file: "t.test.ts", sha: "s1" }] } } },
  { id: "lock-set/changed", gateId: "task.lock-set-unchanged", description: "locked test file edited", expect: "must-fail", input: { diff: { ...diff([]), lockedNow: { "t.test.ts": "s2" } }, tests: { lock: [{ file: "t.test.ts", sha: "s1" }] } } },
  { id: "lock-set/deleted", gateId: "task.lock-set-unchanged", description: "locked test file deleted", expect: "must-fail", input: { diff: { ...diff([]), lockedNow: { "t.test.ts": null } }, tests: { lock: [{ file: "t.test.ts", sha: "s1" }] } } },
];

export const CASES: GateCase[] = [...existing, ...ESTIMATE_CASES];
