// Networks and proxies for containers (verify-runner §2.3, stages-aligned §6 "Container A packages").
//   factory-agent-net  (internal): agent containers + api proxy → only the model APIs (Anthropic, OpenAI), key added by the proxy
//   factory-feeds-net  (internal): restore containers + feed proxy → only allowlisted package hosts
import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { secret } from "../config/env.js";
import { factoryHome } from "../util/paths.js";
import type { ContainerRuntime } from "../verify/runtime.js";

const exec = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = join(here, "..", "..");

export const AGENT_NET = "factory-agent-net";
export const FEEDS_NET = "factory-feeds-net";
export const API_PROXY = "factory-api-proxy";
export const FEED_PROXY = "factory-feed-proxy";
export const PROXY_IMAGE = "node:22-alpine";
export const AGENT_IMAGE = "factory-agent:dotnet8";

export const API_BASE_URL = `http://${API_PROXY}:8080/anthropic`;
/** The same proxy for a GPT coding step (the Codex agent), and where a step reads what its token has spent. */
export const OPENAI_BASE_URL = `http://${API_PROXY}:8080/openai/v1`;
export const PROXY_SPEND_URL = `http://${API_PROXY}:8080/spend`;
export const FEED_PROXY_URL = `http://${FEED_PROXY}:3128`;

async function cli(rt: ContainerRuntime, args: string[]): Promise<string> {
  const { stdout } = await exec(rt.binary, args, { maxBuffer: 16 * 1024 * 1024, timeout: 30 * 60_000 });
  return stdout.trim();
}

async function exists(rt: ContainerRuntime, kind: "network" | "container" | "image", name: string): Promise<boolean> {
  try {
    await cli(rt, [kind, "inspect", name]);
    return true;
  } catch {
    return false;
  }
}

async function running(rt: ContainerRuntime, name: string): Promise<boolean> {
  try {
    return (await cli(rt, ["inspect", "-f", "{{.State.Running}}", name])) === "true";
  } catch {
    return false;
  }
}

/** Tests with a fake runtime skip real network/image setup. */
let skipInfra = false;
export function setSkipInfra(v: boolean): void {
  skipInfra = v;
}

/**
 * What the key proxy reads, mounted into it read-only: the real keys (files, so they are in no container's
 * environment and not in `docker inspect`) and one small file per running agent step (its token).
 */
export function proxyDir(): string {
  return join(factoryHome(), "proxy");
}
const KEY_FILE = "anthropic-key";
const OPENAI_KEY_FILE = "openai-key";
const TOKENS = "tokens";
const PROXY_MOUNT = "/factory";

/** Only agent containers reach this proxy: a Claude coding step, or a GPT one (the Codex agent). Host-side calls go direct. No key in here. */
export function apiProxyEnv(): Record<string, string | undefined> {
  // besides its own model a step may call a Haiku model: the agent SDK uses one for its small background calls
  return { MODE: "api", KEY_FILE: `${PROXY_MOUNT}/${KEY_FILE}`, OPENAI_KEY_FILE: `${PROXY_MOUNT}/${OPENAI_KEY_FILE}`, TOKEN_DIR: `${PROXY_MOUNT}/${TOKENS}`, ALLOW_MODELS: "claude-haiku-*" };
}

/** A short hash of the proxy's settings and code: stored as a label, never the keys themselves. */
export function proxyFingerprint(env: Record<string, string | undefined>, code: string): string {
  const keys = Object.keys(env).sort();
  return createHash("sha256").update(JSON.stringify(keys.map((k) => [k, env[k] ?? ""])) + "\0" + code).digest("hex").slice(0, 16);
}

/** The key proxy's label: its settings, its code, and the keys it was started for (hashed with them, never stored). */
function apiProxyPrint(): string {
  return proxyFingerprint({ ...apiProxyEnv(), ANTHROPIC_API_KEY: secret("ANTHROPIC_API_KEY"), OPENAI_API_KEY: secret("OPENAI_API_KEY") }, readFileSync(join(REPO_ROOT, "docker", "proxy", "proxy.mjs"), "utf8"));
}

/** Today's keys, in the files the proxy reads (owner-only); a missing key removes its file and the proxy refuses every call to that API. */
export function writeProxyKey(): void {
  const dir = proxyDir();
  mkdirSync(join(dir, TOKENS), { recursive: true, mode: 0o700 });
  for (const [name, env] of [[OPENAI_KEY_FILE, "OPENAI_API_KEY"], [KEY_FILE, "ANTHROPIC_API_KEY"]] as const) {
    const file = join(dir, name);
    const key = secret(env);
    if (!key) { rmSync(file, { force: true }); continue; }
    writeFileSync(file, key, { mode: 0o600 });
    chmodSync(file, 0o600);
  }
  // tokens of steps that died without cleaning up (no step runs for two days)
  for (const f of readdirSync(join(dir, TOKENS))) {
    try { if (Date.now() - statSync(join(dir, TOKENS, f)).mtimeMs > 2 * 24 * 3600_000) rmSync(join(dir, TOKENS, f), { force: true }); } catch { /* gone already */ }
  }
}

/** What one agent step may do through the key proxy. `usdPerMTok` are the step model's prices; past `capUsd` the proxy refuses. */
export interface ProxyGrant { run: string; key: string; model: string; capUsd: number; usdPerMTok: { input: number; output: number; cacheRead: number; cacheWrite: number } }

/**
 * A random token for one agent step. The container gets it in place of an API key; the proxy accepts a call
 * only with a token whose file exists, so another container on the network, or a step that has ended, gets nothing.
 */
export function issueProxyToken(grant: ProxyGrant): string {
  const token = `factory-${randomBytes(24).toString("hex")}`;
  const dir = join(proxyDir(), TOKENS);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(join(dir, `${tokenId(token)}.json`), JSON.stringify({ ...grant, created: new Date().toISOString() }), { mode: 0o600 });
  return token;
}

export function revokeProxyToken(token: string): void {
  rmSync(join(proxyDir(), TOKENS, `${tokenId(token)}.json`), { force: true });
}

const tokenId = (token: string): string => createHash("sha256").update(token).digest("hex");

async function label(rt: ContainerRuntime, name: string, key: string): Promise<string | undefined> {
  try {
    return (await cli(rt, ["inspect", "-f", `{{index .Config.Labels "${key}"}}`, name])) || undefined;
  } catch {
    return undefined;
  }
}

/** For doctor: is the running key proxy using today's keys? */
export async function apiProxyState(rt: ContainerRuntime): Promise<"current" | "outdated" | "not-running"> {
  if (!(await running(rt, API_PROXY))) return "not-running";
  return (await label(rt, API_PROXY, "factory.config")) === apiProxyPrint() ? "current" : "outdated";
}

/** Idempotent: create networks, then (re)start both proxies. */
export async function ensureEgress(rt: ContainerRuntime, feedHosts: string[]): Promise<void> {
  if (skipInfra) return;
  for (const net of [AGENT_NET, FEEDS_NET]) {
    if (!(await exists(rt, "network", net))) await cli(rt, ["network", "create", "--internal", net]);
  }
  const proxyFile = join(REPO_ROOT, "docker", "proxy", "proxy.mjs");
  const start = async (name: string, net: string, env: Record<string, string | undefined>, fp: string, extra: string[]) => {
    // recreate when the keys, the allowlist or the proxy code changed (e.g. a key was added later)
    if ((await running(rt, name)) && (await label(rt, name, "factory.config")) === fp) return;
    await cli(rt, ["rm", "-f", name]).catch(() => undefined);
    const envArgs = Object.entries(env).filter(([, v]) => v).flatMap(([k, v]) => ["--env", `${k}=${v}`]);
    // start on the default bridge (for upstream access), then join the internal network
    await cli(rt, [
      "run", "-d", "--name", name, "--restart", "unless-stopped", "--label", "factory.role=proxy", "--label", `factory.config=${fp}`,
      "--cap-drop=ALL", "--security-opt", "no-new-privileges", "--read-only", ...extra,
      "--mount", `type=bind,src=${proxyFile},dst=/proxy.mjs,readonly`, ...envArgs,
      PROXY_IMAGE, "node", "/proxy.mjs",
    ]);
    await cli(rt, ["network", "connect", net, name]);
  };
  // the key proxy runs as this user, the owner of the key and token files (owner-only), which it gets as a read-only folder
  writeProxyKey();
  await start(API_PROXY, AGENT_NET, apiProxyEnv(), apiProxyPrint(), [
    "--user", `${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000}`, "--mount", `type=bind,src=${proxyDir()},dst=${PROXY_MOUNT},readonly`,
  ]);
  const feedEnv = { MODE: "feeds", ALLOW_HOSTS: feedHosts.join(",") };
  await start(FEED_PROXY, FEEDS_NET, feedEnv, proxyFingerprint(feedEnv, readFileSync(proxyFile, "utf8")), ["--user", "node"]);
}

/** Build container A's image once (docker/agent). */
export async function ensureAgentImage(rt: ContainerRuntime, sdkImage: string): Promise<void> {
  if (skipInfra) return;
  // rebuild when the image's files (run-agent.mjs, run-codex.mjs, Dockerfile, package.json) or the SDK image change
  const fp = agentImageFingerprint(sdkImage);
  if ((await exists(rt, "image", AGENT_IMAGE)) && (await imageLabel(rt, AGENT_IMAGE, "factory.config")) === fp) return;
  await cli(rt, ["build", "--label", `factory.config=${fp}`, "--build-arg", `DOTNET_SDK=${sdkImage}`, "-t", AGENT_IMAGE, join(REPO_ROOT, "docker", "agent")]);
}

export function agentImageFingerprint(sdkImage: string): string {
  const dir = join(REPO_ROOT, "docker", "agent");
  const h = createHash("sha256").update(sdkImage);
  for (const f of ["Dockerfile", "package.json", "run-agent.mjs", "run-codex.mjs"]) h.update(`\0${f}\0`).update(readFileSync(join(dir, f)));
  return h.digest("hex").slice(0, 16);
}

async function imageLabel(rt: ContainerRuntime, image: string, key: string): Promise<string | undefined> {
  try {
    return (await cli(rt, ["image", "inspect", "-f", `{{index .Config.Labels "${key}"}}`, image])) || undefined;
  } catch {
    return undefined;
  }
}

/** Feed hosts from the policy's URL-prefix allowlist (host part only in the POC). */
export function feedHostsFrom(prefixes: string[]): string[] {
  const hosts = new Set<string>(["api.nuget.org", "globalcdn.nuget.org"]);
  for (const p of prefixes) {
    try { hosts.add(new URL(p).hostname); } catch { /* skip */ }
  }
  return [...hosts];
}
