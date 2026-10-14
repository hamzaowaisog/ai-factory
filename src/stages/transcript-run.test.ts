import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, expect, it } from "vitest";
import { HUMAN_WRITER, Ledger } from "../ledger/ledger.js";
import { replay } from "../ledger/state.js";

beforeEach(() => { process.env.FACTORY_HOME = mkdtempSync(join(tmpdir(), "factory-tr-")); });

it("run.created carries the transcript's sha into the run info", async () => {
  const l = Ledger.create(`20261014-tr-${Math.random().toString(16).slice(2, 6)}`);
  const t = { format: "gemini-meet", notes: "", turns: [{ id: "T-1", time: "00:00:01", speaker: "A", text: "hi" }], speakers: ["A"] };
  const sha = l.putJson(t);
  await l.append({ type: "run.created", data: { mode: "estimate", project: "demo", request: "T-1 [00:00:01] A: hi", operator: "sam", transcriptSha: sha, sources: [{ kind: "transcript", name: "m.docx" }] } }, HUMAN_WRITER);
  expect(replay(l.events()).info.transcriptSha).toBe(sha);
});
