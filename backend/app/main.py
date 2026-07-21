"""
HCXAI Loan Approval Backend - FastAPI application.

Endpoints (grouped by capability; full schemas in app/schemas.py, browsable at /docs):

Auth & RBAC:
- GET  /health                    Liveness/readiness check (public)
- POST /auth/register             Create a new user account (admin only)
- POST /auth/login                Obtain a JWT access token
- GET  /auth/me                   Current authenticated user's profile
- GET  /auth/users                List all users (admin only)

Predictions:
- POST /predict                   Risk prediction only (admin/risk_manager/loan_officer)
- POST /explain                   Full HCXAI explanation: SHAP + DeepSeek narrative +
                                   Explanation Recommendation Engine + persisted to SQLite
- GET  /predictions                Paginated list of recent predictions (Loan Queue)
- GET  /predictions/{id}           Single prediction detail incl. stored SHAP + feedback

XAI (Explainability Center):
- POST /explain/lime               LIME-style local surrogate (independent SHAP cross-check)
- POST /explain/counterfactual     Self-written minimal-change counterfactual search
- GET  /explain/global             Aggregate SHAP feature importance across the dataset
- POST /explain/quality            Stability / completeness / sparsity metrics for one explanation

HCXAI (Human-Centered XAI Center):
- POST /feedback                  Feedback Learner: record approve/reject/override
- GET  /trust/{user_id}           Trust Dashboard (profile, calibration, trend, override direction, satisfaction)
- GET  /feedback/analytics        Human Feedback Center: override analytics (admin/risk_manager)
- GET  /hcxai/override-analysis   Human Override Analysis by AI confidence bucket
- GET  /hcxai/satisfaction        Explanation Satisfaction Metrics
- GET  /hcxai/explanation-history/{user_id}  Explanation History for a user
- GET  /hcxai/provenance/{prediction_id}     Decision Provenance (full lineage)

Fairness & Responsible AI:
- GET  /fairness/report                       Demographic parity + four-fifths rule check
- GET  /fairness/mitigation-recommendations   Bias mitigation threshold recommendations (admin/risk_manager)

Model Monitoring:
- GET  /monitoring/snapshot        Training metrics + feature drift + prediction drift

AI Model Center (Model Registry):
- GET  /model/versions             List all trained model versions
- GET  /model/versions/active      Currently active (champion) version
- POST /model/train                Train a new version (admin; Continuous Learning trigger)
- POST /model/activate             Champion-Challenger switch (admin)
- POST /model/compare              Side-by-side metric comparison between two versions

AI Governance:
- GET  /audit                      Paginated audit trail of platform actions (admin only)

Interactive tools:
- POST /whatif                    Interactive What-If Lab: single scenario comparison
- POST /whatif/sensitivity        Interactive What-If Lab: sensitivity sweep
- POST /similar-cases             Similar Case Explorer (k-NN over training data)

All endpoints except /health, /auth/login are protected by JWT bearer auth.
RBAC roles: admin, risk_manager, loan_officer, customer.

Run (from backend/ directory, inside the 'hcxai' conda env):
    uvicorn app.main:app --reload --port 8000
"""
from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from . import auth, db, hcxai
from .config import settings
from .counterfactual import find_counterfactuals
from .data_processing import encode_single_application
from .deepseek_client import generate_narrative_explanation
from .explainer import get_explainer
from .explanation_quality import compute_explanation_quality_report
from .fairness import compute_fairness_report
from .global_explainability import compute_global_importance
from .lime_explainer import get_lime_explainer
from .model_registry import compare_versions, train_new_version
from .monitoring import get_monitoring_snapshot
from .schemas import (
    ActivateModelRequest,
    ChangePasswordRequest,
    CompareModelsRequest,
    CounterfactualRequest,
    ExplainRequest,
    ExplanationQualityRequest,
    FeedbackRequest,
    FeedbackResponse,
    HCXAIExplanationResponse,
    LimeExplainRequest,
    LoanApplicationRequest,
    LoginRequest,
    PaginatedPredictions,
    PredictionResponse,
    RegisterRequest,
    SensitivitySweepRequest,
    SimilarCasesRequest,
    TokenResponse,
    TrainModelRequest,
    UserResponse,
    WhatIfRequest,
)
from .similar_cases import get_similar_case_index
from .whatif import run_whatif, sensitivity_sweep

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init_db()
    logger.info("SQLite database initialized at %s", settings.SQLITE_PATH)

    if not db.user_exists():
        default_admin_email = os.getenv("DEFAULT_ADMIN_EMAIL", "admin@hcxai.local")
        default_admin_password = os.getenv("DEFAULT_ADMIN_PASSWORD", "ChangeMe123!")
        db.create_user(
            email=default_admin_email,
            full_name="System Administrator",
            hashed_password=auth.hash_password(default_admin_password),
            role="admin",
        )
        logger.warning(
            "No users found - created default admin account (%s). "
            "Change this password immediately via /auth/me or DEFAULT_ADMIN_PASSWORD env var.",
            default_admin_email,
        )
    yield


app = FastAPI(title=settings.API_TITLE, version=settings.API_VERSION, lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=True,
)


@app.exception_handler(Exception)
async def unhandled_exception_handler(request, exc: Exception):
    """Catch-all handler so unexpected errors never leak stack traces to clients."""
    logger.exception("Unhandled exception on %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error. Please try again or contact support."},
    )


def _get_explainer_or_503():
    try:
        return get_explainer()
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


_PRIVILEGED_ROLES = ("admin", "risk_manager")


def _require_self_or_privileged(current_user: dict, target_user_id: str) -> None:
    """
    Read-path ownership check for per-user HCXAI endpoints (Trust Dashboard,
    Explanation History, Explanation Satisfaction): any authenticated user
    may view their *own* data, but viewing another user's personal profile/
    history/ratings requires admin or risk_manager. Without this, any
    authenticated user (including 'customer') could read another user's
    trust profile or explanation history just by knowing their email.
    """
    if current_user["role"] in _PRIVILEGED_ROLES:
        return
    if current_user["email"].lower() == target_user_id.lower():
        return
    raise HTTPException(
        status_code=403,
        detail="You may only view your own data. Admin or risk_manager role is required to view another user's.",
    )


def _require_matching_user_id_for_customers(current_user: dict, request_user_id: str) -> None:
    """
    Write-path counterpart to _require_self_or_privileged, for /explain and
    /feedback: those endpoints accept a free-text `user_id` field (so staff
    can submit/explain applications on behalf of a customer, and the HCXAI
    User Modeler/Trust Calibrator can track that customer's own profile
    rather than the staff member's). Staff roles (admin, risk_manager,
    loan_officer) are exempt -- processing applications on behalf of
    customers is their normal job. A 'customer' account, however, must only
    ever write under their own email; otherwise any customer could pass
    another customer's email as `user_id` and pollute that person's
    cognitive profile / trust calibration history.
    """
    if current_user["role"] != "customer":
        return
    if current_user["email"].lower() == request_user_id.lower():
        return
    raise HTTPException(
        status_code=403,
        detail="Customers may only submit applications or feedback under their own account.",
    )


@app.get("/health")
def health():
    return {
        "status": "ok",
        "model_loaded": settings.MODEL_PATH.exists(),
        "deepseek_enabled": settings.deepseek_enabled,
        "db_path": str(settings.SQLITE_PATH),
    }


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------

@app.post("/auth/register", response_model=UserResponse, status_code=201)
def register(request: RegisterRequest, current_user: dict = Depends(auth.require_roles("admin"))):
    """Only admins can create new user accounts (RBAC)."""
    if db.get_user_by_email(request.email):
        raise HTTPException(status_code=409, detail="A user with this email already exists")

    user = db.create_user(
        email=request.email,
        full_name=request.full_name,
        hashed_password=auth.hash_password(request.password),
        role=request.role,
    )
    logger.info("Admin %s created new user %s (role=%s)", current_user["email"], user["email"], user["role"])
    db.log_audit_event(
        user_id=current_user["email"],
        action="auth.register",
        resource_type="user",
        resource_id=user["email"],
        details={"role": user["role"]},
    )
    return UserResponse(**{**user, "is_active": bool(user["is_active"])})


@app.post("/auth/login", response_model=TokenResponse)
def login(request: LoginRequest):
    user = auth.authenticate_user(request.email, request.password)
    if not user:
        db.log_audit_event(user_id=request.email, action="login.failed")
        raise HTTPException(status_code=401, detail="Incorrect email or password")

    token = auth.create_access_token(user)
    logger.info("User %s logged in", user["email"])
    db.log_audit_event(user_id=user["email"], action="login.success")
    return TokenResponse(
        access_token=token,
        user=UserResponse(**{**user, "is_active": bool(user["is_active"])}),
    )


@app.get("/auth/me", response_model=UserResponse)
def get_me(current_user: dict = Depends(auth.get_current_user)):
    return UserResponse(**{**current_user, "is_active": bool(current_user["is_active"])})


@app.post("/auth/change-password", status_code=204)
def change_password(
    request: ChangePasswordRequest,
    current_user: dict = Depends(auth.require_authenticated),
):
    """
    Let any authenticated user (including the default admin account) rotate
    their own password. Requires the current password to prevent a stolen/
    left-open session from silently locking out the real owner.
    """
    if not auth.verify_password(request.current_password, current_user["hashed_password"]):
        raise HTTPException(status_code=401, detail="Current password is incorrect")

    db.update_user_password(current_user["id"], auth.hash_password(request.new_password))
    db.log_audit_event(user_id=current_user["email"], action="auth.change_password")


@app.get("/auth/users", response_model=list[UserResponse])
def list_all_users(current_user: dict = Depends(auth.require_roles("admin"))):
    users = db.list_users(limit=200)
    return [UserResponse(**{**u, "is_active": bool(u["is_active"])}) for u in users]


@app.post("/predict", response_model=PredictionResponse)
def predict(
    application: LoanApplicationRequest,
    current_user: dict = Depends(auth.require_roles("admin", "risk_manager", "loan_officer")),
):
    explainer = _get_explainer_or_503()
    features_df = encode_single_application(application.model_dump(), explainer.encoders)
    result = explainer.predict(features_df)
    return PredictionResponse(**result)


@app.post("/explain", response_model=HCXAIExplanationResponse)
def explain(
    request: ExplainRequest,
    current_user: dict = Depends(auth.require_authenticated),
):
    _require_matching_user_id_for_customers(current_user, request.user_id)
    explainer = _get_explainer_or_503()

    features_df = encode_single_application(request.application.model_dump(), explainer.encoders)
    prediction = explainer.predict(features_df)
    shap_result = explainer.explain(features_df)

    narrative_result = generate_narrative_explanation(prediction, shap_result, role=request.role)

    application_id, prediction_id = hcxai.record_prediction_and_context(
        request.application.model_dump(),
        prediction,
        shap_result,
        narrative=narrative_result["narrative"],
        narrative_model=narrative_result["model"],
        model_version=explainer.version_label,
    )
    db.log_audit_event(
        user_id=current_user["email"],
        action="explain",
        resource_type="prediction",
        resource_id=str(prediction_id),
        details={"role": request.role, "model_version": explainer.version_label},
    )

    strategy = hcxai.recommend_explanation_strategy(
        request.user_id, prediction, shap_result, detail_override=request.detail_level
    )
    progressive = hcxai.build_progressive_explanation(
        prediction, shap_result, narrative_result["narrative"], strategy.detail_level
    )
    user_profile = db.get_or_create_user_profile(request.user_id, role=request.role)

    return HCXAIExplanationResponse(
        prediction=PredictionResponse(**prediction),
        base_value=shap_result["base_value"],
        contributions=shap_result["contributions"],
        narrative=narrative_result["narrative"],
        narrative_model=narrative_result["model"],
        prediction_id=prediction_id,
        application_id=application_id,
        progressive=progressive,
        user_profile=user_profile,
        explanation_strategy={
            "detail_level": strategy.detail_level,
            "suggest_counterfactual": strategy.suggest_counterfactual,
            "suggest_similar_cases": strategy.suggest_similar_cases,
            "trust_intervention": strategy.trust_intervention,
            "rationale": strategy.rationale,
        },
    )


@app.get("/predictions", response_model=PaginatedPredictions)
def list_predictions(
    limit: int = 20,
    offset: int = 0,
    current_user: dict = Depends(auth.require_authenticated),
):
    """Loan Queue: paginated list of recent predictions (most recent first)."""
    limit = max(1, min(limit, 100))
    all_recent = db.list_recent_predictions(limit=offset + limit)
    page = all_recent[offset : offset + limit]
    return PaginatedPredictions(items=page, total=len(all_recent), limit=limit, offset=offset)


@app.get("/predictions/{prediction_id}")
def get_prediction_detail(
    prediction_id: int,
    current_user: dict = Depends(auth.require_authenticated),
):
    """Loan Detail page: fetch one prediction (with stored SHAP + narrative) by id."""
    pred = db.get_prediction(prediction_id)
    if pred is None:
        raise HTTPException(status_code=404, detail=f"Prediction {prediction_id} not found")
    import json as _json

    pred["shap_result"] = _json.loads(pred.pop("shap_json"))
    pred["feedback"] = db.get_feedback_for_prediction(prediction_id)
    return pred


@app.post("/feedback", response_model=FeedbackResponse)
def submit_feedback(
    request: FeedbackRequest,
    current_user: dict = Depends(auth.require_authenticated),
):
    """
    Human Feedback Center + Feedback Learner: record a human's approve/reject/
    override decision against a previously generated prediction, and feed it
    into the Trust Calibrator + User Modeler.
    """
    _require_matching_user_id_for_customers(current_user, request.user_id)

    pred = db.get_prediction(request.prediction_id)
    if pred is None:
        raise HTTPException(status_code=404, detail=f"Prediction {request.prediction_id} not found")

    feedback_id = db.save_feedback(
        prediction_id=request.prediction_id,
        user_id=request.user_id,
        action=request.action,
        human_decision=request.human_decision,
        confidence_rating=request.confidence_rating,
        trust_rating=request.trust_rating,
        comment=request.comment,
    )

    human_decision = request.human_decision or (
        "Approved" if request.action == "approve" else "Rejected"
    )
    trust_calibration = hcxai.record_human_decision(
        user_id=request.user_id,
        prediction_id=request.prediction_id,
        ai_prediction=pred["prediction"],
        ai_confidence=pred["confidence"],
        human_decision=human_decision,
    )
    db.log_audit_event(
        user_id=current_user["email"],
        action="feedback",
        resource_type="prediction",
        resource_id=str(request.prediction_id),
        details={"action": request.action, "on_behalf_of": request.user_id},
    )

    return FeedbackResponse(feedback_id=feedback_id, trust_calibration=trust_calibration)


@app.get("/trust/{user_id}")
def trust_dashboard(user_id: str, current_user: dict = Depends(auth.require_authenticated)):
    """
    Trust Dashboard (HCXAI_PLATFORM_DESIGN.md Part 5): profile + trust calibration.
    Ownership-checked: a user can only view their own dashboard unless they
    are admin/risk_manager (see _require_self_or_privileged).
    """
    _require_self_or_privileged(current_user, user_id)
    return hcxai.get_trust_dashboard(user_id)


@app.get("/feedback/analytics")
def feedback_analytics(
    current_user: dict = Depends(auth.require_roles("admin", "risk_manager")),
):
    """Human Feedback Center: aggregate override/approval analytics."""
    return db.get_override_analytics()


@app.post("/whatif")
def whatif(
    request: WhatIfRequest,
    current_user: dict = Depends(auth.require_roles("admin", "risk_manager", "loan_officer")),
):
    """Interactive What-If Lab: compare base application vs. overridden scenario."""
    explainer = _get_explainer_or_503()
    try:
        result = run_whatif(explainer, request.application.model_dump(), request.overrides)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    db.log_audit_event(
        user_id=current_user["email"], action="whatif", details={"overrides": request.overrides}
    )
    return result


@app.post("/whatif/sensitivity")
def whatif_sensitivity(
    request: SensitivitySweepRequest,
    current_user: dict = Depends(auth.require_roles("admin", "risk_manager", "loan_officer")),
):
    """Interactive What-If Lab: sensitivity sweep of the approval boundary for one feature."""
    explainer = _get_explainer_or_503()
    try:
        result = sensitivity_sweep(
            explainer, request.application.model_dump(), request.feature, request.n_points
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    db.log_audit_event(
        user_id=current_user["email"], action="whatif.sensitivity", details={"feature": request.feature}
    )
    return result


@app.post("/similar-cases")
def similar_cases(
    request: SimilarCasesRequest,
    current_user: dict = Depends(auth.require_authenticated),
):
    """Similar Case Explorer: k nearest historical applications + outcome distribution."""
    explainer = _get_explainer_or_503()
    features_df = encode_single_application(request.application.model_dump(), explainer.encoders)

    index = get_similar_case_index()
    cases = index.find_similar(features_df, k=request.k)
    db.log_audit_event(user_id=current_user["email"], action="similar_cases", details={"k": request.k})
    return {"cases": cases, "outcome_distribution": index.outcome_distribution(cases)}


@app.get("/fairness/report")
def fairness_report(
    current_user: dict = Depends(auth.require_roles("admin", "risk_manager")),
):
    """Fairness & Responsible AI Center: demographic parity + 80% rule check + mitigation recommendations."""
    explainer = _get_explainer_or_503()
    report = compute_fairness_report(explainer)
    db.log_audit_event(user_id=current_user["email"], action="fairness.report")
    return report


@app.get("/monitoring/snapshot")
def monitoring_snapshot(
    current_user: dict = Depends(auth.require_roles("admin", "risk_manager")),
):
    """Model Monitoring Center: training metrics + feature drift + prediction drift."""
    snapshot = get_monitoring_snapshot()
    db.log_audit_event(user_id=current_user["email"], action="monitoring.snapshot")
    return snapshot


# ---------------------------------------------------------------------------
# XAI: LIME, Counterfactuals, Global Explainability, Explanation Quality
# ---------------------------------------------------------------------------

@app.post("/explain/lime")
def explain_lime(
    request: LimeExplainRequest,
    current_user: dict = Depends(auth.require_authenticated),
):
    """
    LIME-style local explanation: an independent local linear surrogate,
    useful as a cross-check against the SHAP explanation for the same
    instance (agreement between the two increases confidence in the result).
    """
    explainer = _get_explainer_or_503()
    features_df = encode_single_application(request.application.model_dump(), explainer.encoders)
    lime = get_lime_explainer()
    result = lime.explain(features_df)
    db.log_audit_event(user_id=current_user["email"], action="explain.lime")
    return result


@app.post("/explain/counterfactual")
def explain_counterfactual(
    request: CounterfactualRequest,
    current_user: dict = Depends(auth.require_authenticated),
):
    """
    Counterfactual Explanation Engine: minimal, actionable changes that
    would flip the model's current decision (self-implemented DiCE-style
    search; see app/counterfactual.py for the algorithm and rationale).
    """
    explainer = _get_explainer_or_503()
    result = find_counterfactuals(explainer, request.application.model_dump(), n_results=request.n_results)
    db.log_audit_event(user_id=current_user["email"], action="explain.counterfactual")
    return result


@app.get("/explain/global")
def explain_global(
    current_user: dict = Depends(auth.require_roles("admin", "risk_manager", "loan_officer")),
):
    """Global Explainability: aggregate SHAP feature importance across the dataset."""
    explainer = _get_explainer_or_503()
    return compute_global_importance(explainer)


@app.post("/explain/quality")
def explain_quality(
    request: ExplanationQualityRequest,
    current_user: dict = Depends(auth.require_authenticated),
):
    """Explanation Quality: stability, SHAP-additivity completeness, and sparsity metrics."""
    explainer = _get_explainer_or_503()
    result = compute_explanation_quality_report(explainer, request.application.model_dump())
    db.log_audit_event(user_id=current_user["email"], action="explain.quality")
    return result


# ---------------------------------------------------------------------------
# HCXAI: Explanation strategy, override analysis, satisfaction, history, provenance
# ---------------------------------------------------------------------------

@app.get("/hcxai/override-analysis")
def override_analysis(
    user_id: str | None = None,
    current_user: dict = Depends(auth.require_roles("admin", "risk_manager")),
):
    """Human Override Analysis: disagreement rate bucketed by AI confidence, plus override direction."""
    return {
        "by_confidence": db.get_override_analysis_by_confidence(user_id),
        "direction": db.get_override_direction_stats(user_id) if user_id else None,
    }


@app.get("/hcxai/satisfaction")
def satisfaction_metrics(
    user_id: str | None = None,
    current_user: dict = Depends(auth.require_authenticated),
):
    """
    Explanation Satisfaction Metrics: aggregate trust/confidence ratings.
    Omitting user_id returns a platform-wide aggregate (no personal data
    leak). Passing a specific user_id is ownership-checked: only that user
    or an admin/risk_manager may view it.
    """
    if user_id:
        _require_self_or_privileged(current_user, user_id)
    return db.get_satisfaction_metrics(user_id)


@app.get("/hcxai/explanation-history/{user_id}")
def explanation_history(
    user_id: str,
    current_user: dict = Depends(auth.require_authenticated),
):
    """
    Explanation History: every prediction a user has interacted with.
    Ownership-checked: a user can only view their own history unless they
    are admin/risk_manager (see _require_self_or_privileged).
    """
    _require_self_or_privileged(current_user, user_id)
    return db.get_explanation_history(user_id)


@app.get("/hcxai/provenance/{prediction_id}")
def decision_provenance(
    prediction_id: int,
    current_user: dict = Depends(auth.require_authenticated),
):
    """Decision Provenance: full lineage of one decision (application, model version, feedback)."""
    result = db.get_decision_provenance(prediction_id)
    if result is None:
        raise HTTPException(status_code=404, detail=f"Prediction {prediction_id} not found")
    return result


# ---------------------------------------------------------------------------
# Fairness: bias mitigation recommendations
# ---------------------------------------------------------------------------

@app.get("/fairness/mitigation-recommendations")
def fairness_mitigation_recommendations(
    current_user: dict = Depends(auth.require_roles("admin", "risk_manager")),
):
    """
    Bias Mitigation: threshold-adjustment recommendations for any attribute
    failing the four-fifths rule. Recommendations only -- no automatic
    changes are applied (see app/fairness.py::generate_mitigation_recommendations).
    """
    explainer = _get_explainer_or_503()
    report = compute_fairness_report(explainer)
    db.log_audit_event(user_id=current_user["email"], action="fairness.mitigation_recommendations")
    return report["mitigation_recommendations"]


# ---------------------------------------------------------------------------
# AI Model Center: Model Registry / Experiment Tracking / Champion-Challenger
# ---------------------------------------------------------------------------

@app.get("/model/versions")
def list_model_versions(current_user: dict = Depends(auth.require_roles("admin", "risk_manager"))):
    """Model Registry: list all trained model versions with their metrics."""
    return db.list_model_versions()


@app.get("/model/versions/active")
def get_active_model_version(current_user: dict = Depends(auth.require_authenticated)):
    """The currently active (champion) model version."""
    version = db.get_active_model_version()
    if version is None:
        raise HTTPException(status_code=404, detail="No active model version found")
    return version


@app.post("/model/train", status_code=201)
def train_model(
    request: TrainModelRequest,
    current_user: dict = Depends(auth.require_roles("admin")),
):
    """
    AI Model Center: train a new model version (Continuous Learning trigger).
    Admin-only -- this retrains on the full current dataset and, by default,
    activates the new version as the champion.
    """
    get_explainer.cache_clear()  # invalidate the singleton so the next request picks up the new champion
    result = train_new_version(trained_by=current_user["email"], notes=request.notes, activate=request.activate)
    return result


@app.post("/model/activate")
def activate_model(
    request: ActivateModelRequest,
    current_user: dict = Depends(auth.require_roles("admin")),
):
    """Champion-Challenger switch: promote a specific model version to active."""
    try:
        result = db.activate_model_version(request.version_label)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    get_explainer.cache_clear()
    db.log_audit_event(
        user_id=current_user["email"],
        action="model.activate",
        resource_type="model_version",
        resource_id=request.version_label,
    )
    return result


@app.post("/model/compare")
def compare_model_versions(
    request: CompareModelsRequest,
    current_user: dict = Depends(auth.require_roles("admin", "risk_manager")),
):
    """Model Comparison Dashboard: side-by-side metric comparison between two versions."""
    try:
        result = compare_versions(request.version_a, request.version_b)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    db.log_audit_event(
        user_id=current_user["email"],
        action="model.compare",
        details={"version_a": request.version_a, "version_b": request.version_b},
    )
    return result


# ---------------------------------------------------------------------------
# AI Governance: Audit Trail
# ---------------------------------------------------------------------------

@app.get("/audit")
def list_audit_log(
    limit: int = 100,
    offset: int = 0,
    action: str | None = None,
    current_user: dict = Depends(auth.require_roles("admin")),
):
    """AI Governance / Responsible AI: paginated audit trail of platform actions."""
    limit = max(1, min(limit, 500))
    return {
        "items": db.list_audit_log(limit=limit, offset=offset, action=action),
        "total": db.count_audit_log(),
        "limit": limit,
        "offset": offset,
    }
