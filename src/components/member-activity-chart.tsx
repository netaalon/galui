"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export type ActivityPoint = { month: string; total: number; lead: number };

/**
 * The chart plots one or two stacked series. Members split their bills into
 * lead and co-signed; committees have a single series of sittings, so the
 * labels have to be supplied rather than hardcoded.
 */
export type ActivityLabels = { lead: string; rest: string };

const MEMBER_LABELS: ActivityLabels = { lead: "יוזם/ת ראשי/ת", rest: "חתום/ה" };

/** "2025-08" → "אוג׳ 25" */
function labelFor(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Intl.DateTimeFormat("he-IL", { month: "short", year: "2-digit", timeZone: "UTC" })
    .format(new Date(Date.UTC(y, m - 1, 1)));
}

export function MemberActivityChart({
  data,
  labels = MEMBER_LABELS,
  /** Committees have one series of sittings; rendering the empty second one
   *  puts a stray ": 0" in every tooltip. */
  singleSeries = false,
}: {
  data: ActivityPoint[];
  labels?: ActivityLabels;
  singleSeries?: boolean;
}) {
  const rows = data.map((d) => ({ ...d, label: labelFor(d.month), cosponsored: d.total - d.lead }));

  return (
    // Recharts positions its axes physically; keeping the plot LTR keeps time
    // flowing left-to-right, which is the convention for charts in Hebrew UIs.
    <div dir="ltr" className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            // Recharts writes `fill` as an SVG attribute, which overrides a
            // Tailwind class — the token has to go through the tick prop or the
            // labels stay a hardcoded grey that is unreadable in dark mode.
            tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
            interval="preserveStartEnd"
            minTickGap={16}
          />
          <YAxis
            allowDecimals={false}
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
          />
          <Tooltip
            cursor={{ className: "fill-muted/50" }}
            contentStyle={{
              direction: "rtl",
              borderRadius: "0.5rem",
              border: "1px solid var(--border)",
              background: "var(--popover)",
              color: "var(--popover-foreground)",
              fontSize: "0.8125rem",
            }}
            labelStyle={{ fontWeight: 600, marginBottom: "0.25rem" }}
            formatter={(value, name) => [
              String(value ?? 0),
              name === "lead" ? labels.lead : labels.rest,
            ]}
          />
          {singleSeries ? (
            <Bar dataKey="total" name="total" fill="var(--chart-1)" radius={[4, 4, 0, 0]} />
          ) : (
            <>
              <Bar dataKey="lead" stackId="a" fill="var(--chart-1)" radius={[0, 0, 4, 4]} />
              <Bar dataKey="cosponsored" stackId="a" fill="var(--chart-2)" radius={[4, 4, 0, 0]} />
            </>
          )}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
