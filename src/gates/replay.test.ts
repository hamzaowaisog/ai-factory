// Every check the stored runs recorded (ledgers/), re-decided by today's code. A change to a check shows here as a decision
// that differs from what the run recorded: listed in replay.expected.json when it is meant (a check that was wrong and was
// put right), and a failure here when it is not. The runs were real, so these are real cases, not made-up ones.
// Slow (every stored file is hashed again, one run per process to keep memory flat): FACTORY_REPLAY=1 (npm run test:replay).
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const LEDGERS = join(ROOT, "ledgers");
const EXPECTED = join(HERE, "replay.expected.json");

/** "<run> <check line>" for each recorded decision today's code decides differently (the built CLI: npm run build first). */
export function changedDecisions(dir = LEDGERS): string[] {
  const home = mkdtempSync(join(tmpdir(), "factory-replay-"));
  symlinkSync(dir, join(home, "ledger"));
  const out: string[] = [];
  for (const run of readdirSync(dir).filter((r) => existsSync(join(dir, r, "events.jsonl"))).sort()) {
    let text = "";
    try { text = execFileSync(process.execPath, [join(ROOT, "dist", "cli", "index.js"), "verify-evidence", run], { env: { ...process.env, FACTORY_HOME: home }, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }); }
    catch (e) { text = String((e as { stdout?: string }).stdout ?? (e as Error).message); }
    for (const l of text.split("\n")) if (l.startsWith("FAIL")) out.push(`${run} ${l.slice(5)}`);
  }
  return out;
}

describe.runIf(process.env.FACTORY_REPLAY === "1" && existsSync(LEDGERS))("the stored runs' checks, re-decided by today's code", () => {
  it("decide as recorded, except the changes listed as meant", { timeout: 3_600_000 }, () => {
    const expected = existsSync(EXPECTED) ? (JSON.parse(readFileSync(EXPECTED, "utf8")) as string[]) : [];
    expect(changedDecisions()).toEqual(expected);
  });
});
