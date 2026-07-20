"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ShieldCheck,
  ShieldAlert,
  ShieldQuestion,
  TrendingUp,
  TrendingDown,
  Minus,
  Scale,
  Smile,
} from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { getFeedbackAnalytics, getTrustDashboard } from "@/lib/endpoints";
import { useAuthStore } from "@/stores/auth-store";
import type { TrustCalibration, TrustTrend } from "@/lib/types";

const TREND_META: Record<TrustTrend["trend"], { label: string; icon: React.ComponentType<{ className?: string }>; tone: string }> = {
  increasing: { label: "Trust calibration improving", icon: TrendingUp, tone: "text-success" },
  decreasing: { label: "Trust calibration worsening", icon: TrendingDown, tone: "text-destructive" },
  stable: { label: "Trust calibration stable", icon: Minus, tone: "text-muted-foreground" },
  insufficient_data: { label: "Not enough data yet", icon: Minus, tone: "text-muted-foreground" },
};

const TRUST_STATE_META: Record<
  TrustCalibration["trust_state"],
  { label: string; icon: React.ComponentType<{ className?: string }>; tone: string; description: string }
> = {
  well_calibrated: {
    label: "Well calibrated",
    icon: ShieldCheck,
    tone: "text-success bg-success/10",
    description: "Agreement with the AI tracks its confidence appropriately.",
  },
  over_trust: {
    label: "Over-trusting AI",
    icon: ShieldAlert,
    tone: "text-warning bg-warning/10",
    description: "High agreement even when the AI's confidence is moderate — consider reviewing edge cases more carefully.",
  },
  under_trust: {
    label: "Under-trusting AI",
    icon: ShieldAlert,
    tone: "text-destructive bg-destructive/10",
    description: "Frequent overrides even on high-confidence predictions — the platform may need to build more trust evidence.",
  },
  insufficient_data: {
    label: "Insufficient data",
    icon: ShieldQuestion,
    tone: "text-muted-foreground bg-muted",
    description: "Submit more feedback to build a trust calibration profile.",
  },
};

export default function TrustDashboardPage() {
  const currentUser = useAuthStore((s) => s.user);
  const [userId, setUserId] = useState(currentUser?.email ?? "");
  const [queryUserId, setQueryUserId] = useState(currentUser?.email ?? "");

  const { data, isLoading } = useQuery({
    queryKey: ["trust", queryUserId],
    queryFn: () => getTrustDashboard(queryUserId),
    enabled: !!queryUserId,
  });

  const { data: analytics } = useQuery({
    queryKey: ["feedback-analytics"],
    queryFn: getFeedbackAnalytics,
    retry: false,
  });

  const meta = data ? TRUST_STATE_META[data.trust_calibration.trust_state] : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Trust Dashboard"
        description="HCXAI User Modeler + Trust Calibrator: how well a user's decisions align with AI confidence."
      />

      <Card>
        <CardContent className="flex items-end gap-3 p-4">
          <div className="flex-1">
            <Label htmlFor="user-id" className="mb-1.5">User ID (email)</Label>
            <Input id="user-id" value={userId} onChange={(e) => setUserId(e.target.value)} />
          </div>
          <Button onClick={() => setQueryUserId(userId)}>Load</Button>
        </CardContent>
      </Card>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : data ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Trust calibration</CardTitle>
              <CardDescription>{data.trust_calibration.events} recorded decisions</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {meta && (
                <div className="flex items-center gap-3 rounded-lg border p-4">
                  <div className={`flex size-10 shrink-0 items-center justify-center rounded-lg ${meta.tone}`}>
                    <meta.icon className="size-5" />
                  </div>
                  <div>
                    <p className="font-medium">{meta.label}</p>
                    <p className="text-sm text-muted-foreground">{meta.description}</p>
                  </div>
                </div>
              )}

              {data.trust_calibration.agreement_rate !== null && (
                <div>
                  <div className="mb-1.5 flex justify-between text-sm">
                    <span>Agreement rate with AI</span>
                    <span className="font-medium">
                      {Math.round(data.trust_calibration.agreement_rate * 100)}%
                    </span>
                  </div>
                  <Progress value={data.trust_calibration.agreement_rate * 100} />
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Cognitive profile</CardTitle>
              <CardDescription>Learned from interaction history (HCXAI User Modeler)</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-muted-foreground">Role</p>
                  <p className="font-medium capitalize">{data.profile.role.replace("_", " ")}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Preferred detail level</p>
                  <Badge variant="outline" className="capitalize">{data.profile.preferred_detail_level}</Badge>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Total interactions</p>
                  <p className="font-medium">{data.profile.total_interactions}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Expertise level</p>
                  <p className="font-medium">{Math.round(data.profile.expertise_level * 100)}%</p>
                </div>
              </div>
              <div className="flex gap-4 text-sm">
                <span className="text-success">{data.profile.agreements} agreements</span>
                <span className="text-destructive">{data.profile.disagreements} disagreements</span>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {data && (
        <div className="grid gap-6 lg:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                {(() => {
                  const trendMeta = TREND_META[data.trust_trend.trend];
                  return <trendMeta.icon className={`size-4 ${trendMeta.tone}`} />;
                })()}
                Trust trend
              </CardTitle>
              <CardDescription>Recent vs. prior agreement rate</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className={`text-sm font-medium ${TREND_META[data.trust_trend.trend].tone}`}>
                {TREND_META[data.trust_trend.trend].label}
              </p>
              {data.trust_trend.recent_agreement_rate !== null && (
                <p className="text-sm text-muted-foreground">
                  Recent: {Math.round(data.trust_trend.recent_agreement_rate * 100)}%
                  {data.trust_trend.prior_agreement_rate !== null &&
                    ` · Prior: ${Math.round(data.trust_trend.prior_agreement_rate * 100)}%`}
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Scale className="size-4 text-primary" />
                Override direction
              </CardTitle>
              <CardDescription>Risk tolerance signal from overrides</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {data.override_direction.risk_tolerance === null ? (
                <p className="text-sm text-muted-foreground">No overrides recorded yet.</p>
              ) : (
                <>
                  <p className="text-sm font-medium">
                    {data.override_direction.risk_tolerance > 0.15
                      ? "Leans lenient (approves AI-rejected cases)"
                      : data.override_direction.risk_tolerance < -0.15
                        ? "Leans conservative (rejects AI-approved cases)"
                        : "Balanced override pattern"}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {data.override_direction.reject_to_approve_count} reject→approve ·{" "}
                    {data.override_direction.approve_to_reject_count} approve→reject
                  </p>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Smile className="size-4 text-primary" />
                Explanation satisfaction
              </CardTitle>
              <CardDescription>{data.satisfaction.n_ratings} ratings submitted</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex gap-6">
                <div>
                  <p className="text-xs text-muted-foreground">Avg. trust rating</p>
                  <p className="font-heading text-xl font-semibold">
                    {data.satisfaction.avg_trust_rating?.toFixed(1) ?? "—"} / 5
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Avg. confidence rating</p>
                  <p className="font-heading text-xl font-semibold">
                    {data.satisfaction.avg_confidence_rating?.toFixed(1) ?? "—"} / 5
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {analytics && (
        <Card>
          <CardHeader>
            <CardTitle>Human Feedback Center (platform-wide)</CardTitle>
            <CardDescription>Aggregate override analytics across all users.</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <p className="text-xs text-muted-foreground">Total feedback events</p>
              <p className="font-heading text-xl font-semibold">{analytics.total_feedback_events}</p>
            </div>
            {Object.entries(analytics.by_action).map(([action, count]) => (
              <div key={action}>
                <p className="text-xs text-muted-foreground capitalize">{action}</p>
                <p className="font-heading text-xl font-semibold">{count}</p>
              </div>
            ))}
            <div>
              <p className="text-xs text-muted-foreground">Avg. trust rating</p>
              <p className="font-heading text-xl font-semibold">
                {analytics.average_trust_rating ? analytics.average_trust_rating.toFixed(1) : "—"}
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
