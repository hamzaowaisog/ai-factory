// @client
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { BlockEvents, TextData } from "./types";

export function TextBlock({ body, mark, className }: TextData & BlockEvents) {
  const t = useT();
  return <p data-b={mark} className={cn("max-w-prose text-sm text-muted-foreground", className)}>{t(body)}</p>;
}
