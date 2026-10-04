import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { HUMAN_WRITER, Ledger } from "../src/ledger/ledger.js";
import { leaksIn, publishRun, scrub, writeReadme } from "./publish.js";

beforeEach(() => { process.env.FACTORY_HOME = mkdtempSync(join(tmpdir(), "publish-home-")); });

async function run(id: string, project: string, note: string): Promise<Ledger> {
  const l = Ledger.create(id);
  await l.append({ type: "run.created", data: { mode: "brownfield", project, request: "POST /api/x returns 400; make it 409" } }, HUMAN_WRITER);
  writeFileSync(join(l.dir, "run.log"), note);
  return l;
}

describe("publishing evidence to a public repo", () => {
  it("refuses a run whose project isn't on the public allowlist, and writes nothing", async () => {
    await run("20261004-client-thing-aaaa", "acme-client", "private code");
    const out = mkdtempSync(join(tmpdir(), "evidence-"));
    const p = publishRun("20261004-client-thing-aaaa", { forbidden: [], evidence: out });
    expect(p.refused).toMatch(/not on the public allowlist/);
    expect(existsSync(join(out, "runs"))).toBe(false);
  });

  it("scrubs home paths, the user and host names, emails and secrets", () => {
    const t = scrub(`at ${homedir()}/code/x and /home/someone/y by jane@example.com key sk-ant-${"a".repeat(30)} for ops on box1`, { user: "ops", host: "box1" });
    expect(t).toBe(`at ~/code/x and ~/y by «email» key «SECRET» for operator on host`);
  });

  it("finds what is still unsafe: a secret, a /home/ path, a local project's name", () => {
    expect(leaksIn("f", "clean text", ["acme"])).toEqual([]);
    expect(leaksIn("f", `token sk-ant-${"b".repeat(30)}`, [])[0]).toMatch(/secret/);
    expect(leaksIn("f", "see /home/x/y", [])).toEqual(["f: a /home/ path"]);
    expect(leaksIn("f", "built for Acme-Portal", ["acme"])).toEqual(['f: "acme"']);
  });

  it("publishes a public run: a scrubbed ledger, its row and record, and the judges' table", async () => {
    await run("20261004-vsa-thing-bbbb", "vsa", `worked in ${homedir()}/.factory and mailed ops@example.org`);
    const out = mkdtempSync(join(tmpdir(), "evidence-"));
    const p = publishRun("20261004-vsa-thing-bbbb", { forbidden: [], evidence: out });
    expect(p).toMatchObject({ folder: "runs/2026-10-04-vsa-thing-bbbb", archiveKept: true });
    const dir = join(out, "runs", "2026-10-04-vsa-thing-bbbb");
    const unpacked = mkdtempSync(join(tmpdir(), "unpacked-"));
    execFileSync("tar", ["-xzf", join(dir, "ledger.tar.gz"), "-C", unpacked]);
    expect(readFileSync(join(unpacked, "run.log"), "utf8")).toBe("worked in ~/.factory and mailed «email»");
    expect(JSON.parse(readFileSync(join(dir, "row.json"), "utf8"))).toMatchObject({ runId: "20261004-vsa-thing-bbbb", project: "vsa" });
    writeFileSync(join(out, "gaps.md"), "## Honest gaps\n- one case run once");
    writeReadme(out);
    const readme = readFileSync(join(out, "README.md"), "utf8");
    expect(readme).toContain("| 2026-10-04 | not recorded | POST /api/x returns 400; make it 409 |");
    expect(readme).toContain("[2026-10-04-vsa-thing-bbbb](runs/2026-10-04-vsa-thing-bbbb/)");
    expect(readme).toContain("## Honest gaps");
  });
});

describe("the committed evidence/ folder", () => {
  it("holds no secret, /home/ path or email address, inside the archives too", async () => {
    const { EVIDENCE } = await import("./publish.js");
    if (!existsSync(EVIDENCE)) return;
    const { readdirSync, statSync, rmSync } = await import("node:fs");
    const walk = (d: string): string[] => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
    const unpacked = mkdtempSync(join(tmpdir(), "evidence-scan-"));
    for (const t of walk(EVIDENCE).filter((f) => f.endsWith(".tar.gz"))) {
      const d = join(unpacked, String(Math.random()).slice(2));
      execFileSync("mkdir", ["-p", d]);
      execFileSync("tar", ["-xzf", t, "-C", d]);
    }
    const files = [...walk(EVIDENCE).filter((f) => !f.endsWith(".tar.gz")), ...walk(unpacked)];
    const leaks = files.flatMap((f) => leaksIn(f, readFileSync(f, "utf8"), []));
    rmSync(unpacked, { recursive: true, force: true });
    expect(leaks).toEqual([]);
  });
});
