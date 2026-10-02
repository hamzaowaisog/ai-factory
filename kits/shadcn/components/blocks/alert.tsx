// @client
import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";
import { Notice as Alert, NoticeDescription as AlertDescription, NoticeTitle as AlertTitle } from "@/components/ui/notice";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n";
import type { AlertData, BlockEvents } from "./types";

const ICON = { info: Info, ok: CircleCheck, warn: TriangleAlert, bad: CircleAlert };

export function AlertBlock({ tone = "info", title, text, action, mark, onAction, className }: AlertData & BlockEvents) {
  const t = useT();
  const Icon = ICON[tone];
  return (
    <Alert data-b={mark} tone={tone} className={className}>
      <Icon />
      {title && <AlertTitle>{t(title)}</AlertTitle>}
      <AlertDescription className="flex flex-wrap items-center justify-between gap-2"><span>{t(text)}</span>{action && <Button size="sm" variant="outline" onClick={(e) => onAction?.(action, e.currentTarget)}>{t(action)}</Button>}</AlertDescription>
    </Alert>
  );
}
