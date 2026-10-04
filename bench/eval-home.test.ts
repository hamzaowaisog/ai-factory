import { mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { EVAL_HOMES, useEvalHome } from "./eval-home.js";

const before = process.env.FACTORY_HOME;
afterEach(() => { if (before === undefined) delete process.env.FACTORY_HOME; else process.env.FACTORY_HOME = before; });

/** A stand-in for the real home, with a keys file. */
function realHome(keys = true): string {
  const d = mkdtempSync(join(tmpdir(), "real-home-"));
  if (keys) writeFileSync(join(d, ".env"), "ANTHROPIC_API_KEY=sk-ant-real-000\n", { mode: 0o600 });
  process.env.FACTORY_HOME = d;
  return d;
}

describe("every eval runs in its own temporary factory home", () => {
  it("a free eval: a fresh marked home with fake keys; the real home is left exactly as it was", () => {
    const real = realHome();
    const { home, realHome: from } = useEvalHome("spec", { paid: false });
    expect(from).toBe(real);
    expect(home.startsWith(EVAL_HOMES)).toBe(true);
    expect(process.env.FACTORY_HOME).toBe(home);
    expect(readdirSync(home).sort()).toEqual([".env", ".eval-home"]);
    expect(readFileSync(join(home, ".env"), "utf8")).toContain("sk-ant-fake-eval");
    expect(readdirSync(real)).toEqual([".env"]);
  });

  it("a paid eval copies the real keys, readable by this user only; with no keys it refuses", () => {
    realHome();
    const { home } = useEvalHome("consistency", { paid: true });
    expect(readFileSync(join(home, ".env"), "utf8")).toBe("ANTHROPIC_API_KEY=sk-ant-real-000\n");
    expect(statSync(join(home, ".env")).mode & 0o777).toBe(0o600);
    realHome(false);
    expect(() => useEvalHome("consistency", { paid: true })).toThrow(/needs the keys/);
  });

  it("the spec eval, the consistency bench and the e2e eval all switch to one before running, and answer as \"eval\"", () => {
    const src = (f: string) => readFileSync(new URL(f, import.meta.url), "utf8");
    expect(src("./spec/run.ts")).toMatch(/useEvalHome\("spec", \{ paid: spend \}\)/);
    expect(src("./run.ts")).toMatch(/useEvalHome\("consistency", \{ paid: true \}\)[\s\S]*runCase\(/);
    expect(src("./e2e/run.ts")).toMatch(/useEvalHome\("e2e", \{ paid: false \}\)[\s\S]*useEvalHome\("e2e", \{ paid: true \}\)/);
    for (const f of ["./spec/eval.ts", "./consistency/run.ts", "./e2e/run-case.ts"]) {
      expect(src(f), f).toContain("EVAL_DECIDER");
      expect(src(f), f).not.toMatch(/by: "(spec-eval|bench)"/);
    }
  });
});
