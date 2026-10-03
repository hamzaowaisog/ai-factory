// @client
import { Card } from "@/components/ui/card";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { BlockEvents, StatsData } from "./types";

export function StatsBlock({ items, mark, className }: StatsData & BlockEvents) {
  const t = useT();
  return (
    <section data-b={mark} className={cn("grid grid-cols-2 gap-3 lg:grid-cols-4", className)}>
      {items.map((s) => (
        <Card key={s.label} className="p-pad">
          <p className="text-xs text-muted-foreground">{t(s.label)}</p>
          <p className="mt-1 font-heading text-2xl font-semibold tabular-nums">{s.value}</p>
          {s.delta && <p className={cn("mt-1 text-xs", s.delta.trim().startsWith("-") ? "text-destructive" : "text-success")}>{t(s.delta)}</p>}
        </Card>
      ))}
    </section>
  );
}
