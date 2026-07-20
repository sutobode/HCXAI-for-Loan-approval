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
    label: "Uncertainty highlighted",
    description:
      "Your history shows a tendency to agree with the AI even at moderate confidence — this explanation surfaces the model's limitations more explicitly.",
  },
  highlight_evidence: {
    label: "Supporting evidence highlighted",
    description:
      "Your history shows frequent overrides even on high-confidence predictions — this explanation surfaces more supporting evidence to help calibrate trust.",
  },
};

const ROLE_OPTIONS: { value: ExplainRole; label: string }[] = [
  { value: "customer", label: "Customer (simple)" },
  { value: "loan_officer", label: "Loan Officer" },
  { value: "risk_analyst", label: "Risk Analyst (technical)" },
  { value: "executive", label: "Executive summary" },
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
      toast.success("Explanation generated");
    } catch (error) {
      toast.error(getApiErrorMessage(error, "Failed to generate explanation"));
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
      toast.success("Feedback recorded — thanks! This updates your trust calibration.");
    } catch (error) {
      toast.error(getApiErrorMessage(error));
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Submit Loan Application"
        description="Run the model, view the SHAP-based explanation, and get a DeepSeek-generated narrative tailored to your role."
      />

      <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Applicant details</CardTitle>
            <CardDescription>All fields feed directly into the trained XGBoost model.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3">
              <Label className="shrink-0">Explain as</Label>
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
              submitLabel={isSubmitting ? "Scoring application..." : "Get AI decision & explanation"}
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
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between">
                    <div>
                      <CardTitle className="flex items-center gap-2">
                        Decision
                        <Badge variant={result.prediction.prediction === "Approved" ? "default" : "destructive"}>
                          {result.prediction.prediction}
                        </Badge>
                      </CardTitle>
                      <CardDescription>
                        Confidence: {Math.round(result.prediction.confidence * 100)}% &middot; Prediction #{result.prediction_id}
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
                      AI narrative ({result.narrative_model})
                    </CardTitle>
                    <CardDescription>
                      Detail level: <span className="font-medium">{result.progressive.level}</span> (adapted to your interaction history)
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm leading-relaxed whitespace-pre-line">{result.narrative}</p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Brain className="size-4 text-primary" />
                      Explanation Recommendation Engine
                    </CardTitle>
                    <CardDescription>
                      How this explanation was adapted to you, decided by simple auditable rules (never a black-box model).
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
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
                    <div className="flex flex-wrap gap-2">
                      {result.explanation_strategy.suggest_counterfactual && (
                        <Badge variant="outline">Suggests: What would change the decision?</Badge>
                      )}
                      {result.explanation_strategy.suggest_similar_cases && (
                        <Badge variant="outline">Suggests: Similar Case Explorer</Badge>
                      )}
                    </div>
                    <ul className="space-y-1.5 text-sm text-muted-foreground">
                      {result.explanation_strategy.rationale.map((line, i) => (
                        <li key={i} className="flex gap-2">
                          <span className="text-primary">&bull;</span>
                          <span>{line}</span>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Feature contributions (SHAP)</CardTitle>
                    <CardDescription>Positive bars increase approval likelihood, negative bars decrease it.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ShapChart contributions={result.contributions} />
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <MessageSquare className="size-4" />
                      Human Feedback (Feedback Learner)
                    </CardTitle>
                    <CardDescription>
                      Your response trains the Trust Calibrator and User Modeler for future explanations.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="flex gap-3">
                    <Button
                      variant="outline"
                      disabled={feedbackSent}
                      onClick={() => handleFeedback("approve")}
                    >
                      <ThumbsUp className="size-4" />
                      Agree with AI
                    </Button>
                    <Button
                      variant="outline"
                      disabled={feedbackSent}
                      onClick={() => handleFeedback("override")}
                    >
                      <ThumbsDown className="size-4" />
                      Override decision
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
                <p className="font-medium">No decision yet</p>
                <p className="mt-1 max-w-xs text-sm text-muted-foreground">
                  Fill in the applicant details and click &ldquo;Get AI decision &amp; explanation&rdquo; to see the model&rsquo;s prediction and reasoning here.
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
