"use client";

import { useState, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, ThumbsDown, ThumbsUp, MessageSquare, UserSearch } from "lucide-react";

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
import { explain, submitFeedback, getApplicantDetail } from "@/lib/endpoints";
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

const USER_ROLE_TO_EXPLAIN_ROLE: Record<string, ExplainRole> = {
  admin: "risk_analyst",
  risk_manager: "risk_analyst",
  loan_officer: "loan_officer",
  customer: "customer",
};

export default function NewApplicationPage() {
  const user = useAuthStore((s) => s.user);
  const router = useRouter();
  const searchParams = useSearchParams();
  const applicantIdParam = searchParams.get("applicant_id");

  const [role, setRole] = useState<ExplainRole>(
    USER_ROLE_TO_EXPLAIN_ROLE[user?.role ?? "loan_officer"] ?? "loan_officer"
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState<HCXAIExplanationResult | null>(null);
  const [feedbackSent, setFeedbackSent] = useState(false);

  // Applicant context for prefill + display
  const [applicantName, setApplicantName] = useState<string | null>(null);
  const [applicantId, setApplicantId] = useState<number | null>(
    applicantIdParam ? Number(applicantIdParam) : null
  );
  const [prefillValues, setPrefillValues] = useState<LoanApplication | null>(null);

  useEffect(() => {
    if (!applicantIdParam) return;
    const id = Number(applicantIdParam);
    if (Number.isNaN(id)) return;
    setApplicantId(id);

    getApplicantDetail(id)
      .then((detail) => {
        setApplicantName(detail.applicant.full_name);
        // If applicant has existing applications, prefill from the most recent one
        if (detail.applications.length > 0) {
          const latest = detail.applications[0];
          const f = latest.features;
          setPrefillValues({
            no_of_dependents: Number(f.no_of_dependents) || 0,
            education: (f.education as "Graduate" | "Not Graduate") || "Graduate",
            self_employed: (f.self_employed as "Yes" | "No") || "No",
            income_annum: Number(f.income_annum) || 0,
            loan_amount: Number(f.loan_amount) || 0,
            loan_term: Number(f.loan_term) || 12,
            cibil_score: Number(f.cibil_score) || 600,
            residential_assets_value: Number(f.residential_assets_value) || 0,
            commercial_assets_value: Number(f.commercial_assets_value) || 0,
            luxury_assets_value: Number(f.luxury_assets_value) || 0,
            bank_asset_value: Number(f.bank_asset_value) || 0,
          });
        }
      })
      .catch(() => {
        // Applicant not found -- continue without prefill
      });
  }, [applicantIdParam]);

  async function handleSubmit(values: LoanApplication) {
    setIsSubmitting(true);
    setResult(null);
    setFeedbackSent(false);
    try {
      const explanation = await explain({
        application: values,
        role,
        user_id: user?.email ?? "anonymous",
        applicant_id: applicantId ?? undefined,
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
        title={applicantName ? `Chấm điểm: ${applicantName}` : "Nộp hồ sơ vay"}
        description={
          applicantName
            ? "Thông tin đã được điền sẵn từ hồ sơ khách hàng. Bạn có thể chỉnh sửa trước khi chấm điểm."
            : "Chạy mô hình, xem giải thích dựa trên SHAP, và nhận diễn giải bằng ngôn ngữ tự nhiên từ DeepSeek phù hợp với vai trò của bạn."
        }
      />

      <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Thông tin người vay</CardTitle>
            <CardDescription>Mọi trường dữ liệu đều được đưa trực tiếp vào mô hình XGBoost đã huấn luyện.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Collapsible className="rounded-lg border">
              <CollapsibleTrigger className="px-3 py-2">
                <span className="text-xs text-muted-foreground">
                  Tuỳ chọn nâng cao · Vai trò giải thích: {ROLE_OPTIONS.find((o) => o.value === role)?.label}
                </span>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="flex items-center gap-3 border-t px-3 py-3">
                  <Label className="shrink-0 text-sm">Giải thích theo vai trò</Label>
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
              </CollapsibleContent>
            </Collapsible>
            <Separator />
            <LoanApplicationForm
              key={prefillValues ? "prefilled" : "default"}
              defaultValues={prefillValues ?? undefined}
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
                      <p className="mt-1 text-xs text-muted-foreground">
                        {result.prediction.confidence >= 0.9
                          ? "Mô hình rất chắc chắn về kết quả này — các yếu tố tài chính chỉ rõ một chiều."
                          : result.prediction.confidence >= 0.7
                            ? "Mô hình khá chắc chắn, nhưng có một số yếu tố kéo ngược — nên xem xét kỹ giải thích SHAP bên dưới."
                            : "Mô hình không chắc chắn lắm — hồ sơ nằm gần ranh giới quyết định. Khuyến nghị xem Counterfactual hoặc hồ sơ tương tự để đối chiếu."}
                      </p>
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
                  <CardContent>
                    {!feedbackSent ? (
                      <div className="flex gap-3">
                        <Button
                          variant="outline"
                          onClick={() => handleFeedback("approve")}
                        >
                          <ThumbsUp className="size-4" />
                          Đồng ý với AI
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => handleFeedback("override")}
                        >
                          <ThumbsDown className="size-4" />
                          Ghi đè quyết định
                        </Button>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center gap-4 rounded-lg border bg-emerald-50 p-6 text-center dark:bg-emerald-950/20">
                        <div className="flex size-12 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900/40">
                          <ThumbsUp className="size-5 text-emerald-600" />
                        </div>
                        <div>
                          <p className="font-medium text-emerald-700 dark:text-emerald-400">Đã ghi nhận phản hồi!</p>
                          <p className="mt-1 text-sm text-muted-foreground">
                            Thông tin này giúp hệ thống cân chỉnh lại giải thích cho bạn trong tương lai.
                          </p>
                        </div>
                        <div className="flex gap-3">
                          <Button size="sm" onClick={() => router.push("/applicants")}>
                            <UserSearch className="size-4" />
                            Về Khách hàng
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setResult(null);
                              setFeedbackSent(false);
                            }}
                          >
                            Chấm hồ sơ tiếp
                          </Button>
                        </div>
                      </div>
                    )}
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
