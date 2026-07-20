"""Pydantic request/response schemas for the HCXAI API."""
from __future__ import annotations

from typing import Literal

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
