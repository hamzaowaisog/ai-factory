// @client
// The product's frame (theme.shell): a sidebar app, a top-bar site, a menu button opening a drawer, a bottom tab bar
// (phone apps) or a minimal frame. A sidebar becomes a drawer on a phone.
import { Check, ChevronsUpDown, Languages, Menu } from "lucide-react";
import { type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useLang, useT } from "@/lib/i18n";
import { Link, useNav } from "@/lib/nav";
import { hrefFor, matches } from "@/lib/routes";
import { cn } from "@/lib/utils";

export type Shell = "sidebar" | "topbar" | "drawer" | "tabs" | "minimal";
export interface NavItem { label: string; route: string; group?: string }
export interface Switcher { kind: string; current: string; meta?: string; others: string[] }
export interface FrameApp { id: string; name: string; shell: Shell; nav: NavItem[]; switcher?: Switcher; routes: string[] }

function Brand({ name }: { name: string }) {
  return <span className="flex items-center gap-2 font-heading font-semibold"><span className="flex size-7 items-center justify-center rounded-md bg-primary text-sm text-primary-foreground">{name[0]}</span>{name}</span>;
}

function SwitcherMenu({ s }: { s: Switcher }) {
  const t = useT();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-start text-sm hover:bg-muted">
          <span className="min-w-0 flex-1"><span className="block truncate font-medium">{t(s.current)}</span>{s.meta && <span className="block truncate text-xs text-muted-foreground">{t(s.meta)}</span>}</span>
          <ChevronsUpDown className="size-4 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel>{t(s.kind)}</DropdownMenuLabel>
        <DropdownMenuItem><Check className="size-4" />{t(s.current)}</DropdownMenuItem>
        {s.others.map((o) => <DropdownMenuItem key={o} className="ps-8">{t(o)}</DropdownMenuItem>)}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The other language, when the product has two (the page mirrors for a right-to-left one). */
function LangSwitch() {
  const { lang, langs, setLang } = useLang();
  if (langs.length < 2) return null;
  const next = langs[(langs.indexOf(lang) + 1) % langs.length]!;
  const name = (l: string) => { try { return new Intl.DisplayNames([l], { type: "language" }).of(l) ?? l; } catch { return l; } };
  return <Button variant="ghost" size="sm" onClick={() => setLang(next)} aria-label={name(next)}><Languages />{name(next)}</Button>;
}

function NavList({ items, path, vertical }: { items: NavItem[]; path: string; vertical: boolean }) {
  const t = useT();
  const groups = [...new Set(items.map((i) => i.group ?? ""))];
  return (
    <nav aria-label={t("Main")} className={cn(vertical ? "grid gap-4" : "flex items-center gap-1")}>
      {groups.map((g) => (
        <div key={g} className={vertical ? "grid gap-0.5" : "contents"}>
          {vertical && g && <p className="px-2 text-xs font-medium text-muted-foreground">{t(g)}</p>}
          {items.filter((i) => (i.group ?? "") === g).map((i) => {
            const on = matches(i.route, path);
            return <Link key={i.route} to={hrefFor(i.route)} aria-current={on ? "page" : undefined} className={cn("rounded-md px-2 py-1.5 text-sm hover:bg-muted", on && "bg-muted font-medium text-foreground", !on && "text-muted-foreground")}>{t(i.label)}</Link>;
          })}
        </div>
      ))}
    </nav>
  );
}

export function AppFrame({ product, apps, children }: { product: string; apps: FrameApp[]; children: ReactNode }) {
  const t = useT();
  const { path } = useNav();
  const app = apps.find((a) => a.routes.some((r) => matches(r, path))) ?? apps[0]!;
  const name = apps.length > 1 ? app.name : product;
  const side = (
    <div className="grid content-start gap-4">
      <Brand name={name} />
      {app.switcher && <SwitcherMenu s={app.switcher} />}
      <NavList items={app.nav} path={path} vertical />
      <div><LangSwitch /></div>
    </div>
  );
  const drawer = (
    <Sheet>
      <SheetTrigger asChild><Button variant="ghost" size="icon" aria-label={t("Menu")}><Menu /></Button></SheetTrigger>
      <SheetContent side="left"><SheetTitle className="sr-only">{t("Menu")}</SheetTitle>{side}</SheetContent>
    </Sheet>
  );
  let frame: ReactNode;
  if (app.shell === "sidebar") frame = (
    <div className="flex min-h-dvh">
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 overflow-y-auto border-e bg-card p-4 md:block">{side}</aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-2 border-b bg-card px-2 py-1 md:hidden">{drawer}<Brand name={name} /></header>
        {children}
      </div>
    </div>
  );
  else if (app.shell === "tabs") frame = (
    <div className="flex min-h-dvh flex-col pb-16">
      <header className="flex items-center gap-2 border-b bg-card px-4 py-2"><Brand name={name} /><span className="ms-auto"><LangSwitch /></span></header>
      {children}
      <nav aria-label={t("Main")} className="fixed inset-x-0 bottom-0 z-40 flex border-t bg-card">
        {app.nav.slice(0, 5).map((i) => {
          const on = matches(i.route, path);
          return <Link key={i.route} to={hrefFor(i.route)} aria-current={on ? "page" : undefined} className={cn("flex-1 py-3 text-center text-xs", on ? "font-medium text-primary" : "text-muted-foreground")}>{t(i.label)}</Link>;
        })}
      </nav>
    </div>
  );
  else if (app.shell === "minimal") frame = (
    <div className="min-h-dvh"><header className="mx-auto flex max-w-xl items-center px-4 py-4"><Brand name={name} /><span className="ms-auto"><LangSwitch /></span></header><div className="mx-auto max-w-xl">{children}</div></div>
  );
  else frame = (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-40 flex items-center gap-4 border-b bg-card px-4 py-2">
        <span className={app.shell === "drawer" ? "" : "md:hidden"}>{drawer}</span>
        <Brand name={name} />
        {app.shell === "topbar" && <div className="hidden md:block"><NavList items={app.nav} path={path} vertical={false} /></div>}
        <span className="ms-auto"><LangSwitch /></span>
        {app.switcher && <div className="hidden w-56 sm:block"><SwitcherMenu s={app.switcher} /></div>}
      </header>
      {children}
    </div>
  );
  return <TooltipProvider delayDuration={300}>{frame}<Toaster /></TooltipProvider>;
}
