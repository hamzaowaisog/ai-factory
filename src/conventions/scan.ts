// The one model call in the guidelines build. Deliberately NOT a pipeline step: there is no run,
// no ledger and no gate here, so it takes a small context of its own rather than a StepContext.
import { buildPack } from "../context/pack.js";
import { Redactor } from "../context/secrets.js";
import type { Snapshot } from "../context/snapshot.js";
import { RepoTools } from "../context/tools.js";
import { ApiRunner, defaultProvider } from "../runners/api.js";
import { S } from "../stages/think.js";
import { MINE_TEMPLATE, MinedRules, sampleForScan } from "./mine.js";
import { surveyRepo } from "../context/survey.js";

export interface ScanOpts {
  snap: Snapshot;
  repo: string;
  model: string;
  noGo?: string[];
  sample?: number;
  maxUsd?: number;
  log?: (msg: string) => void;
}

/**
 * Reads a bounded sample of the repository and returns the conventions it already follows.
 *
 * The model is given the file list and read_file over the SAME snapshot, so it fetches what it wants
 * within the sample rather than being handed 40 files at once — which would blow any budget on a
 * large repo. The files it reads come back wrapped as untrusted data like any other tool result.
 */
export async function scanRepo(o: ScanOpts): Promise<MinedRules> {
  const survey = surveyRepo(o.snap, o.repo);
  const files = sampleForScan(o.snap.files, survey, o.sample);
  if (files.length === 0) throw new Error(`No source files to scan in ${o.repo}`);
  o.log?.(`scanning ${files.length} of ${survey.files} files`);

  const redactor = new Redactor();
  const pack = buildPack({
    stage: "discover", cls: "read-large", model: o.model, recipeVersion: "1",
    budgetTokens: 60_000, tools: ["read_file"], toolsAt: "base", redactor,
    sections: [
      S.template("tpl", MINE_TEMPLATE),
      S.reference("signals", `This repository looks like: ${survey.signals.join(", ") || "no framework signals found"}.`),
      S.reference("sample", `Read these files with read_file. They are the most-changed files and a spread across the main areas:\n${files.map((f) => `- ${f}`).join("\n")}`),
      S.task("Write down the conventions this code already follows."),
    ],
  });

  const runner = new ApiRunner({
    provider: defaultProvider,
    tools: new RepoTools(o.snap, redactor, o.noGo ?? []),
  });
  const res = await runner.run({
    step: "discover", model: o.model, pack, schema: MinedRules,
    limits: { maxTurns: Math.min(60, files.length + 10), maxUsd: o.maxUsd ?? 5, timeoutSec: 900 },
  });
  if (res.status !== "ok" || !res.output) {
    throw new Error(`The codebase scan did not finish: ${res.status}${res.error ? ` — ${res.error}` : ""}`);
  }
  o.log?.(`scan found ${res.output.rules.length} conventions ($${res.usage.estUsd?.toFixed(2) ?? "?"})`);
  return res.output;
}
