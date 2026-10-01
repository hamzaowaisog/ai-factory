// The Summary sheet's "List of Special Considerations" block, read from what the client already answered.
// A clarify question whose text names a topic (browsers, platforms, deployment, ...) gives that row its
// answer, with the question id as the source. A topic nobody asked about stays "Not specified": nothing is
// guessed. Pure code, no model call.
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

/** The first answered question on each topic. `rounds` are the clarify results, earliest first. */
export function considerationsFrom(rounds: { asked: { id: string; text: string }[]; answers?: Record<string, string> }[]): Partial<Record<ConsiderationKey, Consideration>> {
  const out: Partial<Record<ConsiderationKey, Consideration>> = {};
  for (const r of rounds) {
    for (const q of r.asked) {
      const answer = r.answers?.[q.id]?.trim();
      if (!answer) continue;
      for (const key of CONSIDERATION_KEYS) if (!out[key] && TOPIC[key].test(q.text)) out[key] = { answer, from: q.id };
    }
  }
  return out;
}
