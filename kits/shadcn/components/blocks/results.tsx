// @client
// Search results with filters beside them; on a phone the filters open in a sheet.
import { ImageIcon, SlidersHorizontal } from "lucide-react";
import { StatusBadge as Badge, toneOf } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Slider } from "@/components/ui/slider";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { BlockEvents, ResultsData } from "./types";

export function ResultsBlock({ query, count, sort, visual, facets, items, mark, onAction, className }: ResultsData & BlockEvents) {
  const t = useT();
  const filters = (
    <div className="grid content-start gap-4">
      {facets.map((f) => (
        <fieldset key={f.title} className="grid gap-2">
          <legend className="mb-1 text-sm font-medium">{t(f.title)}</legend>
          {f.kind === "range"
            ? <><Slider defaultValue={[0, 100]} aria-label={t(f.title)} /><div className="flex justify-between text-xs text-muted-foreground"><span>{t(f.options[0]!)}</span><span>{t(f.options[f.options.length - 1]!)}</span></div></>
            : f.options.map((o) => <Label key={o} className="font-normal"><Checkbox defaultChecked={(f.picked ?? []).includes(o)} />{t(o)}</Label>)}
        </fieldset>
      ))}
    </div>
  );
  return (
    <section data-b={mark} className={cn("grid gap-4 md:grid-cols-[14rem_1fr]", className)}>
      <aside className="hidden md:block">{filters}</aside>
      <div className="grid content-start gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm text-muted-foreground">{query && <span className="font-medium text-foreground">“{query}” · </span>}{t(count)}</p>
          <Sheet>
            <SheetTrigger asChild><Button variant="outline" size="sm" className="md:hidden"><SlidersHorizontal />{t("Filters")}</Button></SheetTrigger>
            <SheetContent side="left"><SheetTitle>{t("Filters")}</SheetTitle>{filters}</SheetContent>
          </Sheet>
          {sort && (
            <Select defaultValue={sort[0]} onValueChange={(v) => onAction?.(v)}>
              <SelectTrigger className="ms-auto w-44" aria-label={t("Sort")}><SelectValue /></SelectTrigger>
              <SelectContent>{sort.map((s) => <SelectItem key={s} value={s}>{t(s)}</SelectItem>)}</SelectContent>
            </Select>
          )}
        </div>
        <div className={cn("grid gap-3", visual ? "grid-cols-2 lg:grid-cols-3" : "")}>
          {items.map((r) => (
            <Card key={r.title} role="button" tabIndex={0} className="cursor-pointer overflow-hidden hover:shadow-raised" onClick={(e) => onAction?.(r.title, e.currentTarget)}>
              {visual && <div className="flex aspect-[4/3] items-center justify-center bg-muted text-muted-foreground"><ImageIcon className="size-6" /></div>}
              <div className="grid gap-1 p-pad">
                <div className="flex items-start justify-between gap-2"><p className="font-medium">{t(r.title)}</p>{r.badge && <Badge tone={toneOf(r.badge)}>{t(r.badge)}</Badge>}</div>
                <p className="text-sm text-muted-foreground">{t(r.meta)}</p>
                {r.price && <p className="font-semibold">{r.price}</p>}
              </div>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}
