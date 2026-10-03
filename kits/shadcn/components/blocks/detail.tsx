// @client
import { AvatarStack } from "@/components/ui/people";
import { StatusBadge as Badge, toneOf } from "@/components/ui/status-badge";
import { Card } from "@/components/ui/card";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { BlockEvents, DetailData } from "./types";

export function DetailBlock({ style = "card", title, lead, rows, people, mark, className }: DetailData & BlockEvents) {
  const t = useT();
  return (
    <Card data-b={mark} className={cn("p-pad", style === "pass" && "border-dashed", className)}>
      {title && <h3 className="mb-3 font-heading font-semibold">{t(title)}</h3>}
      {lead && <div className="mb-3"><p className="text-xs text-muted-foreground">{t(lead.label)}</p><p className="font-heading text-2xl font-semibold">{t(lead.value)}</p></div>}
      <dl className={cn("grid gap-x-4 gap-y-2 text-sm", style === "pass" ? "grid-cols-2" : "grid-cols-[auto_1fr]")}>
        {rows.map((r) => (
          <div key={r.label} className={style === "pass" ? "" : "contents"}>
            <dt className="text-muted-foreground">{t(r.label)}</dt>
            <dd className={style === "pass" ? "font-medium" : "text-end"}>{r.badge ? <Badge tone={toneOf(r.value)}>{t(r.value)}</Badge> : t(r.value)}</dd>
          </div>
        ))}
      </dl>
      {people && <AvatarStack people={people} className="mt-3" />}
    </Card>
  );
}
