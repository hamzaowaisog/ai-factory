// Per-module specify (docs/estimates-design.md, "Inputs"): a large requirements document cannot go
// through specify in one pass, so code splits it at its own headings into modules of bounded size.
// Pure and deterministic: the step list is a function of the request text, so a replay gets the same modules.

export interface Module { id: string; title: string; text: string }

/** Characters per module (about 5,000 tokens). Above this a document is specified module by module. */
export const MODULE_CHARS = 20_000;

interface Section { title: string; text: string }

/** Top-level sections: split on the shallowest heading level present (Markdown "#" lines). */
function sections(text: string): Section[] {
  const lines = text.split("\n");
  const fence: boolean[] = [];
  let inFence = false;
  for (const l of lines) { if (/^\s*```/.test(l)) inFence = !inFence; fence.push(inFence); }
  const level = (l: string, i: number): number => (fence[i] ? 0 : /^(#{1,6})\s+\S/.exec(l)?.[1]!.length ?? 0);
  const levels = lines.map(level).filter((n) => n > 0);
  if (!levels.length) return [{ title: "Requirements", text }];
  const top = Math.min(...levels);
  const out: Section[] = [];
  let cur: string[] = [];
  let title = "Introduction";
  const flush = () => { if (cur.join("").trim()) out.push({ title, text: cur.join("\n") }); };
  lines.forEach((l, i) => {
    if (level(l, i) === top) { flush(); cur = [l]; title = l.replace(/^#+\s+/, "").trim(); } else cur.push(l);
  });
  flush();
  return out;
}

/** A section bigger than the limit is cut at paragraph breaks. */
function cut(s: Section, max: number): Section[] {
  if (s.text.length <= max) return [s];
  const parts: Section[] = [];
  let cur = "";
  for (const p of s.text.split(/\n{2,}/)) {
    if (cur && cur.length + p.length + 2 > max) { parts.push({ title: s.title, text: cur }); cur = ""; }
    // one paragraph longer than the limit is cut hard
    for (let i = 0; i < p.length; i += max) {
      const piece = p.slice(i, i + max);
      cur = cur ? `${cur}\n\n${piece}` : piece;
      if (cur.length >= max && i + max < p.length) { parts.push({ title: s.title, text: cur }); cur = ""; }
    }
  }
  if (cur) parts.push({ title: s.title, text: cur });
  return parts.map((p, n) => ({ title: `${s.title} (part ${n + 1})`, text: p.text }));
}

/**
 * Split a request into modules. A request that fits in one module returns [] (the normal, single-pass
 * spec pipeline). Adjacent sections are grouped until the limit, so modules follow the document's order.
 */
export function splitModules(text: string, max = MODULE_CHARS): Module[] {
  if (text.length <= max) return [];
  const parts = sections(text).flatMap((s) => cut(s, max));
  const groups: Section[][] = [];
  let size = 0;
  for (const p of parts) {
    if (!groups.length || size + p.text.length > max) { groups.push([]); size = 0; }
    groups[groups.length - 1]!.push(p);
    size += p.text.length + 1;
  }
  if (groups.length < 2) return [];
  return groups.map((g, n) => ({
    id: `m${n + 1}`,
    title: g.length === 1 ? g[0]!.title : `${g[0]!.title} to ${g[g.length - 1]!.title}`,
    text: g.map((s) => s.text).join("\n"),
  }));
}
