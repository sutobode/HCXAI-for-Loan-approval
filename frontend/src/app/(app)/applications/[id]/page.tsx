"use client";

import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, MessageSquare, Scale, GitBranch, Gauge } from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { RiskGauge } from "@/components/charts/risk-gauge";
import { ShapChart } from "@/components/charts/shap-chart";
import {
  explainWithCounterfactual,
  explainWithLime,
  getDecisionProvenance,
  getExplanationQuality,
  getPredictionDetail,
} from "@/lib/endpoints";
import { getApiErrorMessage } from "@/lib/api";
import type { LoanApplication } from "@/lib/types";

export default function ApplicationDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = Number(params.id);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["prediction", id],
    queryFn: () => getPredictionDetail(id),
    enabled: Number.isFinite(id),
  });

  // Decision Provenance also gives us the original application features,
  // needed to call the on-demand XAI endpoints (LIME/counterfactual/quality
  // all re-run the model, so they need the raw application, not just the
  // stored SHAP summary).
  const { data: provenance } = useQuery({
    queryKey: ["provenance", id],
    queryFn: () => getDecisionProvenance(id),
    enabled: Number.isFinite(id),
  });
  const applicationFeatures = provenance?.application?.features as LoanApplication | undefined;

  const limeMutation = useMutation({
    mutationFn: () => explainWithLime(applicationFeatures!),
    onError: (error) => toast.error(getApiErrorMessage(error, "LIME explanation failed")),
  });
  const counterfactualMutation = useMutation({
    mutationFn: () => explainWithCounterfactual(applicationFeatures!, 3),
    onError: (error) => toast.error(getApiErrorMessage(error, "Counterfactual search failed")),
  });
  const qualityMutation = useMutation({
    mutationFn: () => getExplanationQuality(applicationFeatures!),
    onError: (error) => toast.error(getApiErrorMessage(error, "Explanation quality check failed")),
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <div className="grid gap-6 lg:grid-cols-2">
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
        </div>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
        <p className="font-medium">Prediction not found</p>
        <Button variant="outline" onClick={() => router.push("/applications")}>
          <ArrowLeft className="size-4" />
          Back to Loan Queue
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Application #${data.id}`}
        description={`Submitted ${new Date(data.created_at).toLocaleString()}`}
        actions={
          <Button variant="outline" onClick={() => router.push("/applications")}>
            <ArrowLeft className="size-4" />
            Back
          </Button>
        }
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Decision
              <Badge variant={data.prediction === "Approved" ? "default" : "destructive"}>
                {data.prediction}
              </Badge>
            </CardTitle>
            <CardDescription>
              Confidence: {Math.round(data.confidence * 100)}%
            </CardDescription>
          </CardHeader>
          <CardContent>
            <RiskGauge riskScore={data.risk_score} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>AI narrative {data.narrative_model ? `(${data.narrative_model})` : ""}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm leading-relaxed whitespace-pre-line">
              {data.narrative ?? "No narrative was recorded for this prediction."}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Feature contributions (SHAP)</CardTitle>
          <CardDescription>Base value: {data.shap_result.base_value.toFixed(3)}</CardDescription>
        </CardHeader>
        <CardContent>
          <ShapChart contributions={data.shap_result.contributions} />
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <GitBranch className="size-4 text-primary" />
              LIME cross-check
            </CardTitle>
            <CardDescription>Independent local surrogate — agreement with SHAP builds confidence.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {!limeMutation.data ? (
              <Button
                variant="outline"
                size="sm"
                disabled={!applicationFeatures || limeMutation.isPending}
                onClick={() => limeMutation.mutate()}
              >
                {limeMutation.isPending ? "Running LIME..." : "Run LIME explanation"}
              </Button>
            ) : (
              <>
                <p className="text-xs text-muted-foreground">
                  Fidelity R&sup2;: {limeMutation.data.fidelity_r2 !== null ? limeMutation.data.fidelity_r2.toFixed(3) : "—"}
                </p>
                <ul className="space-y-1.5 text-sm">
                  {limeMutation.data.contributions.slice(0, 5).map((c) => (
                    <li key={c.feature} className="flex items-center justify-between gap-2">
                      <span className="truncate">{c.display_name}</span>
                      <Badge variant={c.direction === "increases_approval" ? "default" : "destructive"}>
                        {c.lime_weight > 0 ? "+" : ""}
                        {c.lime_weight.toFixed(3)}
                      </Badge>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Scale className="size-4 text-primary" />
              Counterfactual
            </CardTitle>
            <CardDescription>Minimal changes that would flip this decision.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {!counterfactualMutation.data ? (
              <Button
                variant="outline"
                size="sm"
                disabled={!applicationFeatures || counterfactualMutation.isPending}
                onClick={() => counterfactualMutation.mutate()}
              >
                {counterfactualMutation.isPending ? "Searching..." : "Find counterfactuals"}
              </Button>
            ) : counterfactualMutation.data.counterfactuals.length === 0 ? (
              <p className="text-sm text-muted-foreground">No counterfactual found within search bounds.</p>
            ) : (
              <div className="space-y-3">
                {counterfactualMutation.data.counterfactuals.map((cf, i) => (
                  <div key={i} className="rounded-lg border p-2.5 text-sm">
                    <p className="mb-1 font-medium">
                      → {cf.resulting_decision} ({Math.round(cf.resulting_probability * 100)}%)
                    </p>
                    {cf.changes.map((ch) => (
                      <p key={ch.feature} className="text-xs text-muted-foreground">
                        {ch.display_name}: {ch.original_value} → {ch.suggested_value}
                      </p>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Gauge className="size-4 text-primary" />
              Explanation quality
            </CardTitle>
            <CardDescription>Stability, completeness, and sparsity of this SHAP explanation.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {!qualityMutation.data ? (
              <Button
                variant="outline"
                size="sm"
                disabled={!applicationFeatures || qualityMutation.isPending}
                onClick={() => qualityMutation.mutate()}
              >
                {qualityMutation.isPending ? "Computing..." : "Run quality check"}
              </Button>
            ) : (
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Composite score</span>
                  <span className="font-medium">{qualityMutation.data.composite_quality_score.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Stability</span>
                  <Badge variant="outline" className="capitalize">
                    {qualityMutation.data.stability.interpretation.replace("_", " ")}
                  </Badge>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">SHAP additivity</span>
                  <Badge variant={qualityMutation.data.completeness.is_complete ? "default" : "destructive"}>
                    {qualityMutation.data.completeness.is_complete ? "Verified" : "Failed"}
                  </Badge>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Sparsity</span>
                  <Badge variant="outline" className="capitalize">
                    {qualityMutation.data.sparsity.interpretation}
                  </Badge>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <MessageSquare className="size-4" />
            Feedback history
          </CardTitle>
          <CardDescription>Human decisions recorded against this prediction.</CardDescription>
        </CardHeader>
        <CardContent>
          {data.feedback.length === 0 ? (
            <p className="text-sm text-muted-foreground">No feedback submitted yet.</p>
          ) : (
            <div className="space-y-3">
              {data.feedback.map((f) => (
                <div key={f.id} className="flex items-start justify-between rounded-lg border p-3">
                  <div>
                    <p className="text-sm font-medium">
                      {f.user_id} &middot; <span className="capitalize">{f.action}</span>
                      {f.human_decision ? ` → ${f.human_decision}` : ""}
                    </p>
                    {f.comment && <p className="mt-1 text-sm text-muted-foreground">{f.comment}</p>}
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {new Date(f.created_at).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
