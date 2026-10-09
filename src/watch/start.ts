// How the watcher starts a run: exactly `factory start --jira KEY --max-cost <maxCostPerRun>`,
// then the executor in the background like the web screen and MCP do.
import { loadProject } from "../config/project.js";
import { jiraFetcherFor } from "../sources/jira.js";
import { gatherRequest } from "../sources/request.js";
import { runDetached } from "../stages/background.js";
import { createRun } from "../stages/executor.js";
import { checkRoutes, choiceFrom } from "../stages/routing.js";
import { JiraClient } from "./jira-client.js";
import { notifiersFor } from "./notify.js";
import { Watcher, type WatcherDeps } from "./watcher.js";

export async function startFromJira(project: string, key: string, maxCostUsd: number, execute: (runId: string) => void = runDetached): Promise<string> {
  const cfg = loadProject(project);
  // nobody is asked when a ticket starts a run: the project's jira block says the models, else the defaults
  const models = choiceFrom({ preset: cfg.jira?.preset, picks: cfg.jira?.models });
  const problems = checkRoutes(cfg, undefined, models);
  if (problems.length) throw new Error(`Setup problems:\n- ${problems.join("\n- ")}`);
  // only comments by allowed people go into the request: anyone can comment on a ticket
  const req = await gatherRequest({ jira: key }, { fetchJira: jiraFetcherFor(cfg.jira?.allowedReporters) });
  const runId = await createRun(req.text, project, "factory watch", { maxCostUsd, sources: req.sources, models });
  execute(runId);
  return runId;
}

/** A watcher for a project, or why it can't run (no jira block, Jira not set up). */
export function watcherFor(project: string, over: Partial<WatcherDeps> = {}): Watcher {
  const cfg = loadProject(project);
  if (!cfg.jira) throw new Error(`Project ${project} has no "jira:" block, so there's nothing to watch. See "Start runs from Jira" in the README.`);
  const jira = cfg.jira;
  return new Watcher(project, jira, {
    jira: over.jira ?? new JiraClient(),
    notifiers: over.notifiers ?? notifiersFor(cfg.notify),
    start: over.start ?? ((key) => startFromJira(project, key, jira.maxCostPerRun)),
    execute: over.execute ?? runDetached,
    ...(over.lockFree ? { lockFree: over.lockFree } : {}),
    ...(over.now ? { now: over.now } : {}),
  });
}
