/**
 * Shared TypeScript types mirroring the backend Pydantic schemas
 * (backend/app/schemas.py). Keep these in sync when the API changes.
 */

export type UserRole = "admin" | "risk_manager" | "loan_officer" | "customer";

export interface User {
  id: number;
  email: string;
  full_name: string;
  role: UserRole;
  is_active: boolean;
  created_at: string;
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  user: User;
}

export interface LoanApplication {
  no_of_dependents: number;
  education: "Graduate" | "Not Graduate";
  self_employed: "Yes" | "No";
  income_annum: number;
  loan_amount: number;
  loan_term: number;
  cibil_score: number;
  residential_assets_value: number;
  commercial_assets_value: number;
  luxury_assets_value: number;
  bank_asset_value: number;
}

export interface PredictionResult {
  approval_probability: number;
  risk_score: number;
  prediction: "Approved" | "Rejected";
  confidence: number;
}

export interface FeatureContribution {
  feature: string;
  display_name: string;
  value: number;
  shap_contribution: number;
  direction: "increases_approval" | "decreases_approval";
}

export type DetailLevel = "summary" | "detailed" | "technical";
export type ExplainRole = "customer" | "loan_officer" | "risk_analyst" | "executive";

export interface ProgressiveExplanation {
  level: DetailLevel;
  headline: string;
  narrative: string;
  top_reason?: string;
  approval_probability?: number;
  risk_score?: number;
  top_factors?: FeatureContribution[];
  prediction?: PredictionResult;
  base_value?: number;
  all_contributions?: FeatureContribution[];
}

export interface UserProfile {
  user_id: string;
  role: UserRole | string;
  expertise_level: number;
  preferred_detail_level: DetailLevel;
  total_interactions: number;
  agreements: number;
  disagreements: number;
  updated_at: string;
}

export interface ExplanationResult {
  prediction: PredictionResult;
  base_value: number;
  contributions: FeatureContribution[];
  narrative: string;
  narrative_model: string;
  prediction_id: number;
  application_id: number;
  progressive: ProgressiveExplanation;
  user_profile: UserProfile;
}

export interface TrustCalibration {
  user_id: string;
  events: number;
  agreement_rate: number | null;
  avg_ai_confidence_on_agreement?: number | null;
  avg_ai_confidence_on_disagreement?: number | null;
  trust_state: "over_trust" | "under_trust" | "well_calibrated" | "insufficient_data";
}

export interface TrustDashboard {
  profile: UserProfile;
  trust_calibration: TrustCalibration;
}

export interface FeedbackAnalytics {
  total_feedback_events: number;
  by_action: Record<string, number>;
  average_trust_rating: number | null;
}

export interface WhatIfResult {
  base_prediction: PredictionResult;
  updated_prediction: PredictionResult;
  decision_changed: boolean;
  probability_delta: number;
  overrides_applied: Record<string, number | string>;
}

export interface SensitivityPoint {
  value: number;
  approval_probability: number;
  prediction: "Approved" | "Rejected";
}

export interface SensitivityResult {
  feature: string;
  base_value: number;
  points: SensitivityPoint[];
}

export interface SimilarCase {
  loan_id: number;
  similarity_score: number;
  distance: number;
  outcome: "Approved" | "Rejected";
  features: Record<string, number | string>;
}

export interface SimilarCasesResult {
  cases: SimilarCase[];
  outcome_distribution: {
    approved: number;
    rejected: number;
    approval_rate: number | null;
  };
}

export interface FairnessGroupResult {
  approval_rate_by_group: Record<string, number>;
  sample_size_by_group: Record<string, number>;
  parity_ratio: number | null;
  passes_four_fifths_rule: boolean | null;
}

export interface FairnessReport {
  n_samples: number;
  overall_approval_rate_predicted: number;
  overall_approval_rate_actual: number;
  by_attribute: Record<string, FairnessGroupResult>;
  compliance_summary: {
    attributes_checked: string[];
    violations: string[];
    overall_compliant: boolean;
  };
  mitigation_recommendations: MitigationRecommendation[];
}

export interface DriftFeatureResult {
  ks_statistic: number;
  p_value: number;
  drift_detected: boolean;
}

export interface DriftReport {
  status: "ok" | "no_data";
  n_reference?: number;
  n_recent?: number;
  features: Record<string, DriftFeatureResult>;
  drifted_features?: string[];
  overall_drift_detected?: boolean;
}

export interface MonitoringSnapshot {
  training_metrics: {
    feature_columns: string[] | null;
    model_type: string;
    version_label?: string;
    metrics: {
      accuracy: number;
      f1_score: number;
      auc: number;
      n_train: number;
      n_test: number;
    };
  } | null;
  n_predictions_served: number;
  drift_report: DriftReport;
  prediction_drift: PredictionDriftReport;
}

export interface PaginatedPredictions {
  items: PredictionRecord[];
  total: number;
  limit: number;
  offset: number;
}

export interface PredictionRecord {
  id: number;
  application_id: number;
  created_at: string;
  prediction: "Approved" | "Rejected";
  approval_probability: number;
  risk_score: number;
  confidence: number;
  narrative?: string | null;
  narrative_model?: string | null;
  applicant_id?: number | null;
  applicant_name?: string | null;
}

export interface PredictionDetail extends PredictionRecord {
  shap_result: {
    base_value: number;
    contributions: FeatureContribution[];
  };
  feedback: FeedbackRecord[];
}

export interface FeedbackRecord {
  id: number;
  prediction_id: number;
  user_id: string;
  created_at: string;
  action: "approve" | "reject" | "override";
  human_decision?: string | null;
  confidence_rating?: number | null;
  trust_rating?: number | null;
  comment?: string | null;
}

export interface ApiError {
  detail: string | { msg: string; loc: (string | number)[] }[];
}

// --------------------------------------------------------------------------
// HCXAI: Explanation Recommendation Engine
// --------------------------------------------------------------------------

export interface ExplanationStrategy {
  detail_level: DetailLevel;
  suggest_counterfactual: boolean;
  suggest_similar_cases: boolean;
  trust_intervention: "none" | "highlight_uncertainty" | "highlight_evidence";
  rationale: string[];
}

// ExplanationResult now also carries the Explanation Recommendation Engine's
// output alongside the rest of the /explain response.
export interface HCXAIExplanationResult extends ExplanationResult {
  explanation_strategy: ExplanationStrategy;
}

// --------------------------------------------------------------------------
// HCXAI: Trust Dashboard (extended)
// --------------------------------------------------------------------------

export interface TrustTrend {
  trend: "increasing" | "decreasing" | "stable" | "insufficient_data";
  recent_agreement_rate: number | null;
  prior_agreement_rate: number | null;
}

export interface OverrideDirectionStats {
  total_overrides: number;
  reject_to_approve_count: number;
  approve_to_reject_count: number;
  /** -1 (very conservative) .. +1 (very lenient) */
  risk_tolerance: number | null;
}

export interface SatisfactionMetrics {
  scope: string;
  n_ratings: number;
  avg_trust_rating: number | null;
  avg_confidence_rating: number | null;
  by_action: { action: string; avg_trust_rating: number | null; n: number }[];
}

export interface HCXAITrustDashboard extends TrustDashboard {
  trust_trend: TrustTrend;
  override_direction: OverrideDirectionStats;
  satisfaction: SatisfactionMetrics;
}

// --------------------------------------------------------------------------
// HCXAI: Human Override Analysis
// --------------------------------------------------------------------------

export interface ConfidenceBucket {
  confidence_range: string;
  n_events: number;
  disagreement_rate: number | null;
}

export interface OverrideAnalysisByConfidence {
  scope: string;
  buckets: ConfidenceBucket[];
  well_calibrated_pattern: boolean | null;
}

export interface OverrideAnalysisResult {
  by_confidence: OverrideAnalysisByConfidence;
  direction: OverrideDirectionStats | null;
}

// --------------------------------------------------------------------------
// HCXAI: Explanation History & Decision Provenance
// --------------------------------------------------------------------------

export interface ExplanationHistoryItem {
  id: number;
  created_at: string;
  prediction: "Approved" | "Rejected";
  approval_probability: number;
  confidence: number;
  narrative: string | null;
  narrative_model: string | null;
  model_version: string;
}

export interface DecisionProvenance {
  prediction_id: number;
  application: {
    id: number;
    created_at: string;
    features: Record<string, number | string>;
  } | null;
  model_version: ModelVersion | null;
  prediction_summary: {
    prediction: "Approved" | "Rejected";
    approval_probability: number;
    confidence: number;
    created_at: string;
  };
  feedback_events: FeedbackRecord[];
}

// --------------------------------------------------------------------------
// XAI: LIME
// --------------------------------------------------------------------------

export interface LimeContribution {
  feature: string;
  display_name: string;
  value: number;
  lime_weight: number;
  direction: "increases_approval" | "decreases_approval";
}

export interface LimeExplanationResult {
  local_model_prediction: number;
  actual_model_prediction: number;
  fidelity_r2: number | null;
  contributions: LimeContribution[];
  n_samples: number;
}

// --------------------------------------------------------------------------
// XAI: Counterfactual Explanation Engine
// --------------------------------------------------------------------------

export interface CounterfactualFeatureChange {
  feature: string;
  display_name: string;
  original_value: number;
  suggested_value: number;
  delta: number;
}

export interface CounterfactualCandidate {
  changes: CounterfactualFeatureChange[];
  resulting_decision: "Approved" | "Rejected";
  resulting_probability: number;
  normalized_distance: number;
  n_features_changed: number;
}

export interface CounterfactualResult {
  original_decision: "Approved" | "Rejected";
  original_probability: number;
  target_decision: "Approved" | "Rejected";
  counterfactuals: CounterfactualCandidate[];
  search_config: {
    n_restarts: number;
    n_iterations_per_restart: number;
    actionable_features: string[];
  };
}

// --------------------------------------------------------------------------
// XAI: Global Explainability
// --------------------------------------------------------------------------

export interface GlobalFeatureImportance {
  feature: string;
  display_name: string;
  mean_abs_shap: number;
  mean_signed_shap: number;
  std_abs_shap: number;
  overall_direction: "increases_approval" | "decreases_approval";
  relative_importance_pct: number;
}

export interface GlobalExplainabilityResult {
  sample_size: number;
  feature_importance: GlobalFeatureImportance[];
  base_value: number;
}

// --------------------------------------------------------------------------
// XAI: Explanation Quality / Fidelity
// --------------------------------------------------------------------------

export interface ExplanationQualityReport {
  stability: {
    stability_score: number | null;
    n_perturbations_tested: number;
    interpretation: "highly_stable" | "moderately_stable" | "unstable" | "insufficient_data";
  };
  completeness: {
    base_value: number;
    sum_contributions: number;
    reconstructed_output: number;
    actual_model_output: number;
    reconstruction_error: number;
    is_complete: boolean;
  };
  sparsity: {
    top_k: number;
    concentration_ratio: number;
    interpretation: "concise" | "moderately_concise" | "diffuse";
  };
  composite_quality_score: number;
}

// --------------------------------------------------------------------------
// AI Model Center: Model Registry
// --------------------------------------------------------------------------

export interface ModelMetrics {
  accuracy: number;
  precision: number;
  recall: number;
  f1_score: number;
  auc: number;
  n_train: number;
  n_test: number;
  confusion_matrix: number[][];
  roc_curve: { fpr: number; tpr: number }[];
  precision_recall_curve: { precision: number; recall: number }[];
  calibration_curve: { mean_predicted: number; fraction_positive: number }[];
}

export interface ModelVersion {
  id: number;
  version_label: string;
  created_at: string;
  trained_by: string;
  algorithm: string;
  hyperparameters: Record<string, number | string>;
  metrics: ModelMetrics;
  artifact_dir: string;
  is_active: boolean;
  notes: string | null;
}

export interface ModelComparisonResult {
  version_a: ModelVersion;
  version_b: ModelVersion;
  metric_deltas: Record<string, number>;
  recommendation: string;
}

// --------------------------------------------------------------------------
// Fairness: Bias Mitigation
// --------------------------------------------------------------------------

export interface MitigationRecommendation {
  attribute: string;
  advantaged_group: string;
  disadvantaged_group: string;
  approval_rate_gap: number;
  recommendation: string;
  requires_human_approval: boolean;
}

// --------------------------------------------------------------------------
// Monitoring: Prediction Drift
// --------------------------------------------------------------------------

export interface PredictionDriftReport {
  status: "ok" | "insufficient_data";
  n_snapshots?: number;
  required?: number;
  ks_statistic?: number;
  p_value?: number;
  drift_detected?: boolean;
  recent_window_mean?: number;
  prior_window_mean?: number;
  window_size?: number;
}

// --------------------------------------------------------------------------
// AI Governance: Audit Trail
// --------------------------------------------------------------------------

export interface AuditLogEntry {
  id: number;
  created_at: string;
  user_id: string | null;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  details: Record<string, unknown>;
}

export interface PaginatedAuditLog {
  items: AuditLogEntry[];
  total: number;
  limit: number;
  offset: number;
}

// --------------------------------------------------------------------------
// Applicants (Customers) -- Loan Queue
// --------------------------------------------------------------------------

export interface Applicant {
  id: number;
  full_name: string;
  phone: string | null;
  email: string | null;
  date_of_birth: string | null;
  occupation: string | null;
  address: string | null;
  notes: string | null;
  created_at: string;
}

export interface ApplicantQueueItem extends Applicant {
  total_applications: number;
  latest_prediction: {
    prediction_id: number;
    prediction: "Approved" | "Rejected";
    confidence: number;
    created_at: string;
  } | null;
}

export interface PaginatedApplicants {
  items: ApplicantQueueItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface ApplicantDetail {
  applicant: Applicant;
  applications: {
    id: number;
    applicant_id: number;
    created_at: string;
    features: Record<string, number | string>;
    latest_prediction: {
      id: number;
      prediction: "Approved" | "Rejected";
      approval_probability: number;
      risk_score: number;
      confidence: number;
      created_at: string;
    } | null;
  }[];
}
