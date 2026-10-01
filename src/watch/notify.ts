// Outgoing messages for people (Slack today; the interface leaves room for Teams). Text and links
// only, no buttons: every decision stays a terminal command. Webhook URLs come from ~/.factory/.env.
import { secret } from "../config/env.js";

export interface Notice {
  /** one line, e.g. "SHOP-123: a card is waiting for you" */
  title: string;
  lines: string[];
  /** a command to paste in the terminal, shown as code */
  command?: string;
  links?: { text: string; url: string }[];
}

export interface Notifier {
  readonly name: string;
  send(n: Notice): Promise<void>;
}

/** Slack incoming webhook (a Slack app's webhook), Block Kit, no interactive parts. */
export class SlackNotifier implements Notifier {
  readonly name = "slack";
  constructor(private readonly url: string, private readonly f: typeof fetch = fetch) {}

  static blocks(n: Notice): unknown {
    const text = [...n.lines, ...(n.links ?? []).map((l) => `<${l.url}|${l.text.replace(/[<>|]/g, "")}>`)].join("\n");
    return {
      text: n.title,
      blocks: [
        { type: "header", text: { type: "plain_text", text: n.title.slice(0, 150) } },
        ...(text ? [{ type: "section", text: { type: "mrkdwn", text: text.slice(0, 2900) } }] : []),
        ...(n.command ? [{ type: "section", text: { type: "mrkdwn", text: `In your terminal:\n\`\`\`${n.command}\`\`\`` } }] : []),
      ],
    };
  }

  async send(n: Notice): Promise<void> {
    const res = await this.f(this.url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(SlackNotifier.blocks(n)) });
    if (!res.ok) throw new Error(`Slack answered HTTP ${res.status}`);
  }
}

/** The notifiers a project asked for, with their secrets resolved; a missing secret means none. */
export function notifiersFor(cfg: { slackWebhookEnv?: string }, f: typeof fetch = fetch): Notifier[] {
  const out: Notifier[] = [];
  const slack = cfg.slackWebhookEnv ? secret(cfg.slackWebhookEnv) : undefined;
  if (slack && /^https:\/\/hooks\.slack\.com\/|^http:\/\/127\.0\.0\.1[:/]/.test(slack)) out.push(new SlackNotifier(slack, f));
  return out;
}
