"use client";

import { useState } from "react";
import { toast } from "sonner";
import { ArrowRight, FlaskConical } from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import {
  LoanApplicationForm,
  DEFAULT_APPLICATION,
  type LoanApplicationFormValues,
} from "@/components/loan/loan-application-form";
import { runSensitivitySweep, runWhatIf } from "@/lib/endpoints";
import { getApiErrorMessage } from "@/lib/api";
import type { LoanApplication, SensitivityResult, WhatIfResult } from "@/lib/types";
import ReactECharts from "echarts-for-react";
import { useTheme } from "next-themes";

const SWEEP_FEATURES = [
  { value: "cibil_score", label: "Credit score" },
  { value: "income_annum", label: "Annual income" },
  { value: "loan_amount", label: "Loan amount" },
  { value: "loan_term", label: "Loan term" },
];

function SensitivityChart({ result }: { result: SensitivityResult }) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const textColor = isDark ? "#e5e5e5" : "#27272a";

  const option = {
    grid: { left: 50, right: 20, top: 20, bottom: 40 },
    tooltip: { trigger: "axis" },
    xAxis: {
      type: "value",
      name: "Feature value",
      axisLabel: { color: textColor },
      nameTextStyle: { color: textColor },
    },
    yAxis: {
      type: "value",
      name: "Approval probability",
      min: 0,
      max: 1,
      axisLabel: { color: textColor, formatter: (v: number) => `${Math.round(v * 100)}%` },
      nameTextStyle: { color: textColor },
      splitLine: { lineStyle: { color: isDark ? "#333" : "#eee" } },
    },
    series: [
      {
        type: "line",
        smooth: true,
        symbolSize: 8,
        data: result.points.map((p) => [p.value, p.approval_probability]),
        lineStyle: { color: "#6366f1", width: 3 },
        itemStyle: { color: "#6366f1" },
        markLine: {
          silent: true,
          symbol: "none",
          lineStyle: { color: "#94a3b8", type: "dashed" },
          data: [{ yAxis: 0.5 }],
        },
      },
    ],
  };

  return <ReactECharts option={option} style={{ height: 300 }} opts={{ renderer: "svg" }} />;
}

export default function WhatIfPage() {
  const [baseValues, setBaseValues] = useState<LoanApplicationFormValues>(DEFAULT_APPLICATION);
  const [overrideFeature, setOverrideFeature] = useState("cibil_score");
  const [overrideValue, setOverrideValue] = useState<number>(600);
  const [sweepFeature, setSweepFeature] = useState("cibil_score");

  const [whatIfResult, setWhatIfResult] = useState<WhatIfResult | null>(null);
  const [sensitivityResult, setSensitivityResult] = useState<SensitivityResult | null>(null);
  const [isRunningWhatIf, setIsRunningWhatIf] = useState(false);
  const [isRunningSweep, setIsRunningSweep] = useState(false);

  async function handleBaseSubmit(values: LoanApplication) {
    setBaseValues(values as LoanApplicationFormValues);
    toast.success("Base scenario updated");
  }

  async function handleRunWhatIf() {
    setIsRunningWhatIf(true);
    try {
      const result = await runWhatIf(baseValues as LoanApplication, {
        [overrideFeature]: overrideValue,
      });
      setWhatIfResult(result);
    } catch (error) {
      toast.error(getApiErrorMessage(error));
    } finally {
      setIsRunningWhatIf(false);
    }
  }

  async function handleRunSweep() {
    setIsRunningSweep(true);
    try {
      const result = await runSensitivitySweep(baseValues as LoanApplication, sweepFeature, 12);
      setSensitivityResult(result);
    } catch (error) {
      toast.error(getApiErrorMessage(error));
    } finally {
      setIsRunningSweep(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Interactive What-If Lab"
        description="Explore how changing one feature affects the model's decision, and visualize the approval decision boundary."
      />

      <Card>
        <CardHeader>
          <CardTitle>Base scenario</CardTitle>
          <CardDescription>Set the baseline application used for comparisons below.</CardDescription>
        </CardHeader>
        <CardContent>
          <LoanApplicationForm
            defaultValues={baseValues}
            onSubmit={handleBaseSubmit}
            submitLabel="Save base scenario"
          />
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FlaskConical className="size-4 text-primary" />
              Single override comparison
            </CardTitle>
            <CardDescription>Change one feature and compare the resulting decision.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3">
              <Label className="w-28 shrink-0">Feature</Label>
              <Select value={overrideFeature} onValueChange={(v) => v && setOverrideFeature(v)}>
                <SelectTrigger className="flex-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SWEEP_FEATURES.map((f) => (
                    <SelectItem key={f.value} value={f.value}>
                      {f.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-3">
              <Label className="w-28 shrink-0">New value</Label>
              <input
                type="number"
                value={overrideValue}
                onChange={(e) => setOverrideValue(Number(e.target.value))}
                className="h-8 flex-1 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              />
            </div>
            <Button onClick={handleRunWhatIf} disabled={isRunningWhatIf} className="w-full">
              Run comparison
            </Button>

            {whatIfResult && (
              <div className="mt-4 space-y-3 rounded-lg border p-4">
                <div className="flex items-center justify-center gap-4">
                  <div className="text-center">
                    <p className="text-xs text-muted-foreground">Base</p>
                    <Badge variant={whatIfResult.base_prediction.prediction === "Approved" ? "default" : "destructive"}>
                      {whatIfResult.base_prediction.prediction}
                    </Badge>
                    <p className="mt-1 text-sm font-medium">
                      {Math.round(whatIfResult.base_prediction.approval_probability * 100)}%
                    </p>
                  </div>
                  <ArrowRight className="size-5 text-muted-foreground" />
                  <div className="text-center">
                    <p className="text-xs text-muted-foreground">After override</p>
                    <Badge variant={whatIfResult.updated_prediction.prediction === "Approved" ? "default" : "destructive"}>
                      {whatIfResult.updated_prediction.prediction}
                    </Badge>
                    <p className="mt-1 text-sm font-medium">
                      {Math.round(whatIfResult.updated_prediction.approval_probability * 100)}%
                    </p>
                  </div>
                </div>
                <p className="text-center text-sm">
                  {whatIfResult.decision_changed ? (
                    <span className="font-medium text-warning">Decision changed!</span>
                  ) : (
                    <span className="text-muted-foreground">Decision did not change.</span>
                  )}{" "}
                  Probability delta: {(whatIfResult.probability_delta * 100).toFixed(1)}pp
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Sensitivity sweep</CardTitle>
            <CardDescription>Visualize the decision boundary as one feature varies.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3">
              <Label className="w-28 shrink-0">Feature</Label>
              <Select value={sweepFeature} onValueChange={(v) => v && setSweepFeature(v)}>
                <SelectTrigger className="flex-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SWEEP_FEATURES.map((f) => (
                    <SelectItem key={f.value} value={f.value}>
                      {f.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={handleRunSweep} disabled={isRunningSweep} className="w-full">
              Run sensitivity sweep
            </Button>
            {sensitivityResult && <SensitivityChart result={sensitivityResult} />}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
