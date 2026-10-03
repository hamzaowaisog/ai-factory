// @client
import { Slider as SliderPrimitive } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export function Slider({ className, defaultValue, value, "aria-label": label, "aria-labelledby": labelledBy, ...props }: ComponentProps<typeof SliderPrimitive.Root>) {
  const thumbs = (value ?? defaultValue ?? [0]).length;
  return (
    <SliderPrimitive.Root data-slot="slider" defaultValue={defaultValue} value={value} className={cn("relative flex w-full touch-none items-center select-none data-[disabled]:opacity-50", className)} {...props}>
      <SliderPrimitive.Track className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-muted"><SliderPrimitive.Range className="absolute h-full bg-primary" /></SliderPrimitive.Track>
      {Array.from({ length: thumbs }, (_, i) => <SliderPrimitive.Thumb key={i} aria-label={label} aria-labelledby={labelledBy} className="block size-4 rounded-full border border-primary bg-card shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" />)}
    </SliderPrimitive.Root>
  );
}
