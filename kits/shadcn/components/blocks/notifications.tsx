// @client
import { Card } from "@/components/ui/card";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { BlockEvents, NotificationsData } from "./types";

const DOT: Record<string, string> = { ok: "bg-success", warn: "bg-warning", bad: "bg-destructive", info: "bg-info" };

export function NotificationsBlock({ items, mark, onAction, className }: NotificationsData & BlockEvents) {
  const t = useT();
  const groups = [...new Set(items.map((n) => n.group ?? ""))];
  return (
    <Card data-b={mark} className={cn("overflow-hidden", className)}>
      {groups.map((g) => (
        <section key={g}>
          {g && <h3 className="bg-muted/60 px-pad py-1.5 text-xs font-medium text-muted-foreground">{t(g)}</h3>}
          {items.filter((n) => (n.group ?? "") === g).map((n) => (
            <button key={`${n.title}${n.time}`} type="button" className={cn("flex w-full gap-3 border-b px-pad py-3 text-start last:border-0 hover:bg-muted/50", n.unread && "bg-primary/5")} onClick={(e) => onAction?.(n.title, e.currentTarget)}>
              <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", DOT[n.tone ?? "info"])} />
              <span className="min-w-0 flex-1"><span className={cn("block", n.unread && "font-medium")}>{t(n.title)}</span>{n.meta && <span className="block text-sm text-muted-foreground">{t(n.meta)}</span>}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{t(n.time)}</span>
            </button>
          ))}
        </section>
      ))}
    </Card>
  );
}
