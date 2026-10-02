// @client
import { ImageIcon } from "lucide-react";
import { useState } from "react";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { BlockEvents, GalleryData } from "./types";

function Picture({ src, caption, className }: { src?: string; caption: string; className?: string }) {
  return src
    ? <img src={src} alt={caption} className={cn("h-full w-full rounded-md object-cover", className)} />
    : <div role="img" aria-label={caption} className={cn("flex h-full w-full items-center justify-center rounded-md bg-muted text-muted-foreground", className)}><ImageIcon className="size-6" /></div>;
}

export function GalleryBlock({ layout = "hero", items, mark, className }: GalleryData & BlockEvents) {
  const t = useT();
  const [main, setMain] = useState(0);
  if (layout === "grid") {
    return (
      <section data-b={mark} className={cn("grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4", className)}>
        {items.map((g) => <figure key={g.caption} className="grid gap-1"><Picture src={g.src} caption={t(g.caption)} className="aspect-square" /><figcaption className="text-xs text-muted-foreground">{t(g.caption)}</figcaption></figure>)}
      </section>
    );
  }
  const hero = items[main]!;
  return (
    <section data-b={mark} className={cn("grid gap-2", className)}>
      <Picture src={hero.src} caption={t(hero.caption)} className="aspect-video" />
      <div className="flex gap-2 overflow-x-auto">
        {items.map((g, i) => <button key={g.caption} type="button" aria-pressed={i === main} aria-label={t(g.caption)} onClick={() => setMain(i)} className="size-16 shrink-0 rounded-md ring-primary aria-pressed:ring-2"><Picture src={g.src} caption={t(g.caption)} /></button>)}
      </div>
    </section>
  );
}
