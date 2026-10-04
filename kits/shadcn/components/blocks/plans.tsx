// @client
import { Check } from "lucide-react";
import { useState } from "react";
import { StatusBadge as Badge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Segmented } from "@/components/ui/segmented";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { BlockEvents, PlansData } from "./types";

export function PlansBlock({ periods, note, items, mark, onAction, className }: PlansData & BlockEvents) {
  const t = useT();
  const [second, setSecond] = useState(false);
  return (
    <section data-b={mark} className={cn("grid gap-4", className)}>
      {periods && (
        <div className="flex items-center justify-center gap-2">
          <Segmented label={t("Billing period")} value={second ? periods[1] : periods[0]} items={periods.map((p) => ({ value: p, label: t(p) }))} onChange={(v) => setSecond(v === periods[1])} />
          {note && <Badge tone="ok">{t(note)}</Badge>}
        </div>
      )}
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-[repeat(auto-fit,minmax(14rem,1fr))]">
        {items.map((p) => (
          <Card key={p.name} className={cn("grid content-start gap-3 p-pad", p.featured && "border-primary ring-1 ring-primary")}>
            <div className="flex items-center justify-between"><p className="font-heading font-semibold">{t(p.name)}</p>{p.badge && <Badge tone="brand">{t(p.badge)}</Badge>}</div>
            <p><span className="font-heading text-3xl font-semibold">{second && p.alt ? p.alt : p.price}</span>{p.per && <span className="text-sm text-muted-foreground"> {t(p.per)}</span>}</p>
            {p.blurb && <p className="text-sm text-muted-foreground">{t(p.blurb)}</p>}
            <ul className="grid gap-1.5 text-sm">{p.features.map((f) => <li key={f} className="flex gap-2"><Check className="size-4 text-primary" />{t(f)}</li>)}</ul>
            <Button variant={p.featured ? "default" : "outline"} onClick={(e) => onAction?.(p.cta, e.currentTarget)}>{t(p.cta)}</Button>
          </Card>
        ))}
      </div>
    </section>
  );
}
