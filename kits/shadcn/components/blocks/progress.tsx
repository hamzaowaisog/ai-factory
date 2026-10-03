// @client
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { BlockEvents, ProgressData } from "./types";

export function ProgressBlock({ title, items, mark, className }: ProgressData & BlockEvents) {
  const t = useT();
  return (
    <Card data-b={mark} className={cn("grid gap-3 p-pad", className)}>
      {title && <h3 className="font-heading font-semibold">{t(title)}</h3>}
      {items.map((p) => (
        <div key={p.label} className="grid gap-1.5">
          <div className="flex justify-between text-sm"><span>{t(p.label)}</span><span className="text-muted-foreground">{p.meta ? t(p.meta) : `${p.value}%`}</span></div>
          <Progress value={p.value} aria-label={t(p.label)} />
        </div>
      ))}
    </Card>
  );
}
