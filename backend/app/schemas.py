"""Pydantic request/response schemas for the HCXAI API."""
from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


class LoanApplicationRequest(BaseModel):
    no_of_dependents: int = Field(ge=0, le=20)
    education: Literal["Graduate", "Not Graduate"]
    self_employed: Literal["Yes", "No"]
    income_annum: float = Field(gt=0)
    loan_amount: float = Field(gt=0)
    loan_term: int = Field(gt=0, description="Loan term in months")
    cibil_score: int = Field(ge=300, le=900)
    residential_assets_value: float = Field(ge=0)
    commercial_assets_value: float = Field(ge=0)
    luxury_assets_value: float = Field(ge=0)
    bank_asset_value: float = Field(ge=0)

    class Config:
        json_schema_extra = {
            "example": {
                "no_of_dependents": 2,
                "education": "Graduate",
                "self_employed": "No",
                "income_annum": 9600000,
                "loan_amount": 29900000,
                "loan_term": 12,
                "cibil_score": 778,
                "residential_assets_value": 2400000,
                "commercial_assets_value": 17600000,
                "luxury_assets_value": 22700000,
                "bank_asset_value": 8000000,
            }
        }


class PredictionResponse(BaseModel):
    approval_probability: float
    risk_score: float
    prediction: str
    confidence: float


class FeatureContribution(BaseModel):
    feature: str
    display_name: str
    value: float
    shap_contribution: float
    direction: str


class ExplanationResponse(BaseModel):
    prediction: PredictionResponse
    base_value: float
    contributions: list[FeatureContribution]
    narrative: str
    narrative_model: str


class ExplainRequest(BaseModel):
    application: LoanApplicationRequest
    role: Literal["customer", "loan_officer", "risk_analyst", "executive"] = "loan_officer"
    user_id: str = Field(default="anonymous", description="Used by the HCXAI User Modeler")
    detail_level: Literal["summary", "detailed", "technical"] | None = Field(
        default=None,
        description="Overrides the user's learned preferred detail level (Progressive Disclosure)",
    )
    applicant_id: int | None = Field(
        default=None,
        description="Links this prediction to an existing Applicant (Loan Queue) record, if scoring one",
    )


class HCXAIExplanationResponse(ExplanationResponse):
    prediction_id: int
    application_id: int
    progressive: dict[str, Any]
    user_profile: dict[str, Any]
    explanation_strategy: dict[str, Any]


class FeedbackRequest(BaseModel):
    prediction_id: int
    user_id: str = "anonymous"
    action: Literal["approve", "reject", "override"]
    human_decision: Literal["Approved", "Rejected"] | None = None
    confidence_rating: int | None = Field(default=None, ge=1, le=5)
    trust_rating: int | None = Field(default=None, ge=1, le=5)
    comment: str | None = None


class FeedbackResponse(BaseModel):
    feedback_id: int
    trust_calibration: dict[str, Any]


class WhatIfRequest(BaseModel):
    application: LoanApplicationRequest
    overrides: dict[str, float | int | str] = Field(default_factory=dict)


class SensitivitySweepRequest(BaseModel):
    application: LoanApplicationRequest
    feature: str
    n_points: int = Field(default=10, ge=3, le=15)


class SimilarCasesRequest(BaseModel):
    application: LoanApplicationRequest
    k: int = Field(default=5, ge=1, le=20)


# ---------------------------------------------------------------------------
# Auth & Users
# ---------------------------------------------------------------------------

UserRole = Literal["admin", "risk_manager", "loan_officer", "customer"]


class RegisterRequest(BaseModel):
    email: str = Field(min_length=3, max_length=255)
    full_name: str = Field(min_length=1, max_length=255)
    password: str = Field(min_length=8, max_length=128)
    role: UserRole = "loan_officer"


class LoginRequest(BaseModel):
    email: str
    password: str


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8, max_length=128)


class UserResponse(BaseModel):
    id: int
    email: str
    full_name: str
    role: UserRole
    is_active: bool
    created_at: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserResponse


class PaginatedPredictions(BaseModel):
    items: list[dict[str, Any]]
    total: int
    limit: int
    offset: int


# ---------------------------------------------------------------------------
# XAI: LIME, Counterfactuals, Global Explainability, Explanation Quality
# ---------------------------------------------------------------------------

class LimeExplainRequest(BaseModel):
    application: LoanApplicationRequest


class CounterfactualRequest(BaseModel):
    application: LoanApplicationRequest
    n_results: int = Field(default=3, ge=1, le=5)


class ExplanationQualityRequest(BaseModel):
    application: LoanApplicationRequest


# ---------------------------------------------------------------------------
# Applicants (Customers) -- Loan Queue
# ---------------------------------------------------------------------------

class ApplicantResponse(BaseModel):
    id: int
    full_name: str
    phone: str | None = None
    email: str | None = None
    date_of_birth: str | None = None
    occupation: str | None = None
    address: str | None = None
    notes: str | None = None
    created_at: str


class ApplicantQueueItem(ApplicantResponse):
    total_applications: int
    latest_prediction: dict[str, Any] | None = None


class PaginatedApplicants(BaseModel):
    items: list[ApplicantQueueItem]
    total: int
    limit: int
    offset: int


class CreateApplicantRequest(BaseModel):
    full_name: str = Field(min_length=1, max_length=255)
    phone: str | None = Field(default=None, max_length=32)
    email: str | None = Field(default=None, max_length=255)
    date_of_birth: str | None = None
    occupation: str | None = Field(default=None, max_length=255)
    address: str | None = Field(default=None, max_length=500)
    notes: str | None = Field(default=None, max_length=1000)


# ---------------------------------------------------------------------------
# AI Model Center: Model Registry
# ---------------------------------------------------------------------------

class TrainModelRequest(BaseModel):
    notes: str | None = None
    activate: bool = True


class ActivateModelRequest(BaseModel):
    version_label: str


class CompareModelsRequest(BaseModel):
    version_a: str
    version_b: str
