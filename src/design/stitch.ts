// Google Stitch through its SDK (@google/stitch-sdk): one small interface, so the design step can be tested with a fake.
// No MCP server is set up; the SDK talks to Stitch's hosted endpoint with STITCH_API_KEY.
// The SDK is loaded when a Stitch run first calls Stitch, never at start-up: other runs do not need the package.
import { secret } from "../config/env.js";
import type { StitchTheme } from "./stitch-taste.js";

export type StitchDevice = "MOBILE" | "DESKTOP" | "TABLET" | "AGNOSTIC";
export interface StitchClient {
  createProject(title: string): Promise<string>;
  /** Creates the project's design system and applies it (Stitch asks for update_design_system right after create_design_system). */
  createDesignSystem(projectId: string, name: string, theme: StitchTheme & { designMd: string; overridePrimaryColor?: string; overrideNeutralColor?: string }): Promise<void>;
  /** Stitch's default model: the service refused every documented model id (GEMINI_3_FLASH, GEMINI_3_PRO, GEMINI_3_1_PRO) on 9 Oct 2026. */
  generate(projectId: string, prompt: string, device: StitchDevice): Promise<{ screenId: string; htmlUrl: string; imageUrl: string }>;
  /** Edits one screen with a text prompt (Stitch edit_screens) and returns the changed screen. */
  edit(projectId: string, screenId: string, prompt: string, device: StitchDevice): Promise<{ screenId: string; htmlUrl: string; imageUrl: string }>;
  download(url: string): Promise<Uint8Array>;
  close(): Promise<void>;
}


/** How often, and how far apart, a drawn screen's files are asked for again before the call counts as failed. */
let fileTries = { tries: 4, waitMs: 5000 };
/** Tests shorten the wait; undefined goes back to four tries, five seconds apart (longer each time). */
export function setStitchFileTries(t: { tries: number; waitMs: number } | undefined): void { fileTries = t ?? { tries: 4, waitMs: 5000 }; }

/**
 * The page and picture of a screen Stitch just drew. Its answer usually carries both links; when it does not, the SDK asks
 * get_screen, which refuses a screen that is not stored yet ("Request contains an invalid argument", 12 Oct 2026). The drawing is
 * already paid for, so the links are asked for again after a short wait before the call fails.
 */
export async function files(screen: { id: string; getHtml(): Promise<string>; getImage(): Promise<string> }): Promise<{ screenId: string; htmlUrl: string; imageUrl: string }> {
  let last: unknown;
  for (let n = 1; n <= fileTries.tries; n++) {
    try {
      const htmlUrl = await screen.getHtml(), imageUrl = await screen.getImage();
      if (htmlUrl && imageUrl) return { screenId: screen.id, htmlUrl, imageUrl };
      last = new Error(`Stitch drew screen ${screen.id} but gave no ${htmlUrl ? "picture" : "page"} for it`);
    } catch (e) { last = e; }
    if (n < fileTries.tries) await new Promise((r) => setTimeout(r, fileTries.waitMs * n));
  }
  throw last;
}

interface StitchScreen { id?: string; name?: string; deviceType?: string; width?: number | string; height?: number | string; htmlCode?: { downloadUrl?: string }; screenshot?: { downloadUrl?: string } }
export interface StitchAnswer { outputComponents?: { design?: { screens?: StitchScreen[] } }[] }

/**
 * The page among what one drawing call gave back. Asked for a real photograph, Stitch makes the picture first and returns it as
 * a screen of its own, ahead of the page that uses it; that one has no page file and get_screen refuses it ("Request contains an
 * invalid argument", 12 Oct 2026). A drawn signature comes back the same way but with a page file of its own (a 500 x 200 SVG and
 * no device, 13 Oct 2026), so the first screen with a page is not always the page. The SDK takes whichever comes first, so the
 * answer is read here: of the screens that have a page, the one drawn for a device, the tallest when several are; else the first
 * screen.
 */
export function pageOf(raw: StitchAnswer): { id: string; htmlUrl: string; imageUrl: string } {
  const all = (raw?.outputComponents ?? []).flatMap((c) => c?.design?.screens ?? []);
  const device = (x: StitchScreen) => (x.deviceType && x.deviceType !== "DEVICE_TYPE_UNSPECIFIED" ? 1 : 0);
  const pages = all.filter((x) => x.htmlCode?.downloadUrl);
  // sort is stable: screens that tie keep the order Stitch gave them
  const s = [...pages].sort((a, b) => device(b) - device(a) || (Number(b.height) || 0) - (Number(a.height) || 0))[0] ?? all[0];
  const id = s?.id ?? s?.name?.split("/screens/")[1];
  if (!s || !id) throw new Error("Stitch answered without a screen");
  return { id, htmlUrl: s.htmlCode?.downloadUrl ?? "", imageUrl: s.screenshot?.downloadUrl ?? "" };
}

function drawn(tools: { callTool<T>(name: string, args: Record<string, unknown>): Promise<T> }, projectId: string, raw: StitchAnswer) {
  const page = pageOf(raw);
  const ask = () => tools.callTool<StitchScreen>("get_screen", { projectId, screenId: page.id, name: `projects/${projectId}/screens/${page.id}` });
  return {
    id: page.id,
    getHtml: async () => page.htmlUrl || ((await ask())?.htmlCode?.downloadUrl ?? ""),
    getImage: async () => page.imageUrl || ((await ask())?.screenshot?.downloadUrl ?? ""),
  };
}

function sdkClient(apiKey: string): StitchClient {
  let made: Promise<{ tools: { close(): Promise<void>; callTool<T>(name: string, args: Record<string, unknown>): Promise<T> }; stitch: import("@google/stitch-sdk").Stitch }> | undefined;
  const sdk = () => (made ??= import("@google/stitch-sdk").then(({ Stitch, StitchToolClient }) => {
    const tools = new StitchToolClient({ apiKey });
    return { tools, stitch: new Stitch(tools) };
  }));
  return {
    async createProject(title) { return (await (await sdk()).stitch.createProject(title)).id; },
    async createDesignSystem(projectId, name, theme) {
      const ds = await (await sdk()).stitch.project(projectId).createDesignSystem({ displayName: name, theme });
      await ds.update({ displayName: name, theme });
    },
    async generate(projectId, prompt, device) {
      const { tools } = await sdk();
      return files(drawn(tools, projectId, await tools.callTool<StitchAnswer>("generate_screen_from_text", { projectId, prompt, deviceType: device })));
    },
    async edit(projectId, screenId, prompt, device) {
      const { tools } = await sdk();
      return files(drawn(tools, projectId, await tools.callTool<StitchAnswer>("edit_screens", { projectId, selectedScreenIds: [screenId], prompt, deviceType: device })));
    },
    async download(url) {
      // the fetch itself is cut off at the time limit, not only abandoned
      const res = await fetch(url, { signal: AbortSignal.timeout(timeouts.downloadMs) });
      if (!res.ok) throw new Error(`Stitch download failed: ${res.status} ${url}`);
      if (Number(res.headers.get("content-length") ?? 0) > MAX_DOWNLOAD) throw new Error(`Stitch download too large: ${url}`);
      const body = new Uint8Array(await res.arrayBuffer());
      if (body.length > MAX_DOWNLOAD) throw new Error(`Stitch download too large: ${url}`);
      return body;
    },
    // nothing to close when no call loaded the SDK
    close: async () => { if (made) await (await made).tools.close(); },
  };
}

/** A Stitch page or picture is far smaller than this; anything bigger is not one. */
const MAX_DOWNLOAD = 25_000_000;
/**
 * How long one Stitch call and one download may take. A generation takes about 100 seconds; a call or download that never
 * answers would otherwise hold the run (and its lock) for good.
 */
export const STITCH_TIMEOUTS = { callMs: 300_000, downloadMs: 60_000 } as const;
let timeouts: { callMs: number; downloadMs: number } = { ...STITCH_TIMEOUTS };
/** Tests shorten the limits; undefined goes back to STITCH_TIMEOUTS. */
export function setStitchTimeouts(t: { callMs: number; downloadMs: number } | undefined): void { timeouts = { ...(t ?? STITCH_TIMEOUTS) }; }

function within<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`Stitch ${what} timed out after ${Math.round(ms / 1000)} s`)), ms); });
  return Promise.race([p, late]).finally(() => clearTimeout(timer));
}

/** Every call and download with its time limit, whichever client is behind it. */
function timed(c: StitchClient): StitchClient {
  return {
    createProject: (title) => within(c.createProject(title), timeouts.callMs, "create_project"),
    createDesignSystem: (p, name, theme) => within(c.createDesignSystem(p, name, theme), timeouts.callMs, "create_design_system"),
    generate: (p, prompt, device) => within(c.generate(p, prompt, device), timeouts.callMs, "generate_screen"),
    edit: (p, id, prompt, device) => within(c.edit(p, id, prompt, device), timeouts.callMs, "edit_screens"),
    download: (url) => within(c.download(url), timeouts.downloadMs, "download"),
    close: () => within(c.close(), timeouts.downloadMs, "close"),
  };
}

let factory: (() => StitchClient) | undefined;
/** Tests replace the client; undefined goes back to the SDK. */
export function setStitchFactory(f: (() => StitchClient) | undefined): void { factory = f; }

export function stitchClient(): StitchClient {
  if (factory) return timed(factory());
  const key = secret("STITCH_API_KEY");
  if (!key) throw new Error("STITCH_API_KEY is missing from ~/.factory/.env; the stitch design engine needs it");
  return timed(sdkClient(key));
}
