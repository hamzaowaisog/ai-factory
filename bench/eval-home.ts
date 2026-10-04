// Every eval runs in its own temporary factory home, never the real one: no eval writes into the real home's ledgers,
// projects, caches or calibration data. The home is marked as the eval harness's own, so only there can cards be
// answered as "eval". A paid eval takes a copy of the real keys file; a free one gets fake keys.
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { _resetEnvCache } from "../src/config/env.js";
import { markEvalHome } from "../src/ledger/human.js";
import { factoryHome } from "../src/util/paths.js";

// under the user's home folder: the same disk as the e2e package cache (hard links), and shared with Docker's VM
export const EVAL_HOMES = join(homedir(), ".factory", "tmp", "evals");

/** Switch this process to a fresh eval home (FACTORY_HOME) and return it, with the real home it came from. */
export function useEvalHome(kind: string, opts: { paid: boolean }): { home: string; realHome: string } {
  const realHome = factoryHome();
  mkdirSync(EVAL_HOMES, { recursive: true });
  const home = mkdtempSync(join(EVAL_HOMES, `${kind}-`));
  markEvalHome(home);
  const keys = join(realHome, ".env");
  if (opts.paid) {
    if (!existsSync(keys)) throw new Error(`A paid eval needs the keys in ${keys}.`);
    copyFileSync(keys, join(home, ".env"));
    chmodSync(join(home, ".env"), 0o600); // keys: readable by this user only
  } else {
    writeFileSync(join(home, ".env"), "ANTHROPIC_API_KEY=sk-ant-fake-eval-000000000000\nOPENAI_API_KEY=sk-fake-eval-000000000000\n", { mode: 0o600 });
  }
  process.env.FACTORY_HOME = home;
  _resetEnvCache(); // keys read so far came from the real home
  return { home, realHome };
}
