// Fetching links a user gave without letting them reach the factory's own network (PR #11 review, item 17).
// The address is checked in the same lookup the connection uses, so a name cannot answer the check with a public
// address and the connection with a private one (DNS rebinding). Bodies are read up to a cap, never whole.
import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpRequest, type IncomingHttpHeaders } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP, type LookupFunction } from "node:net";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";
import type { Readable } from "node:stream";

export class FetchRefused extends Error {}

const v4Private = (v: string): boolean => {
  const [a, b] = v.split(".").map(Number) as [number, number];
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
};

/** The eight 16-bit groups of an IPv6 address (an embedded dotted IPv4 tail included). */
function groups6(v: string): number[] | undefined {
  let s = v.split("%")[0]!;
  const tail = s.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (tail) {
    const [a, b, c, d] = tail[1]!.split(".").map(Number) as [number, number, number, number];
    s = s.slice(0, -tail[1]!.length) + `${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head, rest] = s.split("::") as [string, string | undefined];
  const h = head ? head.split(":") : [];
  const r = rest !== undefined && rest !== "" ? rest.split(":") : [];
  const fill = s.includes("::") ? 8 - h.length - r.length : 0;
  const all = [...h, ...Array(Math.max(0, fill)).fill("0"), ...r].map((x) => parseInt(x, 16));
  return all.length === 8 && all.every((x) => Number.isInteger(x) && x >= 0 && x <= 0xffff) ? all : undefined;
}

const v4Of = (hi: number, lo: number) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;

/**
 * Loopback, private, link-local, carrier-grade NAT, benchmark and unspecified addresses, IPv4 and IPv6, including an
 * IPv4 address carried inside IPv6 in any spelling (::ffff:127.0.0.1, ::ffff:7f00:1, ::127.0.0.1, 64:ff9b::/96, 2002::/16).
 */
export function isPrivateAddress(ip: string): boolean {
  const v = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (isIP(v) === 4) return v4Private(v);
  if (isIP(v.split("%")[0]!) !== 6) return false;
  const g = groups6(v);
  if (!g) return true; // unreadable: refuse
  const zero = (n: number) => g.slice(0, n).every((x) => x === 0);
  if (zero(8)) return true; // ::
  if (zero(7) && g[7] === 1) return true; // ::1
  if (zero(5) && g[5] === 0xffff) return v4Private(v4Of(g[6]!, g[7]!)); // IPv4-mapped
  if (zero(6)) return v4Private(v4Of(g[6]!, g[7]!)); // IPv4-compatible (deprecated)
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return v4Private(v4Of(g[6]!, g[7]!)); // NAT64
  if (g[0] === 0x2002) return v4Private(v4Of(g[1]!, g[2]!)); // 6to4
  const top = g[0]!;
  return (top & 0xfe00) === 0xfc00 /* fc00::/7 */ || (top & 0xffc0) === 0xfe80 /* link-local */ || (top & 0xffc0) === 0xfec0 /* site-local */ || (top & 0xff00) === 0xff00 /* multicast */;
}

export type Resolve = (host: string) => Promise<string[]>;
const defaultResolve: Resolve = async (h) => (await dnsLookup(h, { all: true })).map((a) => a.address);

/** A DNS lookup for a socket that refuses a private answer: the address checked is the address connected to. */
export function guardedLookup(allowPrivate: boolean, resolve: Resolve = defaultResolve): LookupFunction {
  return ((host: string, opts: { all?: boolean }, cb: (err: Error | null, address: string | { address: string; family: number }[], family?: number) => void) => {
    resolve(host).then((addrs) => {
      if (!addrs.length) throw new FetchRefused(`${host} could not be found`);
      if (!allowPrivate && addrs.some(isPrivateAddress)) throw new FetchRefused(`${host} is a private address`);
      const list = addrs.map((a) => ({ address: a, family: isIP(a) }));
      if (opts?.all) cb(null, list); else cb(null, list[0]!.address, list[0]!.family);
    }).catch((e: Error) => cb(e, ""));
  }) as LookupFunction;
}

/** Read a stream to a buffer, failing past `max` bytes. */
export function readStreamCapped(s: Readable, max: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const parts: Buffer[] = [];
    let n = 0;
    s.on("data", (c: Buffer) => {
      n += c.length;
      if (n > max) { s.destroy(); reject(new FetchRefused(`over ${Math.round(max / 1e6)} MB`)); return; }
      parts.push(c);
    });
    s.on("end", () => resolve(Buffer.concat(parts)));
    s.on("error", reject);
  });
}

/** A fetch Response's body up to `max` bytes (the declared length is checked first, then the bytes as they arrive). */
export async function readResponseCapped(res: Response, max: number): Promise<Buffer> {
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > max) { await res.body?.cancel().catch(() => undefined); throw new FetchRefused(`over ${Math.round(max / 1e6)} MB`); }
  if (!res.body) return Buffer.alloc(0);
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.length;
    if (n > max) { await reader.cancel().catch(() => undefined); throw new FetchRefused(`over ${Math.round(max / 1e6)} MB`); }
    parts.push(value);
  }
  return Buffer.concat(parts);
}

export interface PinnedResponse { status: number; headers: Record<string, string>; body: Buffer }

const DROP_REQ = new Set(["host", "connection", "accept-encoding", "content-length", "transfer-encoding", "proxy-authorization", "upgrade"]);
const DROP_RES = new Set(["content-encoding", "content-length", "transfer-encoding", "connection", "set-cookie", "keep-alive"]);

/**
 * One http(s) request made from Node for a page in the browser: the connection goes only to an address checked in its own
 * lookup, redirects are handed back (the browser asks again, and that request is checked again), and the body is capped.
 */
export function pinnedRequest(url: URL, opts: { method?: string; headers?: Record<string, string>; body?: Buffer; allowPrivate: boolean; resolve?: Resolve; maxBytes: number; timeoutMs: number }): Promise<PinnedResponse> {
  if (url.protocol !== "https:" && url.protocol !== "http:") return Promise.reject(new FetchRefused(`${url.protocol} is not fetched`));
  if (url.username || url.password) return Promise.reject(new FetchRefused("a link with a user name or password is not fetched"));
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (!opts.allowPrivate && (/^localhost$|\.localhost$/i.test(host) || (isIP(host) && isPrivateAddress(host)))) return Promise.reject(new FetchRefused(`${host} is a private address`));
  const headers: Record<string, string> = { "accept-encoding": "gzip, deflate, br" };
  for (const [k, v] of Object.entries(opts.headers ?? {})) if (!DROP_REQ.has(k.toLowerCase())) headers[k] = v;
  return new Promise((resolve, reject) => {
    const req = (url.protocol === "https:" ? httpsRequest : httpRequest)(url, {
      method: opts.method ?? "GET", headers, lookup: guardedLookup(opts.allowPrivate, opts.resolve), timeout: opts.timeoutMs,
    }, (res) => {
      const enc = String(res.headers["content-encoding"] ?? "").toLowerCase();
      const stream: Readable = enc === "gzip" ? res.pipe(createGunzip()) : enc === "deflate" ? res.pipe(createInflate()) : enc === "br" ? res.pipe(createBrotliDecompress()) : res;
      readStreamCapped(stream, opts.maxBytes).then((body) => resolve({ status: res.statusCode ?? 0, headers: flatHeaders(res.headers), body }), (e) => { res.destroy(); reject(e); });
    });
    req.on("timeout", () => req.destroy(new FetchRefused(`no answer in ${opts.timeoutMs / 1000} s`)));
    req.on("error", reject);
    req.end(opts.body);
  });
}

function flatHeaders(h: IncomingHttpHeaders): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(h)) if (v !== undefined && !DROP_RES.has(k)) out[k] = Array.isArray(v) ? v.join(", ") : v;
  return out;
}
