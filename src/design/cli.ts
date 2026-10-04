// `factory design ...`: run the design toolkit by hand on any local repo.
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Command } from "commander";
import { cleanBrief } from "./brief.js";
import { captureReports } from "./capture.js";
import { compareReports, diffFromGit, lintDiff, overall, type StateReport } from "./fidelity.js";
import { buildInventory, inventorySummary } from "./inventory.js";
import { readdirSync } from "node:fs";
import { NOTICEABLE_RATIO, pixelDiff } from "./pixeldiff.js";
import { detectLayout } from "./layout.js";
import { plannedChanges, sizeChange, sizeFromGit, type SizeInput, type SizeResult } from "./size.js";
import { dirSource, gitSource, type FileSource } from "./source.js";
import { allIndustries, archetypeBrief, briefFor, loadMeasured, loadUserIndustries, measuredPath, resolveBrand, userIndustriesDir } from "./refs/index.js";
import { measureAndSave } from "./refs/measure.js";
import { detectUiTarget, isKitTarget, kitTarget, listKits, loadKit, resolveUiTarget, UI_TARGETS, type KitTarget } from "./kit/index.js";
import { loadProject } from "../config/project.js";

const out = (m: string): void => { process.stdout.write(`${m}\n`); };

function source(repo: string, ref?: string): FileSource {
  return ref ? gitSource(repo, ref) : dirSource(repo);
}

function printSize(r: SizeResult, json?: boolean): void {
  if (json) return out(JSON.stringify(r, null, 2));
  out(`UI size: ${r.name} (${r.mode} mode, ${r.uiFiles} UI file(s))`);
  out(`Design work: ${r.work}`);
  for (const w of r.reasons) out(`  - ${w}`);
}

/** `first` adds commands ahead of the toolkit's (the design runs), so they head the help. */
export function registerDesignCommands(program: Command, first?: (design: Command) => void): Command {
  const design = program.command("design").description("design runs (start, show, list, open, check-refs) and the design toolkit: inventory, UI change size, fidelity lint, brief cleaner, industry references");
  first?.(design);

  const kit = design.command("kit").description("the UI kits an approved design is built with (docs/estimates-design.md, \"Kit and scaffold\")");
  kit.command("list").option("--json", "print JSON")
    .description("the kits, their versions and the UI targets they draw")
    .action((o: { json?: boolean }) => {
      const rows = listKits().map((id) => {
        const k = loadKit(id);
        return { id, version: k.manifest.version, targets: Object.keys(k.manifest.targets), blocks: Object.keys(k.manifest.blocks).length, controls: Object.keys(k.manifest.controls).length, overlays: Object.keys(k.manifest.overlays).length, files: k.files.length, dir: k.dir };
      });
      if (o.json) return out(JSON.stringify(rows, null, 2));
      if (!rows.length) return out("No UI kits installed (kits/ is missing).");
      for (const r of rows) out(`${r.id} ${r.version}  targets ${r.targets.join(", ")}  ${r.blocks} blocks, ${r.controls} field kinds, ${r.overlays} layers, ${r.files} files  ${r.dir}`);
      out(`(the target "repo" uses no kit: the repo's own components)`);
    });
  kit.command("show").argument("[target]", `${UI_TARGETS.filter((t) => t !== "repo").join(" or ")}`, "next-shadcn").option("--json", "print JSON")
    .description("what a target gets: where the kit and theme go, the packages, each block's component and how blocks change with width")
    .action((target: string, o: { json?: boolean }) => {
      if (!isKitTarget(target)) throw new Error(`No kit target ${target}: use ${UI_TARGETS.filter((t) => t !== "repo").join(" or ")} ("repo" builds with the repo's own components)`);
      const k = loadKit();
      const t = kitTarget(k, target as KitTarget);
      const m = k.manifest;
      const deps = { ...m.dependencies, ...m.targetDependencies[target] };
      const view = { kit: `${m.id} ${m.version}`, target, ...t, dependencies: deps, devDependencies: m.devDependencies[target] ?? {}, blocks: m.blocks, controls: m.controls, overlays: m.overlays, responsive: m.responsive };
      if (o.json) return out(JSON.stringify(view, null, 2));
      out(`${target}: kit ${m.id} ${m.version} (${t.framework}); kit under "${t.root || "."}" in a fresh app; theme ${t.theme}; stylesheet ${t.stylesheet}`);
      out(`packages: ${Object.entries(deps).map(([n, v]) => `${n}@${v}`).join(", ")}`);
      out(`blocks:`);
      for (const [b, p] of Object.entries(m.blocks)) out(`  ${b.padEnd(14)} ${p.component} (${p.file})`);
      out(`field kinds: ${Object.keys(m.controls).join(", ")}`);
      out(`layers: ${Object.entries(m.overlays).map(([n, p]) => `${n} → ${p.component}`).join(", ")}`);
      out(`with width:`);
      for (const r of m.responsive) out(`  ${r.block ?? r.part ?? r.shell} below ${r.below}: ${r.becomes}`);
    });
  design.command("target").argument("<repo>", "path to the repo")
    .option("--ref <commit>", "read the files at this commit instead of the working folder")
    .option("--project <name>", "apply this project's design.uiTarget / uiTargets")
    .option("--json", "print JSON")
    .description("the UI target a build would use in this repo: what package.json shows, and the project's setting over it")
    .action((repo: string, o: { ref?: string; project?: string; json?: boolean }) => {
      const detected = detectUiTarget(source(resolve(repo), o.ref));
      const config = o.project ? loadProject(o.project).design : undefined;
      const resolved = resolveUiTarget({ detected, ...(config ? { config } : {}) });
      if (o.json) return out(JSON.stringify({ detected, ...resolved, ...(config?.uiTargets && Object.keys(config.uiTargets).length ? { perApp: config.uiTargets } : {}) }, null, 2));
      out(`detected: ${detected.target ?? "nothing to go on"} (${detected.why})${detected.root !== undefined ? `; kit under "${detected.root || "."}"${detected.alias ? ", @/ mapped" : ", relative imports"}` : ""}`);
      out(`target: ${resolved.target} (${resolved.source === "default" ? "the default; set design.uiTarget or pass --ui-target to choose" : `from ${resolved.source === "config" ? "the project" : resolved.source}`})`);
      for (const [app, t] of Object.entries(config?.uiTargets ?? {})) out(`  app ${app}: ${t} (the project's uiTargets)`);
      out(`a phone app is always built with the repo's own components`);
    });

  design.command("inventory").argument("<repo>", "path to a React or Next.js repo")
    .option("--ref <commit>", "read the files at this commit instead of the working folder")
    .option("--source-root <dir>", "source root, e.g. src (default: detected)")
    .option("--ui-dir <dir>", "building-blocks folder, e.g. src/components/ui (default: detected)")
    .option("--json", "print the full inventory as JSON")
    .option("--out <file>", "also write the JSON to a file")
    .description("scan the repo's design system: stack, tokens, building blocks, pages")
    .action((repo: string, o: { ref?: string; sourceRoot?: string; uiDir?: string; json?: boolean; out?: string }) => {
      const inv = buildInventory(source(resolve(repo), o.ref), { ...(o.sourceRoot !== undefined ? { sourceRoot: o.sourceRoot } : {}), ...(o.uiDir ? { uiDir: o.uiDir } : {}) });
      const json = JSON.stringify(inv, null, 2);
      if (o.out) writeFileSync(o.out, json);
      out(o.json ? json : `${inventorySummary(inv)}\n${inv.layout.notes.map((n) => `  (${n})`).join("\n")}`);
    });

  design.command("size")
    .option("--plan <file>", "JSON: { files: [{ path, change: add|modify|delete }] } or a plan with tasks[].fileScope")
    .option("--git <refs...>", "two commits: <base> <head>")
    .option("--repo <path>", "the repo (default: current folder)", ".")
    .option("--nav-raises", "count navigation edits as design-system changes (the original rule)")
    .option("--json", "print JSON")
    .description("size of a UI change: no UI / screen tweak / new screen / design-system change")
    .action((o: { plan?: string; git?: string[]; repo: string; navRaises?: boolean; json?: boolean }) => {
      const repo = resolve(o.repo);
      if (!!o.plan === !!o.git) throw new Error("Give either --plan <file> or --git <base> <head>");
      if (o.git) {
        if (o.git.length !== 2) throw new Error("--git takes two commits: <base> <head>");
        return printSize(sizeFromGit(repo, o.git[0]!, o.git[1]!, { navRaises: !!o.navRaises }), o.json);
      }
      const plan = JSON.parse(readFileSync(o.plan!, "utf8")) as SizeInput & { tasks?: { fileScope: string[] }[] };
      const src = dirSource(repo);
      const hasPkg = src.read("package.json") !== undefined;
      const layout = hasPkg ? detectLayout(src) : undefined;
      const input: SizeInput = plan.tasks ? { files: plannedChanges(plan.tasks.flatMap((t) => t.fileScope), src, layout) } : plan;
      printSize(sizeChange(input, { ...(layout ? { layout } : {}), navRaises: !!o.navRaises }), o.json);
    });

  design.command("lint")
    .requiredOption("--git <refs...>", "two commits: <approved-or-base> <head>")
    .option("--repo <path>", "the repo (default: current folder)", ".")
    .option("--json", "print JSON")
    .description("fidelity lint of a change: tokens only, existing components only, no new building blocks")
    .action((o: { git: string[]; repo: string; json?: boolean }) => {
      if (o.git.length !== 2) throw new Error("--git takes two commits: <base> <head>");
      const repo = resolve(o.repo);
      const inv = buildInventory(gitSource(repo, o.git[0]!));
      const results = lintDiff(inv, diffFromGit(repo, o.git[0]!, o.git[1]!));
      if (o.json) out(JSON.stringify({ overall: overall(results), results }, null, 2));
      else {
        for (const r of results) {
          out(`${r.status.padEnd(9)} ${r.check.padEnd(34)} ${r.detail}`);
          for (const i of r.items?.slice(0, 8) ?? []) out(`          - ${i}`);
        }
        out(`overall: ${overall(results)}`);
      }
      if (overall(results) !== "pass") process.exitCode = 1;
    });

  design.command("capture")
    .requiredOption("--page <name=url...>", "a page to take, as name=url (the app must already be running)")
    .requiredOption("--out <dir>", "folder for the screenshots and reports.json")
    .description("screenshot and report pages of a running app at phone, tablet and desktop width")
    .action(async (o: { page: string[]; out: string }) => {
      const pages = o.page.map((p) => { const i = p.indexOf("="); if (i < 1) throw new Error(`--page wants name=url, got "${p}"`); return { name: p.slice(0, i), url: p.slice(i + 1) }; });
      const r = await captureReports(pages, resolve(o.out));
      writeFileSync(join(resolve(o.out), "reports.json"), JSON.stringify(r.reports, null, 2));
      out(`${r.reports.length} report(s), ${r.files.length} screenshot(s) in ${o.out}${r.note ? `\nnote: ${r.note}` : ""}`);
      if (r.note && !r.reports.length) process.exitCode = 1;
    });

  design.command("compare").argument("<approved.json>", "reports.json from the approved version").argument("<final.json>", "reports.json from the built app")
    .option("--json", "print JSON")
    .description("compare two capture reports: layout, accessibility, sideways scroll; exits 1 on a failure")
    .action((approved: string, final: string, o: { json?: boolean }) => {
      const read = (f: string) => JSON.parse(readFileSync(f, "utf8")) as StateReport[];
      const results = compareReports(read(approved), read(final));
      if (o.json) out(JSON.stringify({ overall: overall(results), results }, null, 2));
      else {
        for (const r of results) {
          out(`${r.status.padEnd(9)} ${r.check.padEnd(34)} ${r.detail}`);
          for (const i of r.items?.slice(0, 8) ?? []) out(`          - ${i}`);
        }
        out(`overall: ${overall(results)}`);
      }
      if (overall(results) === "fail") process.exitCode = 1;
    });

  design.command("pixel").argument("<baseDir>", "screenshots from the before version (from design capture)").argument("<finalDir>", "screenshots from the after version")
    .requiredOption("--out <dir>", "folder for the difference pictures")
    .option("--tolerance <n>", "a colour channel must move by more than this (0-255) to count", "16")
    .option("--json", "print JSON")
    .description("compare two folders of screenshots pixel by pixel and draw where they differ (facts, not a pass or fail)")
    .action(async (baseDir: string, finalDir: string, o: { out: string; tolerance: string; json?: boolean }) => {
      const names = readdirSync(resolve(finalDir)).filter((f) => f.endsWith(".png") && readdirSync(resolve(baseDir)).includes(f));
      const r = await pixelDiff(names.map((f) => ({ name: f, base: join(resolve(baseDir), f), final: join(resolve(finalDir), f), out: join(resolve(o.out), f) })), Number(o.tolerance));
      if (o.json) return out(JSON.stringify(r, null, 2));
      for (const x of r.results) out(`${(x.ratio * 100).toFixed(2).padStart(6)}%  ${x.name}${x.sizeChanged ? "  (page size changed)" : ""}${x.ratio > NOTICEABLE_RATIO || x.sizeChanged ? "  <- differs noticeably" : ""}`);
      out(`${r.results.length} pair(s) compared, pictures in ${o.out}${r.note ? `\nnote: ${r.note}` : ""}`);
    });

  design.command("brief").argument("<extract.json>", "an untrusted design extract (Figma export, screenshot reading, brand guide)")
    .option("--repo <path>", "the repo, for its component inventory", ".")
    .option("--brand-font <name...>", "brand fonts to allow")
    .description("clean an untrusted design extract into typed fields; print what was dropped")
    .action((file: string, o: { repo: string; brandFont?: string[] }) => {
      const inv = buildInventory(dirSource(resolve(o.repo)));
      const r = cleanBrief(JSON.parse(readFileSync(file, "utf8")), inv, { brandFonts: o.brandFont ?? [] });
      out(JSON.stringify(r, null, 2));
    });
  const refs = design.command("refs").description("industry design references: how real products in a field are coloured (feeds the design step)");
  refs.command("list").description("industries, their brands and whether each colour is measured")
    .action(() => {
      const m = loadMeasured();
      for (const i of allIndustries()) {
        out(`${i.id.padEnd(13)} ${i.label}  [${i.archetype}]`);
        for (const raw of i.brands) { const b = resolveBrand(raw, m); out(`  ${b.name.padEnd(20)} ${b.brand}${b.accent ? ` ${b.accent}` : ""}  ${b.measured ? "measured" : "reported"}`); }
      }
      for (const p of loadUserIndustries().problems) out(`ignored (${userIndustriesDir()}): ${p}`);
    });
  refs.command("show").argument("[text...]", "an industry id (airline) or requirement text; the brief the design step would receive")
    .action((words: string[]) => {
      const t = words.join(" ");
      const byId = allIndustries().filter((i) => i.id === t.trim().toLowerCase());
      out(byId.length ? briefFor(byId.flatMap((i) => i.keywords).join(" "), byId) : briefFor(t) || archetypeBrief());
    });
  refs.command("measure").option("--industry <id...>", "only these industries (default: all)")
    .description("open each brand's live site on a phone viewport and store its real colours (needs network access to those sites)")
    .action(async (o: { industry?: string[] }) => {
      const r = await measureAndSave(o.industry ?? []);
      for (const x of r.results) out(`${x.reading?.brand ? "ok   " : "none "} ${x.name.padEnd(20)} ${x.reading?.brand ?? x.error ?? "no colour found"}`);
      out(`${r.saved} brand(s) stored in ${measuredPath()}${r.note ? `\nnote: ${r.note}` : ""}`);
    });
  return design;
}
