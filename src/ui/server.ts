// `factory ui`: a small local web app to start runs and watch them. node:http only, plain files.
// It can NEVER approve a plan, waive, unlock, steer, pause or stop: those decisions are TTY-only
// (ledger/human.ts), so no AI or script can approve its own plan. Three exceptions, each needing a typed name
// and the card's hash: the lead's approve or reject of an estimate card, the same on a design card (E1b), and
// the answers to a clarification question card (so a run never stops waiting for a second command). Exporting an
// approved design (POST /api/runs/:id/exports) only writes files under the run's own exports/ folder, and generating its
// scaffold (POST /api/runs/:id/scaffold) only under the run's own scaffold/ folder.
// Other cards are shown read-only with the terminal command to paste.
// Safety: bound to 127.0.0.1; a random token per start (in the printed link, then an HttpOnly
// cookie) on every API call; Host and Origin checked so another website can't drive it; JSON-only
// POSTs; a 1 MB body limit; no secrets or .env values are ever sent.
import { randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import "../gates/predicates.js";
import "../design/gates.js";
import { REPO_ROOT } from "../runners/netinfra.js";
import { dashboardView, designView, estimateView, eventsView, draftFile, exportFile, findRun, visualShot, previewView, projectsView, referencesView, refImage, runView, runsView, statsView } from "./data.js";
import { previewFile } from "./preview.js";
import { answerEstimateQuestions, checkRefs, decideEstimate, startRun, StartError, type StartDeps } from "./start.js";
import { designExportsView, exportDownload, ExportJobs, exportRequest } from "./exports.js";
import { figmaPluginZip } from "../design/figma.js";
import { generateScaffold, scaffoldDownload, scaffoldPanel } from "./scaffold.js";
import { fidelityPanel, fidelityShot } from "./fidelity.js";
import type { ExportFormat } from "../design/export.js";

export const MAX_BODY_BYTES = 1_000_000;
/** Starting a run (and checking references) may carry design frames and reference files (base64 in the JSON, up to 50 MB of references), so those routes take a bigger body. */
export const MAX_UPLOAD_BODY_BYTES = 80_000_000;
const COOKIE = "factory_ui";

type Json = Record<string, unknown> | unknown[];
interface Reply { status: number; json: unknown }
interface Route {
  method: "GET" | "POST";
  /** "/api/runs/:id" */
  path: string;
  what: string;
  handle(params: Record<string, string>, body: unknown, deps: StartDeps, ctx: RouteContext): Promise<Reply> | Reply;
}

/** Per-server values a route may need: the key in preview file URLs, and the design export jobs. */
interface RouteContext { previewKey: string; jobs: ExportJobs }

const ok = (json: Json): Reply => ({ status: 200, json });
const notFound = (what: string): Reply => ({ status: 404, json: { error: what } });

/** Every API route. Read-only except starting a run; there is deliberately no decision route. */
export const ROUTES: readonly Route[] = [
  { method: "GET", path: "/api/projects", what: "projects and whether Jira and Figma are set up", handle: async () => ok(await projectsView()) },
  { method: "GET", path: "/api/runs", what: "recent runs", handle: () => ok(runsView()) },
  {
    method: "GET", path: "/api/runs/:id", what: "one run: timeline, cost, trace, open card (read-only), delivery",
    handle: ({ id }) => { const l = findRun(id!); return l ? ok(runView(l)) : notFound(`No run ${id}`); },
  },
  {
    method: "GET", path: "/api/runs/:id/design", what: "the design step's data for a run",
    handle: ({ id }) => { const l = findRun(id!); return l ? ok(designView(l)) : notFound(`No run ${id}`); },
  },
  {
    method: "GET", path: "/api/runs/:id/references", what: "the run's design references: pictures, measured look, how they were read and used, the screens they shaped",
    handle: ({ id }) => { const l = findRun(id!); return l ? ok(referencesView(l)) : notFound(`No run ${id}`); },
  },
  {
    method: "GET", path: "/api/runs/:id/estimate", what: "an estimate run's totals, tasks, API cost, approved design and exported files, or why there are none",
    handle: ({ id }) => { const l = findRun(id!); return l ? ok(estimateView(l)) : notFound(`No run ${id}`); },
  },
  {
    method: "GET", path: "/api/runs/:id/events", what: "the run's ledger events and trace lines, secret-masked (text view)",
    handle: ({ id }) => { const l = findRun(id!); return l ? ok(eventsView(l)) : notFound(`No run ${id}`); },
  },
  {
    method: "GET", path: "/api/runs/:id/stats", what: "per-step cost, time and retries, cost over time, totals (graphical and statistical views)",
    handle: ({ id }) => { const l = findRun(id!); return l ? ok(statsView(l)) : notFound(`No run ${id}`); },
  },
  {
    method: "GET", path: "/api/runs/:id/preview", what: "the run's clickable preview and images, or why there is none",
    handle: ({ id }, _b, _d, ctx) => {
      const l = findRun(id!);
      return l ? ok({ ...previewView(l), base: `/preview/${ctx.previewKey}/${encodeURIComponent(l.runId)}/` }) : notFound(`No run ${id}`);
    },
  },
  { method: "GET", path: "/api/dashboard", what: "outcomes, the per-stage table and recent runs", handle: () => ok(dashboardView()) },
  {
    method: "POST", path: "/api/runs", what: "start a run (same checks as factory start), executed in the background",
    handle: async (_p, body, deps, ctx) => {
      try {
        // a build from an estimate exports its approved design at once, as an export job the Design tab shows
        const exportNow = deps.exportNow ?? ((runId: string, formats: ExportFormat[]) => { try { ctx.jobs.start(runId, { formats }); } catch { /* one is already running */ } });
        const r = await startRun((body ?? {}) as Record<string, unknown>, { ...deps, exportNow });
        return { status: 201, json: r };
      } catch (e) {
        if (e instanceof StartError) return { status: e.status, json: { error: e.message } };
        return { status: 400, json: { error: (e as Error).message } };
      }
    },
  },
  {
    method: "POST", path: "/api/check-refs", what: "read design references without starting a run (like factory design check-refs): what each gives, or why it cannot be read",
    handle: async (_p, body, deps) => {
      try { return ok(await checkRefs((body ?? {}) as Record<string, unknown>, deps)); } catch (e) {
        return { status: e instanceof StartError ? e.status : 400, json: { error: (e as Error).message } };
      }
    },
  },
  {
    method: "POST", path: "/api/runs/:id/estimate-decision", what: "the lead's approve or reject of an estimate card (estimate cards only; needs a typed name, the card hash and sign-offs for flagged tasks)",
    handle: async ({ id }, body, deps) => {
      const l = findRun(id!);
      if (!l) return notFound(`No run ${id}`);
      try {
        return { status: 200, json: await decideEstimate(l, (body ?? {}) as Record<string, unknown>, deps) };
      } catch (e) {
        if (e instanceof StartError) return { status: e.status, json: { error: e.message } };
        return { status: 400, json: { error: (e as Error).message } };
      }
    },
  },
  {
    method: "POST", path: "/api/runs/:id/estimate-answers", what: "the answers to an estimate run's clarification questions (question cards on estimate runs only; needs a typed name and the card hash)",
    handle: async ({ id }, body, deps) => {
      const l = findRun(id!);
      if (!l) return notFound(`No run ${id}`);
      try {
        return { status: 200, json: await answerEstimateQuestions(l, (body ?? {}) as Record<string, unknown>, deps) };
      } catch (e) {
        if (e instanceof StartError) return { status: e.status, json: { error: e.message } };
        return { status: 400, json: { error: (e as Error).message } };
      }
    },
  },
  {
    method: "GET", path: "/api/runs/:id/exports", what: "what the run's approved design can be exported as, the export jobs and earlier exports",
    handle: ({ id }, _b, _d, ctx) => { const l = findRun(id!); return l ? ok(designExportsView(l, ctx.jobs.list())) : notFound(`No run ${id}`); },
  },
  {
    method: "POST", path: "/api/runs/:id/exports", what: "export the run's approved design (formats png, pdf, html, tokens, json; screens, states, widths, modes, langs, version, pdfPerScreen), as a job; files land in the run's exports folder",
    handle: ({ id }, body, _d, ctx) => {
      const l = findRun(id!);
      if (!l) return notFound(`No run ${id}`);
      const v = designExportsView(l);
      if (!v.available) return { status: 409, json: { error: v.why } };
      try {
        const { job } = ctx.jobs.start(l.runId, exportRequest((body ?? {}) as Record<string, unknown>));
        return { status: 202, json: { job } };
      } catch (e) {
        return { status: (e as { status?: number }).status ?? 400, json: { error: (e as Error).message } };
      }
    },
  },
  {
    method: "GET", path: "/api/runs/:id/scaffold", what: "the UI target the run's approved design is built in and the files its scaffold writes",
    handle: ({ id }) => { const l = findRun(id!); return l ? ok(scaffoldPanel(l) as unknown as Json) : notFound(`No run ${id}`); },
  },
  {
    method: "GET", path: "/api/runs/:id/scaffold/:target", what: "the same for another target (next-shadcn, vite-shadcn, repo)",
    handle: ({ id, target }) => {
      const l = findRun(id!);
      if (!l) return notFound(`No run ${id}`);
      try { return ok(scaffoldPanel(l, target) as unknown as Json); } catch (e) { return { status: (e as { status?: number }).status ?? 400, json: { error: (e as Error).message } }; }
    },
  },
  {
    method: "POST", path: "/api/runs/:id/scaffold", what: "generate the scaffold (target) into the run's scaffold folder, to download as a zip and run",
    handle: async ({ id }, body) => {
      const l = findRun(id!);
      if (!l) return notFound(`No run ${id}`);
      try { return ok(await generateScaffold(l, (body ?? {}) as Record<string, unknown>)); } catch (e) { return { status: (e as { status?: number }).status ?? 400, json: { error: (e as Error).message } }; }
    },
  },
  {
    method: "GET", path: "/api/runs/:id/fidelity", what: "the build's check of the app against the approved design: levels, findings, each page's built, approved and accepted pictures",
    handle: ({ id }) => { const l = findRun(id!); return l ? ok(fidelityPanel(l) as unknown as Json) : notFound(`No run ${id}`); },
  },
];

function match(route: Route, method: string, path: string): Record<string, string> | undefined {
  if (route.method !== method) return undefined;
  const a = route.path.split("/"), b = path.split("/");
  if (a.length !== b.length) return undefined;
  const params: Record<string, string> = {};
  for (let i = 0; i < a.length; i++) {
    if (a[i]!.startsWith(":")) {
      try { params[a[i]!.slice(1)] = decodeURIComponent(b[i]!); } catch { return undefined; }
    } else if (a[i] !== b[i]) return undefined;
  }
  return params;
}

// ---------- static files ----------

const here = fileURLToPath(new URL(".", import.meta.url));
/** dist/ui/static (copied by the build), or the sources when running with tsx */
export function staticDir(): string {
  const built = join(here, "static");
  return existsSync(built) ? built : join(REPO_ROOT, "src", "ui", "static");
}

const STATIC: Record<string, { file: string; type: string }> = {
  "/app.js": { file: "app.js", type: "text/javascript; charset=utf-8" },
  "/md.js": { file: "md.js", type: "text/javascript; charset=utf-8" },
  "/theme.js": { file: "theme.js", type: "text/javascript; charset=utf-8" },
  "/app.css": { file: "app.css", type: "text/css; charset=utf-8" },
  "/favicon.svg": { file: "favicon.svg", type: "image/svg+xml" },
};

const SECURITY_HEADERS = {
  "Content-Security-Policy": "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
};

/**
 * Preview files: shown in <iframe sandbox="allow-scripts">, so they run in an opaque origin that
 * can't read this app, its cookie or its API. They may run their own inline scripts, but can't
 * connect anywhere, submit forms or be framed by another site.
 */
const PREVIEW_HEADERS = {
  "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'self'; sandbox allow-scripts",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "SAMEORIGIN",
  "Referrer-Policy": "no-referrer",
  // the sandboxed frame has an opaque origin: its own images and scripts must still load
  "Cross-Origin-Resource-Policy": "cross-origin",
};

// ---------- server ----------

export interface UiServerOptions {
  /** fixed token (tests); default: random per start */
  token?: string;
  /** fixed preview key (tests); default: random per start */
  previewKey?: string;
  deps?: StartDeps;
  /** the design export jobs (tests pass their own) */
  exportJobs?: ExportJobs;
}

export interface UiServer { server: Server; token: string; previewKey: string; exportJobs: ExportJobs }

function sameToken(a: string | undefined, b: string): boolean {
  if (!a) return false;
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function cookieToken(req: IncomingMessage): string | undefined {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === COOKIE) return v.join("=");
  }
  return undefined;
}

function send(res: ServerResponse, status: number, body: string | Buffer, type: string, extra: Record<string, string> = {}): void {
  res.writeHead(status, { ...SECURITY_HEADERS, "Content-Type": type, "Cache-Control": "no-store", ...extra });
  res.end(body);
}

const sendJson = (res: ServerResponse, status: number, json: unknown) => send(res, status, JSON.stringify(json), "application/json; charset=utf-8");

async function readBody(req: IncomingMessage, limit = MAX_BODY_BYTES): Promise<string | "too-big"> {
  if (Number(req.headers["content-length"] ?? 0) > limit) return "too-big";
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > limit) return "too-big";
    chunks.push(c as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

const LOCKED_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>AI Factory</title>
<meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/app.css"></head>
<body><main class="locked"><h1>AI Factory</h1><p>Open the link that <code>factory ui</code> printed in your terminal. It carries the key for this session.</p></main></body></html>`;

export function createUiServer(opts: UiServerOptions = {}): UiServer {
  const token = opts.token ?? randomBytes(24).toString("base64url");
  // a second key, only for preview file URLs (a sandboxed frame sends no cookie and no same-site Origin)
  const previewKey = opts.previewKey ?? randomBytes(18).toString("base64url");
  const deps = opts.deps ?? {};
  const jobs = opts.exportJobs ?? new ExportJobs();

  const server = createServer((req, res) => {
    handle(req, res).catch((e: Error) => {
      if (!res.headersSent) sendJson(res, 500, { error: e.message.split("\n")[0] });
      else res.end();
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const port = (server.address() as AddressInfo | null)?.port;
    const allowedHosts = [`127.0.0.1:${port}`, `localhost:${port}`];
    // a page on another site (or a rebound DNS name) can't talk to this server
    if (!allowedHosts.includes(String(req.headers.host ?? ""))) return send(res, 403, "Wrong host.", "text/plain; charset=utf-8");
    const early = new URL(req.url ?? "/", `http://${req.headers.host}`).pathname;
    if (early.startsWith("/preview/")) return servePreview(req, res, early);
    const origin = req.headers.origin;
    if (origin !== undefined && !allowedHosts.map((h) => `http://${h}`).includes(origin)) return sendJson(res, 403, { error: "Cross-origin requests are refused." });
    if (req.headers["sec-fetch-site"] === "cross-site") return sendJson(res, 403, { error: "Cross-site requests are refused." });

    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
    const path = url.pathname;
    const method = req.method ?? "GET";
    const headerToken = typeof req.headers["x-factory-token"] === "string" ? req.headers["x-factory-token"] : undefined;
    const authed = sameToken(headerToken, token) || sameToken(cookieToken(req), token);

    if (method === "GET" && STATIC[path]) {
      const f = STATIC[path]!;
      return send(res, 200, readFileSync(join(staticDir(), f.file)), f.type);
    }
    if (method === "GET" && (path === "/" || path === "/index.html")) {
      const t = url.searchParams.get("t");
      if (t !== null) {
        if (!sameToken(t, token)) return send(res, 401, LOCKED_PAGE, "text/html; charset=utf-8");
        // the key moves into an HttpOnly cookie and out of the address bar
        return send(res, 302, "", "text/plain", { Location: "/", "Set-Cookie": `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/` });
      }
      if (!authed) return send(res, 401, LOCKED_PAGE, "text/html; charset=utf-8");
      return send(res, 200, readFileSync(join(staticDir(), "index.html")), "text/html; charset=utf-8");
    }
    if (method === "GET" && path.startsWith("/export/")) {
      // a workbook download: same key as the API, and only the two files the export step recorded
      if (!authed) return send(res, 401, "Missing or wrong key.", "text/plain; charset=utf-8");
      const [, , runId = "", audience = ""] = path.split("/");
      let l;
      try { l = findRun(decodeURIComponent(runId)); } catch { l = undefined; }
      const want = decodeURIComponent(audience);
      const f = !l ? undefined : want.startsWith("draft-") ? await draftFile(l, want.slice(6)) : exportFile(l, want);
      if (!f) return send(res, 404, "No such workbook.", "text/plain; charset=utf-8");
      const type = /\.pdf$/i.test(f.name) ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      return send(res, 200, f.body, type, { "Content-Disposition": `attachment; filename="${f.name.replace(/[^\w.-]/g, "_")}"` });
    }
    if (method === "GET" && path.startsWith("/design-exports/")) {
      // a design export: same key as the API, only files an export recorded (or its whole folder as a zip)
      if (!authed) return send(res, 401, "Missing or wrong key.", "text/plain; charset=utf-8");
      const [, , runId = "", ...rest] = path.split("/");
      let l;
      try { l = findRun(decodeURIComponent(runId)); } catch { l = undefined; }
      const f = l && rest.length ? await exportDownload(l, rest.join("/")) : undefined;
      if (!f) return send(res, 404, "No such export.", "text/plain; charset=utf-8");
      return send(res, 200, f.body, f.type, { "Content-Disposition": `attachment; filename="${f.name}"` });
    }
    if (method === "GET" && path === "/figma-plugin.zip") {
      // the AI Factory Import plugin for Figma, to import from its manifest: same key as the API
      if (!authed) return send(res, 401, "Missing or wrong key.", "text/plain; charset=utf-8");
      return send(res, 200, await figmaPluginZip(), "application/zip", { "Content-Disposition": 'attachment; filename="ai-factory-figma-plugin.zip"' });
    }
    if (method === "GET" && path.startsWith("/scaffolds/")) {
      // a generated scaffold as a zip: same key as the API, only <run>/scaffold/<target>
      if (!authed) return send(res, 401, "Missing or wrong key.", "text/plain; charset=utf-8");
      const [, , runId = "", name = ""] = path.split("/");
      let l;
      try { l = findRun(decodeURIComponent(runId)); } catch { l = undefined; }
      const f = l ? await scaffoldDownload(l, decodeURIComponent(name)) : undefined;
      if (!f) return send(res, 404, "No such scaffold.", "text/plain; charset=utf-8");
      return send(res, 200, f.body, "application/zip", { "Content-Disposition": `attachment; filename="${f.name.replace(/[^\w.-]/g, "_")}"` });
    }
    if (method === "GET" && path.startsWith("/shots/")) {
      // a picture from a run's visual check: same key as the API, png files in one folder only
      if (!authed) return send(res, 401, "Missing or wrong key.", "text/plain; charset=utf-8");
      const [, , runId = "", ...rest] = path.split("/");
      let l, rel = "";
      try { l = findRun(decodeURIComponent(runId)); rel = rest.map(decodeURIComponent).join("/"); } catch { l = undefined; }
      const body = l ? visualShot(l, rel) : undefined;
      if (!body) return send(res, 404, "No such picture.", "text/plain; charset=utf-8");
      return send(res, 200, body, "image/png", { "Cache-Control": "no-store" });
    }
    if (method === "GET" && path.startsWith("/fidelity-shots/")) {
      // a picture of the fidelity check: same key as the API, png files in four folders only
      if (!authed) return send(res, 401, "Missing or wrong key.", "text/plain; charset=utf-8");
      const [, , runId = "", kind = "", name = ""] = path.split("/");
      let l, file = "";
      try { l = findRun(decodeURIComponent(runId)); file = decodeURIComponent(name); } catch { l = undefined; }
      const body = l ? fidelityShot(l, kind, file) : undefined;
      if (!body) return send(res, 404, "No such picture.", "text/plain; charset=utf-8");
      return send(res, 200, body, "image/png", { "Cache-Control": "no-store" });
    }
    if (method === "GET" && path.startsWith("/refs/")) {
      // a design reference's picture: same key as the API, only refs/R-n-k.png of that run
      if (!authed) return send(res, 401, "Missing or wrong key.", "text/plain; charset=utf-8");
      const [, , runId = "", name = "", ...more] = path.split("/");
      let l, file = "";
      try { l = more.length ? undefined : findRun(decodeURIComponent(runId)); file = decodeURIComponent(name); } catch { l = undefined; }
      const body = l ? refImage(l, file) : undefined;
      if (!body) return send(res, 404, "No such picture.", "text/plain; charset=utf-8");
      return send(res, 200, body, "image/png", { "Cache-Control": "no-store" });
    }
    if (!path.startsWith("/api/")) return send(res, 404, "Not found.", "text/plain; charset=utf-8");

    if (!authed) return sendJson(res, 401, { error: "Missing or wrong key. Open the link factory ui printed." });
    let params: Record<string, string> | undefined;
    const route = ROUTES.find((r) => (params = match(r, method, path)) !== undefined);
    if (!route) {
      const exists = ROUTES.some((r) => match({ ...r, method: method as Route["method"] }, method, path));
      return sendJson(res, exists ? 405 : 404, { error: exists ? "Method not allowed." : "No such endpoint." });
    }
    let body: unknown;
    if (method === "POST") {
      // a browser only sends JSON with a preflight, which this server never allows cross-origin
      if (!String(req.headers["content-type"] ?? "").startsWith("application/json")) return sendJson(res, 415, { error: "Send JSON." });
      // a cookie alone isn't enough without a same-site Origin (curl sends the key in a header)
      if (origin === undefined && !sameToken(headerToken, token)) return sendJson(res, 403, { error: "A POST needs the page's origin or the key header." });
      const limit = route.path === "/api/runs" || route.path === "/api/check-refs" ? MAX_UPLOAD_BODY_BYTES : MAX_BODY_BYTES;
      const raw = await readBody(req, limit);
      if (raw === "too-big") return sendJson(res, 413, { error: `The request is over ${limit / 1_000_000} MB.` });
      try { body = raw ? JSON.parse(raw) : {}; } catch { return sendJson(res, 400, { error: "Bad JSON." }); }
    }
    const r = await route.handle(params!, body, deps, { previewKey, jobs });
    return sendJson(res, r.status, r.json);
  }

  /** GET /preview/<previewKey>/<run>/<file>: read-only, the preview key instead of the session key. */
  function servePreview(req: IncomingMessage, res: ServerResponse, path: string): void {
    const plain = (status: number, text: string) => { res.writeHead(status, { ...PREVIEW_HEADERS, "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" }); res.end(text); };
    if (req.method !== "GET" && req.method !== "HEAD") return plain(405, "Read-only.");
    // raw (still encoded) segments: the file part is decoded and checked once, in previewFile
    const [, , key, run, ...rest] = path.split("/");
    if (!sameToken(key, previewKey)) return plain(401, "Wrong preview key.");
    let runId: string;
    try { runId = decodeURIComponent(run ?? ""); } catch { return plain(404, "Not found."); }
    const l = findRun(runId);
    const f = l && rest.length ? previewFile(l, rest.join("/")) : undefined;
    if (!f) return plain(404, "Not found.");
    res.writeHead(200, { ...PREVIEW_HEADERS, "Content-Type": f.type, "Cache-Control": "no-store" });
    res.end(req.method === "HEAD" ? undefined : f.body);
  }

  return { server, token, previewKey, exportJobs: jobs };
}

/** Listen on 127.0.0.1 only. Tries the next ports when the default one is taken. */
export async function listen(ui: UiServer, port: number, tries = 1): Promise<number> {
  for (let i = 0; i < tries; i++) {
    const p = port === 0 ? 0 : port + i;
    try {
      await new Promise<void>((resolve, reject) => {
        const onErr = (e: Error) => { ui.server.off("listening", onOk); reject(e); };
        const onOk = () => { ui.server.off("error", onErr); resolve(); };
        ui.server.once("error", onErr).once("listening", onOk);
        ui.server.listen(p, "127.0.0.1");
      });
      return (ui.server.address() as AddressInfo).port;
    } catch (e) {
      if ((e as { code?: string }).code !== "EADDRINUSE" || i === tries - 1) throw e;
    }
  }
  throw new Error("no free port");
}
