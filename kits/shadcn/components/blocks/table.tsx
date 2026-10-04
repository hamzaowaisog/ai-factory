// @client
// A table (TanStack Table): sorting, ticked rows with a bulk bar, a pager. On a phone the rows become cards.
import { flexRender, getCoreRowModel, getSortedRowModel, useReactTable, type ColumnDef, type SortingState } from "@tanstack/react-table";
import { ArrowDown, ArrowUp, Ellipsis } from "lucide-react";
import { useMemo, useState } from "react";
import { StatusBadge as Badge, toneOf } from "@/components/ui/status-badge";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Pager } from "@/components/ui/pager";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { ActionButton } from "./action-button";
import type { BlockEvents, TableData } from "./types";

type Row = string[];

export function TableBlock({ columns, rows, statusColumn, sortBy, sortDir = "desc", selectable, bulk, pages, page = 1, mark, onAction, className }: TableData & BlockEvents) {
  const t = useT();
  const [sorting, setSorting] = useState<SortingState>(sortBy !== undefined ? [{ id: String(sortBy), desc: sortDir === "desc" }] : []);
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [at, setAt] = useState(page);
  const cell = (v: string, i: number) => (i === statusColumn ? <Badge tone={toneOf(v)}>{t(v)}</Badge> : t(v));
  const defs = useMemo<ColumnDef<Row>[]>(() => columns.map((c, i) => ({ id: String(i), header: t(c), accessorFn: (r) => r[i] ?? "", cell: (x) => cell(String(x.getValue()), i) })), [columns, statusColumn, t]);
  const table = useReactTable({
    data: rows, columns: defs, state: { sorting, rowSelection: picked }, onSortingChange: setSorting, onRowSelectionChange: setPicked,
    getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel(), enableRowSelection: !!selectable,
  });
  const ticked = Object.values(picked).filter(Boolean).length;
  return (
    <section data-b={mark} className={cn("grid gap-3", className)}>
      {selectable && bulk && ticked > 0 && (
        <div className="flex items-center gap-2 rounded-md bg-muted px-3 py-2 text-sm" role="status">
          <span>{ticked} {t("selected")}</span>
          <span className="ms-auto flex gap-2">{bulk.map((b) => <ActionButton key={typeof b === "string" ? b : b.label} b={b} size="sm" onAction={onAction} />)}</span>
        </div>
      )}
      <Card className="hidden overflow-hidden md:block">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((g) => (
              <TableRow key={g.id}>
                {selectable && <TableHead className="w-8"><Checkbox aria-label={t("Select all")} checked={table.getIsAllRowsSelected()} onCheckedChange={(v) => table.toggleAllRowsSelected(!!v)} /></TableHead>}
                {g.headers.map((h) => {
                  const dir = h.column.getIsSorted();
                  return (
                    <TableHead key={h.id} aria-sort={dir ? (dir === "desc" ? "descending" : "ascending") : undefined}>
                      <button type="button" className="inline-flex items-center gap-1" onClick={h.column.getToggleSortingHandler()}>
                        {flexRender(h.column.columnDef.header, h.getContext())}
                        {dir === "asc" ? <ArrowUp className="size-3" /> : dir === "desc" ? <ArrowDown className="size-3" /> : null}
                      </button>
                    </TableHead>
                  );
                })}
                <TableHead className="w-8"><span className="sr-only">{t("Actions")}</span></TableHead>
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.map((r) => (
              <TableRow key={r.id} data-state={r.getIsSelected() ? "selected" : undefined} className="cursor-pointer" onClick={(e) => onAction?.(r.original[0] ?? "", e.currentTarget)}>
                {selectable && <TableCell onClick={(e) => e.stopPropagation()}><Checkbox aria-label={t("Select row")} checked={r.getIsSelected()} onCheckedChange={(v) => r.toggleSelected(!!v)} /></TableCell>}
                {r.getVisibleCells().map((c) => <TableCell key={c.id}>{flexRender(c.column.columnDef.cell, c.getContext())}</TableCell>)}
                <TableCell><button type="button" aria-label={t("More")} className="rounded-sm p-1 hover:bg-muted" onClick={(e) => { e.stopPropagation(); onAction?.("More", e.currentTarget); }}><Ellipsis className="size-4" /></button></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
      {/* phone: each row a card, its first cell the title */}
      <div className="grid gap-2 md:hidden">
        {table.getRowModel().rows.map((r) => (
          <Card key={r.id} className="cursor-pointer p-pad" onClick={(e) => onAction?.(r.original[0] ?? "", e.currentTarget)}>
            <div className="flex items-start justify-between gap-2">
              <p className="font-medium"><span className="sr-only">{t(columns[0] ?? "")}: </span>{t(r.original[0] ?? "")}</p>
              {statusColumn !== undefined && r.original[statusColumn] && <Badge tone={toneOf(r.original[statusColumn]!)}><span className="sr-only">{t(columns[statusColumn] ?? "")}: </span>{t(r.original[statusColumn]!)}</Badge>}
            </div>
            <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
              {columns.slice(1).map((c, j) => (j + 1 === statusColumn ? null : <div key={c} className="contents"><dt className="text-muted-foreground">{t(c)}</dt><dd className="text-end">{t(r.original[j + 1] ?? "")}</dd></div>))}
            </dl>
          </Card>
        ))}
      </div>
      {pages !== undefined && pages > 1 && <Pager page={at} pages={pages} labels={[t("Previous page"), t("Next page")]} onPage={(p) => setAt(Math.min(Math.max(1, p), pages))} />}
    </section>
  );
}
