// @client
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useRef } from "react";
import { StatusBadge as Badge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { BlockEvents, CarouselData } from "./types";

export function CarouselBlock({ style = "media", title, items, mark, onAction, className }: CarouselData & BlockEvents) {
  const t = useT();
  const strip = useRef<HTMLDivElement>(null);
  const move = (dir: number) => strip.current?.scrollBy({ left: dir * strip.current.clientWidth * 0.8, behavior: "smooth" });
  return (
    <section data-b={mark} aria-roledescription="carousel" className={cn("grid gap-2", className)}>
      <div className="flex items-center justify-between">
        {title && <h3 className="font-heading font-semibold">{t(title)}</h3>}
        <span className="ms-auto flex gap-1">
          <Button variant="ghost" size="icon" aria-label={t("Previous")} onClick={() => move(-1)}><ChevronLeft className="rtl:rotate-180" /></Button>
          <Button variant="ghost" size="icon" aria-label={t("Next")} onClick={() => move(1)}><ChevronRight className="rtl:rotate-180" /></Button>
        </span>
      </div>
      <div ref={strip} className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2">
        {items.map((s) => (
          <article key={s.title} aria-roledescription="slide" className={cn("shrink-0 snap-start rounded-lg p-pad", style === "promo" ? "w-[85%] bg-primary text-primary-foreground sm:w-[60%]" : "w-48 border bg-card")}>
            {s.badge && <Badge tone="brand" className={style === "promo" ? "bg-white/20 text-current" : undefined}>{t(s.badge)}</Badge>}
            <p className="mt-2 font-medium">{t(s.title)}</p>
            <p className={cn("text-sm", style === "promo" ? "opacity-80" : "text-muted-foreground")}>{t(s.meta)}</p>
            {s.cta && <Button size="sm" variant={style === "promo" ? "outline" : "default"} className="mt-3" onClick={(e) => onAction?.(s.cta!, e.currentTarget)}>{t(s.cta)}</Button>}
          </article>
        ))}
      </div>
    </section>
  );
}
