// A stack-agnostic read of a repository (docs/estimates-design.md, "Prerequisites" 1): files by language,
// dependency manifests and the frameworks they name, whether tests, CI and containers exist, and the
// change history. Universal signals only, no build, no network, no model. The estimate and its ground step
// use it in place of the .NET-shaped discover, which refuses other stacks.
import { readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { gitSync } from "../design/source.js";
import type { Snapshot } from "./snapshot.js";

export const LANGUAGES: Record<string, string> = {
  ".cs": "C#", ".ts": "TypeScript", ".tsx": "TypeScript", ".mts": "TypeScript", ".cts": "TypeScript", ".js": "JavaScript", ".jsx": "JavaScript", ".mjs": "JavaScript",
  ".py": "Python", ".java": "Java", ".kt": "Kotlin", ".kts": "Kotlin", ".go": "Go", ".rs": "Rust", ".rb": "Ruby", ".php": "PHP", ".swift": "Swift", ".m": "Objective-C",
  ".dart": "Dart", ".scala": "Scala", ".ex": "Elixir", ".exs": "Elixir", ".cpp": "C++", ".cc": "C++", ".c": "C", ".h": "C/C++", ".vue": "Vue", ".svelte": "Svelte", ".sql": "SQL",
  ".html": "HTML", ".css": "CSS", ".scss": "CSS", ".sh": "Shell",
};

/** Manifest file -> how to read its dependency names. */
const MANIFESTS: { re: RegExp; kind: string; deps: (text: string) => string[] }[] = [
  { re: /(^|\/)package\.json$/, kind: "npm", deps: (t) => { try { const j = JSON.parse(t) as Record<string, Record<string, string>>; return [...Object.keys(j.dependencies ?? {}), ...Object.keys(j.devDependencies ?? {})]; } catch { return []; } } },
  { re: /(^|\/)requirements[\w.-]*\.txt$/, kind: "pip", deps: (t) => t.split("\n").map((l) => /^([A-Za-z0-9_.-]+)/.exec(l.trim())?.[1]).filter((x): x is string => !!x) },
  { re: /(^|\/)pyproject\.toml$/, kind: "python", deps: (t) => [...t.matchAll(/^\s*"?([A-Za-z0-9_.-]+)"?\s*(?:[=<>~!]|$)/gm)].map((m) => m[1]!).filter((d) => d.length > 1) },
  { re: /(^|\/)pom\.xml$/, kind: "maven", deps: (t) => [...t.matchAll(/<artifactId>([^<]+)<\/artifactId>/g)].map((m) => m[1]!) },
  { re: /(^|\/)build\.gradle(\.kts)?$/, kind: "gradle", deps: (t) => [...t.matchAll(/["']([\w.-]+:[\w.-]+)(?::[^"']*)?["']/g)].map((m) => m[1]!) },
  { re: /(^|\/)go\.mod$/, kind: "go", deps: (t) => [...t.matchAll(/^\s*(?:require\s+)?([\w./-]+\.[\w./-]+)\s+v[\d.]/gm)].map((m) => m[1]!) },
  { re: /(^|\/)Cargo\.toml$/, kind: "cargo", deps: (t) => [...t.matchAll(/^([A-Za-z0-9_-]+)\s*=/gm)].map((m) => m[1]!) },
  { re: /\.csproj$/, kind: "nuget", deps: (t) => [...t.matchAll(/<PackageReference\s+Include="([^"]+)"/g)].map((m) => m[1]!) },
  { re: /(^|\/)Gemfile$/, kind: "bundler", deps: (t) => [...t.matchAll(/^\s*gem\s+["']([^"']+)["']/gm)].map((m) => m[1]!) },
  { re: /(^|\/)composer\.json$/, kind: "composer", deps: (t) => { try { return Object.keys((JSON.parse(t) as { require?: Record<string, string> }).require ?? {}); } catch { return []; } } },
  { re: /(^|\/)pubspec\.yaml$/, kind: "pub", deps: (t) => [...t.matchAll(/^ {2}([a-z_][a-z0-9_]*):/gm)].map((m) => m[1]!) },
  { re: /(^|\/)Podfile$/, kind: "cocoapods", deps: (t) => [...t.matchAll(/^\s*pod\s+['"]([^'"]+)['"]/gm)].map((m) => m[1]!) },
  { re: /(^|\/)Package\.swift$/, kind: "swiftpm", deps: (t) => [...t.matchAll(/\.package\(\s*url:\s*"[^"]*\/([^"/]+?)(?:\.git)?"/g)].map((m) => m[1]!) },
];

/** Dependency name (lowercase substring or exact) -> framework or capability it signals. */
const SIGNALS: [RegExp, string][] = [
  [/^(react|react-dom)$/, "React"], [/^next$/, "Next.js"], [/^vue$/, "Vue"], [/^@angular\/core$/, "Angular"], [/^svelte$/, "Svelte"],
  [/^express$/, "Express"], [/^@nestjs\/core$/, "NestJS"], [/^fastify$/, "Fastify"], [/^react-native$/, "React Native"], [/^expo$/, "Expo"],
  [/^django$/i, "Django"], [/^flask$/i, "Flask"], [/^fastapi$/i, "FastAPI"], [/^spring-boot/, "Spring Boot"], [/^rails$/, "Rails"], [/^laravel\/framework$/, "Laravel"],
  [/^flutter$/, "Flutter"], [/^Microsoft\.AspNetCore/, "ASP.NET Core"], [/^Microsoft\.EntityFrameworkCore/, "Entity Framework"], [/^gin-gonic\/gin$|gin-gonic\/gin/, "Gin"],
  [/^(pg|postgres|psycopg2?|npgsql|org\.postgresql:postgresql)$|^Npgsql/i, "PostgreSQL"], [/^(mongoose|mongodb|pymongo)$/i, "MongoDB"], [/^(mysql2?|mysqlclient)$/i, "MySQL"],
  [/^(prisma|@prisma\/client|typeorm|sequelize|sqlalchemy|hibernate)/i, "an ORM"], [/^(stripe|@stripe\/)/i, "Stripe"], [/^(socket\.io|ws)$/, "realtime (sockets)"],
  [/^(firebase|firebase-admin)$/, "Firebase"], [/^(aws-sdk|@aws-sdk\/)/, "AWS SDK"], [/^(jest|vitest|mocha|pytest|xunit|nunit|junit|rspec|phpunit)/i, "a test framework"],
];

const TEST_PATH = /(^|\/)(tests?|__tests__|spec|specs|e2e|cypress|playwright)\/|(\.|_)(test|spec)\.[a-z]+$|Tests?\.(cs|java|kt|swift)$|(^|\/)test_[^/]+\.py$|_test\.go$/i;
const CI_PATH = /^(\.github\/workflows\/|\.gitlab-ci\.yml$|azure-pipelines\.yml$|\.circleci\/|Jenkinsfile$|bitbucket-pipelines\.yml$|\.travis\.yml$)/;
const CONTAINER_PATH = /(^|\/)(Dockerfile[\w.-]*|docker-compose[\w.-]*\.ya?ml|compose\.ya?ml)$/;
const INFRA_PATH = /\.(tf|bicep)$|(^|\/)(k8s|kubernetes|helm|charts)\//;
const MIGRATION_PATH = /(^|\/)(migrations?|db\/migrate|alembic)\//i;
const DOC_PATH = /(^|\/)(README[\w.]*|docs?\/.+\.md|CONTRIBUTING\.md|ARCHITECTURE\.md)$/i;

export interface RepoSurvey {
  files: number;
  lines: number;
  languages: { name: string; files: number; lines: number; share: number }[];
  manifests: { path: string; kind: string; deps: number }[];
  /** frameworks and capabilities named by dependencies */
  signals: string[];
  tests: { files: number; ratio: number; present: boolean };
  ci: string[];
  containers: string[];
  infra: boolean;
  migrations: number;
  docs: string[];
  /** top-level folders with file counts */
  areas: { path: string; files: number }[];
  history?: { commits: number; authors: number; first: string; last: string; hotFiles: { path: string; changes: number }[] };
}

/** Lines in a file, cheaply; binary and huge files count as 0. */
function lineCount(root: string, rel: string): number {
  try {
    const buf = readFileSync(join(root, rel));
    if (buf.length > 2_000_000 || buf.includes(0)) return 0;
    let n = 1;
    for (const b of buf) if (b === 10) n++;
    return buf.length ? n : 0;
  } catch { return 0; }
}

export function surveyFiles(snap: Pick<Snapshot, "root" | "files">): Omit<RepoSurvey, "history"> {
  const byLang = new Map<string, { files: number; lines: number }>();
  let lines = 0;
  const srcFiles: string[] = [];
  for (const f of snap.files) {
    const lang = LANGUAGES[extname(f).toLowerCase()];
    if (!lang || lang === "HTML" || lang === "CSS") continue;
    const n = lineCount(snap.root, f);
    const cur = byLang.get(lang) ?? { files: 0, lines: 0 };
    byLang.set(lang, { files: cur.files + 1, lines: cur.lines + n });
    lines += n;
    srcFiles.push(f);
  }
  const manifests: RepoSurvey["manifests"] = [];
  const signals = new Set<string>();
  for (const f of snap.files) {
    const m = MANIFESTS.find((x) => x.re.test(f));
    if (!m || /(^|\/)(node_modules|vendor)\//.test(f)) continue;
    let text = "";
    try { text = readFileSync(join(snap.root, f), "utf8"); } catch { continue; }
    const deps = m.deps(text);
    manifests.push({ path: f, kind: m.kind, deps: deps.length });
    for (const d of deps) for (const [re, name] of SIGNALS) if (re.test(d)) signals.add(name);
  }
  const tests = snap.files.filter((f) => TEST_PATH.test(f) && LANGUAGES[extname(f).toLowerCase()]);
  const areas = new Map<string, number>();
  for (const f of snap.files) { const top = f.includes("/") ? f.split("/")[0]! : "(root)"; areas.set(top, (areas.get(top) ?? 0) + 1); }
  return {
    files: snap.files.length, lines,
    languages: [...byLang].map(([name, v]) => ({ name, ...v, share: lines ? Math.round((v.lines / lines) * 1000) / 1000 : 0 })).sort((a, b) => b.lines - a.lines),
    manifests, signals: [...signals].sort(),
    tests: { files: tests.length, ratio: srcFiles.length ? Math.round((tests.length / srcFiles.length) * 100) / 100 : 0, present: tests.length > 0 },
    ci: snap.files.filter((f) => CI_PATH.test(f)), containers: snap.files.filter((f) => CONTAINER_PATH.test(f)),
    infra: snap.files.some((f) => INFRA_PATH.test(f)), migrations: snap.files.filter((f) => MIGRATION_PATH.test(f)).length,
    docs: snap.files.filter((f) => DOC_PATH.test(f)).slice(0, 12),
    areas: [...areas].map(([path, files]) => ({ path, files })).sort((a, b) => b.files - a.files).slice(0, 15),
  };
}

/** Change history up to `commit`: how active, how many people, and which files change most. */
export function surveyHistory(repo: string, commit: string, maxCommits = 2000): RepoSurvey["history"] | undefined {
  try {
    const log = gitSync(repo, ["log", `-n${maxCommits}`, "--format=%an|%aI", commit]).trim().split("\n").filter(Boolean);
    if (!log.length) return undefined;
    const dates = log.map((l) => l.split("|")[1]!).sort();
    const names = gitSync(repo, ["log", "-n500", "--name-only", "--format=", commit]).split("\n").filter(Boolean);
    const count = new Map<string, number>();
    for (const n of names) count.set(n, (count.get(n) ?? 0) + 1);
    return {
      commits: log.length, authors: new Set(log.map((l) => l.split("|")[0])).size, first: dates[0]!.slice(0, 10), last: dates[dates.length - 1]!.slice(0, 10),
      hotFiles: [...count].map(([path, changes]) => ({ path, changes })).sort((a, b) => b.changes - a.changes || a.path.localeCompare(b.path)).slice(0, 10),
    };
  } catch { return undefined; }
}

export function surveyRepo(snap: Snapshot, repo?: string): RepoSurvey {
  const s = surveyFiles(snap);
  const history = repo ? surveyHistory(repo, snap.commit) : undefined;
  return { ...s, ...(history ? { history } : {}) };
}

/** Plain text for a prompt or a card. */
export function surveyText(s: RepoSurvey): string {
  const lines = [
    `${s.files} files, ${s.lines} lines of code. Languages: ${s.languages.slice(0, 6).map((l) => `${l.name} ${Math.round(l.share * 100)}%`).join(", ") || "none detected"}.`,
    `Manifests: ${s.manifests.map((m) => `${m.path} (${m.kind}, ${m.deps} deps)`).slice(0, 8).join("; ") || "none"}.`,
    `Frameworks and capabilities seen in dependencies: ${s.signals.join(", ") || "none recognised"}.`,
    `Tests: ${s.tests.present ? `${s.tests.files} test files (${s.tests.ratio} per source file)` : "none found"}. CI: ${s.ci.length ? s.ci.join(", ") : "none"}. Containers: ${s.containers.length ? s.containers.join(", ") : "none"}. Infrastructure as code: ${s.infra ? "yes" : "no"}. Migrations: ${s.migrations}.`,
    `Areas: ${s.areas.map((a) => `${a.path} (${a.files})`).join(", ")}.`,
  ];
  if (s.history) lines.push(`History: ${s.history.commits} commits by ${s.history.authors} people, ${s.history.first} to ${s.history.last}. Most-changed files: ${s.history.hotFiles.slice(0, 5).map((h) => `${h.path} (${h.changes})`).join(", ")}.`);
  return lines.join("\n");
}
