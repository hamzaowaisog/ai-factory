// The Summary sheet's "List of Special Considerations" block, read from what the client already answered.
// A clarify question whose text names a topic (browsers, platforms, deployment, ...) gives that row its
// answer, with the question id as the source; in a hands-off run the factory's assumption on it ("Assumed: ...").
// A topic nobody asked or assumed about stays "Not specified": nothing is guessed. Pure code, no model call.
export const CONSIDERATION_KEYS = ["platforms", "browsers", "deployment", "performance", "security", "documentation"] as const;
export type ConsiderationKey = (typeof CONSIDERATION_KEYS)[number];
export interface Consideration { answer: string; from: string }

const TOPIC: Record<ConsiderationKey, RegExp> = {
  platforms: /\b(platforms?|operating systems?|\bOS\b|ios|android|desktop|windows|macos|devices?)\b/i,
  browsers: /\b(browsers?|chrome|safari|firefox|edge)\b/i,
  deployment: /\b(deploy(ment|ed)?|hosting|hosted|cloud|on-?prem(ise)?|dedicated server|aws|azure|gcp|intranet)\b/i,
  performance: /\b(performance|load|concurren\w+|throughput|latency|scal(e|ing|ability)|peak users)\b/i,
  security: /\b(security|compliance|encrypt\w*|gdpr|hipaa|pci|soc ?2|penetration|audit)\b/i,
  documentation: /\b(documentation|documents?|user guide|manuals?|handover|training)\b/i,
};

/**
 * The first answered question on each topic. `rounds` are the clarify results, earliest first. A hands-off run asks
 * nobody, so a topic its assumptions settle reads "Assumed: ..." (from the assumption's id); an answer comes first.
 */
export function considerationsFrom(rounds: { asked: { id: string; text: string }[]; answers?: Record<string, string>; assumptions?: { id: string; text: string }[]; assumedBy?: string }[]): Partial<Record<ConsiderationKey, Consideration>> {
  const out: Partial<Record<ConsiderationKey, Consideration>> = {};
  for (const r of rounds) {
    for (const q of r.asked) {
      const answer = r.answers?.[q.id]?.trim();
      if (!answer) continue;
      for (const key of CONSIDERATION_KEYS) if (!out[key] && TOPIC[key].test(q.text)) out[key] = { answer, from: q.id };
    }
  }
  for (const r of rounds.filter((x) => x.assumedBy)) {
    for (const a of r.assumptions ?? []) {
      const m = /^(.*) → assumed: (.+)$/s.exec(a.text);
      if (!m) continue;
      for (const key of CONSIDERATION_KEYS) if (!out[key] && TOPIC[key].test(m[1]!)) out[key] = { answer: `Assumed: ${m[2]!.trim()}`, from: a.id };
    }
  }
  return out;
}
