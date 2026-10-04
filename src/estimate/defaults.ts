// Standard answers for common open topics (docs/estimate-consistency.md, section 10, step E). The clarifier tags a
// question with a topic id from this table; when nobody is asked and the factory assumes the answer, it takes the
// table's answer rather than the model's pick, so two wordings of the same requirements are priced on the same scope.
// Versioned. No person signs it off: every estimate lists the assumptions it made, so the client sees each one.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

export const Defaults = z.object({
  version: z.string().min(1),
  note: z.string(),
  topics: z.array(z.object({ id: z.string().regex(/^[a-z]+(-[a-z]+)*$/), question: z.string().min(1), answer: z.string().min(1) })).min(1),
}).superRefine((d, ctx) => {
  const ids = d.topics.map((t) => t.id);
  for (const id of new Set(ids.filter((x, i) => ids.indexOf(x) !== i))) ctx.addIssue({ code: "custom", path: ["topics"], message: `topic ${id} is listed twice` });
});
export type Defaults = z.infer<typeof Defaults>;

const FILE = join(dirname(fileURLToPath(import.meta.url)), "assets", "defaults.json");
let cached: Defaults | undefined;

export function loadDefaults(file = FILE): Defaults {
  if (file === FILE && cached) return cached;
  const d = Defaults.parse(JSON.parse(readFileSync(file, "utf8")));
  if (file === FILE) cached = d;
  return d;
}

/** The topics as the clarifier reads them: id and the question each covers (not the answers: it still recommends on its own). */
export const topicsText = (d: Pick<Defaults, "topics">): string => d.topics.map((t) => `- ${t.id}: ${t.question}`).join("\n");
