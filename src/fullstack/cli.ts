// `factory fullstack`: one request, a web repo and an API repo held to one API contract (src/fullstack/product.ts).
import { userInfo } from "node:os";
import { resolve } from "node:path";
import type { Command } from "commander";
import { gatherRequest } from "../sources/request.js";
import { DATABASE_NAME, databaseOption } from "./database.js";
import { databaseOf, delivered, loadProduct, productSeed, setProductDatabase, startApiRun, startProduct, writeRunFiles } from "./product.js";

export function registerFullstackCommands(program: Command, d: { log: (m: string) => void; runAndReport: (runId: string) => Promise<void> }): void {
  const { log } = d;
  const fs = program.command("fullstack").description("a new product with a web app and an API: two repos, two runs, one locked API contract");

  fs.command("start")
    .argument("[prompt]", "what the product does, in plain words")
    .requiredOption("--name <name>", "the product's short name: the repos are <name>-web and <name>-api")
    .option("--file <path>", "the requirements as a Markdown or text file")
    .option("--dir <folder>", "where the two repos go", ".")
    .option("--from-design <runId>", "start from an approved design made with no repo: its design steps are skipped")
    .option("--from-estimate <runId>", "start from an approved estimate made with no repo: the web run is held to it")
    .option("--max-cost <usd>", "cost limit of the web run")
    .option("--database <which>", "what the API keeps its data in: sqlite, postgres, or auto (the factory proposes one from the request and says why)", "auto")
    .option("--github", "also put both repos on GitHub (private, under the account of GITHUB_TOKEN): each run then pushes its branch and opens a PR")
    .description("make the two repos and start the web run: questions, the design, then the plan with the API contract")
    .action(async (prompt: string | undefined, o: { name: string; file?: string; dir: string; fromDesign?: string; fromEstimate?: string; maxCost?: string; github?: boolean; database?: string }) => {
      const database = databaseOption(o.database);
      const seed = productSeed({ design: o.fromDesign, estimate: o.fromEstimate });
      if (seed && (prompt || o.file)) throw new Error("An approved design or estimate brings its own request: give no prompt and no --file.");
      const req = seed ? undefined : await gatherRequest({ prompt, file: o.file }, {});
      const p = await startProduct(o.name, resolve(o.dir), req, userInfo().username, o.maxCost !== undefined ? Number(o.maxCost) : undefined, seed, !!o.github, database);
      log(`database: ${DATABASE_NAME[databaseOf(p)]}. ${p.database?.reason ?? ""} To switch before the API run starts: factory fullstack database ${p.name} ${databaseOf(p) === "postgres" ? "sqlite" : "postgres"}`);
      log(`web repo ${p.web.repo} (project ${p.web.project}); API repo ${p.api.repo} (project ${p.api.project})`);
      if (p.web.github) log(`on GitHub: ${p.web.github} and ${p.api.github}`);
      if (p.from) log(p.from.kind === "design" ? `started from approved design ${p.from.runId}: its design steps are skipped` : `started from approved estimate ${p.from.runId}: the web run is held to it`);
      log(`web run ${p.web.run}. Answer its cards as usual; once its plan is approved: factory fullstack next ${p.name}`);
      await d.runAndReport(p.web.run!);
    });

  fs.command("next").argument("<name>")
    .option("--max-cost <usd>", "cost limit of the API run")
    .description("the next step: hand the approved contract to the API repo and start the API run, or say where each run is")
    .action(async (name: string, o: { maxCost?: string }) => {
      const p = loadProduct(name);
      if (!p.api.run) {
        log(`database of the API: ${DATABASE_NAME[databaseOf(p)]}. ${p.database?.reason ?? ""}`);
        const api = await startApiRun(p, userInfo().username, o.maxCost !== undefined ? Number(o.maxCost) : undefined);
        if (!api) return log(`The web run's plan is not approved yet, so there is no contract to hand over. See: factory status ${p.web.run}`);
        log(`contract handed to ${p.api.repo}`);
        log(`API run ${api}. The web run goes on by itself: factory resume ${p.web.run}`);
        return d.runAndReport(api);
      }
      const [web, api] = [delivered(p.web.run), delivered(p.api.run)];
      log(`web run ${p.web.run}: ${web ? "delivered" : `not delivered yet (factory status ${p.web.run})`}`);
      log(`API run ${p.api.run}: ${api ? "delivered" : `not delivered yet (factory status ${p.api.run})`}`);
      if (web && api) log(`Both are delivered. Start them together: factory fullstack up ${p.name}`);
    });

  fs.command("database").argument("<name>").argument("[which]", "sqlite or postgres; none: say what it is now")
    .description("say what the product's API keeps its data in and why, or switch it while the API run has not started")
    .action((name: string, which: string | undefined) => {
      const p = loadProduct(name);
      const kind = databaseOption(which);
      if (!kind) return log(`${DATABASE_NAME[databaseOf(p)]}. ${p.database?.reason ?? ""}${p.api.run ? "" : ` To switch: factory fullstack database ${name} ${databaseOf(p) === "postgres" ? "sqlite" : "postgres"}`}`);
      setProductDatabase(p, kind);
      log(`The API of ${name} is on ${DATABASE_NAME[kind]} now: its skeleton and project are updated.`);
    });

  fs.command("up").argument("<name>")
    .description("check out the two delivered branches side by side and write the compose file that starts them together")
    .action((name: string) => {
      const p = loadProduct(name);
      const out = writeRunFiles(p);
      log(`Written to ${out}. Start both: docker compose -f ${out}/docker-compose.yml up\nThen open http://localhost:3000 (the API answers on http://localhost:5080).`);
    });
}
