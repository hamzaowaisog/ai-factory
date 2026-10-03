// @client
// A button as the design gave it: its look, picture, state, hint, and a split menu.
import { ChevronDown, Download, LoaderCircle, Pencil, Plus, Search, Send, Share2, Trash2, Upload, X, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tip } from "./tip";
import { useT } from "@/lib/i18n";
import type { ButtonLike } from "./types";

const ICONS: Record<string, LucideIcon> = { download: Download, export: Download, plus: Plus, add: Plus, new: Plus, create: Plus, edit: Pencil, delete: Trash2, remove: Trash2, upload: Upload, send: Send, share: Share2, search: Search, close: X, cancel: X };
const iconFor = (word?: string, label = "") => ICONS[(word ?? "").toLowerCase()] ?? ICONS[label.split(/\s+/)[0]!.toLowerCase()];

/** Design button variants mapped onto the shadcn ones. */
const VARIANT = { primary: "default", secondary: "outline", ghost: "ghost", danger: "destructive", link: "link" } as const;

export function ActionButton({ b, main = false, onAction, size }: { b: ButtonLike; main?: boolean; onAction?: (label: string, at?: HTMLElement) => void; size?: "sm" | "default" }) {
  const t = useT();
  const spec = typeof b === "string" ? { label: b } : b;
  const variant = VARIANT[spec.variant ?? (main ? "primary" : "secondary")];
  const Icon = spec.state === "loading" ? LoaderCircle : iconFor(spec.icon, spec.label);
  const button = (
    <Button type="button" variant={variant} size={spec.iconOnly ? "icon" : size} disabled={spec.state === "disabled" || spec.state === "loading"} aria-label={spec.iconOnly ? t(spec.label) : undefined}
      className={spec.menu ? "rounded-e-none" : undefined} onClick={(e) => onAction?.(spec.label, e.currentTarget)}>
      {Icon && <Icon className={spec.state === "loading" ? "animate-spin" : undefined} />}
      {!spec.iconOnly && t(spec.label)}
    </Button>
  );
  if (!spec.menu) return <Tip hint={spec.hint ?? (spec.iconOnly ? t(spec.label) : undefined)}>{button}</Tip>;
  return (
    <span className="inline-flex">
      {button}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant={variant} size={size === "sm" ? "sm" : "default"} className="rounded-s-none border-s border-s-black/10 px-2" aria-label={`${t(spec.label)}: more`}><ChevronDown /></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {spec.menu.map((m) => <DropdownMenuItem key={m} onSelect={() => onAction?.(m)}>{t(m)}</DropdownMenuItem>)}
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  );
}
