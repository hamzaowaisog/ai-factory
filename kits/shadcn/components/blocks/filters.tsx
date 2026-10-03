// @client
import { Search } from "lucide-react";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { BlockEvents, FiltersData } from "./types";

export function FiltersBlock({ search, chips = [], segments, mark, onAction, className }: FiltersData & BlockEvents) {
  const t = useT();
  const [on, setOn] = useState<string[]>([]);
  return (
    <section data-b={mark} className={cn("flex flex-wrap items-center gap-2", className)}>
      {search !== undefined && (
        <div className="relative w-full sm:w-64">
          <Search className="absolute start-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input type="search" placeholder={t(search)} aria-label={t(search)} className="ps-8" />
        </div>
      )}
      {chips.map((c) => (
        <button key={c} type="button" aria-pressed={on.includes(c)} onClick={() => { setOn(on.includes(c) ? on.filter((x) => x !== c) : [...on, c]); onAction?.(c); }}
          className="rounded-full border px-3 py-1 text-xs aria-pressed:border-primary aria-pressed:bg-primary/10 aria-pressed:text-brand-text">{t(c)}</button>
      ))}
      {segments && (
        <Segmented className="ms-auto" label={t("View")} items={segments.map((s) => ({ value: s, label: t(s) }))} onChange={(v) => onAction?.(v)} />
      )}
    </section>
  );
}
