"use client";

import { useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { FunnelScale } from "@/lib/funnel";

export type FunnelSeries = {
  key: string;
  label: string;
  counts: number[];
  total: number;
  passed: number;
  /**
   * First rung this series applies to. Government bills join the ladder at the
   * first-reading tabling — not one of them has a furthest rung below it — so
   * the earlier rungs are left null and the line simply begins there rather
   * than being drawn flat at its own total.
   */
  startAt?: number;
};

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

/**
 * Our own legend, in place of Recharts'.
 *
 * Recharts' legend does take an `onClick`, but its items grey themselves out
 * only from an `inactive` flag on a payload it builds itself, and it renders
 * inside the `dir="ltr"` wrapper the plot needs. Faction names are Hebrew and
 * there are eight of them, so the row belongs in the page's own RTL flow.
 */
function ToggleLegend({
  series,
  colours,
  hidden,
  onToggle,
}: {
  series: FunnelSeries[];
  colours: Map<string, string>;
  hidden: ReadonlySet<string>;
  onToggle: (key: string) => void;
}) {
  return (
    <div data-testid="funnel-legend" className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
      {series.map((s) => {
        const off = hidden.has(s.key);
        return (
          <button
            key={s.key}
            type="button"
            onClick={() => onToggle(s.key)}
            aria-pressed={!off}
            className={`flex items-center gap-1.5 text-xs transition-opacity hover:opacity-100 ${off ? "opacity-40" : ""}`}
          >
            <span
              aria-hidden
              className="size-2.5 shrink-0 rounded-full"
              style={{ background: off ? "var(--muted-foreground)" : colours.get(s.key) }}
            />
            <span className={off ? "line-through" : ""}>{s.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * Tick values spread evenly along a square-root axis.
 *
 * d3 spaces ticks evenly in *value*, which on this axis bunches them at the top
 * where nothing happens: a 0–3,727 bloc range produced 0, 1,000, 2,000, 3,000
 * and left the lower half — where 283 against 613 is the whole point —
 * unlabelled. Placing them at even fractions of the axis and snapping to round
 * numbers gives a denser scale exactly where the lines are.
 */
function sqrtTicks(max: number, count = 7): number[] {
  if (!Number.isFinite(max) || max <= 0) return [0];
  // A fine ladder: rounding 3,727 up to 5,000 on a coarse one wasted a third of
  // the axis and put the top label above any data point.
  const LADDER = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
  const snap = (v: number, mode: "near" | "up") => {
    const mag = 10 ** Math.floor(Math.log10(v));
    const scaled = v / mag;
    const step =
      mode === "up"
        ? (LADDER.find((m) => scaled <= m) ?? 10)
        : LADDER.reduce((best, m) => (Math.abs(m - scaled) < Math.abs(best - scaled) ? m : best), LADDER[0]);
    return step * mag;
  };
  const top = snap(max, "up");
  const out = new Set([0, top]);
  // Even fractions of the *axis* — squared, because the axis is a square root —
  // so the labels crowd the lower range where the lines actually sit.
  for (let i = 1; i < count; i++) out.add(snap(top * (i / count) ** 2, "near"));
  return [...out].filter((v) => v > 0 || v === 0).sort((a, b) => a - b);
}

/** Evenly spaced round ticks, for a range that does not need rescaling. */
function linearTicks(max: number, count = 6): number[] {
  if (!Number.isFinite(max) || max <= 0) return [0];
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find((m) => raw <= m * mag) ?? 10) * mag;
  const out: number[] = [];
  for (let v = 0; v <= max + step; v += step) out.push(v);
  return out;
}

export function BillFunnel({
  stages,
  series,
  scale,
  /**
   * Force a linear count axis. Square root exists to rescue a 33x drop from
   * baseline to tail; where the whole range is 638 down to 205 it distorts a
   * chart that has nothing wrong with it.
   */
  linearCounts = false,
}: {
  stages: string[];
  series: FunnelSeries[];
  scale: FunnelScale;
  linearCounts?: boolean;
}) {
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set());

  // Colours come from the position in the full list, so hiding one faction does
  // not recolour the rest.
  const colours = new Map(series.map((s, i) => [s.key, colourFor(s.key, i)]));

  const shown = series.filter((s) => !hidden.has(s.key));
  const visible = shown.length > 0 ? shown : series;

  // One row per stage, one key per series — the shape Recharts wants. Hidden
  // series are left out of the data rather than given `hide` on their line:
  // Recharts still lists a hidden line in the tooltip, and the y axis should
  // rescale to what is actually drawn.
  const rows = stages.map((stage, i) => {
    const row: Record<string, string | number | null> = { stage };
    for (const s of visible) {
      if (i < (s.startAt ?? 0)) {
        row[s.key] = null;
        continue;
      }
      const n = s.counts[i] ?? 0;
      const base = s.counts[s.startAt ?? 0] || 1;
      row[s.key] = scale === "share" ? Number(((n / base) * 100).toFixed(1)) : n;
    }
    return row;
  });

  const max = Math.max(1, ...visible.flatMap((s) => s.counts));
  const useSqrt = scale === "count" && !linearCounts;
  const ticks =
    scale === "share"
      ? [0, 20, 40, 60, 80, 100]
      : useSqrt
        ? sqrtTicks(max)
        : linearTicks(max);

  return (
    <div>
      <ToggleLegend
        series={series}
        colours={colours}
        hidden={hidden}
        onToggle={(key) =>
          setHidden((prev) => {
            const next = new Set(prev);
            if (!next.delete(key)) next.add(key);
            // Hiding every series is the one move we refuse — an empty plot
            // reads as a broken chart.
            return next.size === series.length ? prev : next;
          })
        }
      />
      {/* Recharts lays its axes out physically, so the plot stays LTR and the
          legislative sequence reads left to right, as charts do in Hebrew UIs. */}
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
              // Square root, not log. The first rung is 33x the last, so a
              // linear axis flattens the tail onto the baseline — but log
              // overcorrects: it puts 30 at 38% of the height, mid-graph, and
              // squeezes 300 and 600 to within 8 points of each other despite one
              // being double the other. Sqrt puts 30 at 7% and keeps that same
              // separation, spreading the whole lower range instead of the top.
              //
              // It also plots zero, which log cannot. רע"ם reaches the last two
              // rungs 0 times, and on a log axis that dropped the series and left
              // the entire party view blank.
              scale={useSqrt ? "sqrt" : "linear"}
              domain={scale === "count" ? [0, ticks[ticks.length - 1]] : [0, 100]}
              ticks={ticks}
              // Without this Recharts thins the labels on its own and drops
              // exactly the low ones this axis exists to show.
              interval={0}
              width={52}
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
              // Descending by value. The default is `name`, which alphabetises
              // eight faction names identically at every point on the chart and
              // so says nothing about the point you are hovering. Sorting ascending
              // on the negated value puts the largest first; a rung a series never
              // reached carries no value and sorts to the end.
              itemSorter={(item) => {
                const v = Number(item.value);
                return Number.isFinite(v) ? -v : Number.POSITIVE_INFINITY;
              }}
              formatter={(value, name) => [
                scale === "share" ? `${value}%` : Number(value).toLocaleString("he-IL"),
                series.find((s) => s.key === name)?.label ?? String(name),
              ]}
            />
            {visible.map((s) => (
              <Line
                key={s.key}
                type="linear"
                dataKey={s.key}
                stroke={colours.get(s.key)}
                strokeWidth={2}
                dot={{ r: 3 }}
                activeDot={{ r: 5 }}
                connectNulls={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
