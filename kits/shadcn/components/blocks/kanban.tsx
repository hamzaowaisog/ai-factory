// @client
// Work moving through stages; cards are dragged between columns.
import { useState } from "react";
import { StatusBadge as Badge, toneOf } from "@/components/ui/status-badge";
import { Card } from "@/components/ui/card";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { BlockEvents, KanbanData } from "./types";

export function KanbanBlock({ columns, mark, onAction, className }: KanbanData & BlockEvents) {
  const t = useT();
  const [cols, setCols] = useState(columns);
  const [drag, setDrag] = useState<{ col: number; card: number } | null>(null);
  const drop = (to: number) => {
    if (!drag || drag.col === to) return;
    const next = cols.map((c) => ({ ...c, cards: [...c.cards] }));
    const [card] = next[drag.col]!.cards.splice(drag.card, 1);
    next[to]!.cards.push(card!);
    setCols(next);
    setDrag(null);
    onAction?.(`Move to ${next[to]!.title}`);
  };
  return (
    <section data-b={mark} className={cn("flex gap-3 overflow-x-auto pb-2", className)}>
      {cols.map((c, ci) => (
        <div key={c.title} className="grid w-64 shrink-0 content-start gap-2 rounded-lg bg-muted p-2" onDragOver={(e) => e.preventDefault()} onDrop={() => drop(ci)}>
          <p className="px-1 text-sm font-medium">{t(c.title)} <span className="text-muted-foreground">{c.cards.length}</span></p>
          {c.cards.map((k, ki) => (
            <Card key={k.title} draggable onDragStart={() => setDrag({ col: ci, card: ki })} className="cursor-grab p-3" onClick={(e) => onAction?.(k.title, e.currentTarget)}>
              <p className="text-sm font-medium">{t(k.title)}</p>
              {(k.meta || k.badge) && <div className="mt-1 flex items-center justify-between gap-2 text-xs text-muted-foreground">{k.meta && <span>{t(k.meta)}</span>}{k.badge && <Badge tone={toneOf(k.badge)}>{t(k.badge)}</Badge>}</div>}
            </Card>
          ))}
        </div>
      ))}
    </section>
  );
}
