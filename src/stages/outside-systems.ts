// Outside systems (email, SMS, payment, another company's API) in a build (core-design §16 D8). No step can reach one: the
// coding container sees only the model API, and the test lab has no network. So the plan gives each system one seam, the test
// writer puts a stand-in behind it (locked with the tests, like every file the test writer adds), and the code declares the
// settings the real system needs by name. The pull request lists those settings: nothing in a run proves the real connection.
import type { ProjectConfig } from "../config/project.js";

type Stack = ProjectConfig["stack"];

const SYSTEMS = "an email or SMS provider, a payment service, another company's API, a file store";

/** Where a stack declares the settings its code reads, with empty values (both pass the secret-file rule, gates/protected.ts). */
export const settingsFileFor = (stack: Stack): string => (stack === "node" ? ".env.example" : "appsettings.json");

export function outsideSystemsPlanRule(stack: Stack): string {
  const seam = stack === "node" ? "a module of its own (one exported function per call it makes)" : "an interface of its own, registered with the app's services";
  return `- Outside systems (${SYSTEMS}): the code reaches each one through one seam, ${seam}, and nothing else in the app calls the system directly. Use the seam the repo already has for that system; for a new one, give the seam as a stub, so the tests can put a stand-in behind it before the code exists. The system's settings (host, port, sender address, key) are read from configuration by name: put ${settingsFileFor(stack)} in the fileScope of the task that writes the seam's real implementation, and say in its approach that each new setting is declared there with an empty value.`;
}

export function outsideSystemsTestRule(stack: Stack): string {
  const how = stack === "node"
    ? "replace the system's module with vi.mock"
    : "write a fake implementation of the system's interface in the test project and register it in place of the real one (for an \"api\" criterion, through the web host's test services)";
  return `- Outside systems (${SYSTEMS}) are never called by a test: the test lab has no network. Put a stand-in behind the seam the code reaches the system through: ${how}. The stand-in records every call it gets; assert from that record what was sent (to whom, with which values, how many times), and make the stand-in fail where a criterion is about the system failing. Use a stand-in the tests already have for that system before you write one. A stand-in is test code: keep it with the tests, where it is locked with them.`;
}

export function outsideSystemsImplementRule(stack: Stack): string {
  return `- An outside system (${SYSTEMS}) is called only through its seam from the plan; the locked tests replace it with a stand-in, and nothing here can reach the real one, so don't try. Read its settings from configuration by name and declare each new one in ${settingsFileFor(stack)} with an empty value: never a real host, key or password. The app must still start while they are empty.`;
}

// ---------- the settings a change declares, read from its diff ----------
const APPSETTINGS = /(^|\/)appsettings\.json$/;
const ENV_EXAMPLE = /(^|\/)\.env(\.[\w-]+)?\.example$/;

export const isSettingsFile = (path: string): boolean => APPSETTINGS.test(path) || ENV_EXAMPLE.test(path);

/** The setting names a settings file declares: "Smtp:Host" for appsettings.json, "SMTP_HOST" for an env example. */
export function settingNames(path: string, text: string): string[] {
  if (ENV_EXAMPLE.test(path)) return [...new Set(text.split("\n").flatMap((l) => l.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/)?.[1] ?? []))];
  if (!APPSETTINGS.test(path)) return [];
  let doc: unknown;
  // a file with comments or a trailing comma is not read: the section is left out rather than guessed
  try { doc = JSON.parse(text.replace(/^﻿/, "")); } catch { return []; }
  const walk = (v: unknown, at: string): string[] => v && typeof v === "object" && !Array.isArray(v)
    ? Object.entries(v).flatMap(([k, x]) => walk(x, at ? `${at}:${k}` : k))
    : at ? [at] : [];
  return walk(doc, "");
}

export interface SettingsNeeded { file: string; names: string[] }

/** The settings a change adds: `before` is the file at the base of the change, empty for a new file. */
export function newSettings(file: string, before: string, after: string): SettingsNeeded | undefined {
  const had = new Set(settingNames(file, before));
  const names = settingNames(file, after).filter((n) => !had.has(n));
  return names.length ? { file, names } : undefined;
}

/** How the setting is given outside the file: .NET reads "Smtp:Host" from the environment as Smtp__Host. */
const asEnv = (file: string, name: string): string => (APPSETTINGS.test(file) ? name.replaceAll(":", "__") : name);

/** The pull request's section for them; nothing when the change declares no new setting. */
export function settingsSection(needed: SettingsNeeded[]): string[] {
  if (!needed.length) return [];
  const n = needed.reduce((sum, f) => sum + f.names.length, 0);
  return [
    `## Settings to fill in`,
    `This change declares ${n} new setting${n === 1 ? "" : "s"}. The factory's tests ran with no network, against stand-ins for any outside system, so ${n === 1 ? "it was" : "they were"} never given a real value and no real connection was tried. Check ${n === 1 ? "it" : "each one"} in the environment this is deployed to, and try the feature there once.`,
    ...needed.flatMap((f) => [`- \`${f.file}\``, ...f.names.map((name) => `  - \`${name}\`${asEnv(f.file, name) !== name ? ` (environment variable \`${asEnv(f.file, name)}\`)` : ""}`)]),
    ``,
  ];
}
