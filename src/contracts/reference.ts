// A design reference the user attached (docs/estimates-design.md, "Design references"): any image, a
// website URL, a Word document, a PDF, a Figma link or export, turned into one form at intake by code.
import { z } from "zod";

/** How a reference shapes the design: its exact values, its colour family, or only the layout of its screens. */
export const RefRole = z.enum(["match", "inspire", "layout"]);
export type RefRole = z.infer<typeof RefRole>;

export const RefColour = z.object({
  hex: z.string().regex(/^#[0-9a-f]{6}$/),
  /** what the colour does, when code could tell (a site's computed styles); a picture's colours have none */
  role: z.enum(["brand", "theme", "header", "button", "page", "text", "link", "accent"]).optional(),
  /** share of the picture's area, 0-1 (pictures only) */
  share: z.number().min(0).max(1).optional(),
  /** read from CSS (exact) or sampled from pixels (approximate: near the real value, never equal to it) */
  exact: z.boolean(),
});
export type RefColour = z.infer<typeof RefColour>;

export const RefImage = z.object({
  /** ledger artifact holding the PNG (what a model is sent) */
  sha: z.string(),
  /** the same PNG beside the run, for the UI: refs/R-1-1.png */
  file: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  /** "image", "phone 390 px", "desktop 1280 px", "page 2", or the document's image name */
  label: z.string(),
});
export type RefImage = z.infer<typeof RefImage>;

export const Reference = z.object({
  id: z.string().regex(/^R-\d+$/),
  kind: z.enum(["image", "url", "docx", "figma", "pdf"]),
  /** the file name or the URL as given */
  source: z.string(),
  role: RefRole,
  /** the user chose the role; otherwise it is the default for the kind */
  roleGiven: z.boolean(),
  /** what the user said about it ("table like this"); their words, untrusted like any request text */
  note: z.string().max(500).optional(),
  images: z.array(RefImage),
  colours: z.array(RefColour),
  fonts: z.array(z.object({ family: z.string(), use: z.enum(["body", "heading"]) })).default([]),
  /** the main button's corner radius in px (sites) */
  radiusPx: z.number().optional(),
  /** cards or buttons carry a shadow (sites) */
  shadows: z.boolean().optional(),
  /** the text of a document reference, cut short; untrusted */
  text: z.string().optional(),
  /** colours read from CSS or a file's styles (exact), or from pixels (approximate) */
  measured: z.enum(["exact", "approximate"]),
  /** what intake left out, said plainly ("3 of 11 images kept") */
  notes: z.array(z.string()).default([]),
});
export type Reference = z.infer<typeof Reference>;

/** At most this many references on one run. */
export const MAX_REFERENCES = 12;
