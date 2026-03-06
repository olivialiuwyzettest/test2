"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type ReitAction = "buy_now" | "scale_in" | "wait_for_confirmation" | "avoid";

type ReitSignalPoint = {
  ticker: string;
  action: ReitAction;
  score: number;
  conviction: number;
  timingScore: number;
  dd52wPct: number;
  dividendYieldPct: number | null;
};

type ActionBucket = {
  key: ReitAction;
  label: string;
  color: string;
};

const ACTION_BUCKETS: ActionBucket[] = [
  { key: "buy_now", label: "Buy Now", color: "#16a34a" },
  { key: "scale_in", label: "Scale In", color: "#0284c7" },
  { key: "wait_for_confirmation", label: "Wait", color: "#64748b" },
  { key: "avoid", label: "Avoid", color: "#dc2626" },
];

function formatYield(value: number | null): string {
  if (value === null) return "n/a";
  return `${value.toFixed(2)}%`;
}

export function ReitSignalCharts({ points }: { points: ReitSignalPoint[] }) {
  const scatterByAction = ACTION_BUCKETS.map((bucket) => ({
    ...bucket,
    values: points.filter((item) => item.action === bucket.key),
  }));

  const distribution = ACTION_BUCKETS.map((bucket) => {
    const values = points.filter((item) => item.action === bucket.key);
    const yieldValues = values
      .map((item) => item.dividendYieldPct)
      .filter((value): value is number => value !== null);

    const avgYield =
      yieldValues.length > 0
        ? yieldValues.reduce((sum, value) => sum + value, 0) / yieldValues.length
        : null;

    return {
      action: bucket.label,
      count: values.length,
      avgYieldPct: avgYield,
      color: bucket.color,
    };
  });

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="h-72 rounded-md border p-2">
        <div className="px-2 pb-2 text-xs font-medium text-muted-foreground">
          Trigger map: conviction vs timing score
        </div>
        <ResponsiveContainer width="100%" height="92%">
          <ScatterChart margin={{ top: 8, right: 18, bottom: 10, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <ReferenceLine x={70} stroke="#94a3b8" strokeDasharray="4 4" />
            <ReferenceLine y={60} stroke="#94a3b8" strokeDasharray="4 4" />
            <XAxis
              type="number"
              dataKey="conviction"
              name="Conviction"
              domain={[0, 100]}
              tick={{ fontSize: 11 }}
            />
            <YAxis
              type="number"
              dataKey="timingScore"
              name="Timing Score"
              domain={[0, 100]}
              tick={{ fontSize: 11 }}
            />
            <Tooltip
              cursor={{ strokeDasharray: "4 4" }}
              content={({ active, payload }) => {
                if (!active || !payload || !payload.length) return null;
                const row = payload[0]?.payload as ReitSignalPoint | undefined;
                if (!row) return null;
                return (
                  <div className="rounded-md border bg-background p-2 text-xs shadow-sm">
                    <div className="font-semibold">{row.ticker}</div>
                    <div>Conviction: {row.conviction.toFixed(1)}</div>
                    <div>Timing: {row.timingScore.toFixed(1)}</div>
                    <div>Score: {row.score.toFixed(1)}</div>
                    <div>52W DD: {row.dd52wPct.toFixed(2)}%</div>
                    <div>Yield: {formatYield(row.dividendYieldPct)}</div>
                  </div>
                );
              }}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {scatterByAction.map((series) => (
              <Scatter key={series.key} name={series.label} data={series.values} fill={series.color} />
            ))}
          </ScatterChart>
        </ResponsiveContainer>
      </div>

      <div className="h-72 rounded-md border p-2">
        <div className="px-2 pb-2 text-xs font-medium text-muted-foreground">
          Action distribution and average dividend yield
        </div>
        <ResponsiveContainer width="100%" height="92%">
          <BarChart data={distribution} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="action" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
            <Tooltip
              formatter={(value, key) => {
                if (key === "count") return [value, "REIT Count"];
                return [value, key];
              }}
              labelFormatter={(label, payload) => {
                const row = payload[0]?.payload as
                  | { action: string; avgYieldPct: number | null }
                  | undefined;
                const avgYield = row ? formatYield(row.avgYieldPct) : "n/a";
                return `${label} | Avg Yield: ${avgYield}`;
              }}
            />
            <Bar dataKey="count" name="REIT Count">
              {distribution.map((row) => (
                <Cell key={row.action} fill={row.color} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
