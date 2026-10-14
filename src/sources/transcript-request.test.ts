// A Google Meet export given as a request file (factory start|estimate|design start --file, or the web form's file drop).
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { describeSources, gatherRequest } from "./request.js";
import { makeDocx } from "./testutil.js";

const sample = readFileSync(new URL("./fixtures/meet-sample.txt", import.meta.url), "utf8");
async function writeDocx(name: string, paragraphs: string[]): Promise<string> {
  const p = join(mkdtempSync(join(tmpdir(), "factory-meet-")), name);
  writeFileSync(p, await makeDocx(paragraphs));
  return p;
}

describe("a transcript as a request", () => {
  it("a Meet export is a transcript source with parsed turns", async () => {
    const r = await gatherRequest({ file: await writeDocx("meeting.docx", sample.split("\n")) });
    expect(r.sources[0]).toMatchObject({ kind: "transcript", name: "meeting.docx" });
    expect(r.transcript!.turns.length).toBe(15);
    expect(r.text.split("\n")[0]).toMatch(/^T-1 \[00:00:41\] Alex Morgan:/);
    expect(describeSources(r.sources)).toBe("meeting meeting.docx");
  });
  it("an ordinary .docx stays a docx source", async () => {
    const r = await gatherRequest({ file: await writeDocx("req.docx", ["Requirements", "Users can log in."]) });
    expect(r.sources[0]!.kind).toBe("docx");
    expect(r.transcript).toBeUndefined();
  });
  it("a transcript must be the whole request", async () => {
    await expect(gatherRequest({ prompt: "also add SSO", file: await writeDocx("meeting.docx", sample.split("\n")) })).rejects.toThrow(/whole request/);
  });
});
