// @client
// Charts (Recharts): bar, line, stacked and donut; progress rings and a gauge are drawn here.
import { useState } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Segmented } from "@/components/ui/segmented";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { BlockEvents, ChartData } from "./types";

const SERIES = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];

function Ring({ value, label }: { value: number; label: string }) {
  const r = 34, c = 2 * Math.PI * r, v = Math.max(0, Math.min(100, value));
  return (
    <figure className="grid justify-items-center gap-1">
      <svg viewBox="0 0 80 80" className="size-20" role="img" aria-label={`${label} ${v}%`}>
        <circle cx="40" cy="40" r={r} fill="none" stroke="var(--muted)" strokeWidth="8" />
        <circle cx="40" cy="40" r={r} fill="none" stroke="var(--primary)" strokeWidth="8" strokeLinecap="round" strokeDasharray={`${(v / 100) * c} ${c}`} transform="rotate(-90 40 40)" />
        <text x="40" y="45" textAnchor="middle" className="fill-foreground text-sm font-semibold">{v}%</text>
      </svg>
      <figcaption className="text-xs text-muted-foreground">{label}</figcaption>
    </figure>
  );
}

function Gauge({ value, max, unit, label }: { value: number; max: number; unit?: string; label: string }) {
  const share = Math.max(0, Math.min(1, value / max)), a = Math.PI * (1 - share);
  return (
    <svg viewBox="0 0 120 70" className="mx-auto h-32" role="img" aria-label={`${label} ${value}${unit ?? ""} of ${max}`}>
      <path d="M10 60 A50 50 0 0 1 110 60" fill="none" stroke="var(--muted)" strokeWidth="10" strokeLinecap="round" />
      <path d={`M10 60 A50 50 0 0 1 ${60 + 50 * Math.cos(a)} ${60 - 50 * Math.sin(a)}`} fill="none" stroke="var(--primary)" strokeWidth="10" strokeLinecap="round" />
      <text x="60" y="58" textAnchor="middle" className="fill-foreground text-base font-semibold">{value}{unit ?? ""}</text>
    </svg>
  );
}

export function ChartBlock({ kind = "bar", title, points, series, max, unit, ranges, mark, onAction, className }: ChartData & BlockEvents) {
  const t = useT();
  const [range, setRange] = useState(ranges?.[0]);
  const data = points.map((p) => ({ label: t(p.label), value: p.value, ...Object.fromEntries((p.parts ?? []).map((v, i) => [`s${i}`, v])) }));
  const axes = [<CartesianGrid key="g" vertical={false} stroke="var(--border)" />, <XAxis key="x" dataKey="label" tickLine={false} axisLine={false} fontSize={12} />, <YAxis key="y" tickLine={false} axisLine={false} fontSize={12} width={40} />, <Tooltip key="t" />];
  let body;
  if (kind === "progress") body = <div className="flex flex-wrap justify-around gap-4 py-2">{points.map((p) => <Ring key={p.label} value={p.value} label={t(p.label)} />)}</div>;
  else if (kind === "gauge") body = <Gauge value={points[0]?.value ?? 0} max={max ?? 100} unit={unit} label={t(points[0]?.label ?? title)} />;
  else body = (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        {kind === "donut" ? (
          <PieChart><Pie data={data} dataKey="value" nameKey="label" innerRadius="60%" outerRadius="85%" paddingAngle={2}>{data.map((_, i) => <Cell key={i} fill={SERIES[i % SERIES.length]} />)}</Pie><Tooltip /></PieChart>
        ) : kind === "line" ? (
          <AreaChart data={data}>{axes}<Area dataKey="value" type="monotone" stroke="var(--chart-1)" fill="var(--chart-1)" fillOpacity={0.15} strokeWidth={2} /></AreaChart>
        ) : kind === "stacked" ? (
          <BarChart data={data}>{axes}{(series ?? []).map((s, i) => <Bar key={s} dataKey={`s${i}`} name={t(s)} stackId="a" fill={SERIES[i % SERIES.length]} />)}</BarChart>
        ) : (
          <BarChart data={data}>{axes}<Bar dataKey="value" fill="var(--chart-1)" radius={[4, 4, 0, 0]} /></BarChart>
        )}
      </ResponsiveContainer>
    </div>
  );
  return (
    <Card data-b={mark} className={cn("p-pad", className)}>
      <CardHeader className="flex-row items-center justify-between p-0 pb-3">
        <CardTitle>{t(title)}</CardTitle>
        {ranges && <Segmented label={t("Range")} value={range} items={ranges.map((r) => ({ value: r, label: t(r) }))} onChange={(r) => { setRange(r); onAction?.(r); }} />}
      </CardHeader>
      {body}
    </Card>
  );
}
