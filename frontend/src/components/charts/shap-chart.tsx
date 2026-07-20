"use client";

import ReactECharts from "echarts-for-react";
import { useTheme } from "next-themes";
import type { FeatureContribution } from "@/lib/types";

interface ShapChartProps {
  contributions: FeatureContribution[];
  height?: number;
}

export function ShapChart({ contributions, height = 340 }: ShapChartProps) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const textColor = isDark ? "#e5e5e5" : "#27272a";

  const sorted = [...contributions].sort(
    (a, b) => Math.abs(a.shap_contribution) - Math.abs(b.shap_contribution)
  );

  const option = {
    grid: { left: 160, right: 30, top: 10, bottom: 20 },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
      formatter: (params: unknown) => {
        const p = (params as { name: string; value: number }[])[0];
        return `<b>${p.name}</b><br/>SHAP contribution: ${p.value.toFixed(3)}`;
      },
    },
    xAxis: {
      type: "value",
      axisLabel: { color: textColor },
      splitLine: { lineStyle: { color: isDark ? "#333" : "#eee" } },
    },
    yAxis: {
      type: "category",
      data: sorted.map((c) => c.display_name),
      axisLabel: { color: textColor, fontSize: 12 },
      axisLine: { show: false },
      axisTick: { show: false },
    },
    series: [
      {
        type: "bar",
        data: sorted.map((c) => ({
          value: c.shap_contribution,
          itemStyle: {
            color: c.shap_contribution >= 0 ? "#22c55e" : "#ef4444",
            borderRadius: c.shap_contribution >= 0 ? [0, 4, 4, 0] : [4, 0, 0, 4],
          },
        })),
        barWidth: "60%",
      },
    ],
  };

  return <ReactECharts option={option} style={{ height }} opts={{ renderer: "svg" }} />;
}
