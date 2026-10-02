// @client
// A month with marked days, days that cannot be picked, and the picked day's time slots.
import { useState } from "react";
import { Calendar } from "@/components/ui/calendar";
import { Card } from "@/components/ui/card";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { BlockEvents, CalendarData } from "./types";

/** The month the design named ("March 2027"), or this month when it cannot be read. */
function monthOf(name: string): Date {
  const d = new Date(`1 ${name}`);
  return Number.isNaN(d.getTime()) ? new Date(new Date().getFullYear(), new Date().getMonth(), 1) : d;
}

export function CalendarBlock({ month, startsOn, picked, marks = [], off = [], times, taken = [], time, mark, onAction, className }: CalendarData & BlockEvents) {
  const t = useT();
  const first = monthOf(month);
  const on = (d: number) => new Date(first.getFullYear(), first.getMonth(), d);
  const [day, setDay] = useState<Date | undefined>(picked ? on(picked) : undefined);
  const [slot, setSlot] = useState(time);
  return (
    <Card data-b={mark} className={cn("flex flex-wrap gap-4 p-pad", className)}>
      <Calendar
        mode="single" selected={day} onSelect={setDay} defaultMonth={first} weekStartsOn={((startsOn + 1) % 7) as 0 | 1 | 2 | 3 | 4 | 5 | 6}
        disabled={off.map(on)}
        modifiers={{ ok: marks.filter((m) => m.tone === "ok").map((m) => on(m.day)), warn: marks.filter((m) => m.tone === "warn").map((m) => on(m.day)), bad: marks.filter((m) => m.tone === "bad").map((m) => on(m.day)), info: marks.filter((m) => !m.tone || m.tone === "info").map((m) => on(m.day)) }}
        modifiersClassNames={{ ok: "after:absolute after:bottom-1 after:left-1/2 after:size-1 after:-translate-x-1/2 after:rounded-full after:bg-success", warn: "after:absolute after:bottom-1 after:left-1/2 after:size-1 after:-translate-x-1/2 after:rounded-full after:bg-warning", bad: "after:absolute after:bottom-1 after:left-1/2 after:size-1 after:-translate-x-1/2 after:rounded-full after:bg-destructive", info: "after:absolute after:bottom-1 after:left-1/2 after:size-1 after:-translate-x-1/2 after:rounded-full after:bg-info" }}
      />
      {times && (
        <div className="grid min-w-40 flex-1 content-start gap-2">
          <p className="text-sm font-medium">{t("Times")}</p>
          <div className="grid grid-cols-2 gap-2">
            {times.map((s) => (
              <button key={s} type="button" disabled={taken.includes(s)} aria-pressed={slot === s} onClick={(e) => { setSlot(s); onAction?.(s, e.currentTarget); }}
                className="rounded-md border px-2 py-1.5 text-sm disabled:text-muted-foreground disabled:line-through aria-pressed:border-primary aria-pressed:bg-primary aria-pressed:text-primary-foreground">{s}</button>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}
