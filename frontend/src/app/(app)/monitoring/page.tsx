"use client";

import { useQuery } from "@tanstack/react-query";
import { Activity, AlertTriangle, CheckCircle2, Cpu, TrendingUp } from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { GlossaryTerm } from "@/components/ui/glossary-term";
import { getMonitoringSnapshot } from "@/lib/endpoints";

export default function MonitoringPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["monitoring-snapshot"],
    queryFn: getMonitoringSnapshot,
  });

  const metrics = data?.training_metrics?.metrics;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Trung tâm Giám sát Mô hình"
        description="Hiệu suất tại thời điểm huấn luyện và phát hiện lệch dữ liệu trực tiếp (kiểm định Kolmogorov–Smirnov so với phân phối huấn luyện)."
      />

      {isLoading ? (
        <Skeleton className="h-64" />
      ) : data ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardContent className="p-5">
                <p className="text-sm text-muted-foreground">Loại mô hình</p>
                <p className="mt-1 font-heading text-xl font-semibold">
                  {data.training_metrics?.model_type ?? "—"}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <p className="text-sm text-muted-foreground">Accuracy</p>
                <p className="mt-1 font-heading text-xl font-semibold">
                  {metrics ? `${(metrics.accuracy * 100).toFixed(1)}%` : "—"}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <p className="text-sm text-muted-foreground"><GlossaryTerm term="AUC" /></p>
                <p className="mt-1 font-heading text-xl font-semibold">
                  {metrics ? metrics.auc.toFixed(3) : "—"}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <p className="text-sm text-muted-foreground">Số dự đoán đã xử lý</p>
                <p className="mt-1 font-heading text-xl font-semibold">{data.n_predictions_served}</p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Cpu className="size-4 text-primary" />
                Báo cáo <GlossaryTerm term="Feature Drift" />
              </CardTitle>
              <CardDescription>
                So sánh các hồ sơ được xử lý gần đây với phân phối dữ liệu huấn luyện.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {data.drift_report.status === "no_data" ? (
                <p className="text-sm text-muted-foreground">
                  Chưa có đủ dự đoán để tính toán độ lệch.
                </p>
              ) : (
                <>
                  <Alert
                    variant={data.drift_report.overall_drift_detected ? "destructive" : "default"}
                    className="mb-4"
                  >
                    {data.drift_report.overall_drift_detected ? (
                      <AlertTriangle className="size-4" />
                    ) : (
                      <CheckCircle2 className="size-4" />
                    )}
                    <AlertTitle>
                      {data.drift_report.overall_drift_detected ? (
                        <>Phát hiện <GlossaryTerm term="Feature Drift" /></>
                      ) : (
                        <>Không phát hiện <GlossaryTerm term="Feature Drift" /> đáng kể</>
                      )}
                    </AlertTitle>
                    <AlertDescription>
                      {data.drift_report.overall_drift_detected
                        ? `Các yếu tố bị lệch: ${data.drift_report.drifted_features?.join(", ")}`
                        : `Đã so sánh ${data.drift_report.n_recent} mẫu gần đây với ${data.drift_report.n_reference} mẫu huấn luyện.`}
                    </AlertDescription>
                  </Alert>

                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Yếu tố</TableHead>
                        <TableHead>Chỉ số KS</TableHead>
                        <TableHead>Giá trị p</TableHead>
                        <TableHead>Trạng thái</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {Object.entries(data.drift_report.features).map(([feature, res]) => (
                        <TableRow key={feature}>
                          <TableCell className="font-medium">{feature}</TableCell>
                          <TableCell>{res.ks_statistic.toFixed(3)}</TableCell>
                          <TableCell>{res.p_value.toFixed(4)}</TableCell>
                          <TableCell>
                            <Badge variant={res.drift_detected ? "destructive" : "default"}>
                              {res.drift_detected ? "Bị lệch" : "Ổn định"}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="size-4 text-primary" />
                <GlossaryTerm term="Prediction Drift" />
              </CardTitle>
              <CardDescription>
                Kiểm định Kolmogorov–Smirnov so sánh phân phối xác suất dự đoán gần đây với trước đó
                (độc lập với lệch dữ liệu đầu vào — đầu ra của mô hình có thể thay đổi dù đầu vào có vẻ ổn định).
              </CardDescription>
            </CardHeader>
            <CardContent>
              {data.prediction_drift.status === "insufficient_data" ? (
                <p className="text-sm text-muted-foreground">
                  Chưa đủ dữ liệu dự đoán ({data.prediction_drift.n_snapshots ?? 0} /{" "}
                  {data.prediction_drift.required ?? "—"} cần thiết).
                </p>
              ) : (
                <>
                  <Alert variant={data.prediction_drift.drift_detected ? "destructive" : "default"} className="mb-4">
                    {data.prediction_drift.drift_detected ? (
                      <AlertTriangle className="size-4" />
                    ) : (
                      <CheckCircle2 className="size-4" />
                    )}
                    <AlertTitle>
                      {data.prediction_drift.drift_detected ? (
                        <>Phát hiện <GlossaryTerm term="Prediction Drift" /></>
                      ) : (
                        <>Không phát hiện <GlossaryTerm term="Prediction Drift" /> đáng kể</>
                      )}
                    </AlertTitle>
                    <AlertDescription>
                      Trung bình cửa sổ gần đây: {data.prediction_drift.recent_window_mean?.toFixed(3)} · Trung bình cửa sổ
                      trước: {data.prediction_drift.prior_window_mean?.toFixed(3)} (kích thước cửa sổ:{" "}
                      {data.prediction_drift.window_size})
                    </AlertDescription>
                  </Alert>
                  <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                    <div>
                      <p className="text-xs text-muted-foreground">Chỉ số KS</p>
                      <p className="font-heading text-lg font-semibold">
                        {data.prediction_drift.ks_statistic?.toFixed(4)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Giá trị p</p>
                      <p className="font-heading text-lg font-semibold">
                        {data.prediction_drift.p_value?.toFixed(6)}
                      </p>
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </>
      ) : (
        <div className="flex flex-col items-center gap-2 py-16 text-center text-muted-foreground">
          <Activity className="size-8" />
          <p>Chưa có dữ liệu giám sát.</p>
        </div>
      )}
    </div>
  );
}
