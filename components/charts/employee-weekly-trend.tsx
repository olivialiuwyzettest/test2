"use client";

import {
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type TrendPoint = {
  weekStart: string;
  actualDays: number;
  requiredDaysAdjusted: number;
};

export function EmployeeWeeklyTrendChart({ data }: { data: TrendPoint[] }) {
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
          <XAxis
            dataKey="weekStart"
            tickFormatter={(value) => value.slice(5)}
            tick={{ fontSize: 11 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis domain={[0, 5]} tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
          <Tooltip labelFormatter={(label) => `Week of ${label}`} />
          <Line
            type="monotone"
            dataKey="actualDays"
            stroke="hsl(var(--primary))"
            strokeWidth={2.5}
            dot={{ r: 2 }}
          />
          <Line
            type="monotone"
            dataKey="requiredDaysAdjusted"
            stroke="hsl(var(--chart-2))"
            strokeDasharray="6 4"
            strokeWidth={2}
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
