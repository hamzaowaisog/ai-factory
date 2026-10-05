// `factory conventions build` and `approve`. Run by hand, once per project, never by a trigger.
import { readFileSync } from "node:fs";
import { userInfo } from "node:os";
import { join } from "node:path";
import type { Command } from "commander";
import { loadProject } from "../config/project.js";
import { findConflicts } from "../conventions/build.js";
import { renderGuidelines, parseGuidelines } from "../conventions/markdown.js";
import { DEFAULT_SAMPLE, toConventions } from "../conventions/mine.js";
import { scanRepo } from "../conventions/scan.js";
import { parseSkillRules } from "../conventions/stackpack.js";
import { currentSha, guidelinesPath, readApproved, recordApproval, writeGuidelines } from "../conventions/store.js";
import { noSkillsNote, readSkills } from "../conventions/skills.js";
import { fromToolConfig } from "../conventions/toolconfig.js";

export function registerConventions(program: Command, log: (s: string) => void): void {
  const conventions = program.command("conventions")
    .description("the coding guidelines a merge review judges against");

  conventions.command("build").requiredOption("--project <name>")
    .option("--sample <n>", "how many files the scan may read", String(DEFAULT_SAMPLE))
    .option("--model <id>", "the model that reads the code")
    .description("scan this repo once and write the guidelines (run by hand; never automatic)")
    .action(async (o: { project: string; sample: string; model?: string }) => {
      const cfg = loadProject(o.project);
      const { createSnapshot, snapshotDir } = await import("../context/snapshot.js");
      const { resolveRef } = await import("../ledger/git.js");
      const { modelFor } = await import("../stages/routing.js");

      const commit = await resolveRef(cfg.repo, cfg.baseBranch);
      const snap = createSnapshot(cfg.repo, commit, snapshotDir(`conventions-${o.project}`, commit), cfg.noGo);
      const model = o.model ?? modelFor(cfg, "review", 0).model;
      log(`reading ${cfg.project} @ ${commit.slice(0, 8)} with ${model}`);

      const mined = toConventions(await scanRepo({
        snap, repo: cfg.repo, model, noGo: cfg.noGo, sample: Number(o.sample), log,
      }));
      const declared = fromToolConfig((p) => snap.files.includes(p));
      // shared skills from ~/.factory/skills, overridden by anything the repo carries itself
      const skills = readSkills(cfg.repo);
      if (skills.length === 0) log(noSkillsNote(cfg.repo));
      const external = skills.flatMap((sk) => parseSkillRules(join(sk.dir, sk.name, "SKILL.md"), sk.text));

      const all = [...mined, ...declared, ...external];
      const conflicts = findConflicts(all);
      const sha = writeGuidelines(o.project, renderGuidelines({
        project: o.project, builtAt: new Date().toISOString().slice(0, 10), conventions: all, conflicts,
      }));

      const blocking = all.filter((c) => c.status === "confirmed" && c.check).length;
      log(``);
      log(`Written to ${guidelinesPath(o.project)}`);
      const layers = skills.map((sk) => `${sk.name} (${sk.layer})`).join(", ");
      log(`${all.length} rules — ${mined.length} mined, ${declared.length} declared, ${external.length} external${layers ? ` from ${layers}` : ""}`);
      log(`${blocking} of them can block a merge. The external ones never can.`);
      if (conflicts.length) {
        log(``);
        log(`⚠  ${conflicts.length} conflict${conflicts.length === 1 ? "" : "s"} between the skill files and your code.`);
        for (const c of conflicts) log(`   ${c.a} vs ${c.b} — ${c.why}`);
        log(`   Read section 4 before approving. Your repository wins.`);
      }
      log(``);
      log(`Nothing uses these rules until you approve them:`);
      log(`  factory conventions approve --project ${o.project} ${sha.slice(0, 12)}`);
    });

  conventions.command("approve").requiredOption("--project <name>")
    .argument("<hash>", "first characters of the hash the build printed")
    .description("approve the guidelines (a person, in a terminal — no script and no agent can)")
    .action((hash: string, o: { project: string }) => {
      const sha = currentSha(o.project);
      if (!sha) {
        log(`No guidelines for ${o.project}. Build them first: factory conventions build --project ${o.project}`);
        process.exit(1);
      }
      if (hash.length < 8 || !sha.startsWith(hash)) {
        log(`That hash does not match ${guidelinesPath(o.project)}.`);
        log(`The file now hashes to ${sha.slice(0, 12)}. Read it, then approve that.`);
        process.exit(1);
      }
      // refuse to approve a file the gate would not be able to read
      try {
        parseGuidelines(readFileSync(guidelinesPath(o.project), "utf8"));
      } catch (e) {
        log(`Refusing: ${(e as Error).message}`);
        process.exit(1);
      }
      recordApproval(o.project, sha, userInfo().username);
      log(`Approved ${sha.slice(0, 12)} as ${userInfo().username}. Every review now judges against this file.`);
      log(`Edit it and it is unapproved again.`);
    });

  conventions.command("show").requiredOption("--project <name>")
    .description("print the guidelines and whether they are approved")
    .action((o: { project: string }) => {
      const got = readApproved(o.project);
      if ("unapproved" in got) { log(got.unapproved); process.exit(1); }
      log(got.markdown);
    });
}
