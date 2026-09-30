import { describe, expect, it } from "vitest";
import { blocksFor, wireframeSvg } from "./wireframe.js";

const screen = { id: "S-1", route: "/login" };

describe("wireframes", () => {
  it("draw the blocks the requirement wording asks for", () => {
    expect(blocksFor("The user shall sign in with email and password.")).toContain("form");
    expect(blocksFor("The system shall list all orders in a table.")).toContain("table");
    expect(blocksFor("Show a chart of monthly revenue.")).toContain("chart");
    expect(blocksFor("Something vague.")).toEqual(["text"]);
    const svg = wireframeSvg(screen, "default", [{ id: "REQ-1", text: "The user shall sign in with a password." }]);
    expect(svg).toMatch(/^<svg /);
    expect(svg).toContain("Submit");
    expect(svg).toContain("REQ-1");
  });
  it("change with the state", () => {
    const r = [{ id: "REQ-1", text: "List the orders in a table." }];
    expect(wireframeSvg(screen, "empty", r)).toContain("Nothing here yet");
    expect(wireframeSvg(screen, "error", r)).toContain("Something went wrong");
    expect(wireframeSvg(screen, "success", r)).toContain("Done.");
    expect(wireframeSvg(screen, "loading", r)).not.toBe(wireframeSvg(screen, "default", r));
  });
  it("escape everything and carry no script", () => {
    const svg = wireframeSvg({ id: "<b>S</b>", route: '"><script>x</script>' }, "<u>", [{ id: "R", text: "<img src=x onerror=1> form" }]);
    expect(svg).not.toMatch(/<script|<b>|<u>|<img/);
    expect(svg).not.toMatch(/onload|href/i);
  });
});
