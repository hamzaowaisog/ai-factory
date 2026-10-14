// A full-stack product's locked API contract in a run (src/gates/contract.ts holds the document logic): which files are locked,
// and the web app's client and test handlers, generated from the contract instead of written by an agent.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ProjectConfig } from "../config/project.js";
import type { LedgerEvent } from "../contracts/index.js";
import { DATA_MODEL_FILE } from "../gates/data-model.js";
import { basePath, readContract } from "../gates/contract.js";

/** Where the generated client lives in the web app: factory-owned, locked with the contract. */
/** The web side of a full-stack product: its API is the other repo, held to the same contract, so nothing here answers an HTTP call. */
export const apiElsewhere = (project: { stack: string; contract?: unknown }): boolean => project.stack === "node" && !!project.contract;
/**
 * The criteria this repo proves. On the web side, api and job criteria are the API run's, proven there from the same
 * request: no test here. A spec inherited from a design keeps them (run 77de: 41 of 48), and the web test writers had
 * nothing to test them against. Requirements stay, so the plan's gates against the approved spec still hold.
 */
export function provenHere<T extends { requirements: { acceptance: { level: string }[] }[] }>(project: { stack: string; contract?: unknown }, spec: T): T {
  if (!apiElsewhere(project)) return spec;
  return { ...spec, requirements: spec.requirements.map((r) => ({ ...r, acceptance: r.acceptance.filter((a) => !provedByApi(project, a)) })) };
}
export const provedByApi = (project: { stack: string; contract?: unknown }, a: { level: string }): boolean => apiElsewhere(project) && (a.level === "api" || a.level === "job");
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

/**
 * The generator's settings: the client in one file, the test handlers (MSW) beside it, answering with the contract's examples.
 * delay 0: left out, every handler waits one second, which is the whole time a screen test waits for text to appear, so a test
 * that reads an answer failed however the screen was built (run 1679, the import screen's tests).
 */
export const clientConfig = (file: string, apiUrl: string): string =>
  `// Written by the factory: the API client and its test handlers are generated from the locked contract (${file}).\nmodule.exports = { api: { input: ${JSON.stringify(`./${file}`)}, output: { mode: "split", target: ${JSON.stringify(`./${CLIENT_DIR}/client.ts`)}, client: "fetch", baseUrl: ${JSON.stringify(apiUrl)}, mock: { type: "msw", useExamples: true, delay: 0 } } } };\n`;

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

const MOCK_BEFORE = 'mock: { type: "msw", useExamples: true }';

/**
 * The settings of a client generated before the handlers' wait was set to 0, with it set; undefined for settings that have it
 * (or that the factory did not write this way). A run that was already under way gets its handlers generated again from these.
 */
export const withoutMockDelay = (config: string): string | undefined =>
  /\bdelay\s*:/.test(config) || !config.includes(MOCK_BEFORE) ? undefined : config.replace(MOCK_BEFORE, 'mock: { type: "msw", useExamples: true, delay: 0 }');

/** One generated file the factory wrote again in a run, as its `client.refreshed` event records it. */
export interface Refreshed { step: string; file: string; sha: string; was: string; why: string }

/** The generated files written again in this run: the newest content of each. */
export function refreshedClient(events: LedgerEvent[]): Refreshed[] {
  const by = new Map<string, Refreshed>();
  for (const e of events) if (e.type === "client.refreshed") { const r = e.data as unknown as Refreshed; by.set(r.file, r); }
  return [...by.values()];
}

/** A lock with the files the factory generated again at the hash they have now, each named beside the unlocks. */
export function withRefreshed<L extends { lock: { file: string; sha: string }[]; unlocks?: unknown[] }>(lock: L, events: LedgerEvent[], boundTo: string): L {
  const rf = refreshedClient(events).filter((r) => lock.lock.some((l) => l.file === r.file));
  if (!rf.length) return lock;
  const sha = new Map(rf.map((r) => [r.file, r.sha]));
  return {
    ...lock,
    lock: lock.lock.map((l) => (sha.has(l.file) ? { ...l, sha: sha.get(l.file)! } : l)),
    unlocks: [...(lock.unlocks ?? []), ...rf.map((r) => ({ what: r.file, human: "factory (generated again)", reason: r.why, boundTo }))],
  };
}
