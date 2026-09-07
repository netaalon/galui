"use client";

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { FunnelScale } from "@/lib/funnel";

export type FunnelSeries = { key: string; label: string; counts: number[]; total: number; passed: number };

/**
 * The theme's `--chart-*` ramp is greyscale, which is fine for one stacked
 * series and useless for nine lines, so these are explicit hues.
 *
 * `coalition` and `opposition` match the emerald/orange the bloc badges use, so
 * a line and a badge for the same side agree.
 */
const BLOC_COLOURS: Record<string, string> = {
  coalition: "oklch(0.66 0.15 155)",
  opposition: "oklch(0.68 0.16 55)",
};

const SERIES_COLOURS = [
  "oklch(0.55 0.19 260)",
  "oklch(0.66 0.15 155)",
  "oklch(0.68 0.16 55)",
  "oklch(0.58 0.2 340)",
  "oklch(0.62 0.14 200)",
  "oklch(0.52 0.17 300)",
  "oklch(0.6 0.13 100)",
  "oklch(0.5 0.1 240)",
  "oklch(0.7 0.12 20)",
];

function colourFor(key: string, i: number) {
  return BLOC_COLOURS[key] ?? SERIES_COLOURS[i % SERIES_COLOURS.length];
}

export function BillFunnel({
  stages,
  series,
  scale,
}: {
  stages: string[];
  series: FunnelSeries[];
  scale: FunnelScale;
}) {
  // One row per stage, one key per series — the shape Recharts wants.
  const rows = stages.map((stage, i) => {
    const row: Record<string, string | number> = { stage };
    for (const s of series) {
      const n = s.counts[i] ?? 0;
      row[s.key] = scale === "share" ? Number(((n / (s.total || 1)) * 100).toFixed(1)) : n;
    }
    return row;
  });

  return (
    // Recharts lays its axes out physically, so the plot stays LTR and the
    // legislative sequence reads left to right, as charts do in Hebrew UIs.
    <div dir="ltr" className="h-80 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 8, right: 12, bottom: 56, left: -8 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
          <XAxis
            dataKey="stage"
            tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
            angle={-32}
            textAnchor="end"
            interval={0}
            height={56}
          />
          <YAxis
            tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
            // The first rung is 33x the last, so a linear axis flattens the
            // whole tail into the baseline. Log keeps the later stages legible;
            // the share view is linear because percentages already compress.
            scale={scale === "count" ? "log" : "linear"}
            domain={scale === "count" ? [1, "auto"] : [0, 100]}
            allowDataOverflow={false}
            tickFormatter={(v: number) => (scale === "share" ? `${v}%` : v.toLocaleString("he-IL"))}
          />
          <Tooltip
            contentStyle={{
              background: "var(--popover)",
              border: "1px solid var(--border)",
              borderRadius: "0.5rem",
              fontSize: "0.8125rem",
            }}
            labelStyle={{ color: "var(--foreground)" }}
            formatter={(value, name) => [
              scale === "share" ? `${value}%` : Number(value).toLocaleString("he-IL"),
              series.find((s) => s.key === name)?.label ?? String(name),
            ]}
          />
          <Legend
            verticalAlign="top"
            height={28}
            formatter={(value) => series.find((s) => s.key === value)?.label ?? value}
            wrapperStyle={{ fontSize: "0.75rem" }}
          />
          {series.map((s, i) => (
            <Line
              key={s.key}
              type="linear"
              dataKey={s.key}
              stroke={colourFor(s.key, i)}
              strokeWidth={2}
              dot={{ r: 3 }}
              activeDot={{ r: 5 }}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
