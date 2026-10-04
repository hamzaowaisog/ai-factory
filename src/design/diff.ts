// Design lineage: what a change request does to an approved design (moved from src/estimate/lineage.ts, PR #11 review item 14).

export interface ScreenView { id: string; route: string; reqs: string[]; states?: string[]; size?: string }
export interface DesignView { skipped?: boolean; screens: ScreenView[] }

/** What a change request does to the approved design: screens added, removed or changed, for the design card. */
export function diffDesigns(from: DesignView | undefined, to: DesignView): string[] {
  const was = from && !from.skipped ? from.screens : [];
  const now = to.skipped ? [] : to.screens;
  const out: string[] = [];
  const byId = new Map(was.map((s) => [s.id, s]));
  const same = (a: string[] = [], b: string[] = []) => a.length === b.length && a.every((x) => b.includes(x));
  for (const s of now) {
    const o = byId.get(s.id);
    if (!o) { out.push(`Added screen ${s.id} ${s.route} (${s.reqs.join(", ")})`); continue; }
    const ch: string[] = [];
    if (o.route !== s.route) ch.push(`route ${o.route} -> ${s.route}`);
    if (!same(o.reqs, s.reqs)) ch.push(`requirements ${o.reqs.join(", ") || "none"} -> ${s.reqs.join(", ") || "none"}`);
    if (!same(o.states, s.states)) ch.push(`states ${(o.states ?? []).join(", ") || "none"} -> ${(s.states ?? []).join(", ") || "none"}`);
    if (o.size !== s.size && o.size && s.size) ch.push(`size ${o.size} -> ${s.size}`);
    if (ch.length) out.push(`Changed screen ${s.id}: ${ch.join("; ")}`);
  }
  const ids = new Set(now.map((s) => s.id));
  for (const o of was) if (!ids.has(o.id)) out.push(`Removed screen ${o.id} ${o.route}`);
  return out;
}
