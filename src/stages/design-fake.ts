// For tests: a fake model's whole design, answered the way the design step asks for it (src/stages/design.ts, drawInParts):
// the screen list first, then one page per call. A call that is neither gets the answer as it is.

interface FakeScreen { id: string; mock?: { title?: string }; mockFull?: unknown; [k: string]: unknown }

/** The design step's page calls: "drawing ONE page of a design". */
export const isPageCall = (system: string): boolean => system.includes("drawing ONE page of a design");

export function designAnswer(system: string, user: string, whole: unknown): unknown {
  const screens = (whole as { screens?: FakeScreen[] } | undefined)?.screens;
  if (!Array.isArray(screens)) return whole;
  if (system.includes("PAGES ARE DRAWN NEXT")) {
    return { ...(whole as object), screens: screens.map(({ mock, mockFull: _f, ...x }) => ({ ...x, title: mock?.title ?? x.id, purpose: "What the user sees and does on this page." })) };
  }
  if (!isPageCall(system)) return whole;
  const id = /(?:Draw|Fix) page (S-\d+)/.exec(user)?.[1];
  const page = screens.find((x) => x.id === id);
  return page ? { mock: page.mock, ...(page.mockFull ? { mockFull: page.mockFull } : {}) } : whole;
}
