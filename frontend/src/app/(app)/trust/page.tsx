"use client";

import { useState } from "react";
import Link from "next/link";
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
  History,
} from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { GlossaryTerm } from "@/components/ui/glossary-term";
import { getFeedbackAnalytics, getTrustDashboard } from "@/lib/endpoints";
import { useAuthStore } from "@/stores/auth-store";
import type { TrustCalibration, TrustTrend } from "@/lib/types";

const TREND_META: Record<TrustTrend["trend"], { label: string; icon: React.ComponentType<{ className?: string }>; tone: string }> = {
  increasing: { label: "Độ tin cậy đang cải thiện", icon: TrendingUp, tone: "text-success" },
  decreasing: { label: "Độ tin cậy đang giảm", icon: TrendingDown, tone: "text-destructive" },
  stable: { label: "Độ tin cậy ổn định", icon: Minus, tone: "text-muted-foreground" },
  insufficient_data: { label: "Chưa có đủ dữ liệu", icon: Minus, tone: "text-muted-foreground" },
};

const TRUST_STATE_META: Record<
  TrustCalibration["trust_state"],
  { label: string; icon: React.ComponentType<{ className?: string }>; tone: string; description: string }
> = {
  well_calibrated: {
    label: "Cân chỉnh tốt",
    icon: ShieldCheck,
    tone: "text-success bg-success/10",
    description: "Mức độ đồng ý với AI phù hợp với độ tin cậy của mô hình.",
  },
  over_trust: {
    label: "Quá tin tưởng AI",
    icon: ShieldAlert,
    tone: "text-warning bg-warning/10",
    description: "Mức độ đồng ý cao ngay cả khi độ tin cậy của AI chỉ ở mức trung bình — nên xem xét kỹ hơn các trường hợp biên.",
  },
  under_trust: {
    label: "Chưa đủ tin tưởng AI",
    icon: ShieldAlert,
    tone: "text-destructive bg-destructive/10",
    description: "Thường xuyên ghi đè ngay cả khi độ tin cậy của AI cao — hệ thống có thể cần xây dựng thêm minh chứng để tăng độ tin tưởng.",
  },
  insufficient_data: {
    label: "Chưa đủ dữ liệu",
    icon: ShieldQuestion,
    tone: "text-muted-foreground bg-muted",
    description: "Hãy gửi thêm phản hồi để xây dựng hồ sơ cân chỉnh độ tin cậy.",
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
        title="Bảng Tin cậy"
        description={
          <>
            <GlossaryTerm term="User Modeler" /> + <GlossaryTerm term="Trust Calibrator" />: mức độ quyết định của
            người dùng khớp với độ tin cậy của AI.
          </>
        }
        actions={
          <Button variant="outline" nativeButton={false} render={<Link href="/hcxai/explanation-history" />}>
            <History className="size-4" />
            Lịch sử giải thích
          </Button>
        }
      />

      <Card>
        <CardContent className="flex items-end gap-3 p-4">
          <div className="flex-1">
            <Label htmlFor="user-id" className="mb-1.5">Mã người dùng (email)</Label>
            <Input id="user-id" value={userId} onChange={(e) => setUserId(e.target.value)} />
          </div>
          <Button onClick={() => setQueryUserId(userId)}>Tải dữ liệu</Button>
        </CardContent>
      </Card>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Đang tải...</p>
      ) : data ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Cân chỉnh độ tin cậy</CardTitle>
              <CardDescription>{data.trust_calibration.events} quyết định đã được ghi nhận</CardDescription>
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
                    <span>Tỷ lệ đồng ý với AI</span>
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
              <CardTitle>Hồ sơ nhận thức</CardTitle>
              <CardDescription>
                Được học từ lịch sử tương tác (<GlossaryTerm term="User Modeler" />)
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-muted-foreground">Vai trò</p>
                  <p className="font-medium capitalize">{data.profile.role.replace("_", " ")}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Mức độ chi tiết ưa thích</p>
                  <Badge variant="outline" className="capitalize">{data.profile.preferred_detail_level}</Badge>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Tổng số lượt tương tác</p>
                  <p className="font-medium">{data.profile.total_interactions}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Mức độ am hiểu</p>
                  <p className="font-medium">{Math.round(data.profile.expertise_level * 100)}%</p>
                </div>
              </div>
              <div className="flex gap-4 text-sm">
                <span className="text-success">{data.profile.agreements} lượt đồng ý</span>
                <span className="text-destructive">{data.profile.disagreements} lượt không đồng ý</span>
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
                Xu hướng tin cậy
              </CardTitle>
              <CardDescription>So sánh tỷ lệ đồng ý gần đây với trước đó</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className={`text-sm font-medium ${TREND_META[data.trust_trend.trend].tone}`}>
                {TREND_META[data.trust_trend.trend].label}
              </p>
              {data.trust_trend.recent_agreement_rate !== null && (
                <p className="text-sm text-muted-foreground">
                  Gần đây: {Math.round(data.trust_trend.recent_agreement_rate * 100)}%
                  {data.trust_trend.prior_agreement_rate !== null &&
                    ` · Trước đó: ${Math.round(data.trust_trend.prior_agreement_rate * 100)}%`}
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Scale className="size-4 text-primary" />
                Xu hướng ghi đè
              </CardTitle>
              <CardDescription>Tín hiệu về mức độ chấp nhận rủi ro từ các lần ghi đè</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {data.override_direction.risk_tolerance === null ? (
                <p className="text-sm text-muted-foreground">Chưa có lượt ghi đè nào được ghi nhận.</p>
              ) : (
                <>
                  <p className="text-sm font-medium">
                    {data.override_direction.risk_tolerance > 0.15
                      ? "Có xu hướng dễ dãi hơn (duyệt các hồ sơ AI đã từ chối)"
                      : data.override_direction.risk_tolerance < -0.15
                        ? "Có xu hướng thận trọng hơn (từ chối các hồ sơ AI đã duyệt)"
                        : "Xu hướng ghi đè cân bằng"}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {data.override_direction.reject_to_approve_count} lượt từ chối→duyệt ·{" "}
                    {data.override_direction.approve_to_reject_count} lượt duyệt→từ chối
                  </p>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Smile className="size-4 text-primary" />
                Mức độ hài lòng với giải thích
              </CardTitle>
              <CardDescription>{data.satisfaction.n_ratings} lượt đánh giá đã gửi</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex gap-6">
                <div>
                  <p className="text-xs text-muted-foreground">Điểm tin cậy TB</p>
                  <p className="font-heading text-xl font-semibold">
                    {data.satisfaction.avg_trust_rating?.toFixed(1) ?? "—"} / 5
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Điểm tự tin TB</p>
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
            <CardTitle>Trung tâm Phản hồi (toàn hệ thống)</CardTitle>
            <CardDescription>Số liệu tổng hợp về ghi đè trên toàn bộ người dùng.</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <p className="text-xs text-muted-foreground">Tổng số phản hồi</p>
              <p className="font-heading text-xl font-semibold">{analytics.total_feedback_events}</p>
            </div>
            {Object.entries(analytics.by_action).map(([action, count]) => (
              <div key={action}>
                <p className="text-xs text-muted-foreground capitalize">{action}</p>
                <p className="font-heading text-xl font-semibold">{count}</p>
              </div>
            ))}
            <div>
              <p className="text-xs text-muted-foreground">Điểm tin cậy TB</p>
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
