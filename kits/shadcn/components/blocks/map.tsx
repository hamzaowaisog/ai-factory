// @client
// Places on a map (Leaflet) with their list beside it. Pins without coordinates are drawn on a plain plan instead.
import { useEffect, useRef } from "react";
import { Card } from "@/components/ui/card";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { BlockEvents, MapData } from "./types";

const TONE: Record<string, string> = { ok: "var(--success)", warn: "var(--warning)", bad: "var(--destructive)", info: "var(--primary)" };

function LeafletMap({ pins, route }: Pick<MapData, "pins" | "route">) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let map: { remove: () => void } | undefined;
    let live = true;
    void Promise.all([import("leaflet"), import("leaflet/dist/leaflet.css" as string)]).then(([L]) => {
      if (!live || !box.current) return;
      // Leaflet writes colours as SVG attributes, which cannot read CSS variables: take the theme's values
      const css = getComputedStyle(box.current);
      const colour = (tone?: string) => css.getPropertyValue(TONE[tone ?? "info"]!.slice(4, -1)).trim() || "currentColor";
      const at = pins.filter((p) => p.lat !== undefined && p.lng !== undefined).map((p) => [p.lat!, p.lng!] as [number, number]);
      const m = L.map(box.current, { scrollWheelZoom: false });
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "&copy; OpenStreetMap" }).addTo(m);
      pins.forEach((p, i) => p.lat !== undefined && p.lng !== undefined && L.circleMarker([p.lat, p.lng], { radius: 8, color: colour(p.tone), fillOpacity: 0.9 }).bindTooltip(`${i + 1}. ${p.label}`).addTo(m));
      if (route && at.length > 1) L.polyline(at, { color: colour("info"), dashArray: "6 6" }).addTo(m);
      m.fitBounds(L.latLngBounds(at), { padding: [24, 24] });
      map = m;
    });
    return () => { live = false; map?.remove(); };
  }, [pins, route]);
  return <div ref={box} className="h-72 w-full rounded-md" />;
}

function Plan({ pins, route }: Pick<MapData, "pins" | "route">) {
  // the same places every time: spread over the plan by their order; the pins are HTML so they stay round at any width
  const at = pins.map((_, i) => ({ x: 12 + ((i * 37) % 76), y: 15 + ((i * 53) % 70) }));
  return (
    <div className="relative h-72 w-full overflow-hidden rounded-md bg-muted" role="img" aria-label="Map">
      {route && (
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 size-full" aria-hidden="true">
          <polyline points={at.map((p) => `${p.x},${p.y}`).join(" ")} fill="none" stroke="var(--primary)" strokeWidth="2" strokeDasharray="6 6" vectorEffect="non-scaling-stroke" />
        </svg>
      )}
      {at.map((p, i) => (
        <span key={i} className="absolute flex size-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-card text-xs font-medium text-white shadow-card" style={{ left: `${p.x}%`, top: `${p.y}%`, background: TONE[pins[i]!.tone ?? "info"] }}>{i + 1}</span>
      ))}
    </div>
  );
}

export function MapBlock({ area, pins, route, mark, onAction, className }: MapData & BlockEvents) {
  const t = useT();
  const real = pins.length > 0 && pins.every((p) => p.lat !== undefined && p.lng !== undefined);
  return (
    <Card data-b={mark} className={cn("grid gap-3 p-pad md:grid-cols-[2fr_1fr]", className)}>
      <div>{area && <p className="mb-2 text-sm text-muted-foreground">{t(area)}</p>}{real ? <LeafletMap pins={pins} route={route} /> : <Plan pins={pins} route={route} />}</div>
      <ol className="grid content-start gap-2 text-sm">
        {pins.map((p, i) => (
          <li key={p.label}><button type="button" className="flex w-full gap-2 rounded-md p-2 text-start hover:bg-muted" onClick={(e) => onAction?.(p.label, e.currentTarget)}>
            <span className="flex size-5 shrink-0 items-center justify-center rounded-full text-xs text-white" style={{ background: TONE[p.tone ?? "info"] }}>{i + 1}</span>
            <span><span className="block font-medium">{t(p.label)}</span>{p.meta && <span className="block text-muted-foreground">{t(p.meta)}</span>}</span>
          </button></li>
        ))}
      </ol>
    </Card>
  );
}
