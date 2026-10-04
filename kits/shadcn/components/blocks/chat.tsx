// @client
import { Send } from "lucide-react";
import { Avatar } from "@/components/ui/people";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { BlockEvents, ChatData } from "./types";

export function ChatBlock({ with: who, meta, messages, quick, placeholder, mark, onAction, className }: ChatData & BlockEvents) {
  const t = useT();
  return (
    <Card data-b={mark} className={cn("flex flex-col", className)}>
      <header className="flex items-center gap-3 border-b p-pad"><Avatar name={who} /><div><p className="font-medium">{who}</p>{meta && <p className="text-xs text-muted-foreground">{t(meta)}</p>}</div></header>
      <div className="grid gap-2 p-pad" role="log">
        {messages.map((m, i) => (
          <div key={i} className={cn("max-w-[80%] rounded-lg px-3 py-2 text-sm", m.from === "me" ? "justify-self-end bg-primary text-primary-foreground" : "justify-self-start bg-muted")}>
            <p>{t(m.text)}</p>{m.time && <p className="mt-1 text-[10px] opacity-70">{m.time}</p>}
          </div>
        ))}
      </div>
      {quick && <div className="flex flex-wrap gap-2 px-pad">{quick.map((q) => <button key={q} type="button" className="rounded-full border px-3 py-1 text-xs hover:bg-muted" onClick={(e) => onAction?.(q, e.currentTarget)}>{t(q)}</button>)}</div>}
      <form className="flex gap-2 p-pad" onSubmit={(e) => { e.preventDefault(); onAction?.("Send", e.currentTarget); }}>
        <Input placeholder={t(placeholder ?? "Write a message")} aria-label={t(placeholder ?? "Write a message")} />
        <Button type="submit" size="icon" aria-label={t("Send")}><Send className="rtl:-scale-x-100" /></Button>
      </form>
    </Card>
  );
}
