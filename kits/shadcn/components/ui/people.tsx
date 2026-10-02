import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");

export function Avatar({ name, className, ...props }: { name: string } & ComponentProps<"span">) {
  return <span data-slot="avatar" title={name} className={cn("inline-flex size-8 shrink-0 items-center justify-center rounded-full border-2 border-card bg-primary/10 text-brand-text text-xs font-semibold", className)} {...props}>{initials(name)}</span>;
}

/** Overlapping avatars, five at most then "+N". */
export function AvatarStack({ people, className }: { people: string[]; className?: string }) {
  if (!people.length) return null;
  return (
    <span className={cn("flex -space-x-2 rtl:space-x-reverse", className)}>
      {people.slice(0, 5).map((p) => <Avatar key={p} name={p} />)}
      {people.length > 5 && <span className="inline-flex size-8 items-center justify-center rounded-full border-2 border-card bg-muted text-xs">+{people.length - 5}</span>}
    </span>
  );
}
