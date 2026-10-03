// @client
import type { CSSProperties } from "react";
import { Toaster as Sonner } from "sonner";

// sonner's own palette replaced by the design's: the layer colours, the border, the raised shadow and the corner
const LOOK = { "--normal-bg": "var(--popover)", "--normal-text": "var(--popover-foreground)", "--normal-border": "var(--border)", "--border-radius": "var(--radius)" } as CSSProperties;

/** Where the short messages after an action appear (one per app, in the frame). */
export function Toaster() {
  return (
    <Sonner position="bottom-right" closeButton style={LOOK} toastOptions={{ classNames: {
      toast: "font-body shadow-raised!", actionButton: "rounded-md! bg-primary! text-primary-foreground!", closeButton: "bg-popover! text-popover-foreground! border-border!",
      success: "[&_[data-icon]]:text-success", error: "[&_[data-icon]]:text-destructive", info: "[&_[data-icon]]:text-info",
    } }} />
  );
}
