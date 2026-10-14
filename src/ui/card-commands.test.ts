// The run page's copyable commands for an open card (src/ui/data.ts cardCommands).
import { describe, expect, it } from "vitest";
import { cardCommands } from "./data.js";

describe("card commands on the run page", () => {
  it("lists edit-intent with approve and reject for a client-intent card", () => {
    const md = [
      "## Decide",
      '  factory edit-intent run-1 abcd1234 --status R-3=deferred --remove R-7 --add "text" --role "Name=team" --reason "why"',
      "  factory approve run-1 abcd1234",
      '  factory reject  run-1 abcd1234 --reason "what is wrong"',
    ].join("\n");
    expect(cardCommands(md, "run-1", "abcd1234")).toEqual([
      "factory show-card run-1",
      'factory edit-intent run-1 abcd1234 --status R-3=deferred --remove R-7 --add "text" --role "Name=team" --reason "why"',
      "factory approve run-1 abcd1234",
      'factory reject run-1 abcd1234 --reason "what is wrong"',
    ]);
  });
});
