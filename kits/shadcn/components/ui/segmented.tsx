// @client
import { useState } from "react";
import { cn } from "@/lib/utils";

/** A choice of one view (7D / 30D, Monthly / Yearly, List / Map): pressed buttons in a group, not tabs, since no panel follows. */
export function Segmented({ items, value, defaultValue, onChange, label, className }: {
  items: { value: string; label: string }[]; value?: string; defaultValue?: string; onChange?: (v: string) => void; label?: string; className?: string;
}) {
  const [own, setOwn] = useState(defaultValue ?? items[0]?.value);
  const at = value ?? own;
  return (
    <div role="group" aria-label={label} data-slot="segmented" className={cn("inline-flex h-9 items-center gap-1 rounded-lg bg-muted p-1 text-muted-foreground", className)}>
      {items.map((x) => (
        <button key={x.value} type="button" aria-pressed={at === x.value} onClick={() => { setOwn(x.value); onChange?.(x.value); }}
          className="inline-flex h-7 items-center justify-center rounded-md px-3 text-sm font-medium whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-ring aria-pressed:bg-card aria-pressed:text-foreground aria-pressed:shadow-card">{x.label}</button>
      ))}
    </div>
  );
}
