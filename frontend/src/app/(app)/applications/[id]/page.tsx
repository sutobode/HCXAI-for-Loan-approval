"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, MessageSquare, Scale, GitBranch, Gauge, ThumbsUp, ThumbsDown, Star } from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { GlossaryTerm } from "@/components/ui/glossary-term";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RiskGauge } from "@/components/charts/risk-gauge";
import { ShapChart } from "@/components/charts/shap-chart";
import {
  explainWithCounterfactual,
  explainWithLime,
  getDecisionProvenance,
  getExplanationQuality,
  getPredictionDetail,
  submitFeedback,
} from "@/lib/endpoints";
import { getApiErrorMessage } from "@/lib/api";
import { useAuthStore } from "@/stores/auth-store";
import type { LoanApplication } from "@/lib/types";

export default function ApplicationDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const id = Number(params.id);

  const [feedbackComment, setFeedbackComment] = useState("");
  const [trustRating, setTrustRating] = useState(0);

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
    onError: (error) => toast.error(getApiErrorMessage(error, "Giải thích LIME thất bại")),
  });
  const counterfactualMutation = useMutation({
    mutationFn: () => explainWithCounterfactual(applicationFeatures!, 3),
    onError: (error) => toast.error(getApiErrorMessage(error, "Tìm kiếm phản chứng thất bại")),
  });
  const qualityMutation = useMutation({
    mutationFn: () => getExplanationQuality(applicationFeatures!),
    onError: (error) => toast.error(getApiErrorMessage(error, "Kiểm tra chất lượng giải thích thất bại")),
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
        <p className="font-medium">Không tìm thấy hồ sơ</p>
        <Button variant="outline" onClick={() => router.push("/applications")}>
          <ArrowLeft className="size-4" />
          Về danh sách hồ sơ
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Hồ sơ #${data.id}${data.applicant_name ? ` — ${data.applicant_name}` : ""}`}
        description={`Nộp lúc ${new Date(data.created_at).toLocaleString("vi-VN")}`}
        actions={
          <Button variant="outline" onClick={() => router.push("/applications")}>
            <ArrowLeft className="size-4" />
            Quay lại
          </Button>
        }
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Quyết định
              <Badge variant={data.prediction === "Approved" ? "default" : "destructive"}>
                {data.prediction === "Approved" ? "Được duyệt" : "Bị từ chối"}
              </Badge>
            </CardTitle>
            <CardDescription>
              Độ tin cậy: {Math.round(data.confidence * 100)}%
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Đồng hồ đo rủi ro bên dưới cho thấy mức độ rủi ro tổng thể của hồ sơ này theo đánh giá của AI.
              Kim càng nghiêng về phía đỏ = rủi ro càng cao, xanh = an toàn.
            </p>
            <RiskGauge riskScore={data.risk_score} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Diễn giải từ AI {data.narrative_model ? `(${data.narrative_model})` : ""}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm leading-relaxed whitespace-pre-line">
              {data.narrative ?? "Không có diễn giải nào được lưu cho hồ sơ này."}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            Feature Contribution (<GlossaryTerm term="SHAP" />)
          </CardTitle>
          <CardDescription>Giá trị cơ sở: {data.shap_result.base_value.toFixed(3)}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Biểu đồ bên dưới cho thấy từng yếu tố tài chính đóng góp bao nhiêu vào quyết định.
            Cột hướng phải (dương) = tăng khả năng duyệt, cột hướng trái (âm) = giảm khả năng duyệt.
            Yếu tố nào cột càng dài thì ảnh hưởng càng lớn.
          </p>
          <ShapChart contributions={data.shap_result.contributions} />
        </CardContent>
      </Card>

      <Collapsible className="rounded-xl border">
        <CollapsibleTrigger className="p-4">
          <span className="text-sm font-medium">
            Công cụ phân tích chuyên sâu (LIME, Counterfactual, Explanation Quality)
          </span>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="grid gap-6 border-t p-4 pt-4 lg:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <GitBranch className="size-4 text-primary" />
                  Đối chiếu với <GlossaryTerm term="LIME" />
                </CardTitle>
                <CardDescription>
                  Mô hình thay thế cục bộ độc lập — nếu khớp với SHAP thì càng đáng tin cậy.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {!limeMutation.data ? (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!applicationFeatures || limeMutation.isPending}
                    onClick={() => limeMutation.mutate()}
                  >
                    {limeMutation.isPending ? "Đang chạy LIME..." : "Chạy giải thích LIME"}
                  </Button>
                ) : (
                  <>
                    <p className="text-xs text-muted-foreground">
                      Độ khớp R&sup2;: {limeMutation.data.fidelity_r2 !== null ? limeMutation.data.fidelity_r2.toFixed(3) : "—"}
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
                  <GlossaryTerm term="Counterfactual" />
                </CardTitle>
                <CardDescription>Những thay đổi nhỏ nhất có thể đổi ngược quyết định này.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {!counterfactualMutation.data ? (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!applicationFeatures || counterfactualMutation.isPending}
                    onClick={() => counterfactualMutation.mutate()}
                  >
                    {counterfactualMutation.isPending ? "Đang tìm kiếm..." : "Tìm Counterfactual"}
                  </Button>
                ) : counterfactualMutation.data.counterfactuals.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Không tìm được Counterfactual trong phạm vi tìm kiếm.</p>
                ) : (
                  <div className="space-y-3">
                    {counterfactualMutation.data.counterfactuals.map((cf, i) => (
                      <div key={i} className="rounded-lg border p-2.5 text-sm">
                        <p className="mb-1 font-medium">
                          → {cf.resulting_decision === "Approved" ? "Được duyệt" : "Bị từ chối"} ({Math.round(cf.resulting_probability * 100)}%)
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
                  Explanation Quality
                </CardTitle>
                <CardDescription>
                  <GlossaryTerm term="Stability" />, <GlossaryTerm term="Completeness" /> và{" "}
                  <GlossaryTerm term="Sparsity" /> của giải thích SHAP này.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {!qualityMutation.data ? (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!applicationFeatures || qualityMutation.isPending}
                    onClick={() => qualityMutation.mutate()}
                  >
                    {qualityMutation.isPending ? "Đang tính toán..." : "Kiểm tra chất lượng"}
                  </Button>
                ) : (
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Điểm tổng hợp</span>
                      <span className="font-medium">{qualityMutation.data.composite_quality_score.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">
                        <GlossaryTerm term="Stability" />
                      </span>
                      <Badge variant="outline" className="capitalize">
                        {qualityMutation.data.stability.interpretation.replace("_", " ")}
                      </Badge>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">
                        <GlossaryTerm term="Completeness" /> (SHAP)
                      </span>
                      <Badge variant={qualityMutation.data.completeness.is_complete ? "default" : "destructive"}>
                        {qualityMutation.data.completeness.is_complete ? "Đã xác nhận" : "Không đạt"}
                      </Badge>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">
                        <GlossaryTerm term="Sparsity" />
                      </span>
                      <Badge variant="outline" className="capitalize">
                        {qualityMutation.data.sparsity.interpretation}
                      </Badge>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </CollapsibleContent>
      </Collapsible>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ThumbsUp className="size-4 text-primary" />
            Phê duyệt hồ sơ
          </CardTitle>
          <CardDescription>
            Xem xét kết quả AI ở trên, sau đó đưa ra quyết định cuối cùng. Phản hồi của bạn sẽ được ghi nhận vào hệ thống HCXAI.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Trust rating */}
          <div className="space-y-2">
            <Label className="text-sm">Mức độ tin tưởng vào quyết định AI (1–5)</Label>
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setTrustRating(n)}
                  className={`flex size-9 items-center justify-center rounded-lg border transition-colors ${
                    trustRating >= n
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-muted text-muted-foreground hover:border-primary/50"
                  }`}
                >
                  <Star className={`size-4 ${trustRating >= n ? "fill-primary" : ""}`} />
                </button>
              ))}
              <span className="ml-2 self-center text-xs text-muted-foreground">
                {trustRating === 0 ? "Chưa đánh giá" : `${trustRating}/5`}
              </span>
            </div>
          </div>

          {/* Comment */}
          <div className="space-y-2">
            <Label className="text-sm">Ghi chú (tuỳ chọn)</Label>
            <Input
              placeholder="Lý do đồng ý hoặc ghi đè..."
              value={feedbackComment}
              onChange={(e) => setFeedbackComment(e.target.value)}
            />
          </div>

          {/* Action buttons */}
          <div className="flex gap-3 pt-1">
            <Button
              onClick={async () => {
                try {
                  await submitFeedback({
                    prediction_id: id,
                    user_id: user?.email ?? "anonymous",
                    action: "approve",
                    human_decision: data.prediction === "Approved" ? "Approved" : "Rejected",
                    trust_rating: trustRating || undefined,
                    comment: feedbackComment || undefined,
                  });
                  toast.success("Đã xác nhận đồng ý với quyết định AI");
                  queryClient.invalidateQueries({ queryKey: ["prediction", id] });
                  setFeedbackComment("");
                  setTrustRating(0);
                } catch (error) {
                  toast.error(getApiErrorMessage(error, "Gửi phản hồi thất bại"));
                }
              }}
            >
              <ThumbsUp className="size-4" />
              Đồng ý với AI
            </Button>
            <Button
              variant="outline"
              onClick={async () => {
                const overriddenDecision = data.prediction === "Approved" ? "Rejected" : "Approved";
                try {
                  await submitFeedback({
                    prediction_id: id,
                    user_id: user?.email ?? "anonymous",
                    action: "override",
                    human_decision: overriddenDecision,
                    trust_rating: trustRating || undefined,
                    comment: feedbackComment || undefined,
                  });
                  toast.success(`Đã ghi đè: quyết định cuối là "${overriddenDecision === "Approved" ? "Duyệt" : "Từ chối"}"`);
                  queryClient.invalidateQueries({ queryKey: ["prediction", id] });
                  setFeedbackComment("");
                  setTrustRating(0);
                } catch (error) {
                  toast.error(getApiErrorMessage(error, "Gửi phản hồi thất bại"));
                }
              }}
            >
              <ThumbsDown className="size-4" />
              Ghi đè quyết định
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <MessageSquare className="size-4" />
            Lịch sử phản hồi
          </CardTitle>
          <CardDescription>Các quyết định của con người được ghi nhận trên hồ sơ này.</CardDescription>
        </CardHeader>
        <CardContent>
          {data.feedback.length === 0 ? (
            <p className="text-sm text-muted-foreground">Chưa có phản hồi nào được gửi.</p>
          ) : (
            <div className="space-y-3">
              {data.feedback.map((f) => (
                <div key={f.id} className="flex items-start justify-between rounded-lg border p-3">
                  <div>
                    <p className="text-sm font-medium">
                      {f.user_id} &middot; <span className="capitalize">{f.action}</span>
                      {f.human_decision ? ` → ${f.human_decision === "Approved" ? "Được duyệt" : "Bị từ chối"}` : ""}
                    </p>
                    {f.comment && <p className="mt-1 text-sm text-muted-foreground">{f.comment}</p>}
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {new Date(f.created_at).toLocaleString("vi-VN")}
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
