// Building the guidelines, by hand (`factory conventions build`) or by the factory itself: a project with no
// guidelines file gets one built and approved as `factory` when a run or a review pass starts, so nobody has to
// run the two commands first. A file a person built or edited is theirs to approve, and is never touched here.
import { join } from "node:path";
import type { ProjectConfig } from "../config/project.js";
import type { Convention } from "../contracts/index.js";
import { surveyRepo } from "../context/survey.js";
import { type Conflict, findConflicts } from "./build.js";
import { renderGuidelines } from "./markdown.js";
import { DEFAULT_SAMPLE, sampleForScan, toConventions } from "./mine.js";
import { scanRepo } from "./scan.js";
import { noSkillsNote, readSkills } from "./skills.js";
import { parseSkillRules } from "./stackpack.js";
import { approvalOf, currentSha, guidelinesPath, recordApproval, writeGuidelines } from "./store.js";
import { fromToolConfig } from "./toolconfig.js";

/** who approved a file the factory built itself */
export const FACTORY_APPROVER = "factory";

export interface BuiltGuidelines {
  markdown: string;
  /** the base branch commit that was read */
  commit: string;
  /** false when the base branch holds no code yet (a new product before its first merge): nothing was mined */
  scanned: boolean;
  all: Convention[]; mined: Convention[]; declared: Convention[]; external: Convention[];
  skills: ReturnType<typeof readSkills>;
  conflicts: Conflict[];
}

export interface BuildOpts {
  sample?: number;
  model?: string;
  log: (msg: string) => void;
  /** a base branch with no code is not an error: the file is built from the tool config and the skill files alone */
  emptyOk?: boolean;
  /** what reads the code; a test swaps it */
  scan?: typeof scanRepo;
}

/** Reads the base branch and returns the guidelines file, unwritten. */
export async function buildGuidelines(cfg: ProjectConfig, o: BuildOpts): Promise<BuiltGuidelines> {
  const { createSnapshot, snapshotDir } = await import("../context/snapshot.js");
  const { resolveRef } = await import("../ledger/git.js");
  const { modelFor } = await import("../stages/routing.js");

  const commit = await resolveRef(cfg.repo, cfg.baseBranch);
  const snap = createSnapshot(cfg.repo, commit, snapshotDir(`conventions-${cfg.project}`, commit), cfg.noGo);
  const sample = o.sample ?? DEFAULT_SAMPLE;
  const scanned = !o.emptyOk || sampleForScan(snap.files, surveyRepo(snap, cfg.repo), sample).length > 0;
  let mined: Convention[] = [];
  if (scanned) {
    const model = o.model ?? modelFor(cfg, "review", 0).model;
    o.log(`reading ${cfg.project} @ ${commit.slice(0, 8)} with ${model}`);
    mined = toConventions(await (o.scan ?? scanRepo)({ snap, repo: cfg.repo, model, noGo: cfg.noGo, sample, log: o.log }));
  }
  const declared = fromToolConfig((p) => snap.files.includes(p));
  // shared skills from ~/.factory/skills, overridden by anything the repo carries itself
  const skills = readSkills(cfg.repo);
  if (skills.length === 0) o.log(noSkillsNote(cfg.repo));
  const external = skills.flatMap((sk) => parseSkillRules(join(sk.dir, sk.name, "SKILL.md"), sk.text));

  const all = [...mined, ...declared, ...external];
  const conflicts = findConflicts(all);
  const markdown = renderGuidelines({ project: cfg.project, builtAt: new Date().toISOString().slice(0, 10), conventions: all, conflicts });
  return { markdown, commit, scanned, all, mined, declared, external, skills, conflicts };
}

export type Ensured = "kept" | "built" | "failed" | "off";

const building = new Map<string, Promise<Ensured>>();

/**
 * Makes sure the project has guidelines, without a person: none yet, and the factory builds the file and approves
 * it. A file built while the base branch held no code is built once more when the base branch has code to read.
 * Anything else (a file a person built, approved or edited) is left exactly as it is. Never throws: a build that
 * fails leaves the project as it was, and the gate that cannot check says why.
 */
export function ensureGuidelines(cfg: ProjectConfig, log: (msg: string) => void, o: Pick<BuildOpts, "scan"> = {}): Promise<Ensured> {
  // tests build nothing unless they bring their own scan; FACTORY_NO_AUTO_GUIDELINES keeps the build and the approval by hand
  if ((process.env.VITEST && !o.scan) || process.env.FACTORY_NO_AUTO_GUIDELINES === "1") return Promise.resolve("off");
  const going = building.get(cfg.project);
  if (going) return going;
  const p = ensure(cfg, log, o).catch((e: Error): Ensured => {
    log(`coding guidelines for ${cfg.project} were not built: ${e.message.split("\n")[0]}`);
    return "failed";
  }).finally(() => building.delete(cfg.project));
  building.set(cfg.project, p);
  return p;
}

async function ensure(cfg: ProjectConfig, log: (msg: string) => void, o: Pick<BuildOpts, "scan">): Promise<Ensured> {
  const project = cfg.project;
  const sha = currentSha(project);
  if (sha) {
    const rec = approvalOf(project);
    // only the factory's own file, unedited, built before there was code to read, is built again
    if (!rec || rec.by !== FACTORY_APPROVER || rec.sha !== sha || rec.auto?.scanned !== false) return "kept";
    const { resolveRef } = await import("../ledger/git.js");
    if (await resolveRef(cfg.repo, cfg.baseBranch) === rec.auto.commit) return "kept";
  }
  const built = await buildGuidelines(cfg, { log, emptyOk: true, scan: o.scan });
  if (sha && !built.scanned) {
    // the base branch moved and still has no code: remember the commit, keep the file
    recordApproval(project, sha, FACTORY_APPROVER, { commit: built.commit, scanned: false });
    return "kept";
  }
  // a file with no rules cannot be used to check anything, and the store refuses it
  if (built.all.length === 0) throw new Error("the base branch has no code yet and no skill files are installed, so there is nothing to build them from");
  const written = writeGuidelines(project, built.markdown);
  recordApproval(project, written, FACTORY_APPROVER, { commit: built.commit, scanned: built.scanned });
  const blocking = built.all.filter((c) => c.status === "confirmed" && c.check).length;
  log(`coding guidelines for ${project} built and approved by the factory: ${built.all.length} rules (${built.mined.length} from the code, ${built.declared.length} declared, ${built.external.length} outside best practices), ${blocking} can block a merge. ${built.scanned ? "" : "The base branch has no code yet, so they are built again once it has. "}${guidelinesPath(project)}`);
  return "built";
}
