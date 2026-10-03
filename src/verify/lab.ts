// The test lab for a project's stack: .NET (dotnet restore/build/test, TRX) or Node (npm, vitest JSON). Both take the same
// input and give the same output, so the build steps do not care which one judged a commit.
import type { ProjectConfig } from "../config/project.js";
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
