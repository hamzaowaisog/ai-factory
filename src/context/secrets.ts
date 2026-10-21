// Secret redaction for packs and tool results (context-builder §2.6).
// Built-in rules are a backstop; the real control is no live secrets where a model acts.
// Hits become stable placeholders «SECRET_n»; values are never stored.

const RULES: { id: string; re: RegExp }[] = [
  { id: "private-key", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g },
  { id: "aws-access-key", re: /\b(AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { id: "github-token", re: /\b(gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,})\b/g },
  { id: "anthropic-key", re: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g },
  { id: "openai-key", re: /\bsk-(proj-)?[A-Za-z0-9_-]{32,}\b/g },
  { id: "slack-token", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  { id: "jwt", re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
  { id: "azure-storage", re: /AccountKey=[A-Za-z0-9+/=]{40,}/g },
  // password=... inside connection strings or config, keep the key, redact the value
  { id: "password-assignment", re: /((?:password|pwd|passwd|secret|api[_-]?key|access[_-]?token)\s*[=:]\s*["']?)([^"'\s;,}]{6,})/gi },
];

export interface Redaction { text: string; hits: { rule: string; placeholder: string }[] }

/** Redact with placeholders that stay stable across calls within one run (same value → same n). */
/** Source files, where `password: passphrase` is code and not a secret (config, env and data files are read as before). */
const CODE_FILE = /\.(?:[cm]?[jt]sx?|cs|cshtml|razor)$/i;

/**
 * In a source file: the value is a name, a member, a call or a type, written bare and outside any string (`password: passphrase`,
 * `accessToken: response.data.accessToken`, `accessToken: string;`, `password={password}`). A secret in code is a quoted literal or
 * sits inside a string (a connection string), and both are still caught. Run 1679 parked a sign-in screen on lines like these.
 */
function isCodeValue(prefix: string, value: string, before: string): boolean {
  if (/["']$/.test(prefix)) return false;
  if (((before.match(/["'`]/g) ?? []).length) % 2) return false;
  // a parameter's type before a return type reads "string):" (run e220: login(email: string, password: string): Promise<…>)
  return /^[{(]*[A-Za-z_$][\w$.?!()[\]<>|&{:]*$/.test(value);
}

/**
 * In a source file, a quoted value that is not a secret either: sample data named as such (`accessToken: "demo-token-01"` in a
 * screen's fixture) or the first word of a message (`errors.password = "Password is required."`). Both were reported on the
 * real files of run 1679 after the bare values no longer were. A passphrase of plain words in source is not caught by this rule.
 */
function isCodeLiteral(prefix: string, value: string, after: string): boolean {
  const quote = prefix.slice(-1);
  if (quote !== '"' && quote !== "'") return false;
  if (/^(?:demo|example|sample|fake|test|mock|fixture)(?:[-_.]|$)/i.test(value)) return true;
  return /^[A-Za-z]+[.,:!?]?$/.test(value) && new RegExp(`^\\s+[^${quote}]*[A-Za-z][^${quote}]*${quote}`).test(after);
}

export class Redactor {
  private readonly seen = new Map<string, string>();

  /** code: the text is a source file's (see isCodeValue). */
  constructor(private readonly opts: { code?: boolean } = {}) {}

  redact(text: string): Redaction {
    const hits: Redaction["hits"] = [];
    let out = text;
    for (const rule of RULES) {
      out = out.replace(rule.re, (...m: string[]) => {
        const isAssign = rule.id === "password-assignment";
        const value = isAssign ? m[2]! : m[0]!;
        if (isAssign && /^(«SECRET_\d+»|\*+|x+|dummy|changeme|placeholder|your[_-].*|<.*>|\{\{.*)$/i.test(value)) return m[0]!;
        const whole = String(m[m.length - 1]), at = Number(m[m.length - 2]);
        if (isAssign && this.opts.code && (isCodeValue(m[1]!, value, whole.slice(0, at)) || isCodeLiteral(m[1]!, value, whole.slice(at + m[0]!.length)))) return m[0]!;
        let ph = this.seen.get(value);
        if (!ph) {
          ph = `«SECRET_${this.seen.size + 1}»`;
          this.seen.set(value, ph);
        }
        hits.push({ rule: rule.id, placeholder: ph });
        return isAssign ? `${m[1]}${ph}` : ph;
      });
    }
    return { text: out, hits };
  }

  get count(): number {
    return this.seen.size;
  }
}

/** A connection string whose server is this machine (Host, Server or Data Source = 127.0.0.1, localhost or ::1). */
const LOOPBACK_DB = /\b(?:host|server|data source)\s*=\s*(?:127\.0\.0\.1|localhost|\[?::1\]?)(?=[;:,"'\s]|$)/i;

/**
 * A test file or an OpenAPI contract: its passwords are made-up test or example data (run 9071: a test account's "…2025!" and a
 * fake `password=…` in an error; run 4049: the contract's example sign-in request and token). Both parked deliver.
 */
const TEST_FILE = /(^|\/)(tests?|__tests__)\/|\.Tests?\/|\.(test|spec)\.[cm]?[jt]sx?$|Tests?\.cs$|(^|\/)openapi\.(ya?ml|json)$/i;

/** Scan without redacting: where secrets are (for per-commit scans). Values are never returned. */
export function scanText(file: string, text: string): { file: string; line: number; rule: string }[] {
  const hits: { file: string; line: number; rule: string }[] = [];
  const lines = text.split("\n");
  const code = CODE_FILE.test(file);
  // in a test file only the password rule is off: a key or token with a known shape (AWS, GitHub, OpenAI, a private key) is still caught
  const test = TEST_FILE.test(file);
  lines.forEach((line, i) => {
    const r = new Redactor({ code }).redact(line);
    // a database on this machine: its password opens nothing anyone else can reach (run e1b5: a test's unreachable 127.0.0.1 string)
    const local = LOOPBACK_DB.test(line);
    for (const h of r.hits) if (!((local || test) && h.rule === "password-assignment")) hits.push({ file, line: i + 1, rule: h.rule });
  });
  // multi-line private keys
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(text) && !hits.some((h) => h.rule === "private-key")) {
    const line = lines.findIndex((l) => l.includes("PRIVATE KEY-----")) + 1;
    hits.push({ file, line, rule: "private-key" });
  }
  return hits;
}
