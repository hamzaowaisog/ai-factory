import { ChevronRight } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export function Crumbs({ items, className }: { items: string[]; className?: string } & Omit<ComponentProps<"nav">, "children">) {
  return (
    <nav aria-label="breadcrumb" data-slot="breadcrumb" className={className}>
      <ol className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
        {items.map((it, i) => (
          <li key={i} className="inline-flex items-center gap-1.5">
            {i > 0 && <ChevronRight className="size-3.5 rtl:rotate-180" aria-hidden />}
            <span className={cn(i === items.length - 1 && "text-foreground")}>{it}</span>
          </li>
        ))}
      </ol>
    </nav>
  );
}
