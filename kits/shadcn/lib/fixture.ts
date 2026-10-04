// Fixture mode: any screen in any state without a backend, e.g. ?fixture=S-3:empty (docs/estimates-design.md, "Fidelity and tests").

/** The state asked for this screen in the address (?fixture=S-3:empty,S-4:error), or undefined when the page runs on real data. */
export function fixtureState(fixture: string | null | undefined, screen: string): string | undefined {
  if (!fixture) return undefined;
  for (const part of fixture.split(",")) {
    const [id, state] = part.split(":");
    if (id === screen) return state || "default";
  }
  return undefined;
}

export type StateKind = "normal" | "success" | "validation" | "loading" | "empty" | "error";

/** What a state is, from its name, as the approved demo reads it (src/estimate/demo.ts, stateKind). */
export function stateKind(state: string): StateKind {
  return /empty|no data|none|no results/i.test(state) ? "empty"
    : /load|wait|pending|progress|skeleton/i.test(state) ? "loading"
    : /valid|invalid|required/i.test(state) ? "validation"
    : /error|fail|denied|offline|unauthori[sz]ed|forbidden/i.test(state) ? "error"
    : /success|done|saved|complete|confirm|sent/i.test(state) ? "success"
    : "normal";
}

/** A state's name in the address: "Dialog: Add payee" is dialog-add-payee. */
export const stateSlug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "default";
