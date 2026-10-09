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
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Stitch download failed: ${res.status} ${url}`);
      return new Uint8Array(await res.arrayBuffer());
    },
    close: () => tools.close(),
  };
}

let factory: (() => StitchClient) | undefined;
/** Tests replace the client; undefined goes back to the SDK. */
export function setStitchFactory(f: (() => StitchClient) | undefined): void { factory = f; }

export function stitchClient(): StitchClient {
  if (factory) return factory();
  const key = secret("STITCH_API_KEY");
  if (!key) throw new Error("STITCH_API_KEY is missing from ~/.factory/.env; the stitch design engine needs it");
  return sdkClient(key);
}
