"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { SentimentDistribution } from "@/lib/schema";

export function DistributionBars(props: {
  today: SentimentDistribution;
  yesterday: SentimentDistribution | null;
}) {
  const data = [
    {
      day: "Today",
      positive: props.today.positive,
      neutral: props.today.neutral,
      negative: props.today.negative,
      unknown: props.today.unknown,
    },
    props.yesterday
      ? {
          day: "Yesterday",
          positive: props.yesterday.positive,
          neutral: props.yesterday.neutral,
          negative: props.yesterday.negative,
          unknown: props.yesterday.unknown,
        }
      : null,
  ].filter(Boolean) as Array<Record<string, string | number>>;

  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 10, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="4 6" opacity={0.35} />
          <XAxis dataKey="day" tick={{ fontSize: 12 }} />
          <YAxis tick={{ fontSize: 12 }} width={32} allowDecimals={false} />
          <Tooltip
            contentStyle={{
              background: "hsl(var(--popover))",
              borderColor: "hsl(var(--border))",
              borderRadius: 12,
            }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar
            dataKey="positive"
            stackId="a"
            fill="hsl(var(--chart-2))"
            radius={[6, 6, 0, 0]}
          />
          <Bar dataKey="neutral" stackId="a" fill="hsl(var(--muted-foreground))" />
          <Bar dataKey="negative" stackId="a" fill="hsl(var(--chart-5))" />
          <Bar dataKey="unknown" stackId="a" fill="hsl(var(--chart-4))" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

