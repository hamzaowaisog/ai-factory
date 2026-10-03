// @client
import { Check } from "lucide-react";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { BlockEvents, StepsData } from "./types";

export function StepsBlock({ items, current = 0, mark, className }: StepsData & BlockEvents) {
  const t = useT();
  return (
    <ol data-b={mark} className={cn("flex flex-wrap items-center gap-2 text-sm", className)}>
      {items.map((s, i) => (
        <li key={s} aria-current={i === current ? "step" : undefined} className="flex items-center gap-2">
          <span className={cn("flex size-6 items-center justify-center rounded-full border text-xs", i < current && "border-primary bg-primary text-primary-foreground", i === current && "border-primary text-primary")}>{i < current ? <Check className="size-3.5" /> : i + 1}</span>
          <span className={cn(i === current ? "font-medium" : "text-muted-foreground")}>{t(s)}</span>
          {i < items.length - 1 && <span className="h-px w-6 bg-border" aria-hidden />}
        </li>
      ))}
    </ol>
  );
}
