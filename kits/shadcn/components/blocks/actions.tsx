// @client
import { cn } from "@/lib/utils";
import { ActionButton } from "./action-button";
import type { ActionsData, BlockEvents } from "./types";
import { label } from "./types";

export function ActionsBlock({ buttons, mark, onAction, className }: ActionsData & BlockEvents) {
  return (
    <section data-b={mark} className={cn("flex flex-wrap justify-end gap-2", className)}>
      {buttons.map((b, i) => <ActionButton key={label(b)} b={b} main={i === 0} onAction={onAction} />)}
    </section>
  );
}
