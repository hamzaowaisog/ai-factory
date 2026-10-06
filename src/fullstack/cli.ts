// `factory fullstack`: one request, a web repo and an API repo held to one API contract (src/fullstack/product.ts).
import { userInfo } from "node:os";
import { resolve } from "node:path";
import type { Command } from "commander";
import { gatherRequest } from "../sources/request.js";
import { delivered, loadProduct, startApiRun, startProduct, writeRunFiles } from "./product.js";

export function registerFullstackCommands(program: Command, d: { log: (m: string) => void; runAndReport: (runId: string) => Promise<void> }): void {
  const { log } = d;
  const fs = program.command("fullstack").description("a new product with a web app and an API: two repos, two runs, one locked API contract");

  fs.command("start")
    .argument("[prompt]", "what the product does, in plain words")
    .requiredOption("--name <name>", "the product's short name: the repos are <name>-web and <name>-api")
    .option("--file <path>", "the requirements as a Markdown or text file")
    .option("--dir <folder>", "where the two repos go", ".")
    .option("--max-cost <usd>", "cost limit of the web run")
    .description("make the two repos and start the web run: questions, the design, then the plan with the API contract")
    .action(async (prompt: string | undefined, o: { name: string; file?: string; dir: string; maxCost?: string }) => {
      const req = await gatherRequest({ prompt, file: o.file }, {});
      const p = await startProduct(o.name, resolve(o.dir), req, userInfo().username, o.maxCost !== undefined ? Number(o.maxCost) : undefined);
      log(`web repo ${p.web.repo} (project ${p.web.project}); API repo ${p.api.repo} (project ${p.api.project})`);
      log(`web run ${p.web.run}. Answer its cards as usual; once its plan is approved: factory fullstack next ${p.name}`);
      await d.runAndReport(p.web.run!);
    });

  fs.command("next").argument("<name>")
    .option("--max-cost <usd>", "cost limit of the API run")
    .description("the next step: hand the approved contract to the API repo and start the API run, or say where each run is")
    .action(async (name: string, o: { maxCost?: string }) => {
      const p = loadProduct(name);
      if (!p.api.run) {
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

  fs.command("up").argument("<name>")
    .description("check out the two delivered branches side by side and write the compose file that starts them together")
    .action((name: string) => {
      const p = loadProduct(name);
      const out = writeRunFiles(p);
      log(`Written to ${out}. Start both: docker compose -f ${out}/docker-compose.yml up\nThen open http://localhost:3000 (the API answers on http://localhost:5080).`);
    });
}
