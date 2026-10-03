// @client
// Type to filter a long list: one picked (combobox, search) or several shown as chips (multiselect).
import { Check, ChevronDown, X } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "./command";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";

export function Combobox({ options, value, onChange, placeholder, multiple = false, disabled, id }: {
  options: string[]; value: string[]; onChange?: (v: string[]) => void; placeholder?: string; multiple?: boolean; disabled?: boolean; id?: string;
}) {
  const [open, setOpen] = useState(false);
  const pick = (o: string) => {
    if (!multiple) { onChange?.([o]); setOpen(false); return; }
    onChange?.(value.includes(o) ? value.filter((x) => x !== o) : [...value, o]);
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild disabled={disabled}>
        <button id={id} type="button" role="combobox" aria-expanded={open} className="flex min-h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-card px-3 py-1.5 text-sm shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50">
          <span className="flex flex-wrap gap-1">
            {!value.length && <span className="text-muted-foreground">{placeholder ?? "Select"}</span>}
            {!multiple && value[0]}
            {multiple && value.map((v) => (
              <span key={v} className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs">
                {v}
                <X className="size-3" aria-label={`Remove ${v}`} onClick={(e) => { e.stopPropagation(); pick(v); }} />
              </span>
            ))}
          </span>
          <ChevronDown className="size-4 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        <Command>
          <CommandInput placeholder={placeholder ?? "Search"} />
          <CommandList>
            <CommandEmpty>No results</CommandEmpty>
            {options.map((o) => (
              <CommandItem key={o} value={o} onSelect={() => pick(o)}>
                <Check className={cn("size-4", value.includes(o) ? "opacity-100" : "opacity-0")} />
                {o}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
