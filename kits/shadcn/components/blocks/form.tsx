// @client
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Field } from "./field";
import type { BlockEvents, FormData } from "./types";

export function FormBlock({ fields, submit = "Save", mark, onAction, invalid, className }: FormData & BlockEvents) {
  const t = useT();
  return (
    <Card data-b={mark} className={cn("p-pad", className)}>
      <form className="grid gap-4 sm:grid-cols-2" noValidate onSubmit={(e) => { e.preventDefault(); onAction?.(submit, e.currentTarget); }}>
        {fields.map((f) => <div key={f.label} className={cn((f.kind === "textarea" || f.kind === "card" || f.kind === "consent") && "sm:col-span-2")}><Field f={f} invalid={invalid} /></div>)}
        <div className="flex justify-end sm:col-span-2"><Button type="submit">{t(submit)}</Button></div>
      </form>
    </Card>
  );
}
