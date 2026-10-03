// @client
import { Check, Minus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { BlockEvents, CompareData } from "./types";

const value = (v: string, t: (s: string) => string) => (/^yes$/i.test(v) ? <Check className="mx-auto size-4 text-success" aria-label={t("Yes")} /> : /^no$/i.test(v) ? <Minus className="mx-auto size-4 text-muted-foreground" aria-label={t("No")} /> : t(v));

export function CompareBlock({ items, rows, cta, mark, onAction, className }: CompareData & BlockEvents) {
  const t = useT();
  return (
    <Card data-b={mark} className={cn("overflow-hidden", className)}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead />
            {items.map((i) => <TableHead key={i.name} className={cn("text-center", i.featured && "bg-primary/5 text-foreground")}><span className="block font-semibold">{t(i.name)}</span>{i.meta && <span className="block font-normal">{t(i.meta)}</span>}</TableHead>)}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => <TableRow key={r.label}><TableCell className="text-muted-foreground">{t(r.label)}</TableCell>{r.values.map((v, i) => <TableCell key={i} className={cn("text-center", items[i]?.featured && "bg-primary/5")}>{value(v, t)}</TableCell>)}</TableRow>)}
          {cta && <TableRow><TableCell />{items.map((i) => <TableCell key={i.name} className="text-center"><Button size="sm" variant={i.featured ? "default" : "outline"} onClick={(e) => onAction?.(cta, e.currentTarget)}>{t(cta)}</Button></TableCell>)}</TableRow>}
        </TableBody>
      </Table>
    </Card>
  );
}
