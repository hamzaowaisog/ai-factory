// @client
// One page as the design drew it: the trail, title, status and tabs; its states (loading, empty, error, success,
// validation); the layers it opens from its buttons, the short messages after its actions, and where its links lead.
import { CircleAlert, CircleCheck, Inbox, RotateCw, TriangleAlert } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Notice as Alert, NoticeDescription as AlertDescription, NoticeTitle as AlertTitle } from "@/components/ui/notice";
import { StatusBadge as Badge, toneOf } from "@/components/ui/status-badge";
import { Crumbs } from "@/components/ui/crumbs";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { stateKind } from "@/lib/fixture";
import { useT } from "@/lib/i18n";
import { useNav } from "@/lib/nav";
import { Overlay, type OverlaySpec } from "./overlay";

export interface ScreenSpec {
  id: string;
  title: string;
  subtitle?: string;
  badge?: string;
  crumbs?: string[];
  tabs?: string[];
  copy?: { emptyTitle?: string; emptyHint?: string; error?: string; success?: string; validation?: string };
  /** where a button, row, card or list item leads: its label, and the route it opens */
  links?: { from: string; to: string }[];
  overlays?: OverlaySpec[];
  toasts?: { after: string; text: string; tone?: "ok" | "info" | "bad"; undo?: boolean }[];
  /** each state's name in the address (fixture mode), and the overlay or toast it shows */
  states?: Record<string, { name: string; overlay?: number; toast?: number; full?: boolean }>;
}

export type Act = (label: string, at?: HTMLElement) => void;

export function ScreenShell({ spec, state = "default", onAction, overlayBody, children }: {
  spec: ScreenSpec;
  /** the state to show: a state name from spec.states (fixture mode), or "default" */
  state?: string;
  /** every action, after the page has opened its layer, shown its message or followed its link: the container adds behaviour here */
  onAction?: (label: string) => void;
  /** what a layer shows inside (its form, facts or list), by its index in spec.overlays */
  overlayBody?: (index: number, act: Act) => ReactNode;
  children: (act: Act, invalid: boolean) => ReactNode;
}) {
  const t = useT();
  const nav = useNav();
  const st = spec.states?.[state];
  const kind = stateKind(st?.name ?? state);
  const [open, setOpen] = useState<{ i: number; at?: DOMRect } | null>(st?.overlay !== undefined ? { i: st.overlay } : null);
  const [tab, setTab] = useState(spec.tabs?.[0]);

  const say = (i: number, stay = false) => {
    const m = spec.toasts![i]!;
    const show = m.tone === "bad" ? toast.error : m.tone === "info" ? toast.info : toast.success;
    show(t(m.text), { ...(m.undo ? { action: { label: t("Undo"), onClick: () => onAction?.("Undo") } } : {}), ...(stay ? { duration: Infinity } : {}) });
  };
  // a state that shows a message keeps it on screen (the page opened in that state, for a look or a test)
  useEffect(() => { if (st?.toast !== undefined) say(st.toast, true); }, [state]); // eslint-disable-line react-hooks/exhaustive-deps

  const act: Act = (label, el) => {
    const o = spec.overlays?.findIndex((x) => x.trigger === label) ?? -1;
    if (o >= 0) setOpen({ i: o, at: el?.getBoundingClientRect() });
    spec.toasts?.forEach((m, i) => m.after === label && say(i));
    const link = spec.links?.find((l) => l.from === label);
    if (link) nav.go(link.to);
    onAction?.(label);
  };

  let body: ReactNode;
  if (kind === "loading") body = <div className="grid gap-3" aria-busy="true"><Skeleton className="h-24" /><Skeleton className="h-64" /><Skeleton className="h-10 w-1/2" /></div>;
  else if (kind === "empty") body = (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-10 text-center" data-b="state:empty">
      <Inbox className="size-8 text-muted-foreground" />
      <p className="font-medium">{t(spec.copy?.emptyTitle ?? "Nothing here yet")}</p>
      {spec.copy?.emptyHint && <p className="max-w-sm text-sm text-muted-foreground">{t(spec.copy.emptyHint)}</p>}
    </div>
  );
  else if (kind === "error") body = (
    <Alert tone="bad" data-b="state:error">
      <CircleAlert />
      <AlertTitle>{t("Something went wrong")}</AlertTitle>
      <AlertDescription className="flex flex-wrap items-center justify-between gap-2"><span>{t(spec.copy?.error ?? "Try again in a moment.")}</span><Button size="sm" variant="outline" onClick={() => onAction?.("Retry")}><RotateCw />{t("Retry")}</Button></AlertDescription>
    </Alert>
  );
  else body = (
    <>
      {kind === "success" && spec.copy?.success && <Alert tone="ok" data-b="state:success"><CircleCheck /><AlertDescription>{t(spec.copy.success)}</AlertDescription></Alert>}
      {kind === "validation" && spec.copy?.validation && <Alert tone="warn" data-b="state:validation"><TriangleAlert /><AlertDescription>{t(spec.copy.validation)}</AlertDescription></Alert>}
      {children(act, kind === "validation")}
    </>
  );

  return (
    <main data-screen={spec.id} data-state={state} className="mx-auto grid w-full max-w-6xl gap-4 p-4 md:p-6">
      {spec.crumbs && <Crumbs items={[...spec.crumbs, spec.title].map(t)} className="hidden sm:block" />}
      <header className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="flex items-center gap-2 font-heading text-2xl font-semibold tracking-tight">{t(spec.title)}{spec.badge && <Badge tone={toneOf(spec.badge)}>{t(spec.badge)}</Badge>}</h1>
          {spec.subtitle && <p className="text-sm text-muted-foreground">{t(spec.subtitle)}</p>}
        </div>
      </header>
      {spec.tabs && (
        <Tabs value={tab} onValueChange={setTab}>
          {/* a tab is a control like any other: one that names a layer, a message or a link opens it, as in the demo */}
          <TabsList className="max-w-full overflow-x-auto">{spec.tabs.map((x) => <TabsTrigger key={x} value={x} onClick={(e) => act(x, e.currentTarget)}>{t(x)}</TabsTrigger>)}</TabsList>
          {spec.tabs.map((x) => <TabsContent key={x} value={x} forceMount hidden={x !== tab} tabIndex={-1} />)}
        </Tabs>
      )}
      {body}
      {spec.overlays?.map((o, i) => (
        <Overlay key={o.trigger + i} spec={o} open={open?.i === i} at={open?.i === i ? open.at : undefined} onClose={() => setOpen(null)} onAction={(l) => act(l)}>
          {overlayBody?.(i, act)}
        </Overlay>
      ))}
    </main>
  );
}
