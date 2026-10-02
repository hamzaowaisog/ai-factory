import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { buttonVariants } from "./button";

/** The pages around the current one, with gaps ("…") between far ones. */
export function pageList(page: number, pages: number): (number | "…")[] {
  const want = new Set([1, pages, page - 1, page, page + 1].filter((p) => p >= 1 && p <= pages));
  const out: (number | "…")[] = [];
  let last = 0;
  for (const p of [...want].sort((a, b) => a - b)) {
    if (p - last > 1) out.push("…");
    out.push(p);
    last = p;
  }
  return out;
}

export function Pager({ page, pages, onPage, className, labels = ["Previous page", "Next page"] }: { page: number; pages: number; onPage?: (p: number) => void; className?: string; labels?: [string, string] }) {
  const btn = (p: number, label: ReactNode, active = false, disabled = false, name?: string) => (
    <button type="button" disabled={disabled} aria-label={name} aria-current={active ? "page" : undefined} onClick={() => onPage?.(p)} className={cn(buttonVariants({ variant: active ? "outline" : "ghost", size: "icon" }), "size-8")}>{label}</button>
  );
  return (
    <nav aria-label="pagination" data-slot="pagination" className={cn("flex items-center justify-center gap-1", className)}>
      {btn(page - 1, <ChevronLeft className="rtl:rotate-180" />, false, page <= 1, labels[0])}
      {pageList(page, pages).map((p, i) => (p === "…" ? <span key={`g${i}`} className="px-1 text-muted-foreground">…</span> : <span key={p}>{btn(p, p, p === page)}</span>))}
      {btn(page + 1, <ChevronRight className="rtl:rotate-180" />, false, page >= pages, labels[1])}
    </nav>
  );
}
