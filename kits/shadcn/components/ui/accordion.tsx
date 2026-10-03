// @client
import { Accordion as AccordionPrimitive } from "radix-ui";
import { ChevronDown } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export const Accordion = AccordionPrimitive.Root;

export function AccordionItem({ className, ...props }: ComponentProps<typeof AccordionPrimitive.Item>) {
  return <AccordionPrimitive.Item data-slot="accordion-item" className={cn("border-b last:border-b-0", className)} {...props} />;
}
export function AccordionTrigger({ className, children, ...props }: ComponentProps<typeof AccordionPrimitive.Trigger>) {
  return (
    <AccordionPrimitive.Header className="flex">
      <AccordionPrimitive.Trigger data-slot="accordion-trigger" className={cn("flex flex-1 items-center justify-between gap-4 py-4 text-start text-sm font-medium outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring [&[data-state=open]>svg]:rotate-180", className)} {...props}>
        {children}
        <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform" />
      </AccordionPrimitive.Trigger>
    </AccordionPrimitive.Header>
  );
}
export function AccordionContent({ className, children, ...props }: ComponentProps<typeof AccordionPrimitive.Content>) {
  return <AccordionPrimitive.Content data-slot="accordion-content" className="overflow-hidden text-sm" {...props}><div className={cn("pb-4 text-muted-foreground", className)}>{children}</div></AccordionPrimitive.Content>;
}
