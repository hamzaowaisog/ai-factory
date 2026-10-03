import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { gzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FetchRefused, isPrivateAddress, pinnedRequest, readResponseCapped } from "./safe-fetch.js";

describe("isPrivateAddress (PR #11 review, item 17)", () => {
  it("refuses IPv4 inside IPv6 in every spelling, and the usual private ranges", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "169.254.169.254", "192.168.0.1", "172.16.0.1", "100.64.0.1", "0.0.0.0", "::", "::1", "[::1]",
      "::ffff:127.0.0.1", "::ffff:7f00:1", "[::ffff:7f00:1]", "::ffff:a9fe:a9fe", "0:0:0:0:0:ffff:7f00:0001", "::127.0.0.1", "::7f00:1",
      "64:ff9b::7f00:1", "64:ff9b::10.0.0.1", "2002:7f00:1::", "fc00::1", "fd12::1", "fe80::1", "fe80::1%en0", "fec0::1", "ff02::1"]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
    expect(isPrivateAddress(new URL("https://[::ffff:127.0.0.1]/").hostname)).toBe(true);
  });
  it("lets public addresses through", () => {
    for (const ip of ["93.184.216.34", "8.8.8.8", "::ffff:8.8.8.8", "::ffff:808:808", "2606:4700::1111", "64:ff9b::808:808", "2002:808:808::"]) {
      expect(isPrivateAddress(ip), ip).toBe(false);
    }
  });
});

describe("pinnedRequest", () => {
  let server: Server;
  let port = 0;
  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.url === "/big") { res.writeHead(200); res.end(Buffer.alloc(2_000)); return; }
      if (req.url === "/gz") { res.writeHead(200, { "content-encoding": "gzip", "content-type": "text/plain" }); res.end(gzipSync("hello")); return; }
      if (req.url === "/go") { res.writeHead(302, { location: "http://127.0.0.1/" }); res.end(); return; }
      res.writeHead(200, { "content-type": "text/html", "set-cookie": "a=b" }); res.end(`ok ${req.headers.host}`);
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));
  const opts = { maxBytes: 1_000, timeoutMs: 5_000 };

  it("refuses a name whose lookup answers with a private address (the lookup the connection uses)", async () => {
    await expect(pinnedRequest(new URL(`http://rebind.example:${port}/`), { ...opts, allowPrivate: false, resolve: async () => ["127.0.0.1"] })).rejects.toBeInstanceOf(FetchRefused);
    await expect(pinnedRequest(new URL(`http://mixed.example:${port}/`), { ...opts, allowPrivate: false, resolve: async () => ["8.8.8.8", "::ffff:7f00:1"] })).rejects.toBeInstanceOf(FetchRefused);
    await expect(pinnedRequest(new URL(`http://[::ffff:7f00:1]:${port}/`), { ...opts, allowPrivate: false })).rejects.toBeInstanceOf(FetchRefused);
    await expect(pinnedRequest(new URL(`http://localhost:${port}/`), { ...opts, allowPrivate: false })).rejects.toBeInstanceOf(FetchRefused);
  });
  it("connects to the checked address when private addresses are allowed, keeps the host name, and drops cookies", async () => {
    const r = await pinnedRequest(new URL(`http://site.example:${port}/`), { ...opts, allowPrivate: true, resolve: async () => ["127.0.0.1"] });
    expect(r.status).toBe(200);
    expect(r.body.toString()).toBe(`ok site.example:${port}`);
    expect(r.headers["set-cookie"]).toBeUndefined();
  });
  it("decompresses, hands redirects back unfollowed, and caps the body", async () => {
    const base = { ...opts, allowPrivate: true, resolve: async () => ["127.0.0.1"] };
    const gz = await pinnedRequest(new URL(`http://s.example:${port}/gz`), base);
    expect(gz.body.toString()).toBe("hello");
    expect(gz.headers["content-encoding"]).toBeUndefined();
    const go = await pinnedRequest(new URL(`http://s.example:${port}/go`), base);
    expect(go.status).toBe(302);
    expect(go.headers.location).toBe("http://127.0.0.1/");
    await expect(pinnedRequest(new URL(`http://s.example:${port}/big`), base)).rejects.toThrow(/over/);
  });
});

describe("readResponseCapped", () => {
  it("refuses a body over the cap, by declared length or by the bytes that arrive", async () => {
    await expect(readResponseCapped(new Response("x".repeat(10), { headers: { "content-length": "999999" } }), 100)).rejects.toThrow(/over/);
    await expect(readResponseCapped(new Response("x".repeat(200)), 100)).rejects.toThrow(/over/);
    expect((await readResponseCapped(new Response("abc"), 100)).toString()).toBe("abc");
  });
});
