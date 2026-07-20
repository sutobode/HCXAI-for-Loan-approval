"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import ReactECharts from "echarts-for-react";
import { useTheme } from "next-themes";
import { CheckCircle2, AlertTriangle, GitCompareArrows } from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { getOverrideAnalysis } from "@/lib/endpoints";

export default function OverrideAnalysisPage() {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const textColor = isDark ? "#e5e5e5" : "#27272a";

  const [userId, setUserId] = useState("");
  const [queryUserId, setQueryUserId] = useState<string | undefined>(undefined);

  const { data, isLoading } = useQuery({
    queryKey: ["override-analysis", queryUserId],
    queryFn: () => getOverrideAnalysis(queryUserId),
  });

  const buckets = data?.by_confidence.buckets ?? [];
  const option = {
    grid: { left: 60, right: 20, top: 20, bottom: 40 },
    tooltip: { trigger: "axis" },
    xAxis: {
      type: "category",
      data: buckets.map((b) => b.confidence_range),
      axisLabel: { color: textColor },
      name: "AI confidence at prediction time",
      nameLocation: "middle",
      nameGap: 30,
      nameTextStyle: { color: textColor },
    },
    yAxis: {
      type: "value",
      max: 1,
      axisLabel: { color: textColor, formatter: (v: number) => `${Math.round(v * 100)}%` },
      splitLine: { lineStyle: { color: isDark ? "#333" : "#eee" } },
      name: "Human disagreement rate",
      nameTextStyle: { color: textColor },
    },
    series: [
      {
        type: "bar",
        data: buckets.map((b) => b.disagreement_rate),
        itemStyle: { color: "#f59e0b", borderRadius: [6, 6, 0, 0] },
        barWidth: "50%",
        label: {
          show: true,
          position: "top",
          color: textColor,
          formatter: (p: { value: number | null }) => (p.value !== null ? `${Math.round(p.value * 100)}%` : "—"),
        },
      },
    ],
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Human Override Analysis"
        description="Disagreement rate bucketed by the AI's confidence at prediction time — a well-calibrated pattern shows fewer disagreements as confidence increases."
      />

      <Card>
        <CardContent className="flex items-end gap-3 p-4">
          <div className="flex-1">
            <Label htmlFor="scope-user" className="mb-1.5">
              Filter by user (leave blank for platform-wide)
            </Label>
            <Input
              id="scope-user"
              placeholder="user@company.com"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
            />
          </div>
          <Button onClick={() => setQueryUserId(userId || undefined)}>Apply</Button>
        </CardContent>
      </Card>

      {isLoading ? (
        <Skeleton className="h-80" />
      ) : data ? (
        <>
          {data.by_confidence.well_calibrated_pattern !== null && (
            <Alert variant={data.by_confidence.well_calibrated_pattern ? "default" : "destructive"}>
              {data.by_confidence.well_calibrated_pattern ? (
                <CheckCircle2 className="size-4" />
              ) : (
                <AlertTriangle className="size-4" />
              )}
              <AlertTitle>
                {data.by_confidence.well_calibrated_pattern
                  ? "Well-calibrated override pattern"
                  : "Miscalibrated override pattern"}
              </AlertTitle>
              <AlertDescription>
                {data.by_confidence.well_calibrated_pattern
                  ? "Disagreement rate decreases (or stays flat) as AI confidence increases, as expected."
                  : "Disagreement rate does not consistently decrease with AI confidence — this may indicate miscalibrated trust."}
              </AlertDescription>
            </Alert>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Disagreement rate by confidence bucket</CardTitle>
              <CardDescription>Scope: {data.by_confidence.scope}</CardDescription>
            </CardHeader>
            <CardContent>
              <ReactECharts option={option} style={{ height: 320 }} opts={{ renderer: "svg" }} />
            </CardContent>
          </Card>

          {data.direction && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <GitCompareArrows className="size-4 text-primary" />
                  Override direction (risk tolerance)
                </CardTitle>
                <CardDescription>
                  {data.direction.total_overrides} total overrides for this scope
                </CardDescription>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                <div>
                  <p className="text-xs text-muted-foreground">Reject → Approve (lenient)</p>
                  <p className="font-heading text-xl font-semibold">{data.direction.reject_to_approve_count}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Approve → Reject (conservative)</p>
                  <p className="font-heading text-xl font-semibold">{data.direction.approve_to_reject_count}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Risk tolerance score</p>
                  <p className="font-heading text-xl font-semibold">
                    {data.direction.risk_tolerance !== null ? data.direction.risk_tolerance.toFixed(2) : "—"}
                  </p>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      ) : null}
    </div>
  );
}
