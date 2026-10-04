// @client
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Card } from "@/components/ui/card";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { AccordionData, BlockEvents } from "./types";

export function AccordionBlock({ title, items, mark, className }: AccordionData & BlockEvents) {
  const t = useT();
  return (
    <Card data-b={mark} className={cn("px-pad", className)}>
      {title && <h3 className="pt-pad font-heading font-semibold">{t(title)}</h3>}
      <Accordion type="single" collapsible defaultValue="0">
        {items.map((it, i) => (
          <AccordionItem key={it.title} value={String(i)}>
            <AccordionTrigger>{t(it.title)}</AccordionTrigger>
            <AccordionContent>{t(it.body)}</AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </Card>
  );
}
