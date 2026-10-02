import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export const badgeVariants = cva("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold whitespace-nowrap", {
  variants: {
    tone: {
      neutral: "border-transparent bg-muted text-muted-foreground",
      brand: "border-transparent bg-primary/10 text-brand-text",
      ok: "border-transparent bg-success/6 text-success",
      warn: "border-transparent bg-warning/6 text-warning",
      bad: "border-transparent bg-destructive/6 text-destructive",
      info: "border-transparent bg-info/6 text-info",
    },
  },
  defaultVariants: { tone: "neutral" },
});

export function StatusBadge({ className, tone, ...props }: ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span data-slot="status-badge" className={cn(badgeVariants({ tone }), className)} {...props} />;
}

// a status word's colour, as the approved demo draws it (src/estimate/demo.ts, tone): wrong, needs attention, happening now, fine
const TONES: [RegExp, "bad" | "warn" | "brand" | "ok"][] = [
  [/\b(unpaid|overdue|fail(ed|ure|ing)?|errors?|reject(ed)?|block(ed)?|late|critical|declined|cancell?ed|bounced|expired|out of stock|sold out|missed|lost|suspended|offline|denied|no.?show|disputed|breach(ed)?|returned|refused|terminated|churned|urgent|severe|outage)\b/i, "bad"],
  [/\b(delayed|pending|due|wait(ing|list(ed)?)?|awaiting|draft|(in |under )?review|partial(ly)?|on hold|hold|low stock|few left|at risk|queued|processing|expiring|unverified|limited|needs (action|attention|review)|not \w+|incomplete|requested|follow.?up|warning|moderate|paused)\b/i, "warn"],
  [/\b(boarding|in progress|live|now|in transit|on the way|out for delivery|preparing|checking in|ongoing|running|new|started|en route|departing|arriving|admitted|in surgery|deal|offer|sale|popular|featured|best (value|seller)|top rated|trending|limited time)\b/i, "brand"],
  [/\b(paid|active|done|approved|completed?|success(ful)?|delivered|ok|resolved|sent|on track|on time|open|confirmed|booked|available|in stock|verified|online|healthy|passed|shipped|arrived|landed|published|accepted|enrolled|checked.?in|ready|signed|settled|won|valid|insured|current|stable|discharged|normal|good|excellent|hired|closed won)\b/i, "ok"],
];

/** The tone a status word reads as (Paid, Overdue, Pending...). */
export const toneOf = (status: string): "bad" | "warn" | "brand" | "ok" | "info" => TONES.find(([re]) => re.test(status.trim()))?.[1] ?? "info";
