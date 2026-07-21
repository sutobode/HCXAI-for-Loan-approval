"use client";

import { useQuery } from "@tanstack/react-query";
import { ShieldHalf, CheckCircle2, AlertTriangle, Gavel } from "lucide-react";
import ReactECharts from "echarts-for-react";
import { useTheme } from "next-themes";

import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { getFairnessReport } from "@/lib/endpoints";
import type { FairnessGroupResult } from "@/lib/types";

function GroupBarChart({ result }: { result: FairnessGroupResult }) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const textColor = isDark ? "#e5e5e5" : "#27272a";
  const groups = Object.keys(result.approval_rate_by_group);

  const option = {
    grid: { left: 60, right: 20, top: 20, bottom: 30 },
    tooltip: { trigger: "axis" },
    xAxis: {
      type: "category",
      data: groups,
      axisLabel: { color: textColor },
    },
    yAxis: {
      type: "value",
      max: 1,
      axisLabel: { color: textColor, formatter: (v: number) => `${Math.round(v * 100)}%` },
      splitLine: { lineStyle: { color: isDark ? "#333" : "#eee" } },
    },
    series: [
      {
        type: "bar",
        data: groups.map((g) => result.approval_rate_by_group[g]),
        itemStyle: { color: "#6366f1", borderRadius: [6, 6, 0, 0] },
        barWidth: "40%",
        markLine: {
          silent: true,
          symbol: "none",
          lineStyle: { color: "#ef4444", type: "dashed" },
          label: { formatter: "Four-Fifths Rule", color: textColor },
          data: [{ yAxis: (Math.max(...groups.map((g) => result.approval_rate_by_group[g])) * 0.8) }],
        },
      },
    ],
  };

  return <ReactECharts option={option} style={{ height: 260 }} opts={{ renderer: "svg" }} />;
}

export default function FairnessPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["fairness-report"],
    queryFn: getFairnessReport,
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Trung tâm Công bằng & AI Có trách nhiệm"
        description="Kiểm tra tính công bằng nhân khẩu học và mức độ tuân thủ Four-Fifths Rule (80%) trên các thuộc tính nhạy cảm."
      />

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
        </div>
      ) : data ? (
        <>
          <Alert variant={data.compliance_summary.overall_compliant ? "default" : "destructive"}>
            {data.compliance_summary.overall_compliant ? (
              <CheckCircle2 className="size-4" />
            ) : (
              <AlertTriangle className="size-4" />
            )}
            <AlertTitle>
              {data.compliance_summary.overall_compliant
                ? "Mô hình đạt các kiểm tra công bằng"
                : "Phát hiện vi phạm về công bằng"}
            </AlertTitle>
            <AlertDescription>
              {data.compliance_summary.overall_compliant
                ? `Toàn bộ ${data.compliance_summary.attributes_checked.length} thuộc tính được kiểm tra đều thỏa Four-Fifths Rule.`
                : `Phát hiện vi phạm ở: ${data.compliance_summary.violations.join(", ")}`}
            </AlertDescription>
          </Alert>

          <div className="grid gap-4 sm:grid-cols-3">
            <Card>
              <CardContent className="p-5">
                <p className="text-sm text-muted-foreground">Số mẫu phân tích</p>
                <p className="mt-1 font-heading text-2xl font-semibold">{data.n_samples.toLocaleString()}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <p className="text-sm text-muted-foreground">Tỷ lệ duyệt theo dự đoán</p>
                <p className="mt-1 font-heading text-2xl font-semibold">
                  {Math.round(data.overall_approval_rate_predicted * 100)}%
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <p className="text-sm text-muted-foreground">Tỷ lệ duyệt thực tế</p>
                <p className="mt-1 font-heading text-2xl font-semibold">
                  {Math.round(data.overall_approval_rate_actual * 100)}%
                </p>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            {Object.entries(data.by_attribute).map(([attribute, result]) => (
              <Card key={attribute}>
                <CardHeader>
                  <CardTitle className="flex items-center justify-between capitalize">
                    <span className="flex items-center gap-2">
                      <ShieldHalf className="size-4 text-primary" />
                      {attribute.replace("_", " ")}
                    </span>
                    <Badge variant={result.passes_four_fifths_rule ? "default" : "destructive"}>
                      {result.passes_four_fifths_rule ? "Đạt Four-Fifths Rule" : "Không đạt Four-Fifths Rule"}
                    </Badge>
                  </CardTitle>
                  <CardDescription>
                    Parity Ratio: {result.parity_ratio !== null ? result.parity_ratio.toFixed(3) : "—"}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <GroupBarChart result={result} />
                </CardContent>
              </Card>
            ))}
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Gavel className="size-4 text-primary" />
                Khuyến nghị giảm thiểu thiên lệch
              </CardTitle>
              <CardDescription>
                Chỉ là gợi ý điều chỉnh ngưỡng — không có thay đổi nào được áp dụng tự động.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {data.mitigation_recommendations.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Không cần giảm thiểu — tất cả thuộc tính được kiểm tra hiện đều đạt Four-Fifths Rule.
                </p>
              ) : (
                <div className="space-y-3">
                  {data.mitigation_recommendations.map((rec) => (
                    <div key={rec.attribute} className="rounded-lg border p-4">
                      <div className="mb-2 flex items-center justify-between">
                        <p className="font-medium capitalize">{rec.attribute.replace("_", " ")}</p>
                        <Badge variant="outline">
                          Chênh lệch {Math.round(rec.approval_rate_gap * 100)} điểm %
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">{rec.recommendation}</p>
                      {rec.requires_human_approval && (
                        <Badge variant="secondary" className="mt-2">
                          Cần phê duyệt của cán bộ tuân thủ
                        </Badge>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}
