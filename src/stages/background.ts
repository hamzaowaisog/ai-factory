// Run a run's executor in the background (`factory resume <run>` as a detached process).
// Used by the front ends that can start runs but never decide: the MCP server and `factory ui`.
import { spawn } from "node:child_process";
import { existsSync, openSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { factoryHome } from "../util/paths.js";

/** Execute a run in the background; output goes to the run's executor.log. `fresh` skips stored model answers (--fresh). */
export function runDetached(runId: string, opts: { fresh?: boolean } = {}): void {
  const js = fileURLToPath(new URL("../cli/index.js", import.meta.url));
  // from the TypeScript sources (npm run factory): the same entry point, with the same loader flags
  const args = existsSync(js) ? [js] : [...process.execArgv, fileURLToPath(new URL("../cli/index.ts", import.meta.url))];
  const log = openSync(join(factoryHome(), "ledger", runId, "executor.log"), "a");
  const child = spawn(process.execPath, [...args, "resume", runId], { detached: true, stdio: ["ignore", log, log], ...(opts.fresh ? { env: { ...process.env, FACTORY_NO_CACHE: "1" } } : {}) });
  child.unref();
}
