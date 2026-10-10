// Google Stitch through its SDK (@google/stitch-sdk): one small interface, so the design step can be tested with a fake.
// No MCP server is set up; the SDK talks to Stitch's hosted endpoint with STITCH_API_KEY.
import { Stitch, StitchToolClient } from "@google/stitch-sdk";
import { secret } from "../config/env.js";
import type { StitchTheme } from "./stitch-taste.js";

export type StitchDevice = "MOBILE" | "DESKTOP" | "TABLET" | "AGNOSTIC";
export interface StitchClient {
  createProject(title: string): Promise<string>;
  /** Creates the project's design system and applies it (Stitch asks for update_design_system right after create_design_system). */
  createDesignSystem(projectId: string, name: string, theme: StitchTheme & { designMd: string }): Promise<void>;
  /** Stitch's default model: the service refused every documented model id (GEMINI_3_FLASH, GEMINI_3_PRO, GEMINI_3_1_PRO) on 9 Oct 2026. */
  generate(projectId: string, prompt: string, device: StitchDevice): Promise<{ screenId: string; htmlUrl: string; imageUrl: string }>;
  /** Edits one screen with a text prompt (Stitch edit_screens) and returns the changed screen. */
  edit(projectId: string, screenId: string, prompt: string, device: StitchDevice): Promise<{ screenId: string; htmlUrl: string; imageUrl: string }>;
  download(url: string): Promise<Uint8Array>;
  close(): Promise<void>;
}


function sdkClient(apiKey: string): StitchClient {
  const tools = new StitchToolClient({ apiKey });
  const stitch = new Stitch(tools);
  return {
    async createProject(title) { return (await stitch.createProject(title)).id; },
    async createDesignSystem(projectId, name, theme) {
      const ds = await stitch.project(projectId).createDesignSystem({ displayName: name, theme });
      await ds.update({ displayName: name, theme });
    },
    async generate(projectId, prompt, device) {
      const screen = await stitch.project(projectId).generate(prompt, device);
      return { screenId: screen.id, htmlUrl: await screen.getHtml(), imageUrl: await screen.getImage() };
    },
    async edit(projectId, screenId, prompt, device) {
      const screen = await stitch.project(projectId).screen(screenId).edit(prompt, device);
      return { screenId: screen.id, htmlUrl: await screen.getHtml(), imageUrl: await screen.getImage() };
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
    close: () => tools.close(),
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
