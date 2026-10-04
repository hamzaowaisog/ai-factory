// The test lab for a project's stack: .NET (dotnet restore/build/test, TRX) or Node (npm, vitest JSON). Both take the same
// input and give the same output, so the build steps do not care which one judged a commit.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ProjectConfig } from "../config/project.js";
import { sha256 } from "../util/hash.js";
import { FEED_PROXY_URL, FEEDS_NET } from "../runners/netinfra.js";
import { hostUser, produceDotnetTests, type ProduceInput, type ProduceOutput } from "./dotnet.js";
import { INSTALL_CMD, NODE_ENV, nodeNameFilter, produceNodeTests } from "./node.js";
import { stopAndRemove, type ContainerRuntime } from "./runtime.js";

export interface Lab {
  produce(inp: ProduceInput): Promise<ProduceOutput>;
  /** a filter that runs only the tests with these names (method names for .NET, test titles for Node) */
  nameFilter(names: string[]): string;
}

const dotnetLab: Lab = { produce: produceDotnetTests, nameFilter: (names) => names.map((n) => `FullyQualifiedName~.${n}`).join("|") };
const nodeLab: Lab = { produce: produceNodeTests, nameFilter: nodeNameFilter };

export function labFor(project: Pick<ProjectConfig, "stack">): Lab {
  return project.stack === "node" ? nodeLab : dotnetLab;
}

/**
 * A Node checkout's packages, installed into the checkout itself (node_modules, which a fresh app's .gitignore leaves out) so a
 * coding agent, which has no network, can typecheck and run its tests. npm registry only, through the feed proxy; no install scripts.
 */
/** What the installed node_modules were made from: package.json and the lockfile, hashed together. */
export function installKey(dir: string): string {
  const read = (f: string) => (existsSync(join(dir, f)) ? readFileSync(join(dir, f), "utf8") : "");
  return sha256(`package.json\n${read("package.json")}\npackage-lock.json\n${read("package-lock.json")}`);
}

const INSTALL_MARK = join("node_modules", ".factory-install-key");

/** True when node_modules is there and was installed from today's package.json and lockfile (PR #17 review, item 7). */
export function installIsCurrent(dir: string): boolean {
  try { return readFileSync(join(dir, INSTALL_MARK), "utf8").trim() === installKey(dir); } catch { return false; }
}

/** Record what node_modules was installed from, after a good install (the install may have written the lockfile). */
export function markInstalled(dir: string): void {
  writeFileSync(join(dir, INSTALL_MARK), installKey(dir));
}

export async function installNodeModules(rt: ContainerRuntime, o: { runId: string; key: string; dir: string; cache: string; image: string; timeoutSec: number; onContainer?: (id: string) => Promise<void>; onRemoved?: (id: string) => Promise<void> }): Promise<{ ok: boolean; log: string }> {
  const id = await rt.create({
    role: "restore", image: o.image, network: FEEDS_NET, workdir: "/src", user: hostUser(), labels: { run: o.runId, key: o.key },
    env: { ...NODE_ENV, HTTPS_PROXY: FEED_PROXY_URL, HTTP_PROXY: FEED_PROXY_URL },
    mounts: [{ src: o.dir, dst: "/src" }, { src: o.cache, dst: "/npm-cache" }], cmd: INSTALL_CMD,
  });
  await o.onContainer?.(id);
  try {
    await rt.start(id);
    const code = await rt.wait(id, o.timeoutSec * 1000);
    return { ok: code === 0, log: await rt.logs(id) };
  } finally {
    await stopAndRemove(rt, id);
    await o.onRemoved?.(id);
  }
}
