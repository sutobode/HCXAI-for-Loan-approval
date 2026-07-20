"""
HCXAI Loan Approval Backend - FastAPI application.

Endpoints:
- GET  /health              Liveness/readiness check
- POST /predict             Risk prediction only (no explanation)
- POST /explain             Full HCXAI explanation: SHAP contributions + DeepSeek narrative

Run (from backend/ directory, inside the 'hcxai' conda env):
    uvicorn app.main:app --reload --port 8000
"""
from __future__ import annotations

import logging

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .data_processing import encode_single_application
from .deepseek_client import generate_narrative_explanation
from .explainer import get_explainer
from .schemas import (
    ExplainRequest,
    ExplanationResponse,
    LoanApplicationRequest,
    PredictionResponse,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

app = FastAPI(title=settings.API_TITLE, version=settings.API_VERSION)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {
        "status": "ok",
        "model_loaded": settings.MODEL_PATH.exists(),
        "deepseek_enabled": settings.deepseek_enabled,
    }


@app.post("/predict", response_model=PredictionResponse)
def predict(application: LoanApplicationRequest):
    try:
        explainer = get_explainer()
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    features_df = encode_single_application(application.model_dump(), explainer.encoders)
    result = explainer.predict(features_df)
    return PredictionResponse(**result)


@app.post("/explain", response_model=ExplanationResponse)
def explain(request: ExplainRequest):
    try:
        explainer = get_explainer()
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    features_df = encode_single_application(request.application.model_dump(), explainer.encoders)
    prediction = explainer.predict(features_df)
    shap_result = explainer.explain(features_df)

    narrative_result = generate_narrative_explanation(prediction, shap_result, role=request.role)

    return ExplanationResponse(
        prediction=PredictionResponse(**prediction),
        base_value=shap_result["base_value"],
        contributions=shap_result["contributions"],
        narrative=narrative_result["narrative"],
        narrative_model=narrative_result["model"],
    )
