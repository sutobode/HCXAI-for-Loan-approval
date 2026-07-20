"use client";

import { useQuery } from "@tanstack/react-query";
import { Activity, AlertTriangle, CheckCircle2, Cpu, TrendingUp } from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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
        title="Model Monitoring Center"
        description="Training-time performance and live feature drift detection (Kolmogorov–Smirnov test vs. training distribution)."
      />

      {isLoading ? (
        <Skeleton className="h-64" />
      ) : data ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardContent className="p-5">
                <p className="text-sm text-muted-foreground">Model type</p>
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
                <p className="text-sm text-muted-foreground">AUC</p>
                <p className="mt-1 font-heading text-xl font-semibold">
                  {metrics ? metrics.auc.toFixed(3) : "—"}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <p className="text-sm text-muted-foreground">Predictions served</p>
                <p className="mt-1 font-heading text-xl font-semibold">{data.n_predictions_served}</p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Cpu className="size-4 text-primary" />
                Feature drift report
              </CardTitle>
              <CardDescription>
                Comparing recently served applications against the training distribution.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {data.drift_report.status === "no_data" ? (
                <p className="text-sm text-muted-foreground">
                  Not enough served predictions yet to compute drift.
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
                      {data.drift_report.overall_drift_detected
                        ? "Drift detected"
                        : "No significant drift detected"}
                    </AlertTitle>
                    <AlertDescription>
                      {data.drift_report.overall_drift_detected
                        ? `Drifted features: ${data.drift_report.drifted_features?.join(", ")}`
                        : `Compared ${data.drift_report.n_recent} recent samples against ${data.drift_report.n_reference} training samples.`}
                    </AlertDescription>
                  </Alert>

                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Feature</TableHead>
                        <TableHead>KS statistic</TableHead>
                        <TableHead>p-value</TableHead>
                        <TableHead>Status</TableHead>
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
                              {res.drift_detected ? "Drift" : "Stable"}
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
                Prediction drift
              </CardTitle>
              <CardDescription>
                Kolmogorov–Smirnov test comparing recent vs. prior predicted-probability distributions
                (independent of feature drift — the model&rsquo;s outputs can shift even if inputs look stable).
              </CardDescription>
            </CardHeader>
            <CardContent>
              {data.prediction_drift.status === "insufficient_data" ? (
                <p className="text-sm text-muted-foreground">
                  Not enough prediction snapshots yet ({data.prediction_drift.n_snapshots ?? 0} of{" "}
                  {data.prediction_drift.required ?? "—"} required).
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
                      {data.prediction_drift.drift_detected
                        ? "Prediction drift detected"
                        : "No significant prediction drift"}
                    </AlertTitle>
                    <AlertDescription>
                      Recent window mean: {data.prediction_drift.recent_window_mean?.toFixed(3)} · Prior window
                      mean: {data.prediction_drift.prior_window_mean?.toFixed(3)} (window size:{" "}
                      {data.prediction_drift.window_size})
                    </AlertDescription>
                  </Alert>
                  <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                    <div>
                      <p className="text-xs text-muted-foreground">KS statistic</p>
                      <p className="font-heading text-lg font-semibold">
                        {data.prediction_drift.ks_statistic?.toFixed(4)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">p-value</p>
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
          <p>No monitoring data available.</p>
        </div>
      )}
    </div>
  );
}
