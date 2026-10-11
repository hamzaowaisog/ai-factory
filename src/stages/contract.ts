// A full-stack product's locked API contract in a run (src/gates/contract.ts holds the document logic): which files are locked,
// and the web app's client and test handlers, generated from the contract instead of written by an agent.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ProjectConfig } from "../config/project.js";
import { DATA_MODEL_FILE } from "../gates/data-model.js";
import { basePath, readContract } from "../gates/contract.js";

/** Where the generated client lives in the web app: factory-owned, locked with the contract. */
export const CLIENT_DIR = "lib/api";
export const CLIENT_CONFIG = "orval.config.cjs";
/** Pinned: the generated code is part of the locked files, so the same contract must always give the same client. */
export const CLIENT_PACKAGES = { orval: "7.21.0", msw: "2.15.0", "@faker-js/faker": "9.9.0" };
export const CLIENT_CMD = ["npx", "--no-install", "orval", "--config", CLIENT_CONFIG];

/** The contract and everything generated from it that is in this checkout: locked like the tests, never an agent's to change. */
export function contractLockFiles(project: Pick<ProjectConfig, "contract">, wt: string): string[] {
  const c = project.contract;
  // the approved data model is locked the same way, with or without an API contract
  const model = existsSync(join(wt, DATA_MODEL_FILE)) ? [DATA_MODEL_FILE] : [];
  if (!c || !existsSync(join(wt, c.file))) return model;
  const dir = join(wt, CLIENT_DIR);
  const generated = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".ts")).sort().map((f) => `${CLIENT_DIR}/${f}`) : [];
  return [c.file, ...generated, ...(existsSync(join(wt, CLIENT_CONFIG)) ? [CLIENT_CONFIG] : []), ...model];
}

/** The generator's settings: the client in one file, the test handlers (MSW) beside it, answering with the contract's examples. */
export const clientConfig = (file: string, apiUrl: string): string =>
  `// Written by the factory: the API client and its test handlers are generated from the locked contract (${file}).\nmodule.exports = { api: { input: ${JSON.stringify(`./${file}`)}, output: { mode: "split", target: ${JSON.stringify(`./${CLIENT_DIR}/client.ts`)}, client: "fetch", baseUrl: ${JSON.stringify(apiUrl)}, mock: { type: "msw", useExamples: true } } } };\n`;

/**
 * The address the client calls: where the API answers, plus the path the contract puts every operation under (its first
 * server: "/api"). The generator adds only the address it is given, so without the path the web app asked for /requests
 * while the API, following the contract, served /api/requests (runs 0f9d and e1b5: "Could not load requests").
 */
export function clientBaseUrl(apiUrl: string, contractText: string): string {
  const doc = readContract(contractText);
  const base = doc ? basePath(doc) : "";
  const root = apiUrl.replace(/\/+$/, "");
  return base && !root.endsWith(base) ? root + base : root;
}

/** Add the generator and what its output needs to the app's dev packages, and write its settings. True when package.json changed. */
export function prepareClient(wt: string, file: string, apiUrl: string): boolean {
  writeFileSync(join(wt, CLIENT_CONFIG), clientConfig(file, clientBaseUrl(apiUrl, readFileSync(join(wt, file), "utf8"))));
  const p = join(wt, "package.json");
  const pkg = JSON.parse(readFileSync(p, "utf8")) as { devDependencies?: Record<string, string> };
  const dev = { ...pkg.devDependencies, ...CLIENT_PACKAGES };
  if (JSON.stringify(dev) === JSON.stringify(pkg.devDependencies)) return false;
  writeFileSync(p, `${JSON.stringify({ ...pkg, devDependencies: Object.fromEntries(Object.entries(dev).sort(([a], [b]) => a.localeCompare(b))) }, null, 2)}\n`);
  return true;
}
