import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

const noticeVariants = cva("relative grid w-full grid-cols-[auto_1fr] items-start gap-x-3 gap-y-0.5 rounded-lg border px-4 py-3 text-sm [&>svg]:size-4 [&>svg]:translate-y-0.5", {
  variants: {
    tone: {
      info: "border-info/30 bg-info/10 text-foreground [&>svg]:text-info",
      ok: "border-success/30 bg-success/10 text-foreground [&>svg]:text-success",
      warn: "border-warning/30 bg-warning/10 text-foreground [&>svg]:text-warning",
      bad: "border-destructive/30 bg-destructive/10 text-foreground [&>svg]:text-destructive",
    },
  },
  defaultVariants: { tone: "info" },
});

export function Notice({ className, tone, ...props }: ComponentProps<"div"> & VariantProps<typeof noticeVariants>) {
  return <div data-slot="notice" role="alert" className={cn(noticeVariants({ tone }), className)} {...props} />;
}
export function NoticeTitle({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("col-start-2 font-medium", className)} {...props} />;
}
export function NoticeDescription({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("col-start-2 text-text-secondary", className)} {...props} />;
}
