// @client
import { Dialog as SheetPrimitive } from "radix-ui";
import { X } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export const Sheet = SheetPrimitive.Root;
export const SheetTrigger = SheetPrimitive.Trigger;
export const SheetClose = SheetPrimitive.Close;

const sides = {
  right: "inset-y-0 end-0 h-full w-3/4 border-s sm:max-w-sm",
  left: "inset-y-0 start-0 h-full w-3/4 border-e sm:max-w-sm",
  bottom: "inset-x-0 bottom-0 max-h-[85vh] rounded-t-xl border-t",
  top: "inset-x-0 top-0 border-b",
};

export function SheetContent({ className, children, side = "right", ...props }: ComponentProps<typeof SheetPrimitive.Content> & { side?: keyof typeof sides }) {
  return (
    <SheetPrimitive.Portal>
      <SheetPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50" />
      <SheetPrimitive.Content data-slot="sheet-content" className={cn("fixed z-50 flex flex-col gap-4 overflow-y-auto bg-popover p-6 text-popover-foreground shadow-raised", sides[side], className)} {...props}>
        {children}
        <SheetPrimitive.Close className="absolute end-4 top-4 rounded-sm opacity-70 outline-none hover:opacity-100 focus-visible:ring-2 focus-visible:ring-ring"><X className="size-4" /><span className="sr-only">Close</span></SheetPrimitive.Close>
      </SheetPrimitive.Content>
    </SheetPrimitive.Portal>
  );
}
export function SheetTitle({ className, ...props }: ComponentProps<typeof SheetPrimitive.Title>) {
  return <SheetPrimitive.Title className={cn("font-heading text-lg font-semibold", className)} {...props} />;
}
export function SheetDescription({ className, ...props }: ComponentProps<typeof SheetPrimitive.Description>) {
  return <SheetPrimitive.Description className={cn("text-sm text-muted-foreground", className)} {...props} />;
}
