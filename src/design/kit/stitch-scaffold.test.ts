// Greenfield with Stitch screens: the scaffold writes a Stitch screen's route, navigation entry and a container the coding task
// fills, but no screen.tsx or fixtures.ts (there is no design JSON to generate them from), and nothing of it is protected.
import { describe, expect, it } from "vitest";
import { DesignBody } from "../../contracts/artifacts.js";
import { loadKit, scaffold } from "./index.js";
import { sampleDesign } from "./sample.js";

const kit = loadKit();
const TAG = "ai-factory design r1 v1 (abc), approved by lead on 2026-10-10";
const facts = { title: "Today's Appointments", buttons: ["Book appointment"], fields: [], columns: ["Time", "Patient"], headings: ["Today's Appointments"] };

function withStitch() {
  const d = sampleDesign();
  return DesignBody.parse({ ...d, screens: [...d.screens, { id: "S-9", route: "/appointments", file: "app/appointments/page.tsx", reqs: ["R-9"], app: "portal", states: ["default", "empty"], facts }] });
}
const base = { kit, product: "Acme Billing", tag: TAG, apps: ["portal"], target: "next-shadcn" as const };

describe("a Stitch screen in the greenfield scaffold", () => {
  const l = scaffold({ ...base, design: withStitch() });
  const s9 = l.screens.find((s) => s.id === "S-9");
  const file = (p: string) => l.files.find((f) => f.path === p)?.text;

  it("gets a route, a container the coding task owns, and no generated page", () => {
    expect(s9).toMatchObject({ id: "S-9", title: "Today's Appointments", stitch: true, screen: "", fixtures: "", page: "app/appointments/page.tsx" });
    expect(file("app/appointments/page.tsx")).toContain("TodaySAppointmentsContainer");
    const container = l.files.find((f) => f.path === s9!.container)!;
    expect(container).toMatchObject({ owner: "app", regenerate: false });
    expect(container.text).toContain(`data-screen="S-9"`);
    expect(container.text).toContain("Today&apos;s Appointments");
    expect(container.text).toContain("?fixture=S-9:<state>");
    expect(file("components/screens/s-9/screen.tsx")).toBeUndefined();
    expect(file("components/screens/s-9/fixtures.ts")).toBeUndefined();
  });

  it("protects nothing of it, lists it in the navigation, and says so in the notes", () => {
    expect(l.protected.filter((p) => /s-9|appointments/i.test(p))).toEqual([]);
    expect(l.protected).not.toContain("");
    expect(file("components/screens/frame.ts")).toContain("Today's Appointments");
    expect(l.notes.join(" ")).toMatch(/drawn by Stitch, built by its coding task: S-9/);
  });

  it("leaves the JSON screens' files exactly as a scaffold without it", () => {
    const plain = scaffold({ ...base, design: sampleDesign() });
    const own = (x: typeof l) => x.files.filter((f) => /components\/screens\/s-1\//.test(f.path));
    expect(own(l)).toEqual(own(plain));
  });
});
