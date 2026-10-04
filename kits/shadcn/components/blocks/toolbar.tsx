// @client
// A search, dropdowns and buttons above a list. On a phone the dropdowns and buttons fold into a menu.
import { Ellipsis, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { ActionButton } from "./action-button";
import type { BlockEvents, ToolbarData } from "./types";
import { label } from "./types";

export function ToolbarBlock({ search, selects = [], buttons = [], mark, onAction, className }: ToolbarData & BlockEvents) {
  const t = useT();
  return (
    <section data-b={mark} className={cn("flex items-center gap-2", className)}>
      {search !== undefined && (
        <div className="relative min-w-0 flex-1 sm:max-w-72">
          <Search className="absolute start-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input type="search" placeholder={t(search)} aria-label={t(search)} className="ps-8" />
        </div>
      )}
      <div className="ms-auto hidden items-center gap-2 sm:flex">
        {selects.map((s) => (
          <Select key={s.label} defaultValue={s.value ?? s.options[0]} onValueChange={(v) => onAction?.(v)}>
            <SelectTrigger className="w-40" aria-label={t(s.label)}><SelectValue placeholder={t(s.label)} /></SelectTrigger>
            <SelectContent>{s.options.map((o) => <SelectItem key={o} value={o}>{t(o)}</SelectItem>)}</SelectContent>
          </Select>
        ))}
        {buttons.map((b, i) => <ActionButton key={label(b)} b={b} main={i === 0 && !selects.length} onAction={onAction} />)}
      </div>
      {(selects.length > 0 || buttons.length > 0) && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button variant="outline" size="icon" className="ms-auto sm:hidden" aria-label={t("More")}><Ellipsis /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {selects.map((s) => (
              <div key={s.label}>
                <DropdownMenuLabel>{t(s.label)}</DropdownMenuLabel>
                {s.options.map((o) => <DropdownMenuItem key={o} onSelect={() => onAction?.(o)}>{t(o)}</DropdownMenuItem>)}
                <DropdownMenuSeparator />
              </div>
            ))}
            {buttons.map((b) => <DropdownMenuItem key={label(b)} onSelect={() => onAction?.(label(b))}>{t(label(b))}</DropdownMenuItem>)}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </section>
  );
}
