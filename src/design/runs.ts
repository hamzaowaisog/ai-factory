// Design-only runs as people see them (`factory design show|list`, later the UI's Design tab): where the
// design is, what it looks like, what it was based on and whether it is approved. Read from the ledger only.
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Reference } from "../contracts/index.js";
import { Ledger } from "../ledger/ledger.js";
import { replay, statusLabel, type RunState } from "../ledger/state.js";

export type DesignStage = "drafting" | "waiting for approval" | "approved" | "no UI" | "parked" | "stopped";

export interface DesignRunView {
  runId: string;
  mode: string;
  project: string;
  status: string;
  stage: DesignStage;
  request: string;
  /** the open approval card's hash prefix, when one is waiting */
  card?: string;
  theme?: { mood?: string; mode?: string; brand?: string; font?: string; radius?: string; density?: string; basis?: { ref: string; took: string }[] };
  /** "new" for a look drawn for this product, "repo" for the app's own look */
  themeSource?: string;
  /** the existing app is restyled to the match references (the questions card) */
  restyle?: boolean;
  screens: { id: string; title?: string; route: string; reqs: string[]; states: string[]; refs?: string[] }[];
  references: (Pick<Reference, "id" | "kind" | "source" | "role" | "measured" | "colours" | "fonts" | "notes"> & Partial<Pick<Reference, "note" | "radiusPx">> & { images?: { file: string; label: string }[] } & { read?: { kind: string; navigation: string; reqs: string[]; palette: { name: string; hex: string }[] }; use?: { use: string; how: string } })[];
  /** screens still differing from a layout reference after the fix round */
  refLayout?: { screen: string; ref: string; nav?: string; missing: string[] }[];
  files: { demo?: string; shots?: string; tokens?: string };
  costUsd: number;
  approvedBy?: string;
  /** set when this run was itself seeded from another approved design */
  from?: string;
}

interface DesignOut { skipped?: boolean; screens?: { id: string; route: string; reqs: string[]; states?: string[]; mock?: { title?: string }; refs?: string[] }[]; refUse?: { id: string; use: string; how: string }[]; refLayout?: DesignRunView["refLayout"]; theme?: DesignRunView["theme"] & Record<string, unknown>; themeSource?: string; restyle?: boolean }

function stageOf(s: RunState): DesignStage {
  const base = s.steps.get("design-baseline");
  if (base?.status === "completed") return (base.data as { ui?: boolean } | undefined)?.ui ? "approved" : "no UI";
  if (s.openCard?.kind === "design-approval") return "waiting for approval";
  if (s.status === "parked") return "parked";
  if (typeof s.status === "object") return "stopped";
  return "drafting";
}

/** One run's design: works for design runs and for any other run that drew a design (an estimate). */
export function designRunView(ledger: Ledger): DesignRunView {
  const s = replay(ledger.events());
  const designSha = s.steps.get("design")?.status === "completed" ? s.steps.get("design")!.outputs[0] : undefined;
  const d = designSha ? ledger.getJson<DesignOut>(designSha) : undefined;
  const has = (f: string) => (existsSync(join(ledger.dir, f)) ? join(ledger.dir, f) : undefined);
  const base = s.steps.get("design-baseline");
  const approvedBy = base?.status === "completed" && base.outputs[0] ? ledger.getJson<{ by?: string }>(base.outputs[0])?.by : undefined;
  const t = d?.theme;
  const refsSha = s.steps.get("design-refs")?.status === "completed" ? s.steps.get("design-refs")!.outputs[0] : undefined;
  const reading = refsSha ? ledger.getJson<{ refs?: { id: string; kind: string; navigation: string; reqs: string[]; brief: { palette: { name: string; hex: string }[] } }[] }>(refsSha)?.refs ?? [] : [];
  return {
    runId: ledger.runId, mode: s.info.mode, project: s.info.project, status: statusLabel(s.status), stage: stageOf(s),
    request: (s.info.request ?? "").split("\n").find((l) => l.trim())?.trim().slice(0, 120) ?? "",
    ...(s.openCard?.kind === "design-approval" ? { card: s.openCard.artifactSha.slice(0, 8) } : {}),
    ...(t ? { theme: { mood: t.mood, mode: t.mode, brand: t.brand, font: t.font, radius: t.radius, density: t.density, ...(t.basis ? { basis: t.basis } : {}) } } : {}),
    ...(d?.themeSource ? { themeSource: d.themeSource } : {}), ...(d?.restyle ? { restyle: true } : {}),
    screens: d && !d.skipped ? (d.screens ?? []).map((x) => ({ id: x.id, ...(x.mock?.title ? { title: x.mock.title } : {}), route: x.route, reqs: x.reqs, states: x.states ?? [], ...(x.refs?.length ? { refs: x.refs } : {}) })) : [],
    references: (s.info.references ?? []).map((r) => {
      const x = reading.find((y) => y.id === r.id), u = d && !d.skipped ? d.refUse?.find((y) => y.id === r.id) : undefined;
      return { id: r.id, kind: r.kind, source: r.source, role: r.role, measured: r.measured, colours: r.colours, fonts: r.fonts, notes: r.notes,
        ...(r.note ? { note: r.note } : {}), ...(r.radiusPx !== undefined ? { radiusPx: r.radiusPx } : {}), images: r.images.map((im) => ({ file: im.file, label: im.label })), ...(x ? { read: { kind: x.kind, navigation: x.navigation, reqs: x.reqs, palette: x.brief.palette } } : {}), ...(u ? { use: { use: u.use, how: u.how } } : {}) };
    }),
    ...(d && !d.skipped && d.refLayout?.length ? { refLayout: d.refLayout } : {}),
    files: Object.fromEntries(Object.entries({ demo: has("preview/index.html") ?? has("design-demo.html"), shots: has("preview/shots"), tokens: has("preview/tokens.css") }).filter(([, v]) => v)) as DesignRunView["files"],
    costUsd: s.costUsd,
    ...(approvedBy ? { approvedBy } : {}),
    ...(s.info.designRef ? { from: s.info.designRef.runId } : {}),
  };
}

/** Design-only runs, newest last (with `all`, also estimate runs, which draw a design too). */
export function listDesignRuns(all = false): DesignRunView[] {
  const out: DesignRunView[] = [];
  for (const id of Ledger.listRuns()) {
    try {
      const l = Ledger.open(id);
      const mode = replay(l.events()).info.mode;
      if (mode === "design" || (all && mode === "estimate")) out.push(designRunView(l));
    } catch { /* an unreadable run is not listed */ }
  }
  return out;
}

/** The view as terminal lines. */
export function formatDesignRun(v: DesignRunView): string[] {
  const lines = [
    `${v.runId}  ${v.stage}${v.card ? ` (card ${v.card})` : ""}  ${v.mode} run · ${v.project} · $${v.costUsd.toFixed(2)}${v.approvedBy ? ` · approved by ${v.approvedBy}` : ""}`,
    `  request: ${v.request}`,
  ];
  if (v.from) lines.push(`  seeded from design run ${v.from}`);
  if (v.theme) {
    lines.push(`  look: ${[v.theme.mood, v.theme.mode, v.theme.brand, v.theme.font, v.theme.radius && `${v.theme.radius} corners`, v.theme.density].filter(Boolean).join(" · ")}`);
    for (const b of v.theme.basis ?? []) lines.push(`    based on ${b.ref}: ${b.took}`);
  } else if (v.themeSource === "repo") lines.push("  look: the app's own (tokens and components from the repo)");
  if (v.restyle) lines.push("  restyle: the app is restyled to the match reference's look (chosen on the questions card): a design-system change");
  if (v.references.length) {
    lines.push(`  references (${v.references.length}):`);
    for (const r of v.references) {
      const cols = r.colours.slice(0, 5).map((c) => `${c.hex}${c.role ? ` ${c.role}` : ""}`).join(", ");
      const rd = r.read ? `\n      read as ${r.read.kind}${r.read.navigation !== "unclear" ? `, ${r.read.navigation}` : ""}${r.read.palette.length ? `; ${r.read.palette.map((p) => `${p.name} ${p.hex}`).join(", ")}` : ""}${r.read.reqs.length ? `; for ${r.read.reqs.join(", ")}` : ""}` : "";
      const use = r.use ? `\n      ${r.use.use === "used" ? "used" : "set aside"}: ${r.use.how}` : "";
      lines.push(`    ${r.id} ${r.role.padEnd(7)} ${r.kind.padEnd(5)} ${r.source}${cols ? `  [${cols}${r.measured === "approximate" ? ", approximate" : ""}]` : ""}${r.fonts.length ? `  fonts ${r.fonts.map((f) => f.family).join(", ")}` : ""}${rd}${use}`);
    }
  }
  if (v.screens.length) {
    lines.push(`  screens (${v.screens.length}):`);
    for (const x of v.screens) lines.push(`    ${x.id} ${x.title ? `${x.title} ` : ""}${x.route} -> ${x.reqs.join(", ") || "no requirement"}${x.states.length ? `; states: ${x.states.join(", ")}` : ""}${x.refs ? `; from ${x.refs.join(", ")}` : ""}`);
    for (const g of v.refLayout ?? []) lines.push(`    ${g.screen} differs from ${g.ref}:${g.nav ? ` not reached by ${g.nav}` : ""}${g.nav && g.missing.length ? ";" : ""}${g.missing.length ? ` no ${g.missing.join(", ")}` : ""}`);
  }
  if (v.files.demo) lines.push(`  demo: ${v.files.demo}`);
  if (v.files.shots) lines.push(`  screenshots: ${v.files.shots}`);
  if (v.files.tokens) lines.push(`  tokens: ${v.files.tokens}`);
  if (v.card) lines.push(`  approve: factory approve ${v.runId} ${v.card}    send back: factory reject ${v.runId} ${v.card} --reason "..."`);
  if (v.stage === "approved" && v.mode === "design") lines.push(`  next: factory estimate --from-design ${v.runId}   or   factory start --project <name> --from-design ${v.runId}`);
  return lines;
}
