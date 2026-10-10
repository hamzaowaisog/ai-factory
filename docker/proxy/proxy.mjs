// Factory egress proxy. No dependencies; runs in a small container on an internal network.
//   MODE=api   → reverse proxy: /anthropic/* → https://api.anthropic.com/*, /openai/* → https://api.openai.com/*,
//                adds the API key. The agent container never holds a key and can reach nothing else. Each key is
//                read from a file mounted read-only (KEY_FILE, OPENAI_KEY_FILE), never from the environment. A call
//                must be a model call (Anthropic: POST /v1/messages or its token count; OpenAI: POST /v1/responses),
//                carry a step's token (a file under TOKEN_DIR, written by the factory for that one step), and name
//                that step's model or a listed cheap one. What each token spends is counted, and a token past
//                its cap is refused. GET /spend tells the holder of a token what it has spent so far.
//   MODE=feeds → forward proxy: HTTPS CONNECT only to allowlisted hosts (package feeds).
// POC limit: feeds are allowlisted by host, not URL prefix (verify-runner §2.3 wants TLS
// termination with a factory CA; not built yet).
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { StringDecoder } from "node:string_decoder";

const MODE = process.env.MODE ?? "api";
const PORT = Number(process.env.PORT ?? (MODE === "api" ? 8080 : 3128));
const ALLOW = (process.env.ALLOW_HOSTS ?? "api.nuget.org,globalcdn.nuget.org,registry.npmjs.org").split(",").map((s) => s.trim()).filter(Boolean);
const KEY_FILE = process.env.KEY_FILE;
const OPENAI_KEY_FILE = process.env.OPENAI_KEY_FILE;
const TOKEN_DIR = process.env.TOKEN_DIR;
// models any step may call besides its own (the agent SDK's small background calls); "name-*" is a prefix
const ALLOW_MODELS = (process.env.ALLOW_MODELS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
// no byte from the API for this long ends the call (a stream sends pings, so only a dead connection waits this long)
const UPSTREAM_TIMEOUT_MS = Number(process.env.UPSTREAM_TIMEOUT_MS ?? 600_000);
const MAX_BODY = 64 * 1024 * 1024;
const fileKey = (file) => { try { return (file && readFileSync(file, "utf8").trim()) || undefined; } catch { return undefined; } };
const UPSTREAMS = {
  // read on every call, so a changed key needs no restart
  anthropic: { host: "api.anthropic.com", keyHeader: "x-api-key", key: () => fileKey(KEY_FILE) },
  openai: { host: "api.openai.com", keyHeader: "authorization", key: () => { const k = fileKey(OPENAI_KEY_FILE); return k ? `Bearer ${k}` : undefined; } },
};
const STRIP = new Set(["host", "x-api-key", "authorization", "connection", "proxy-authorization", "proxy-connection", "content-length", "transfer-encoding", "accept-encoding"]);
/** The text of a refusal for a token past its cap: the core reads it to tell this stop from a bad request. */
export const CAP_TEXT = "this step's spending cap is reached";

export function hostAllowed(host, allow = ALLOW) {
  const h = String(host).toLowerCase().replace(/:\d+$/, "");
  return allow.some((a) => h === a.toLowerCase());
}

export function route(url) {
  const m = /^\/(anthropic|openai)(\/.*)$/.exec(url ?? "");
  if (!m) return undefined;
  return { name: m[1], path: m[2] };
}

/** Only model calls pass: no files, batches, admin or model-list endpoints. `upstream` is "anthropic" (the default) or "openai". */
export function callAllowed(method, path, upstream = "anthropic") {
  const calls = upstream === "openai" ? /^\/v1\/responses$/ : /^\/v1\/messages(\/count_tokens)?$/;
  return method === "POST" && calls.test(String(path ?? "").split("?")[0]);
}

/** A model passes when it is listed by name, by name with a date ("name-20260101"), or under a "name-*" prefix. */
export function modelAllowed(model, allow) {
  if (typeof model !== "string" || !model) return false;
  return allow.some((a) => a && (a.endsWith("*") ? model.startsWith(a.slice(0, -1)) : model === a || (model.startsWith(`${a}-`) && /^\d{8}$/.test(model.slice(a.length + 1)))));
}

/** A step's token → what the factory allowed it (its file is named by the token's hash, so the name is no secret). */
export function readGrant(token, dir = TOKEN_DIR) {
  if (!dir || typeof token !== "string" || token.length < 16) return undefined;
  const id = createHash("sha256").update(token).digest("hex");
  try { return { id, ...JSON.parse(readFileSync(`${dir}/${id}.json`, "utf8")) }; } catch { return undefined; }
}

/** Reads the token counts out of an answer as it passes (a stream's events or one JSON body); the largest value of each count stands. */
export function usageMeter() {
  const u = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  const dec = new StringDecoder("utf8");
  let tail = "";
  const take = (x) => {
    if (!x || typeof x !== "object") return;
    // OpenAI counts cached tokens inside input_tokens and names them in a details object
    const cached = x.input_tokens_details?.cached_tokens;
    const y = typeof cached === "number" ? { ...x, input_tokens: Math.max(0, (x.input_tokens ?? 0) - cached), cache_read_input_tokens: cached } : x;
    for (const k of Object.keys(u)) if (typeof y[k] === "number") u[k] = Math.max(u[k], y[k]);
  };
  const line = (l) => {
    const s = l.startsWith("data:") ? l.slice(5) : l;
    if (!s.includes('"usage"')) return;
    try { const j = JSON.parse(s); take(j.message?.usage); take(j.usage); take(j.response?.usage); } catch { /* not a whole JSON line: nothing counted */ }
  };
  const feed = (text) => {
    tail += text;
    for (let i = tail.indexOf("\n"); i >= 0; i = tail.indexOf("\n")) { line(tail.slice(0, i).trim()); tail = tail.slice(i + 1); }
    if (tail.length > 8 * 1024 * 1024) tail = "";
  };
  return { push: (chunk) => feed(dec.write(chunk)), done: () => { feed(dec.end()); line(tail.trim()); tail = ""; return u; } };
}

/** USD for counted tokens at the grant's prices (per million tokens); 0 when the grant has none. */
export function usdOf(u, price) {
  if (!price) return 0;
  return (u.input_tokens * (price.input ?? 0) + u.output_tokens * (price.output ?? 0) + u.cache_read_input_tokens * (price.cacheRead ?? 0) + u.cache_creation_input_tokens * (price.cacheWrite ?? 0)) / 1_000_000;
}

function log(msg) {
  process.stdout.write(`${new Date().toISOString()} ${MODE} ${msg}\n`);
}

/** `opts` replaces the settings from the environment (tests point it at a local stand-in for the API). */
function apiServer(opts = {}) {
  const upstreams = opts.upstreams ?? UPSTREAMS;
  const tokenDir = opts.tokenDir ?? TOKEN_DIR;
  const allowModels = opts.allowModels ?? ALLOW_MODELS;
  const timeoutMs = opts.timeoutMs ?? UPSTREAM_TIMEOUT_MS;
  // token id → what it has spent so far: USD, model calls and tokens. In memory: a restarted proxy starts the count again.
  const spent = new Map();
  const spentBy = (id) => spent.get(id) ?? { usd: 0, calls: 0, input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  return http.createServer((req, res) => {
    const where = `${req.method} ${String(req.url).split("?")[0]}`;
    const deny = (status, type, why) => {
      req.resume();
      res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify({ type: "error", error: { type, message: `factory proxy: ${why}` } }));
      log(`deny ${status} ${where} (${why})`);
    };
    const bearer = /^Bearer\s+(.+)$/i.exec(String(req.headers.authorization ?? ""))?.[1];
    // a step asks what its own token has spent (the Codex agent reports no cost while it works)
    if (req.method === "GET" && String(req.url).split("?")[0] === "/spend") {
      const own = readGrant(req.headers["x-api-key"] ?? bearer, tokenDir);
      if (!own) return deny(401, "authentication_error", "no step token, or one that is not registered");
      req.resume();
      return void res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(spentBy(own.id)));
    }
    const r = route(req.url);
    const up = r && upstreams[r.name];
    const key = up?.key();
    if (!up || !key) return deny(403, "permission_error", "blocked");
    if (!callAllowed(req.method, r.path, r.name)) return deny(403, "permission_error", "only model calls are allowed");
    const grant = readGrant(req.headers["x-api-key"] ?? bearer, tokenDir);
    if (!grant) return deny(401, "authentication_error", "no step token, or one that is not registered");
    if (typeof grant.capUsd === "number" && spentBy(grant.id).usd >= grant.capUsd) return deny(400, "invalid_request_error", CAP_TEXT);

    const parts = [];
    let size = 0, refused = false;
    req.on("data", (c) => {
      if (refused) return;
      size += c.length;
      if (size > MAX_BODY) { refused = true; return deny(413, "request_too_large", "request body too large"); }
      parts.push(c);
    });
    req.on("error", () => { refused = true; });
    req.on("end", () => {
      if (refused) return;
      const body = Buffer.concat(parts);
      let model;
      try { model = JSON.parse(body.toString("utf8")).model; } catch { /* no model: refused below */ }
      if (!modelAllowed(model, [grant.model, ...allowModels])) return deny(403, "permission_error", `model ${String(model).slice(0, 80)} is not allowed for this step`);
      const headers = {};
      for (const [k, v] of Object.entries(req.headers)) if (!STRIP.has(k.toLowerCase())) headers[k] = v;
      headers[up.keyHeader] = key;
      headers.host = up.host;
      headers["content-length"] = String(body.length);
      const meter = usageMeter();
      let settled = false;
      const settle = () => {
        if (settled) return;
        settled = true;
        const u = meter.done();
        const usd = usdOf(u, grant.usdPerMTok);
        const before = spentBy(grant.id);
        const total = before.usd + usd;
        spent.set(grant.id, {
          usd: total, calls: before.calls + 1, input_tokens: before.input_tokens + u.input_tokens, output_tokens: before.output_tokens + u.output_tokens,
          cache_read_input_tokens: before.cache_read_input_tokens + u.cache_read_input_tokens, cache_creation_input_tokens: before.cache_creation_input_tokens + u.cache_creation_input_tokens,
        });
        log(`${where} ${grant.run ?? "?"} ${grant.key ?? "?"} ${model} $${usd.toFixed(4)} (step total $${total.toFixed(4)}${typeof grant.capUsd === "number" ? ` of $${grant.capUsd.toFixed(2)}` : ""})`);
      };
      const out = (up.tls === false ? http : https).request({ host: up.host, port: up.port ?? 443, method: req.method, path: r.path, headers }, (upRes) => {
        res.writeHead(upRes.statusCode ?? 502, upRes.headers);
        upRes.on("data", (c) => meter.push(c));
        upRes.on("end", settle);
        upRes.on("close", settle);
        upRes.pipe(res);
      });
      out.setTimeout(timeoutMs, () => out.destroy(new Error(`no answer from the API in ${Math.round(timeoutMs / 1000)} s`)));
      out.on("error", (e) => {
        log(`upstream error ${e.message}`);
        if (!res.headersSent) res.writeHead(504, { "content-type": "application/json" }).end(JSON.stringify({ type: "error", error: { type: "api_error", message: `factory proxy: ${e.message}` } }));
        else res.destroy();
      });
      // the agent went away: stop the upstream call too
      res.on("close", () => { if (!res.writableEnded) out.destroy(); });
      out.end(body);
    });
  });
}

function feedServer() {
  const server = http.createServer((req, res) => {
    res.writeHead(403).end("only HTTPS CONNECT to package feeds is allowed");
    log(`deny plain ${req.method} ${req.url}`);
  });
  server.on("connect", (req, clientSocket, head) => {
    const [host, portStr] = String(req.url).split(":");
    const port = Number(portStr || 443);
    if (port !== 443 || !hostAllowed(host)) {
      clientSocket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
      log(`deny CONNECT ${req.url}`);
      return;
    }
    const up = net.connect(port, host, () => {
      clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head?.length) up.write(head);
      up.pipe(clientSocket);
      clientSocket.pipe(up);
    });
    up.on("error", () => clientSocket.destroy());
    clientSocket.on("error", () => up.destroy());
    log(`CONNECT ${host}`);
  });
  return server;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  const server = MODE === "api" ? apiServer() : feedServer();
  server.listen(PORT, "0.0.0.0", () => log(`listening on ${PORT}`));
}

export { apiServer, feedServer };
