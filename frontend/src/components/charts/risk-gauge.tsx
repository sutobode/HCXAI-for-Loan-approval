"use client";

import ReactECharts from "echarts-for-react";

interface RiskGaugeProps {
  /** 0-1 risk score (higher = riskier) */
  riskScore: number;
  height?: number;
}

export function RiskGauge({ riskScore, height = 220 }: RiskGaugeProps) {
  const value = Math.round(riskScore * 100);

  const option = {
    series: [
      {
        type: "gauge",
        startAngle: 200,
        endAngle: -20,
        min: 0,
        max: 100,
        splitNumber: 5,
        itemStyle: { color: "auto" },
        progress: { show: true, width: 14 },
        pointer: { show: false },
        axisLine: {
          lineStyle: {
            width: 14,
            color: [
              [0.3, "#22c55e"],
              [0.7, "#f59e0b"],
              [1, "#ef4444"],
            ],
          },
        },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: { show: false },
        anchor: { show: false },
        title: { show: false },
        detail: {
          valueAnimation: true,
          fontSize: 30,
          fontWeight: 600,
          offsetCenter: [0, "10%"],
          formatter: "{value}%",
          color: "inherit",
        },
        data: [{ value }],
      },
    ],
  };

  return (
    <ReactECharts
      option={option}
      style={{ height }}
      opts={{ renderer: "svg" }}
      className="[&_div]:!text-foreground"
    />
  );
}
