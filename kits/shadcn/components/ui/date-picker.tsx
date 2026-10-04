// @client
// A date (or a start and an end) picked from a calendar; the field shows it as text.
import { CalendarDays } from "lucide-react";
import { useState } from "react";
import type { DateRange } from "react-day-picker";
import { Calendar } from "./calendar";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";

const fmt = (d?: Date) => (d ? d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "");
const parse = (s?: string) => { const d = s ? new Date(s) : undefined; return d && !Number.isNaN(d.getTime()) ? d : undefined; };

export function DatePicker({ value, placeholder, range = false, disabled, id }: { value?: string; placeholder?: string; range?: boolean; disabled?: boolean; id?: string }) {
  const [from, to] = (value ?? "").split(/\s+-\s+/);
  const [day, setDay] = useState<Date | undefined>(parse(from));
  const [span, setSpan] = useState<DateRange | undefined>(range ? { from: parse(from), to: parse(to) } : undefined);
  const text = range ? [fmt(span?.from), fmt(span?.to)].filter(Boolean).join(" - ") : fmt(day);
  return (
    <Popover>
      <PopoverTrigger asChild disabled={disabled}>
        <button id={id} type="button" className="flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-card px-3 text-sm shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50">
          <span className={text ? "" : "text-muted-foreground"}>{text || placeholder || "Pick a date"}</span>
          <CalendarDays className="size-4 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        {range
          ? <Calendar mode="range" selected={span} onSelect={setSpan} defaultMonth={span?.from} />
          : <Calendar mode="single" selected={day} onSelect={setDay} defaultMonth={day} />}
      </PopoverContent>
    </Popover>
  );
}
