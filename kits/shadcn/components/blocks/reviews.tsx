// @client
import { Star } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { BlockEvents, ReviewsData } from "./types";

const Stars = ({ n }: { n: number }) => (
  <span className="flex" role="img" aria-label={`${n} / 5`}>{[1, 2, 3, 4, 5].map((i) => <Star key={i} className={cn("size-4", i <= Math.round(n) ? "fill-warning text-warning" : "text-muted-foreground/40")} />)}</span>
);

export function ReviewsBlock({ score, count, bars, items, mark, className }: ReviewsData & BlockEvents) {
  const t = useT();
  return (
    <Card data-b={mark} className={cn("grid gap-4 p-pad md:grid-cols-[14rem_1fr]", className)}>
      <div className="grid content-start gap-2">
        <p className="font-heading text-4xl font-semibold">{score.toFixed(1)}</p>
        <Stars n={score} />
        <p className="text-sm text-muted-foreground">{t(count)}</p>
        {bars && bars.map((b, i) => <div key={i} className="flex items-center gap-2 text-xs"><span className="w-3">{5 - i}</span><Progress value={b} aria-label={`${5 - i} / 5`} className="h-1.5" /></div>)}
      </div>
      <div className="grid gap-4">
        {items.map((r) => (
          <article key={`${r.name}${r.text.slice(0, 12)}`} className="grid gap-1">
            <div className="flex items-center gap-2"><p className="font-medium">{r.name}</p><Stars n={r.rating} />{r.time && <span className="text-xs text-muted-foreground">{t(r.time)}</span>}</div>
            {r.tag && <p className="text-xs text-muted-foreground">{t(r.tag)}</p>}
            <p className="text-sm">{t(r.text)}</p>
          </article>
        ))}
      </div>
    </Card>
  );
}
