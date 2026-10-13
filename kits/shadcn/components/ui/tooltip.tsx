// @client
import { Tooltip as TooltipPrimitive } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export const TooltipProvider = TooltipPrimitive.Provider;
/** Its own provider, so a part that shows a tooltip renders anywhere: in the app frame, alone in a screen test, in a preview. */
export function Tooltip(props: ComponentProps<typeof TooltipPrimitive.Root>) {
  return <TooltipPrimitive.Provider><TooltipPrimitive.Root {...props} /></TooltipPrimitive.Provider>;
}
export const TooltipTrigger = TooltipPrimitive.Trigger;

export function TooltipContent({ className, sideOffset = 4, ...props }: ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content data-slot="tooltip-content" sideOffset={sideOffset} className={cn("z-50 max-w-xs rounded-md bg-foreground px-3 py-1.5 text-xs text-background", className)} {...props} />
    </TooltipPrimitive.Portal>
  );
}
