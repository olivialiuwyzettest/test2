"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { HistoryDay } from "@/lib/schema";

function tickLabel(date: string) {
  const [y, m, d] = date.split("-");
  if (!y || !m || !d) return date;
  return `${m}/${d}`;
}

export function SentimentLineChart({ days }: { days: HistoryDay[] }) {
  const data = days.map((d) => ({
    date: d.date,
    sentimentIndex: d.sentimentIndex,
    mentions: d.mentions,
  }));

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 10, right: 16, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="pulseLine" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="hsl(var(--chart-4))" />
              <stop offset="50%" stopColor="hsl(var(--primary))" />
              <stop offset="100%" stopColor="hsl(var(--chart-2))" />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="4 6" opacity={0.35} />
          <XAxis
            dataKey="date"
            tickFormatter={tickLabel}
            tick={{ fontSize: 12 }}
            interval="preserveStartEnd"
            minTickGap={18}
          />
          <YAxis domain={[0, 100]} tick={{ fontSize: 12 }} width={32} />
          <Tooltip
            contentStyle={{
              background: "hsl(var(--popover))",
              borderColor: "hsl(var(--border))",
              borderRadius: 12,
            }}
            labelFormatter={(v) => `Date: ${v}`}
            formatter={(value: unknown, key: string) => {
              if (key === "sentimentIndex") return [`${value}`, "Sentiment"];
              if (key === "mentions") return [`${value}`, "Mentions"];
              return [String(value), key];
            }}
          />
          <Line
            type="monotone"
            dataKey="sentimentIndex"
            stroke="url(#pulseLine)"
            strokeWidth={2.5}
            dot={false}
            activeDot={{ r: 4 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

