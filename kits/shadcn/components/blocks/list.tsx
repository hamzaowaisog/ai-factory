// @client
import { ChevronRight } from "lucide-react";
import { AvatarStack } from "@/components/ui/people";
import { StatusBadge as Badge, toneOf } from "@/components/ui/status-badge";
import { Card } from "@/components/ui/card";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { BlockEvents, ListData } from "./types";

export function ListBlock({ items, mark, onAction, className }: ListData & BlockEvents) {
  const t = useT();
  return (
    <Card data-b={mark} className={cn("divide-y overflow-hidden", className)}>
      {items.map((it) => (
        <button key={it.title} type="button" className="flex w-full items-center gap-3 px-pad py-3 text-start hover:bg-muted/50" onClick={(e) => onAction?.(it.title, e.currentTarget)}>
          <span className="min-w-0 flex-1"><span className="block truncate font-medium">{t(it.title)}</span><span className="block truncate text-sm text-muted-foreground">{t(it.meta)}</span></span>
          {it.people && <AvatarStack people={it.people} />}
          {it.badge && <Badge tone={toneOf(it.badge)}>{t(it.badge)}</Badge>}
          <ChevronRight className="size-4 text-muted-foreground rtl:rotate-180" />
        </button>
      ))}
    </Card>
  );
}
