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
    expect(r.text.split("\n")[0]).toBe("# Meeting Jan 5, 2026 at 10:00 PKT");
    expect(r.text.split("\n")[2]).toMatch(/^T-1 \[00:00:41\] Alex Morgan:/);
    expect(describeSources(r.sources)).toBe("meeting meeting.docx");
  });
  it("an ordinary .docx stays a docx source", async () => {
    const r = await gatherRequest({ file: await writeDocx("req.docx", ["Requirements", "Users can log in."]) });
    expect(r.sources[0]!.kind).toBe("docx");
    expect(r.transcript).toBeUndefined();
  });
  it("a Meet export copied out as text is a transcript too", async () => {
    const p = join(mkdtempSync(join(tmpdir(), "factory-meet-")), "meeting.txt");
    writeFileSync(p, sample);
    const r = await gatherRequest({ file: p });
    expect(r.sources[0]).toMatchObject({ kind: "transcript", name: "meeting.txt" });
    expect(r.transcript!.turns.length).toBe(15);
  });
  it("a long meeting fits on a build run; another file that long still does not", async () => {
    const dir = mkdtempSync(join(tmpdir(), "factory-meet-"));
    const long = `${sample}\n${Array.from({ length: 1500 }, (_, i) => `00:${String(30 + Math.floor(i / 60)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}\nAlex Morgan: and then the booking screen should also show the clinic's opening hours for the week`).join("\n")}`;
    writeFileSync(join(dir, "long.txt"), long);
    expect(Buffer.byteLength(long)).toBeGreaterThan(100_000);
    expect((await gatherRequest({ file: join(dir, "long.txt") })).transcript).toBeDefined();
    writeFileSync(join(dir, "plain.txt"), "Users can log in. ".repeat(7000));
    await expect(gatherRequest({ file: join(dir, "plain.txt") })).rejects.toThrow(/KB/);
  });
  it("a transcript must be the whole request", async () => {
    await expect(gatherRequest({ prompt: "also add SSO", file: await writeDocx("meeting.docx", sample.split("\n")) })).rejects.toThrow(/whole request/);
  });
});
