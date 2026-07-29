import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { SalesTrendPoint } from "../../lib/sample-data";

type Props = {
  data: SalesTrendPoint[];
};

export function SalesTrendChartInner({ data }: Props) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="salesFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-florisyn-sage-500)" stopOpacity={0.35} />
            <stop offset="100%" stopColor="var(--color-florisyn-sage-500)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" className="stroke-florisyn-sage-100 dark:stroke-florisyn-sage-900" />
        <XAxis
          dataKey="label"
          tickLine={false}
          axisLine={false}
          tick={{ fill: "var(--color-florisyn-muted)", fontSize: 12 }}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          width={48}
          tick={{ fill: "var(--color-florisyn-muted)", fontSize: 12 }}
          tickFormatter={(v) => `$${v}`}
        />
        <Tooltip
          contentStyle={{
            borderRadius: "0.625rem",
            border: "1px solid var(--color-florisyn-sage-100)",
            background: "var(--color-florisyn-surface)",
          }}
          formatter={(value) => [
            `$${Number(value).toLocaleString()}`,
            "Sales",
          ]}
        />
        <Area
          type="monotone"
          dataKey="sales"
          stroke="var(--color-florisyn-sage-700)"
          strokeWidth={2}
          fill="url(#salesFill)"
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
