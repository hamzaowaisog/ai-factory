// @client
import { StatusBadge as Badge, toneOf } from "@/components/ui/status-badge";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { BlockEvents, ReceiptData } from "./types";

export function ReceiptBlock({ title, status, from, to, facts = [], lines, totals, note, mark, className }: ReceiptData & BlockEvents) {
  const t = useT();
  return (
    <Card data-b={mark} className={cn("grid gap-4 p-pad", className)}>
      <div className="flex items-start justify-between gap-2"><h3 className="font-heading text-xl font-semibold">{t(title)}</h3>{status && <Badge tone={toneOf(status)}>{t(status)}</Badge>}</div>
      {(from || to) && <div className="grid grid-cols-2 gap-4 text-sm">{from && <div><p className="text-xs text-muted-foreground">{t("From")}</p><p>{from}</p></div>}{to && <div><p className="text-xs text-muted-foreground">{t("To")}</p><p>{to}</p></div>}</div>}
      {facts.length > 0 && <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">{facts.map((f) => <div key={f.label}><dt className="text-xs text-muted-foreground">{t(f.label)}</dt><dd>{t(f.value)}</dd></div>)}</dl>}
      <Separator />
      <ul className="grid gap-2 text-sm">{lines.map((l) => <li key={l.item} className="flex gap-2"><span className="flex-1">{t(l.item)}</span>{l.qty && <span className="text-muted-foreground">× {l.qty}</span>}<span className="tabular-nums">{l.amount}</span></li>)}</ul>
      <Separator />
      <dl className="grid gap-1 text-sm">{totals.map((x, i) => <div key={x.label} className={cn("flex justify-between", i === totals.length - 1 && "text-base font-semibold")}><dt>{t(x.label)}</dt><dd className="tabular-nums">{x.value}</dd></div>)}</dl>
      {note && <p className="text-xs text-muted-foreground">{t(note)}</p>}
    </Card>
  );
}
