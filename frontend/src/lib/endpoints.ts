/**
 * Typed wrappers around every backend endpoint (backend/app/main.py).
 * All frontend data-fetching should go through these functions -- never
 * call apiClient directly from a component.
 */
import { apiClient } from "@/lib/api";
import type {
  CounterfactualResult,
  DecisionProvenance,
  DetailLevel,
  ExplainRole,
  ExplanationHistoryItem,
  ExplanationQualityReport,
  FairnessReport,
  FeedbackAnalytics,
  GlobalExplainabilityResult,
  HCXAIExplanationResult,
  HCXAITrustDashboard,
  LimeExplanationResult,
  LoanApplication,
  ModelComparisonResult,
  ModelVersion,
  MonitoringSnapshot,
  OverrideAnalysisResult,
  PaginatedAuditLog,
  PaginatedPredictions,
  PredictionDetail,
  PredictionResult,
  SatisfactionMetrics,
  SensitivityResult,
  SimilarCasesResult,
  TokenResponse,
  TrustDashboard,
  User,
  UserRole,
  WhatIfResult,
} from "@/lib/types";

// --------------------------------------------------------------------------
// Auth
// --------------------------------------------------------------------------

export async function login(email: string, password: string): Promise<TokenResponse> {
  const { data } = await apiClient.post<TokenResponse>("/auth/login", { email, password });
  return data;
}

export async function getMe(): Promise<User> {
  const { data } = await apiClient.get<User>("/auth/me");
  return data;
}

export async function listUsers(): Promise<User[]> {
  const { data } = await apiClient.get<User[]>("/auth/users");
  return data;
}

export async function registerUser(payload: {
  email: string;
  full_name: string;
  password: string;
  role: UserRole;
}): Promise<User> {
  const { data } = await apiClient.post<User>("/auth/register", payload);
  return data;
}

export async function changePassword(payload: {
  current_password: string;
  new_password: string;
}): Promise<void> {
  await apiClient.post("/auth/change-password", payload);
}

// --------------------------------------------------------------------------
// Predictions & Explanations
// --------------------------------------------------------------------------

export async function predict(application: LoanApplication): Promise<PredictionResult> {
  const { data } = await apiClient.post<PredictionResult>("/predict", application);
  return data;
}

export async function explain(params: {
  application: LoanApplication;
  role: ExplainRole;
  user_id: string;
  detail_level?: DetailLevel;
}): Promise<HCXAIExplanationResult> {
  const { data } = await apiClient.post<HCXAIExplanationResult>("/explain", params);
  return data;
}

export async function listPredictions(limit = 20, offset = 0): Promise<PaginatedPredictions> {
  const { data } = await apiClient.get<PaginatedPredictions>("/predictions", {
    params: { limit, offset },
  });
  return data;
}

export async function getPredictionDetail(id: number): Promise<PredictionDetail> {
  const { data } = await apiClient.get<PredictionDetail>(`/predictions/${id}`);
  return data;
}

// --------------------------------------------------------------------------
// Feedback / Trust (HCXAI)
// --------------------------------------------------------------------------

export async function submitFeedback(payload: {
  prediction_id: number;
  user_id: string;
  action: "approve" | "reject" | "override";
  human_decision?: "Approved" | "Rejected";
  confidence_rating?: number;
  trust_rating?: number;
  comment?: string;
}) {
  const { data } = await apiClient.post("/feedback", payload);
  return data as { feedback_id: number; trust_calibration: TrustDashboard["trust_calibration"] };
}

export async function getTrustDashboard(userId: string): Promise<HCXAITrustDashboard> {
  const { data } = await apiClient.get<HCXAITrustDashboard>(`/trust/${encodeURIComponent(userId)}`);
  return data;
}

export async function getFeedbackAnalytics(): Promise<FeedbackAnalytics> {
  const { data } = await apiClient.get<FeedbackAnalytics>("/feedback/analytics");
  return data;
}

// --------------------------------------------------------------------------
// HCXAI: Human Override Analysis, Satisfaction, Explanation History, Provenance
// --------------------------------------------------------------------------

export async function getOverrideAnalysis(userId?: string): Promise<OverrideAnalysisResult> {
  const { data } = await apiClient.get<OverrideAnalysisResult>("/hcxai/override-analysis", {
    params: userId ? { user_id: userId } : undefined,
  });
  return data;
}

export async function getSatisfactionMetrics(userId?: string): Promise<SatisfactionMetrics> {
  const { data } = await apiClient.get<SatisfactionMetrics>("/hcxai/satisfaction", {
    params: userId ? { user_id: userId } : undefined,
  });
  return data;
}

export async function getExplanationHistory(userId: string): Promise<ExplanationHistoryItem[]> {
  const { data } = await apiClient.get<ExplanationHistoryItem[]>(
    `/hcxai/explanation-history/${encodeURIComponent(userId)}`
  );
  return data;
}

export async function getDecisionProvenance(predictionId: number): Promise<DecisionProvenance> {
  const { data } = await apiClient.get<DecisionProvenance>(`/hcxai/provenance/${predictionId}`);
  return data;
}

// --------------------------------------------------------------------------
// XAI: LIME, Counterfactual, Global Explainability, Explanation Quality
// --------------------------------------------------------------------------

export async function explainWithLime(application: LoanApplication): Promise<LimeExplanationResult> {
  const { data } = await apiClient.post<LimeExplanationResult>("/explain/lime", { application });
  return data;
}

export async function explainWithCounterfactual(
  application: LoanApplication,
  n_results = 3
): Promise<CounterfactualResult> {
  const { data } = await apiClient.post<CounterfactualResult>("/explain/counterfactual", {
    application,
    n_results,
  });
  return data;
}

export async function getGlobalExplainability(): Promise<GlobalExplainabilityResult> {
  const { data } = await apiClient.get<GlobalExplainabilityResult>("/explain/global");
  return data;
}

export async function getExplanationQuality(application: LoanApplication): Promise<ExplanationQualityReport> {
  const { data } = await apiClient.post<ExplanationQualityReport>("/explain/quality", { application });
  return data;
}

// --------------------------------------------------------------------------
// What-If Lab
// --------------------------------------------------------------------------

export async function runWhatIf(
  application: LoanApplication,
  overrides: Record<string, number | string>
): Promise<WhatIfResult> {
  const { data } = await apiClient.post<WhatIfResult>("/whatif", { application, overrides });
  return data;
}

export async function runSensitivitySweep(
  application: LoanApplication,
  feature: string,
  n_points = 12
): Promise<SensitivityResult> {
  const { data } = await apiClient.post<SensitivityResult>("/whatif/sensitivity", {
    application,
    feature,
    n_points,
  });
  return data;
}

// --------------------------------------------------------------------------
// Similar Cases
// --------------------------------------------------------------------------

export async function findSimilarCases(
  application: LoanApplication,
  k = 5
): Promise<SimilarCasesResult> {
  const { data } = await apiClient.post<SimilarCasesResult>("/similar-cases", { application, k });
  return data;
}

// --------------------------------------------------------------------------
// Fairness & Monitoring
// --------------------------------------------------------------------------

export async function getFairnessReport(): Promise<FairnessReport> {
  const { data } = await apiClient.get<FairnessReport>("/fairness/report");
  return data;
}

export async function getMonitoringSnapshot(): Promise<MonitoringSnapshot> {
  const { data } = await apiClient.get<MonitoringSnapshot>("/monitoring/snapshot");
  return data;
}

export async function getHealth() {
  const { data } = await apiClient.get<{
    status: string;
    model_loaded: boolean;
    deepseek_enabled: boolean;
    db_path: string;
  }>("/health");
  return data;
}

// --------------------------------------------------------------------------
// AI Model Center: Model Registry / Experiment Tracking / Champion-Challenger
// --------------------------------------------------------------------------

export async function listModelVersions(): Promise<ModelVersion[]> {
  const { data } = await apiClient.get<ModelVersion[]>("/model/versions");
  return data;
}

export async function getActiveModelVersion(): Promise<ModelVersion> {
  const { data } = await apiClient.get<ModelVersion>("/model/versions/active");
  return data;
}

export async function trainModelVersion(payload: {
  notes?: string;
  activate?: boolean;
}): Promise<ModelVersion> {
  const { data } = await apiClient.post<ModelVersion>("/model/train", payload);
  return data;
}

export async function activateModelVersion(versionLabel: string): Promise<ModelVersion> {
  const { data } = await apiClient.post<ModelVersion>("/model/activate", {
    version_label: versionLabel,
  });
  return data;
}

export async function compareModelVersions(
  versionA: string,
  versionB: string
): Promise<ModelComparisonResult> {
  const { data } = await apiClient.post<ModelComparisonResult>("/model/compare", {
    version_a: versionA,
    version_b: versionB,
  });
  return data;
}

// --------------------------------------------------------------------------
// AI Governance: Audit Trail
// --------------------------------------------------------------------------

export async function listAuditLog(
  limit = 100,
  offset = 0,
  action?: string
): Promise<PaginatedAuditLog> {
  const { data } = await apiClient.get<PaginatedAuditLog>("/audit", {
    params: { limit, offset, action },
  });
  return data;
}
