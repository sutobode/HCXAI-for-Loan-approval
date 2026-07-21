"use client";

import { useState } from "react";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, ThumbsDown, ThumbsUp, MessageSquare } from "lucide-react";

import { Brain, Lightbulb } from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { GlossaryTerm } from "@/components/ui/glossary-term";
import { RiskGauge } from "@/components/charts/risk-gauge";
import { ShapChart } from "@/components/charts/shap-chart";
import { LoanApplicationForm } from "@/components/loan/loan-application-form";
import { explain, submitFeedback } from "@/lib/endpoints";
import { getApiErrorMessage } from "@/lib/api";
import { useAuthStore } from "@/stores/auth-store";
import type { ExplainRole, HCXAIExplanationResult, LoanApplication } from "@/lib/types";

const TRUST_INTERVENTION_META: Record<
  HCXAIExplanationResult["explanation_strategy"]["trust_intervention"],
  { label: string; description: string } | null
> = {
  none: null,
  highlight_uncertainty: {
    label: "Đã làm rõ mức độ không chắc chắn",
    description:
      "Lịch sử của bạn cho thấy xu hướng đồng ý với AI ngay cả khi độ tin cậy chỉ ở mức trung bình — giải thích này làm rõ hơn giới hạn của mô hình.",
  },
  highlight_evidence: {
    label: "Đã bổ sung minh chứng hỗ trợ",
    description:
      "Lịch sử của bạn cho thấy bạn thường ghi đè quyết định ngay cả khi độ tin cậy cao — giải thích này bổ sung thêm minh chứng để giúp cân chỉnh lại mức độ tin tưởng.",
  },
};

const ROLE_OPTIONS: { value: ExplainRole; label: string }[] = [
  { value: "customer", label: "Khách hàng (đơn giản)" },
  { value: "loan_officer", label: "Chuyên viên Tín dụng" },
  { value: "risk_analyst", label: "Chuyên viên Rủi ro (kỹ thuật)" },
  { value: "executive", label: "Tóm tắt cho Lãnh đạo" },
];

export default function NewApplicationPage() {
  const user = useAuthStore((s) => s.user);
  const [role, setRole] = useState<ExplainRole>("loan_officer");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState<HCXAIExplanationResult | null>(null);
  const [feedbackSent, setFeedbackSent] = useState(false);

  async function handleSubmit(values: LoanApplication) {
    setIsSubmitting(true);
    setResult(null);
    setFeedbackSent(false);
    try {
      const explanation = await explain({
        application: values,
        role,
        user_id: user?.email ?? "anonymous",
      });
      setResult(explanation);
      toast.success("Đã tạo giải thích");
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Không thể tạo giải thích"));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleFeedback(action: "approve" | "override") {
    if (!result) return;
    try {
      await submitFeedback({
        prediction_id: result.prediction_id,
        user_id: user?.email ?? "anonymous",
        action,
        human_decision: action === "approve" ? result.prediction.prediction : (result.prediction.prediction === "Approved" ? "Rejected" : "Approved"),
        trust_rating: 4,
      });
      setFeedbackSent(true);
      toast.success("Đã ghi nhận phản hồi — cảm ơn bạn! Điều này giúp cân chỉnh lại mức độ tin tưởng của bạn.");
    } catch (error) {
      toast.error(getApiErrorMessage(error));
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Nộp hồ sơ vay"
        description="Chạy mô hình, xem giải thích dựa trên SHAP, và nhận diễn giải bằng ngôn ngữ tự nhiên từ DeepSeek phù hợp với vai trò của bạn."
      />

      <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Thông tin người vay</CardTitle>
            <CardDescription>Mọi trường dữ liệu đều được đưa trực tiếp vào mô hình XGBoost đã huấn luyện.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3">
              <Label className="shrink-0">Giải thích theo vai trò</Label>
              <Select value={role} onValueChange={(v) => setRole(v as ExplainRole)}>
                <SelectTrigger className="w-56">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLE_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Separator />
            <LoanApplicationForm
              onSubmit={handleSubmit}
              isSubmitting={isSubmitting}
              submitLabel={isSubmitting ? "Đang chấm điểm hồ sơ..." : "Nhận quyết định & giải thích từ AI"}
            />
          </CardContent>
        </Card>

        <div className="space-y-6">
          <AnimatePresence mode="wait">
            {result ? (
              <motion.div
                key="result"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="space-y-6"
              >
                {/* ===== Lớp đơn giản: luôn hiển thị, ai xem cũng hiểu ngay ===== */}
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between">
                    <div>
                      <CardTitle className="flex items-center gap-2">
                        Quyết định
                        <Badge variant={result.prediction.prediction === "Approved" ? "default" : "destructive"}>
                          {result.prediction.prediction === "Approved" ? "Được duyệt" : "Bị từ chối"}
                        </Badge>
                      </CardTitle>
                      <CardDescription>
                        Độ tin cậy: {Math.round(result.prediction.confidence * 100)}% &middot; Hồ sơ #{result.prediction_id}
                      </CardDescription>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <RiskGauge riskScore={result.prediction.risk_score} />
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Sparkles className="size-4 text-primary" />
                      Diễn giải từ AI ({result.narrative_model})
                    </CardTitle>
                    <CardDescription>
                      Mức độ chi tiết: <span className="font-medium">{result.progressive.level}</span> (đã được điều chỉnh theo lịch sử tương tác của bạn)
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm leading-relaxed whitespace-pre-line">{result.narrative}</p>
                  </CardContent>
                </Card>

                {(result.explanation_strategy.suggest_counterfactual ||
                  result.explanation_strategy.suggest_similar_cases) && (
                  <div className="flex flex-wrap items-center gap-2">
                    {result.explanation_strategy.suggest_counterfactual && (
                      <Badge variant="outline" className="gap-1">
                        Gợi ý: <GlossaryTerm term="Counterfactual" /> — cần thay đổi gì để đổi kết quả?
                      </Badge>
                    )}
                    {result.explanation_strategy.suggest_similar_cases && (
                      <Badge variant="outline">Gợi ý: Tra cứu hồ sơ tương tự</Badge>
                    )}
                  </div>
                )}

                {/* ===== Lớp kỹ thuật: gấp lại theo mặc định, chỉ ai cần mới mở ===== */}
                <Collapsible className="rounded-xl border">
                  <CollapsibleTrigger className="p-4">
                    <span className="text-sm font-medium">
                      Xem chi tiết kỹ thuật (SHAP, quy tắc điều chỉnh giải thích)
                    </span>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="space-y-6 border-t p-4 pt-4">
                      <div>
                        <div className="mb-3 flex items-center gap-2 text-base font-semibold">
                          <Brain className="size-4 text-primary" />
                          <GlossaryTerm term="Explanation Recommendation Engine" />
                        </div>
                        <p className="mb-3 text-sm text-muted-foreground">
                          Giải thích này được điều chỉnh cho bạn như thế nào, dựa trên các quy tắc đơn giản, minh bạch (không bao giờ là mô hình hộp đen).
                        </p>
                        <div className="space-y-3">
                          {TRUST_INTERVENTION_META[result.explanation_strategy.trust_intervention] && (
                            <div className="flex items-start gap-3 rounded-lg border bg-primary/5 p-3">
                              <Lightbulb className="mt-0.5 size-4 shrink-0 text-primary" />
                              <div>
                                <p className="text-sm font-medium">
                                  {TRUST_INTERVENTION_META[result.explanation_strategy.trust_intervention]!.label}
                                </p>
                                <p className="text-sm text-muted-foreground">
                                  {TRUST_INTERVENTION_META[result.explanation_strategy.trust_intervention]!.description}
                                </p>
                              </div>
                            </div>
                          )}
                          <ul className="space-y-1.5 text-sm text-muted-foreground">
                            {result.explanation_strategy.rationale.map((line, i) => (
                              <li key={i} className="flex gap-2">
                                <span className="text-primary">&bull;</span>
                                <span>{line}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      </div>

                      <Separator />

                      <div>
                        <div className="mb-1 flex items-center gap-1.5 text-base font-semibold">
                          Feature Contribution (<GlossaryTerm term="SHAP" />)
                        </div>
                        <p className="mb-3 text-sm text-muted-foreground">
                          Cột dương làm tăng khả năng được duyệt, cột âm làm giảm khả năng đó.
                        </p>
                        <ShapChart contributions={result.contributions} />
                      </div>
                    </div>
                  </CollapsibleContent>
                </Collapsible>

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <MessageSquare className="size-4" />
                      Phản hồi của con người
                    </CardTitle>
                    <CardDescription>
                      Phản hồi của bạn giúp huấn luyện <GlossaryTerm term="Trust Calibrator" /> và{" "}
                      <GlossaryTerm term="User Modeler" /> cho các giải thích sau này.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="flex gap-3">
                    <Button
                      variant="outline"
                      disabled={feedbackSent}
                      onClick={() => handleFeedback("approve")}
                    >
                      <ThumbsUp className="size-4" />
                      Đồng ý với AI
                    </Button>
                    <Button
                      variant="outline"
                      disabled={feedbackSent}
                      onClick={() => handleFeedback("override")}
                    >
                      <ThumbsDown className="size-4" />
                      Ghi đè quyết định
                    </Button>
                  </CardContent>
                </Card>
              </motion.div>
            ) : (
              <motion.div
                key="empty"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex h-full min-h-[420px] flex-col items-center justify-center rounded-xl border border-dashed p-10 text-center"
              >
                <Sparkles className="mb-3 size-8 text-muted-foreground" />
                <p className="font-medium">Chưa có quyết định</p>
                <p className="mt-1 max-w-xs text-sm text-muted-foreground">
                  Điền thông tin người vay và nhấn &ldquo;Nhận quyết định &amp; giải thích từ AI&rdquo; để xem dự đoán và lý giải của mô hình tại đây.
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
