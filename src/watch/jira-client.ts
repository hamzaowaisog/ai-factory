// Jira REST for `factory watch`: search for labelled tickets, read who added the label, post and find
// comments, move tickets. Credentials only from ~/.factory/.env (JIRA_BASE_URL, JIRA_EMAIL,
// JIRA_API_TOKEN), the same as --jira. No model is involved: this costs no credits.
import { secret } from "../config/env.js";

export interface JiraIssue {
  key: string;
  summary: string;
  description: unknown;
  issueType: string;
  /** epics are above standard tickets, sub-tasks below */
  hierarchyLevel: number;
  subtask: boolean;
  labels: string[];
  reporter?: { accountId?: string; emailAddress?: string; displayName?: string };
  updated?: string;
}

export interface LabelAdd { at: string; by: { accountId?: string; emailAddress?: string; displayName?: string } }

export class JiraHttpError extends Error {
  constructor(message: string, readonly status: number, readonly retryAfterSec?: number) { super(message); }
}

export interface JiraClientOptions { baseUrl?: string; email?: string; token?: string; fetchFn?: typeof fetch }

export class JiraClient {
  readonly base: string;
  private readonly auth: string;
  private readonly f: typeof fetch;

  constructor(o: JiraClientOptions = {}) {
    this.base = (o.baseUrl ?? secret("JIRA_BASE_URL") ?? "").replace(/\/+$/, "");
    const email = o.email ?? secret("JIRA_EMAIL") ?? "";
    const token = o.token ?? secret("JIRA_API_TOKEN") ?? "";
    if (!this.base || !email || !token) throw new Error("Jira isn't set up: add JIRA_BASE_URL, JIRA_EMAIL and JIRA_API_TOKEN to ~/.factory/.env.");
    if (!/^https:\/\//.test(this.base) && !/^http:\/\/127\.0\.0\.1[:/]/.test(this.base)) throw new Error("JIRA_BASE_URL must start with https://");
    this.auth = `Basic ${Buffer.from(`${email}:${token}`).toString("base64")}`;
    this.f = o.fetchFn ?? fetch;
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await this.f(`${this.base}${path}`, {
        method, headers: { Authorization: this.auth, Accept: "application/json", ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    } catch (e) {
      throw new JiraHttpError(`Couldn't reach Jira: ${(e as Error).message}`, 0);
    }
    if (res.status === 429) throw new JiraHttpError("Jira asked us to slow down (429)", 429, Number(res.headers.get("retry-after")) || 60);
    if (!res.ok) throw new JiraHttpError(`Jira answered HTTP ${res.status} for ${method} ${path.split("?")[0]}`, res.status);
    return (res.status === 204 ? undefined : await res.json()) as T;
  }

  /**
   * Labelled "To Do" tickets updated in the last few minutes (the seen-set makes repeats harmless;
   * the search endpoint's paging has quirks, so correctness never depends on it).
   */
  async labelledTickets(project: string, label: string, sinceMinutes = 10): Promise<JiraIssue[]> {
    const jql = `project = ${project} AND labels = "${label.replace(/"/g, "")}" AND statusCategory = "To Do" AND updated >= -${sinceMinutes}m ORDER BY created ASC`;
    const out: JiraIssue[] = [];
    let nextPageToken: string | undefined;
    for (let page = 0; page < 3; page++) {
      const r = await this.call<{ issues?: { key: string; fields: Record<string, unknown> }[]; nextPageToken?: string }>("POST", "/rest/api/3/search/jql", {
        jql, maxResults: 50, fields: ["summary", "description", "issuetype", "labels", "reporter", "updated"], ...(nextPageToken ? { nextPageToken } : {}),
      });
      for (const i of r.issues ?? []) {
        const f = i.fields;
        const it = (f.issuetype ?? {}) as { name?: string; subtask?: boolean; hierarchyLevel?: number };
        out.push({
          key: i.key, summary: String(f.summary ?? ""), description: f.description, issueType: it.name ?? "",
          hierarchyLevel: Number(it.hierarchyLevel ?? 0), subtask: !!it.subtask, labels: (f.labels as string[] | undefined) ?? [],
          reporter: f.reporter as JiraIssue["reporter"], updated: f.updated as string | undefined,
        });
      }
      if (!r.nextPageToken) break;
      nextPageToken = r.nextPageToken;
    }
    return out;
  }

  /** The latest time the label was added, and by whom (from the ticket's history). */
  async lastLabelAdd(key: string, label: string): Promise<LabelAdd | undefined> {
    let found: LabelAdd | undefined;
    for (let startAt = 0, page = 0; page < 5; page++) {
      const r = await this.call<{ values?: { created: string; author?: LabelAdd["by"]; items?: { field?: string; fromString?: string | null; toString?: string | null }[] }[]; isLast?: boolean; total?: number }>(
        "GET", `/rest/api/3/issue/${encodeURIComponent(key)}/changelog?startAt=${startAt}&maxResults=100`);
      const values = r.values ?? [];
      for (const v of values) {
        for (const item of v.items ?? []) {
          if (item.field !== "labels") continue;
          const before = new Set((item.fromString ?? "").split(/\s+/).filter(Boolean));
          const after = new Set((item.toString ?? "").split(/\s+/).filter(Boolean));
          if (after.has(label) && !before.has(label) && (!found || v.created > found.at)) found = { at: v.created, by: v.author ?? {} };
        }
      }
      if (r.isLast !== false || !values.length) break;
      startAt += values.length;
    }
    return found;
  }

  async comments(key: string): Promise<{ id: string; text: string }[]> {
    const r = await this.call<{ comments?: { id: string; body?: unknown }[] }>("GET", `/rest/api/3/issue/${encodeURIComponent(key)}/comment?maxResults=100&orderBy=-created`);
    return (r.comments ?? []).map((c) => ({ id: c.id, text: JSON.stringify(c.body ?? "") }));
  }

  async addComment(key: string, adf: unknown): Promise<string> {
    const r = await this.call<{ id: string }>("POST", `/rest/api/3/issue/${encodeURIComponent(key)}/comment`, { body: adf });
    return r.id;
  }

  /** Move the ticket with the transition of this name; a missing transition is skipped, not an error. */
  async transition(key: string, name: string): Promise<boolean> {
    const r = await this.call<{ transitions?: { id: string; name: string }[] }>("GET", `/rest/api/3/issue/${encodeURIComponent(key)}/transitions`);
    const t = (r.transitions ?? []).find((x) => x.name.toLowerCase() === name.toLowerCase());
    if (!t) return false;
    await this.call("POST", `/rest/api/3/issue/${encodeURIComponent(key)}/transitions`, { transition: { id: t.id } });
    return true;
  }
}

/** Jira rich text (ADF) from plain paragraphs; `code` spans are shown as inline code. */
export function adfParagraphs(paragraphs: string[]): unknown {
  return {
    type: "doc", version: 1,
    content: paragraphs.map((p) => ({
      type: "paragraph",
      content: p.split(/(`[^`]+`)/).filter(Boolean).map((part) => part.startsWith("`") && part.endsWith("`")
        ? { type: "text", text: part.slice(1, -1), marks: [{ type: "code" }] }
        : { type: "text", text: part }),
    })),
  };
}
