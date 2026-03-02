"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type ReitSignal = "strong_buy" | "buy_dip" | "watch" | "hold_back";

type ReitSignalPoint = {
  ticker: string;
  signal: ReitSignal;
  score: number;
  dd52wPct: number;
  dividendYieldPct: number | null;
};

type SignalBucket = {
  key: ReitSignal;
  label: string;
  color: string;
};

const SIGNAL_BUCKETS: SignalBucket[] = [
  { key: "strong_buy", label: "Strong Buy", color: "#16a34a" },
  { key: "buy_dip", label: "Weak Buy", color: "#0ea5e9" },
  { key: "watch", label: "Watch", color: "#64748b" },
  { key: "hold_back", label: "Hold Back", color: "#dc2626" },
];

function formatYield(value: number | null): string {
  if (value === null) return "n/a";
  return `${value.toFixed(2)}%`;
}

export function ReitSignalCharts({ points }: { points: ReitSignalPoint[] }) {
  const scatterBySignal = SIGNAL_BUCKETS.map((bucket) => ({
    ...bucket,
    values: points.filter((item) => item.signal === bucket.key),
  }));

  const distribution = SIGNAL_BUCKETS.map((bucket) => {
    const values = points.filter((item) => item.signal === bucket.key);
    const yieldValues = values
      .map((item) => item.dividendYieldPct)
      .filter((value): value is number => value !== null);

    const avgYield =
      yieldValues.length > 0
        ? yieldValues.reduce((sum, value) => sum + value, 0) / yieldValues.length
        : null;

    return {
      signal: bucket.label,
      count: values.length,
      avgYieldPct: avgYield,
      color: bucket.color,
    };
  });

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="h-72 rounded-md border p-2">
        <div className="px-2 pb-2 text-xs font-medium text-muted-foreground">
          Signal Map: score vs 52W drawdown
        </div>
        <ResponsiveContainer width="100%" height="92%">
          <ScatterChart margin={{ top: 8, right: 18, bottom: 10, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis
              type="number"
              dataKey="score"
              name="Score"
              domain={[0, 100]}
              tick={{ fontSize: 11 }}
            />
            <YAxis
              type="number"
              dataKey="dd52wPct"
              name="52W Drawdown"
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
                    <div>Score: {row.score.toFixed(2)}</div>
                    <div>52W DD: {row.dd52wPct.toFixed(2)}%</div>
                    <div>Yield: {formatYield(row.dividendYieldPct)}</div>
                  </div>
                );
              }}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {scatterBySignal.map((series) => (
              <Scatter
                key={series.key}
                name={series.label}
                data={series.values}
                fill={series.color}
              />
            ))}
          </ScatterChart>
        </ResponsiveContainer>
      </div>

      <div className="h-72 rounded-md border p-2">
        <div className="px-2 pb-2 text-xs font-medium text-muted-foreground">
          Signal distribution and average dividend yield
        </div>
        <ResponsiveContainer width="100%" height="92%">
          <BarChart data={distribution} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="signal" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
            <Tooltip
              formatter={(value, key, payload) => {
                if (key === "count") return [value, "REIT Count"];
                return [value, key];
              }}
              labelFormatter={(label, payload) => {
                const row = payload[0]?.payload as
                  | { signal: string; avgYieldPct: number | null }
                  | undefined;
                const avgYield = row ? formatYield(row.avgYieldPct) : "n/a";
                return `${label} | Avg Yield: ${avgYield}`;
              }}
            />
            <Bar dataKey="count" name="REIT Count">
              {distribution.map((row) => (
                <Cell key={row.signal} fill={row.color} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
