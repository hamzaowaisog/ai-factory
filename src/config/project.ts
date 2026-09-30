// Project config: ~/.factory/projects/<name>.yaml (contracts §3, trimmed to the POC).
// Never holds secrets: credentials are env var names resolved from ~/.factory/.env.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { z } from "zod";
import { factoryHome } from "../util/paths.js";

const StepRoute = z.object({
  runner: z.enum(["api", "claude-agent", "codex", "jcode"]),
  model: z.string(),
  escalate: z.array(z.string()).default([]),
  effort: z.enum(["low", "medium", "high", "xhigh"]).optional(),
});
export type StepRoute = z.infer<typeof StepRoute>;

export const ProjectConfig = z.object({
  project: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  repo: z.string(),
  baseBranch: z.string().default("main"),
  stack: z.literal("dotnet"),
  forge: z.object({
    kind: z.enum(["github", "bitbucket"]), repo: z.string(), tokenEnv: z.string().default("GITHUB_TOKEN"),
    /** GitHub API and git push URLs; set only for GitHub Enterprise or tests (a local fake) */
    apiUrl: z.string().default("https://api.github.com"),
    pushUrl: z.string().optional(),
  }).optional(),
  /**
   * `factory watch`: a Jira ticket labelled `label` by someone on `allowedReporters` starts a run.
   * Off when absent. Every limit here protects real credits.
   */
  jira: z.object({
    project: z.string().regex(/^[A-Z][A-Z0-9_]+$/, "the Jira project key, e.g. SHOP"),
    label: z.string().default("factory"),
    /** Jira account ids or emails of people allowed to start runs by adding the label */
    allowedReporters: z.array(z.string()).min(1),
    /** optional workflow moves: the transition names to use when a run starts / is delivered */
    transitions: z.object({ started: z.string().optional(), delivered: z.string().optional() }).default({}),
    /** passed like --max-cost to every run the watcher starts */
    maxCostPerRun: z.number().positive().default(3),
    maxRunsPerDay: z.number().int().positive().default(3),
    dailyBudgetUsd: z.number().positive().default(10),
    monthlyBudgetUsd: z.number().positive().default(100),
    /** tickets whose description is shorter than this are skipped (not enough to go on) */
    minDescriptionChars: z.number().int().nonnegative().default(80),
    pollSeconds: z.number().int().min(30).default(60),
  }).optional(),
  /** Where the watcher posts updates. Webhook URLs live in ~/.factory/.env, named here. */
  notify: z.object({ slackWebhookEnv: z.string().optional() }).default({}),
  dotnet: z.object({
    sdkImage: z.string().default("mcr.microsoft.com/dotnet/sdk:8.0"),
    solution: z.string().optional(),
    buildTimeoutSec: z.number().default(900),
    testTimeoutSec: z.number().default(1800),
    /** Runner settings passed after `--` on the command line (never by editing repo config). */
    runnerArgs: z.array(z.string()).default([]),
  }).default({ sdkImage: "mcr.microsoft.com/dotnet/sdk:8.0", buildTimeoutSec: 900, testTimeoutSec: 1800, runnerArgs: [] }),
  database: z.object({
    image: z.string().default("postgres:16-alpine"),
    name: z.string().default("app_test"),
    /** Login the repo's tests use. Created with CREATEDB, never superuser. */
    user: z.string().default("factory"),
    /** Env var in ~/.factory/.env holding that login's test password (when the tests hardcode one). */
    passwordEnv: z.string().optional(),
    /** Producer env template: only container B gets these. {{DB_*}} are filled by the core. */
    producerEnv: z.record(z.string(), z.string()).default({}),
    migrate: z.array(z.string()).optional(),
  }).optional(),
  /** Accept: boot the app next to the test database and send the locked HTTP probes. */
  accept: z.object({
    bootApp: z.boolean().default(true),
    /** the web project to run (auto-detected: the one with Sdk.Web) */
    project: z.string().optional(),
    /** any HTTP answer on this path counts as "the app is up" */
    readyPath: z.string().default("/"),
    readyTimeoutSec: z.number().default(120),
    port: z.number().default(5080),
    /** extra environment for the booted app only (e.g. a flag that makes it run its migrations) */
    env: z.record(z.string(), z.string()).default({}),
  }).default({ bootApp: true, readyPath: "/", readyTimeoutSec: 120, port: 5080, env: {} }),
  /** Agent env template: dummy values so the app compiles in container A. */
  agentEnv: z.record(z.string(), z.string()).default({}),
  /** Read-only reference DB for discover (D9): the env var holding its connection string. */
  referenceDb: z.object({ connEnv: z.string() }).optional(),
  noGo: z.array(z.string()).default([]),
  /** USD per million tokens for models the factory has no price for (e.g. a GPT model). */
  prices: z.record(z.string(), z.object({
    input: z.number(), output: z.number(), cacheRead: z.number().default(0), cacheWrite: z.number().default(0),
  })).default({}),
  policy: z.record(z.string(), z.unknown()).default({}),
  steps: z.record(z.string(), StepRoute).default({}),
});
export type ProjectConfig = z.infer<typeof ProjectConfig>;

export function projectPath(name: string): string {
  return join(factoryHome(), "projects", `${name}.yaml`);
}

export function loadProject(name: string): ProjectConfig {
  const p = projectPath(name);
  if (!existsSync(p)) throw new Error(`No project "${name}". Create ${p} (see docs/project-example.yaml).`);
  return ProjectConfig.parse(parse(readFileSync(p, "utf8")));
}

/** Fill {{DB_HOST}} etc. in an env template. */
export function fillTemplate(env: Record<string, string>, vars: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) out[k] = v.replace(/\{\{(\w+)\}\}/g, (_, n: string) => vars[n] ?? "");
  return out;
}
