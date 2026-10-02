// @client
import { Card } from "@/components/ui/card";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { BlockEvents, TimelineData } from "./types";

export function TimelineBlock({ items, mark, className }: TimelineData & BlockEvents) {
  const t = useT();
  return (
    <Card data-b={mark} className={cn("p-pad", className)}>
      <ol className="relative grid gap-4 border-s ps-5">
        {items.map((e) => (
          <li key={`${e.time}${e.title}`} className="relative">
            <span className={cn("absolute -start-[1.6rem] top-1 size-3 rounded-full border-2 border-card", e.status === "done" ? "bg-success" : e.status === "now" ? "bg-primary ring-4 ring-primary/20" : "bg-muted-foreground/40")} />
            <p className="text-xs text-muted-foreground">{t(e.time)}</p>
            <p className="font-medium">{t(e.title)}</p>
            {e.meta && <p className="text-sm text-muted-foreground">{t(e.meta)}</p>}
          </li>
        ))}
      </ol>
    </Card>
  );
}
