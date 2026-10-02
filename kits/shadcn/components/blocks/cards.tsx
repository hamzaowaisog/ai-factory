// @client
import { ImageIcon } from "lucide-react";
import { AvatarStack } from "@/components/ui/people";
import { StatusBadge as Badge, toneOf } from "@/components/ui/status-badge";
import { Card } from "@/components/ui/card";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { BlockEvents, CardsData } from "./types";

export function CardsBlock({ visual, items, mark, onAction, className }: CardsData & BlockEvents) {
  const t = useT();
  return (
    <section data-b={mark} className={cn("grid gap-3 sm:grid-cols-2 lg:grid-cols-3", className)}>
      {items.map((c) => (
        <Card key={c.title} role="button" tabIndex={0} className="cursor-pointer overflow-hidden transition-shadow hover:shadow-raised" onClick={(e) => onAction?.(c.title, e.currentTarget)} onKeyDown={(e) => e.key === "Enter" && onAction?.(c.title, e.currentTarget)}>
          {visual && <div className="flex aspect-video items-center justify-center bg-muted text-muted-foreground"><ImageIcon className="size-6" /></div>}
          <div className="grid gap-1 p-pad">
            <div className="flex items-start justify-between gap-2"><p className="font-medium">{t(c.title)}</p>{c.badge && <Badge tone={toneOf(c.badge)}>{t(c.badge)}</Badge>}</div>
            <p className="text-sm text-muted-foreground">{t(c.meta)}</p>
            {c.people && <AvatarStack people={c.people} className="mt-2" />}
          </div>
        </Card>
      ))}
    </section>
  );
}
