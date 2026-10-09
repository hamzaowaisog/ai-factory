import { describe, expect, it } from "vitest";
import { stitchFacts } from "./stitch-facts.js";
import { screenFacts } from "./design-link.js";

const html = `<html><body><h1>Today's Appointments</h1><h2>Next up</h2>
<button><span class="material-symbols-outlined">add</span> Book appointment</button><button>Book appointment</button>
<a role="button">Check in</a><input type="submit" value="Save">
<label>Patient name</label><label>Phone</label>
<table><tr><th>Time</th><th>Patient</th><th>Status</th></tr></table><script>alert(1)</script></body></html>`;

describe("facts from Stitch HTML", () => {
  it("reads the title, buttons, fields, columns and headings, without icon words or scripts", () => {
    expect(stitchFacts(html)).toEqual({
      title: "Today's Appointments", buttons: ["Book appointment", "Check in", "Save"], fields: ["Patient name", "Phone"],
      columns: ["Time", "Patient", "Status"], headings: ["Today's Appointments", "Next up"],
    });
  });
  it("is empty for empty HTML", () => {
    expect(stitchFacts("")).toEqual({ buttons: [], fields: [], columns: [], headings: [] });
  });
});

describe("screen facts for tests", () => {
  it("uses a Stitch screen's facts when it has no mock", () => {
    const facts = { title: "Payees", buttons: ["Add payee"], fields: ["IBAN"], columns: ["Name"], headings: ["Payees"] };
    expect(screenFacts({ screens: [{ id: "S-1", route: "/payees", file: "x", reqs: ["REQ-1"], states: ["empty"], facts }] }, ["REQ-1"])).toEqual([
      { screen: "S-1", route: "/payees", reqs: ["REQ-1"], states: ["empty"], title: "Payees", buttons: ["Add payee"], fields: ["IBAN"], columns: ["Name"], messages: {}, toasts: [] },
    ]);
  });
  it("reads a mock screen exactly as before", () => {
    const mock = { title: "Add payee", blocks: [{ type: "form", fields: [{ label: "IBAN", kind: "text" }], submit: "Save" }], copy: {} };
    expect(screenFacts({ screens: [{ id: "S-2", route: "/new", file: "x", reqs: ["REQ-2"], mock }] }, ["REQ-2"])).toEqual([
      { screen: "S-2", route: "/new", reqs: ["REQ-2"], states: [], title: "Add payee", buttons: ["Save"], fields: ["IBAN"], columns: [], messages: {}, toasts: [] },
    ]);
  });
});
