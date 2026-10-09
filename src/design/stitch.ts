// Google Stitch through its SDK (@google/stitch-sdk): one small interface, so the design step can be tested with a fake.
// No MCP server is set up; the SDK talks to Stitch's hosted endpoint with STITCH_API_KEY.
import { Stitch, StitchToolClient } from "@google/stitch-sdk";
import { secret } from "../config/env.js";

export type StitchDevice = "MOBILE" | "DESKTOP" | "TABLET" | "AGNOSTIC";
export interface StitchClient {
  createProject(title: string): Promise<string>;
  createDesignSystem(projectId: string, name: string, styleGuidelines: string): Promise<void>;
  generate(projectId: string, prompt: string, device: StitchDevice, model: string): Promise<{ screenId: string; htmlUrl: string; imageUrl: string }>;
  download(url: string): Promise<Uint8Array>;
  close(): Promise<void>;
}

type StitchModel = Parameters<ReturnType<Stitch["project"]>["generate"]>[2];

function sdkClient(apiKey: string): StitchClient {
  const tools = new StitchToolClient({ apiKey });
  const stitch = new Stitch(tools);
  return {
    async createProject(title) { return (await stitch.createProject(title)).id; },
    async createDesignSystem(projectId, name, styleGuidelines) { await stitch.project(projectId).createDesignSystem({ displayName: name, styleGuidelines }); },
    async generate(projectId, prompt, device, model) {
      const screen = await stitch.project(projectId).generate(prompt, device, model as StitchModel);
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
