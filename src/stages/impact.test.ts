import { describe, expect, it } from "vitest";
import { rippleCandidates, type Source } from "../context/ripple.js";
import { affectsLines, CARD_LINES, mergeImpact, planCoverageFailures, planNote, seedsOf } from "./impact.js";

const files: Record<string, string> = {
  "src/Shop/Orders/OrderService.cs": "public class OrderService : IOrderService { public void Cancel(int id) {} }",
  "src/Shop/Orders/Legacy.cs": "public class LegacyExport { }",
  "src/Shop/Orders/Order.cs": "public class Order { }",
  "src/Shop/Data/ShopDb.cs": "public class ShopDb { public DbSet<Order> Orders { get; set; } }",
  "src/Shop/Program.cs": "builder.Services.AddScoped<IOrderService, OrderService>();",
  "src/Shop/Jobs/Nightly.cs": "new LegacyExport();",
  ...Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`src/Shop/Use${i}.cs`, "var s = new OrderService();"])),
};
const src: Source = { files: Object.keys(files), read: (p) => files[p] };
const ev = (path: string) => ({ path, lineStart: 1, lineEnd: 1, quote: files[path]! });
const req = (id: string, op: "ADDED" | "MODIFIED" | "REMOVED", path?: string) => ({ id, op, ears: "", sources: [], acceptance: [], ...(path ? { anchors: [ev(path)] } : {}) });
const cb = { claims: [{ id: "C1", text: "", spans: [], anchors: [{ ...ev("src/Shop/Orders/OrderService.cs"), symbol: "OrderService.Cancel" }] }], notFound: [] };

describe("impact: merge and risk", () => {
  const spec = { requirements: [req("REQ-1", "MODIFIED", "src/Shop/Orders/OrderService.cs"), req("REQ-2", "REMOVED", "src/Shop/Orders/Legacy.cs"), req("REQ-3", "ADDED")] };
  const impact = mergeImpact(spec, rippleCandidates(src, seedsOf(spec, cb)), "low");
  const level = (p: string) => impact.items.find((i) => i.path === p)?.level;

  it("seeds: ground anchors and MODIFIED/REMOVED anchors; REMOVED ones are marked", () => {
    expect(seedsOf(spec, cb)).toEqual([
      { path: "src/Shop/Orders/OrderService.cs", symbol: "OrderService.Cancel" },
      { path: "src/Shop/Orders/OrderService.cs" },
      { path: "src/Shop/Orders/Legacy.cs", removed: true },
    ]);
  });

  it("levels: users of removed code break; requirement anchors and other users are to check (anchors can be context)", () => {
    expect(level("src/Shop/Orders/OrderService.cs")).toBe("check");
    expect(level("src/Shop/Orders/Legacy.cs")).toBe("check");
    expect(impact.items.find((i) => i.path === "src/Shop/Orders/OrderService.cs")!.reason).toBe("REQ-1 (MODIFIED) points at it");
    expect(level("src/Shop/Jobs/Nightly.cs")).toBe("breaks");
    expect(level("src/Shop/Program.cs")).toBe("check");
    expect(impact.counts.check).toBe(15); // 13 users + the 2 requirement anchors
  });

  it("risk: breaks make it high, with the reason; low base without ripple stays low", () => {
    expect(impact.risk).toBe("high");
    expect(impact.riskWhy.join(" ")).toMatch(/REMOVED requirement/);
    const quiet = mergeImpact({ requirements: [] }, rippleCandidates(src, [{ path: "src/Shop/Jobs/Nightly.cs" }]), "low");
    expect(quiet.risk).toBe("low");
    expect(mergeImpact({ requirements: [] }, rippleCandidates(src, [{ path: "src/Shop/Jobs/Nightly.cs" }]), "medium").risk).toBe("medium");
    const data = mergeImpact({ requirements: [] }, rippleCandidates(src, [{ path: "src/Shop/Orders/Order.cs" }]), "low");
    expect(data.risk).toBe("high");
  });

  it("plan gate: must-change and breaks paths need a file scope or a mention; check paths never fail", () => {
    const plan = (fileScope: string[], approach = "", adr = "") => ({ adr, tasks: [{ title: "Cancel", fileScope, approach }] });
    expect(planCoverageFailures(plan(["src/Shop/Orders/**"]), impact).map((f) => f.message)).toEqual([expect.stringMatching(/^src\/Shop\/Jobs\/Nightly\.cs breaks/)]);
    expect(planCoverageFailures(plan(["src/Shop/Orders/**", "src/Shop/Jobs/Nightly.cs"]), impact)).toEqual([]);
    expect(planCoverageFailures(plan(["src/Shop/Orders/**"], "Nightly.cs keeps working: it moves to the new export"), impact)).toEqual([]);
    // a requirement-anchored file the plan leaves alone never fails it (a real delivered run did exactly that)
    expect(planCoverageFailures(plan(["src/Shop/Jobs/Nightly.cs"]), impact)).toEqual([]);
  });

  it("a test file that uses removed code is 'check', never 'breaks': plans can't scope tests", () => {
    const t = { ...files, "tests/Shop.Tests/NightlyTests.cs": "new LegacyExport();" };
    const s2 = { files: Object.keys(t), read: (p: string) => t[p] };
    const i2 = mergeImpact(spec, rippleCandidates(s2, seedsOf(spec, cb)), "low");
    expect(i2.items.find((i) => i.path === "tests/Shop.Tests/NightlyTests.cs")!.level).toBe("check");
    const lens = { lens: "tests" as const, lineStart: 1, lineEnd: 1, quote: "x", reqId: "REQ-1", why: "y" };
    const i3 = mergeImpact(spec, rippleCandidates(s2, seedsOf(spec, cb)), "low", [{ ...lens, path: "tests/Shop.Tests/NightlyTests.cs", level: "must-change" }, { ...lens, path: "src/Shop/Program.cs", level: "must-change" }]);
    expect(i3.items.find((i) => i.path === "tests/Shop.Tests/NightlyTests.cs")!.level).toBe("check");
    expect(i3.items.find((i) => i.path === "src/Shop/Program.cs")!.level).toBe("must-change");
  });

  it("card: files outside the plan, breaks first, at most 8 lines with a 'more' line", () => {
    const lines = affectsLines(impact, ["src/Shop/Orders/OrderService.cs", "src/Shop/Orders/Legacy.cs", "src/Shop/Orders/Order.cs"]);
    expect(lines).toHaveLength(CARD_LINES);
    expect(lines[0]).toMatch(/^- src\/Shop\/Jobs\/Nightly\.cs \(breaks\): uses LegacyExport/);
    expect(lines.at(-1)).toMatch(/…and \d+ more/);
    expect(affectsLines(mergeImpact({ requirements: [] }, rippleCandidates(src, []), "low"), [])).toEqual([]);
  });

  it("plan note lists what to cover, and is empty when nothing was found", () => {
    expect(planNote(impact)).toMatch(/src\/Shop\/Jobs\/Nightly\.cs \[breaks\]/);
    expect(planNote(mergeImpact({ requirements: [] }, rippleCandidates(src, []), "low"))).toBe("");
  });
});
