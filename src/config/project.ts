// Project config: ~/.factory/projects/<name>.yaml (contracts §3, trimmed to the POC).
// Never holds secrets: credentials are env var names resolved from ~/.factory/.env.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
  /** dotnet: built and tested in the .NET lab; node: a TypeScript app (a new product's kit app), built and tested with npm and vitest */
  stack: z.enum(["dotnet", "node"]).default("dotnet"),
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
  /** the Node lab (stack: node): install from the npm registry through the feed proxy, then build and test with no network */
  node: z.object({
    image: z.string().default("node:22-bookworm"),
    buildTimeoutSec: z.number().default(900),
    testTimeoutSec: z.number().default(900),
  }).default({ image: "node:22-bookworm", buildTimeoutSec: 900, testTimeoutSec: 900 }),
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
  /** the Folio3 estimation template (.xlsx) the estimate workbooks are drawn on; FACTORY_ESTIMATE_TEMPLATE also works */
  estimateTemplate: z.string().optional(),
  /** estimate runs: a person answers the clarify questions and approves the estimate (E7) by default; humanReview false makes the project's estimates hands-off (opt-in; `factory estimate --hands-off` does it for one run) */
  estimate: z.object({ humanReview: z.boolean().default(true) }).optional(),
  /** Front end of the repo, when it has one (docs/design-step.md): overrides what the design checks would detect. */
  design: z.object({
    /** source root, e.g. "src/" ("" is the repo root); default: detected */
    sourceRoot: z.string().optional(),
    /** the app's building-block folder, e.g. "src/components/ui"; default: detected */
    uiDir: z.string().optional(),
    /** brand fonts the design brief may name besides Google Fonts */
    brandFonts: z.array(z.string()).default([]),
    /**
     * A small UI fix in an app of its own gets a text design note approved with the estimate, not a drawn demo and a card of its
     * own (docs/estimates-design.md, "Design note for a small fix"). false: every UI request gets the full design.
     */
    lightNote: z.boolean().default(true),
    /**
     * Commit the approved design package (design.json, tokens, the demo, up to 240 pictures) into the client's branch under
     * `.factory/design/<line>/vN/`. Off by default (PR #11 review, item 12): the package stays in the factory's store, and the
     * build reads it from there.
     */
    commitPackage: z.boolean().default(false),
    /** a nav change counts as a new screen, not a tweak */
    navRaises: z.boolean().default(false),
    /** design reference URLs may point at private addresses (an intranet style guide); off by default */
    allowPrivateRefs: z.boolean().default(false),
    /**
     * The stack the approved design is built in (docs/estimates-design.md, "Kit and scaffold"): next-shadcn or vite-shadcn copy the
     * factory's component kit, the theme and a page per screen into the repo before the agents start; repo builds with the repo's own
     * components (no kit). Default: detected from package.json and components.json.
     */
    uiTarget: z.enum(["next-shadcn", "vite-shadcn", "repo"]).optional(),
    /** the target of one app of a product with several (app id to target), over uiTarget */
    uiTargets: z.record(z.string(), z.enum(["next-shadcn", "vite-shadcn", "repo"])).default({}),
    /**
     * Take the app's pages before and after the change and compare them (docs/design-step.md, "Visual check").
     * The app is started from the repo's own commands ON THIS MACHINE, not in a container, so it is off unless
     * `allowHost` is true: you are agreeing to run the project's start command on the generated code here.
     */
    capture: z.object({
      allowHost: z.literal(true),
      /** run once in each checkout first, e.g. "npm ci" */
      install: z.string().optional(),
      /** starts the app and listens on $PORT, e.g. "npm run start -- -p $PORT" */
      start: z.string(),
      pages: z.array(z.object({ name: z.string().min(1), path: z.string().startsWith("/") })).min(1).max(12),
      port: z.number().int().min(1024).max(65000).default(4310),
      /** a path that answers once the app is up */
      readyPath: z.string().startsWith("/").default("/"),
      timeoutSec: z.number().int().min(10).max(900).default(180),
      /** extra environment for the app (no secrets from the factory are passed) */
      env: z.record(z.string(), z.string()).default({}),
    }).optional(),
    /**
     * Check the built app against the approved design (docs/estimates-design.md, "Fidelity and tests"): tokens, structure and
     * accessibility block (waivable), layout and pixels advise. On by default whenever the factory generated the screens (a kit
     * scaffold: next-shadcn, vite-shadcn), with the kit's own commands; this object only changes them. The app is installed and
     * started in containers (the agent image: the install reaches only the package feeds, the app has no network); `false`
     * switches the check off.
     */
    fidelity: z.union([z.literal(false), z.object({
      /**
       * true runs the app ON THIS MACHINE instead, in the run's worktree with a scratch HOME (for a factory host with no
       * container runtime): you are agreeing to run the agents' generated code and its install scripts here, with network access.
       */
      allowHost: z.literal(true).optional(),
      /** run once in the checkout first; default "npm install --no-audit --no-fund" */
      install: z.string().optional(),
      /** builds and starts the app on $PORT; default per target (next build && next start, vite build && vite preview) */
      start: z.string().optional(),
      port: z.number().int().min(1024).max(65000).default(4320),
      readyPath: z.string().startsWith("/").default("/"),
      timeoutSec: z.number().int().min(10).max(1800).default(600),
      env: z.record(z.string(), z.string()).default({}),
      /** most pages to open (the rest are noted, not checked) */
      maxPages: z.number().int().min(1).max(400).default(160),
    })]).optional(),
  }).optional(),
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

/**
 * The config an estimate uses when there is no project: requirements alone, no repo to read. It holds nothing
 * but a name (the estimate steps take their models from the defaults) and is written on first use.
 */
export const STANDALONE_PROJECT = "standalone-estimates";
export function ensureStandaloneProject(): string {
  const p = projectPath(STANDALONE_PROJECT);
  if (!existsSync(p)) {
    mkdirSync(join(factoryHome(), "projects"), { recursive: true });
    writeFileSync(p, `# Written by the factory for estimates that have no project: the requirements stand alone, there is no repo.\nproject: ${STANDALONE_PROJECT}\nrepo: "-"\nstack: dotnet\n`, { mode: 0o600 });
  }
  return STANDALONE_PROJECT;
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
