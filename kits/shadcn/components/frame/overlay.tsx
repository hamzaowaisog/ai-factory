// @client
// The layers a page opens over itself (src/contracts/artifacts.ts, MockOverlay): a dialog, a side panel, a bottom sheet,
// a yes-or-no question, a short menu or a small panel beside its button.
import type { ReactNode } from "react";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogAction, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { buttonVariants } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { ActionButton } from "@/components/blocks/action-button";
import { label, type ButtonLike } from "@/components/blocks/types";
import { useT } from "@/lib/i18n";

export interface OverlaySpec { kind: "modal" | "drawer" | "sheet" | "confirm" | "menu" | "popover"; trigger: string; title: string; text?: string; items?: string[]; actions?: ButtonLike[] }

export function Overlay({ spec, open, onClose, at, onAction, children }: {
  spec: OverlaySpec; open: boolean; onClose: () => void; at?: DOMRect; onAction: (label: string) => void; children?: ReactNode;
}) {
  const t = useT();
  const set = (o: boolean) => { if (!o) onClose(); };
  const act = (l: string) => { onAction(l); onClose(); };
  const actions = spec.actions ?? [];
  const buttons = actions.map((b, i) => <ActionButton key={label(b)} b={b} main={i === 0} onAction={act} />);
  const mark = `overlay:${spec.trigger}`;
  switch (spec.kind) {
    case "confirm":
      return (
        <AlertDialog open={open} onOpenChange={set}>
          <AlertDialogContent data-b={mark}>
            <AlertDialogTitle>{t(spec.title)}</AlertDialogTitle>
            {spec.text && <AlertDialogDescription>{t(spec.text)}</AlertDialogDescription>}
            {children}
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => actions[1] && onAction(label(actions[1]))}>{t(actions[1] ? label(actions[1]) : "Cancel")}</AlertDialogCancel>
              <AlertDialogAction className={typeof actions[0] !== "string" && actions[0]?.variant === "danger" ? buttonVariants({ variant: "destructive" }) : undefined} onClick={() => onAction(actions[0] ? label(actions[0]) : "OK")}>{t(actions[0] ? label(actions[0]) : "OK")}</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      );
    case "drawer": case "sheet":
      return (
        <Sheet open={open} onOpenChange={set}>
          <SheetContent side={spec.kind === "sheet" ? "bottom" : "right"} data-b={mark}>
            <SheetTitle>{t(spec.title)}</SheetTitle>
            {spec.text ? <SheetDescription>{t(spec.text)}</SheetDescription> : <SheetDescription className="sr-only">{t(spec.title)}</SheetDescription>}
            {children}
            {buttons.length > 0 && <div className="mt-auto flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">{buttons}</div>}
          </SheetContent>
        </Sheet>
      );
    case "menu": case "popover":
      return (
        <Popover open={open} onOpenChange={set}>
          <PopoverAnchor asChild><span className="fixed" style={{ left: at?.left ?? 0, top: at?.bottom ?? 0, width: at?.width ?? 0, height: 0 }} /></PopoverAnchor>
          <PopoverContent data-b={mark} align="end" className={spec.kind === "menu" ? "w-48 p-1" : undefined}>
            {spec.kind === "menu"
              ? <div role="menu">{(spec.items ?? []).map((it) => <button key={it} role="menuitem" type="button" className="flex w-full rounded-sm px-2 py-1.5 text-start text-sm hover:bg-muted" onClick={() => act(it)}>{t(it)}</button>)}</div>
              : <div className="grid gap-3"><p className="font-medium">{t(spec.title)}</p>{spec.text && <p className="text-sm text-muted-foreground">{t(spec.text)}</p>}{children}{buttons.length > 0 && <div className="flex justify-end gap-2">{buttons}</div>}</div>}
          </PopoverContent>
        </Popover>
      );
    default:
      return (
        <Dialog open={open} onOpenChange={set}>
          <DialogContent data-b={mark}>
            <DialogHeader><DialogTitle>{t(spec.title)}</DialogTitle>{spec.text ? <DialogDescription>{t(spec.text)}</DialogDescription> : <DialogDescription className="sr-only">{t(spec.title)}</DialogDescription>}</DialogHeader>
            {children}
            {buttons.length > 0 && <DialogFooter>{buttons}</DialogFooter>}
          </DialogContent>
        </Dialog>
      );
  }
}
