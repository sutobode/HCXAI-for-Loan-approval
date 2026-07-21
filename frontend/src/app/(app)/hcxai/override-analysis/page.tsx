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
      name: "Độ tin cậy của AI tại thời điểm dự đoán",
      nameLocation: "middle",
      nameGap: 30,
      nameTextStyle: { color: textColor },
    },
    yAxis: {
      type: "value",
      max: 1,
      axisLabel: { color: textColor, formatter: (v: number) => `${Math.round(v * 100)}%` },
      splitLine: { lineStyle: { color: isDark ? "#333" : "#eee" } },
      name: "Tỷ lệ không đồng ý của con người",
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
        title="Phân tích Ghi đè của Con người"
        description="Tỷ lệ không đồng ý được phân theo từng mức độ tin cậy của AI tại thời điểm dự đoán — một mô hình cân chỉnh tốt sẽ cho thấy tỷ lệ không đồng ý giảm khi độ tin cậy tăng."
      />

      <Card>
        <CardContent className="flex items-end gap-3 p-4">
          <div className="flex-1">
            <Label htmlFor="scope-user" className="mb-1.5">
              Lọc theo người dùng (để trống để xem toàn hệ thống)
            </Label>
            <Input
              id="scope-user"
              placeholder="user@company.com"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
            />
          </div>
          <Button onClick={() => setQueryUserId(userId || undefined)}>Áp dụng</Button>
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
                  ? "Xu hướng ghi đè cân chỉnh tốt"
                  : "Xu hướng ghi đè chưa cân chỉnh tốt"}
              </AlertTitle>
              <AlertDescription>
                {data.by_confidence.well_calibrated_pattern
                  ? "Tỷ lệ không đồng ý giảm (hoặc giữ nguyên) khi độ tin cậy của AI tăng, đúng như kỳ vọng."
                  : "Tỷ lệ không đồng ý không giảm ổn định theo độ tin cậy của AI — điều này có thể cho thấy mức độ tin tưởng chưa được cân chỉnh đúng."}
              </AlertDescription>
            </Alert>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Tỷ lệ không đồng ý theo mức độ tin cậy</CardTitle>
              <CardDescription>Phạm vi: {data.by_confidence.scope === "platform-wide" ? "toàn hệ thống" : data.by_confidence.scope}</CardDescription>
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
                  Xu hướng ghi đè (mức độ chấp nhận rủi ro)
                </CardTitle>
                <CardDescription>
                  {data.direction.total_overrides} lượt ghi đè trong phạm vi này
                </CardDescription>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                <div>
                  <p className="text-xs text-muted-foreground">Từ chối → Duyệt (dễ dãi)</p>
                  <p className="font-heading text-xl font-semibold">{data.direction.reject_to_approve_count}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Duyệt → Từ chối (thận trọng)</p>
                  <p className="font-heading text-xl font-semibold">{data.direction.approve_to_reject_count}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Điểm chấp nhận rủi ro</p>
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
