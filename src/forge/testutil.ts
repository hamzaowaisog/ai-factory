// Test helper: a GitHub on 127.0.0.1 for the repos the factory makes. The API answers /user, GET /repos/:owner/:name and
// POST /user/repos (a bare repo under `root`), and git itself goes over smart HTTP through `git http-backend` (the factory's hardened
// git refuses folder remotes). It checks the token the factory sends, so a test sees the token is used and never written down.
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface FakeGithub {
  url: string; login: string; token: string; root: string;
  /** the repos made through the API, as owner/name, and what each was asked for */
  made: string[];
  asked: { name: string; private?: boolean; description?: string }[];
  /** set to answer the next POST /user/repos with this status (403: the token may not create repos) */
  refuseCreate?: number;
  /** set to answer 403 whenever a repo of this name is asked for */
  refuseName?: string;
  /** a commit's sha on a branch of a repo here, or undefined */
  head(repo: string, branch?: string): string | undefined;
  close(): Promise<void>;
}

function gitBackend(root: string, path: string, req: IncomingMessage, res: ServerResponse): void {
  const u = new URL(req.url ?? "/", "http://x");
  const cgi = spawn("git", ["http-backend"], { env: { ...process.env, GIT_PROJECT_ROOT: root, GIT_HTTP_EXPORT_ALL: "1", PATH_INFO: path, QUERY_STRING: u.search.slice(1), REQUEST_METHOD: req.method ?? "GET", CONTENT_TYPE: req.headers["content-type"] ?? "", REMOTE_USER: "factory" } });
  req.pipe(cgi.stdin);
  const chunks: Buffer[] = [];
  cgi.stdout.on("data", (c: Buffer) => chunks.push(c));
  cgi.on("close", () => {
    const all = Buffer.concat(chunks);
    const split = all.indexOf("\r\n\r\n");
    const headers: Record<string, string> = {};
    let status = 200;
    for (const line of all.subarray(0, split).toString().split("\r\n")) {
      const [k, ...v] = line.split(": ");
      if (k!.toLowerCase() === "status") status = Number(v.join(": ").split(" ")[0]); else headers[k!] = v.join(": ");
    }
    res.writeHead(status, headers);
    res.end(all.subarray(split + 4));
  });
}

export async function fakeGithub(login = "acme", token = "github_pat_test0000000000000000"): Promise<FakeGithub> {
  const root = mkdtempSync(join(tmpdir(), "factory-fake-github-"));
  const bare = (repo: string) => join(root, `${repo}.git`);
  const gh: FakeGithub = {
    url: "", login, token, root, made: [], asked: [],
    head: (repo, branch = "main") => { try { return execFileSync("git", ["-C", bare(repo), "rev-parse", `refs/heads/${branch}`], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return undefined; } },
    close: () => new Promise((ok) => server.close(() => ok())),
  };
  const json = (res: ServerResponse, status: number, body: unknown) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };
  const server = createServer((req, res) => {
    const path = new URL(req.url ?? "/", "http://x").pathname;
    if (path.startsWith("/git/")) return gitBackend(root, path.slice("/git".length), req, res);
    if (req.headers.authorization !== `Bearer ${token}`) return json(res, 401, { message: "Bad credentials" });
    if (req.method === "GET" && path === "/user") return json(res, 200, { login, type: "User" });
    const one = /^\/repos\/([^/]+)\/([^/]+)$/.exec(path);
    if (req.method === "GET" && one) return existsSync(bare(`${one[1]}/${one[2]}`)) ? json(res, 200, { full_name: `${one[1]}/${one[2]}` }) : json(res, 404, { message: "Not Found" });
    if (req.method === "POST" && path === "/user/repos") {
      let body = "";
      req.on("data", (c: Buffer) => { body += c.toString(); });
      req.on("end", () => {
        if (gh.refuseCreate) { const status = gh.refuseCreate; gh.refuseCreate = undefined; return json(res, status, { message: "Resource not accessible by personal access token" }); }
        const ask = JSON.parse(body) as { name: string; private?: boolean; description?: string };
        const { name, private: priv } = ask;
        gh.asked.push(ask);
        if (name === gh.refuseName) return json(res, 403, { message: "Resource not accessible by personal access token" });
        const full = `${login}/${name}`;
        if (existsSync(bare(full))) return json(res, 422, { message: "name already exists on this account" });
        execFileSync("git", ["init", "-q", "--bare", "-b", "main", bare(full)]);
        execFileSync("git", ["-C", bare(full), "config", "http.receivepack", "true"]);
        gh.made.push(full);
        json(res, 201, { full_name: full, private: priv === true, html_url: `${gh.url}/${full}`, clone_url: `${gh.url}/git/${full}.git` });
      });
      return;
    }
    json(res, 404, { message: "Not Found" });
  });
  gh.url = await new Promise<string>((ok) => server.listen(0, "127.0.0.1", () => ok(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)));
  return gh;
}
