"use client";

import { useQuery } from "@tanstack/react-query";
import ReactECharts from "echarts-for-react";
import { useTheme } from "next-themes";
import { Layers } from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getGlobalExplainability } from "@/lib/endpoints";

export default function GlobalExplainabilityPage() {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const textColor = isDark ? "#e5e5e5" : "#27272a";

  const { data, isLoading } = useQuery({
    queryKey: ["global-explainability"],
    queryFn: getGlobalExplainability,
  });

  const features = data?.feature_importance ?? [];
  const option = {
    grid: { left: 160, right: 40, top: 10, bottom: 10 },
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
    xAxis: {
      type: "value",
      axisLabel: { color: textColor, formatter: (v: number) => `${v}%` },
      splitLine: { lineStyle: { color: isDark ? "#333" : "#eee" } },
    },
    yAxis: {
      type: "category",
      data: features.map((f) => f.display_name).reverse(),
      axisLabel: { color: textColor },
    },
    series: [
      {
        type: "bar",
        data: features
          .map((f) => ({
            value: f.relative_importance_pct,
            itemStyle: {
              color: f.overall_direction === "increases_approval" ? "#10b981" : "#ef4444",
              borderRadius: [0, 4, 4, 0],
            },
          }))
          .reverse(),
        barWidth: "60%",
        label: {
          show: true,
          position: "right",
          color: textColor,
          formatter: (p: { value: number }) => `${p.value}%`,
        },
      },
    ],
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Global Explainability"
        description="Aggregate SHAP feature importance across the dataset — how the model behaves overall, not just for one applicant."
      />

      {isLoading ? (
        <Skeleton className="h-96" />
      ) : data ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <Card>
              <CardContent className="p-5">
                <p className="text-sm text-muted-foreground">Sample size</p>
                <p className="mt-1 font-heading text-2xl font-semibold">
                  {data.sample_size.toLocaleString()} applications
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <p className="text-sm text-muted-foreground">Model base value (log-odds)</p>
                <p className="mt-1 font-heading text-2xl font-semibold">{data.base_value.toFixed(3)}</p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Layers className="size-4 text-primary" />
                Feature importance ranking
              </CardTitle>
              <CardDescription>
                Mean absolute SHAP value per feature, as a share of total attribution. Green bars
                increase approval likelihood on average, red bars decrease it.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ReactECharts
                option={option}
                style={{ height: Math.max(320, features.length * 44) }}
                opts={{ renderer: "svg" }}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Detailed breakdown</CardTitle>
              <CardDescription>Mean and standard deviation of |SHAP| per feature.</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Feature</TableHead>
                    <TableHead>Relative importance</TableHead>
                    <TableHead>Mean |SHAP|</TableHead>
                    <TableHead>Std |SHAP|</TableHead>
                    <TableHead>Overall direction</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {features.map((f) => (
                    <TableRow key={f.feature}>
                      <TableCell className="font-medium">{f.display_name}</TableCell>
                      <TableCell>{f.relative_importance_pct}%</TableCell>
                      <TableCell className="font-mono text-sm">{f.mean_abs_shap.toFixed(4)}</TableCell>
                      <TableCell className="font-mono text-sm">{f.std_abs_shap.toFixed(4)}</TableCell>
                      <TableCell>
                        <Badge variant={f.overall_direction === "increases_approval" ? "default" : "destructive"}>
                          {f.overall_direction === "increases_approval" ? "Increases approval" : "Decreases approval"}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}
