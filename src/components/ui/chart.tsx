import * as React from "react";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  ComposedChart,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  RadarChart,
  Radar,
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  ZAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { cn } from "./button";

const formatters = {
  shortCurrency: (value: number) =>
    value.toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }),
  currency: (value: number) =>
    value.toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }),
  percentage: (value: number) =>
    value.toLocaleString("en-US", {
      style: "percent",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }),
  number: (value: number) => value.toLocaleString("en-US"),
  shortNumber: (value: number) =>
    value.toLocaleString("en-US", {
      maximumFractionDigits: 0,
    }),
};

const Chart = ({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => {
  return (
    <div className={cn("relative flex w-full h-[350px] items-center justify-center", className)}>
      <ResponsiveContainer width="100%" height="100%">
        {children as any}
      </ResponsiveContainer>
    </div>
  );
};

const ChartTooltip = ({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: number | string;
}) => {
  return (
    <div
      className={cn(
        "bg-popover text-popover-foreground rounded-lg shadow-sm border p-3",
        !active && "hidden"
      )}
    >
      <p className="text-xs text-muted-foreground">{label}</p>
      {payload && payload.length > 0 && (
        <div className="mt-2 space-y-1">
          {payload.map((entry, index) => (
            <div key={index} className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: entry.color }} />
                <span className="text-muted-foreground">{entry.name}</span>
              </div>
              <span className="font-medium">{entry.value.toLocaleString()}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export {
  Chart,
  ChartTooltip,
  AreaChart,
  Area,
  BarChart,
  Bar,
  ComposedChart,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  RadarChart,
  Radar,
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  ZAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
};

export { formatters };
