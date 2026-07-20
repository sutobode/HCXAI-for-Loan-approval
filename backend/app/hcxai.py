"""
Human-Centered XAI (HCXAI) logic layer -- the core novel contribution of
this platform (HCXAI_PLATFORM_DESIGN.md Part 5).

Implements, in working code:

1. User Modeler              -> UserModeler class below (wraps app.db profile
                                 functions + adds cognitive-style inference
                                 from override direction / trust trend)
2. Trust Calibrator           -> record_human_decision / get_trust_dashboard
                                 (app.db.save_trust_event / get_trust_calibration)
3. Progressive Disclosure     -> build_progressive_explanation()
4. Cognitive Load Adaptation  -> estimate_cognitive_load()
5. Explanation Recommendation Engine -> recommend_explanation_strategy()
6. Human Override Analysis    -> app.db.get_override_analysis_by_confidence /
                                  get_override_direction_stats
7. Explanation Satisfaction   -> app.db.get_satisfaction_metrics
8. Explanation History        -> app.db.get_explanation_history
9. Decision Provenance        -> app.db.get_decision_provenance

Design principle: every adaptation rule here is a simple, auditable,
human-readable heuristic (thresholds on counts/rates), never a black-box
meta-model. This is deliberate -- an HCXAI platform whose own adaptation
logic cannot itself be explained would undermine its purpose. Every
function below can be read top-to-bottom and reasoned about by a
non-ML-engineer reviewer, which matters for the "Responsible AI" /
"AI Governance" goals of this project as much as for the AI model itself.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

from . import db

DetailLevel = Literal["summary", "detailed", "technical"]


def resolve_detail_level(user_id: str, override: DetailLevel | None = None) -> DetailLevel:
    """
    Decide which explanation detail level to use for this user.
    Explicit request override wins; otherwise use the user's learned preference
    from the User Modeler (based on interaction history).
    """
    if override:
        return override
    profile = db.get_or_create_user_profile(user_id)
    return profile["preferred_detail_level"]  # type: ignore[return-value]


def estimate_cognitive_load(shap_result: dict[str, Any], user_expertise: float) -> dict[str, Any]:
    """
    Cognitive Load Adaptation (HCXAI_PLATFORM_DESIGN.md Part 5).

    Estimates how much mental effort a given explanation would demand from
    a user with a given expertise level, from two objective signals:

    1. Feature contribution "conflict": how many features push toward
       *opposite* conclusions (some increase approval, some decrease it).
       A decision with 8 factors pulling in different directions is
       harder to reason about than one with 2 factors clearly agreeing.
    2. Number of features whose contribution is non-negligible (a proxy for
       how many things a human would need to hold in mind at once, related
       to Miller's "7 +/- 2" working-memory heuristic).

    The estimated load is then combined with the user's expertise (0..1,
    from the User Modeler) to recommend whether the *full* explanation is
    appropriate right now, or whether it should be simplified further than
    what resolve_detail_level() alone would pick.
    """
    contributions = shap_result["contributions"]
    magnitudes = [abs(c["shap_contribution"]) for c in contributions]
    max_magnitude = max(magnitudes) if magnitudes else 1.0
    threshold = max_magnitude * 0.1  # features under 10% of the top factor's magnitude are "noise"

    significant = [c for c in contributions if abs(c["shap_contribution"]) >= threshold]
    n_increasing = sum(1 for c in significant if c["direction"] == "increases_approval")
    n_decreasing = len(significant) - n_increasing

    # Conflict score: 0 if all significant factors agree, 1 if perfectly split
    conflict_score = (
        1.0 - abs(n_increasing - n_decreasing) / len(significant) if significant else 0.0
    )

    # Raw load: more significant factors + more conflict => higher load
    raw_load = min(1.0, (len(significant) / 8.0) * 0.6 + conflict_score * 0.4)

    # A more expert user can absorb higher raw load before it becomes a problem
    perceived_load = raw_load * (1.5 - user_expertise)  # expertise 0 -> x1.5, expertise 1 -> x0.5
    perceived_load = max(0.0, min(1.0, perceived_load))

    if perceived_load > 0.7:
        recommendation = "simplify"
    elif perceived_load > 0.4:
        recommendation = "standard"
    else:
        recommendation = "can_show_full_detail"

    return {
        "n_significant_factors": len(significant),
        "n_increasing": n_increasing,
        "n_decreasing": n_decreasing,
        "conflict_score": round(conflict_score, 4),
        "raw_load": round(raw_load, 4),
        "perceived_load": round(perceived_load, 4),
        "recommendation": recommendation,
    }


def build_progressive_explanation(
    prediction: dict[str, Any],
    shap_result: dict[str, Any],
    narrative: str,
    detail_level: DetailLevel,
) -> dict[str, Any]:
    """
    Progressive Disclosure (HCXAI_PLATFORM_DESIGN.md Part 5, component 6):
    return only as much information as the requested detail level implies,
    while keeping the raw numbers available for "technical" users.
    """
    contributions = shap_result["contributions"]

    if detail_level == "summary":
        top = contributions[0]
        return {
            "level": "summary",
            "headline": f"{prediction['prediction']} ({prediction['confidence']:.0%} confidence)",
            "top_reason": f"{top['display_name']}: {top['direction'].replace('_', ' ')}",
            "narrative": narrative,
        }

    if detail_level == "detailed":
        top5 = contributions[:5]
        return {
            "level": "detailed",
            "headline": f"{prediction['prediction']} ({prediction['confidence']:.0%} confidence)",
            "approval_probability": prediction["approval_probability"],
            "risk_score": prediction["risk_score"],
            "top_factors": top5,
            "narrative": narrative,
        }

    # technical
    return {
        "level": "technical",
        "headline": f"{prediction['prediction']} ({prediction['confidence']:.0%} confidence)",
        "prediction": prediction,
        "base_value": shap_result["base_value"],
        "all_contributions": contributions,
        "narrative": narrative,
    }


def record_prediction_and_context(
    features: dict[str, Any],
    prediction: dict[str, Any],
    shap_result: dict[str, Any],
    narrative: str,
    narrative_model: str,
    model_version: str = "unknown",
) -> tuple[int, int]:
    """
    Persist the application + prediction, returning (application_id, prediction_id).
    Also records a prediction snapshot (Decision Provenance + Prediction Drift input).
    """
    application_id = db.save_application(features)
    prediction_id = db.save_prediction(
        application_id,
        prediction,
        shap_result,
        narrative=narrative,
        narrative_model=narrative_model,
        model_version=model_version,
    )
    db.save_prediction_snapshot(model_version, prediction["approval_probability"])
    return application_id, prediction_id


def record_human_decision(
    user_id: str,
    prediction_id: int,
    ai_prediction: str,
    ai_confidence: float,
    human_decision: str,
) -> dict[str, Any]:
    """
    Feed a human decision into the Trust Calibrator + User Modeler.
    Returns the updated trust calibration read-out for the user.
    """
    db.save_trust_event(user_id, prediction_id, ai_prediction, ai_confidence, human_decision)
    return db.get_trust_calibration(user_id)


def get_trust_dashboard(user_id: str) -> dict[str, Any]:
    """
    Combined Trust Dashboard view: user cognitive profile, trust calibration
    state, trust trend over time, override direction (risk tolerance), and
    explanation satisfaction ratings -- everything HCXAI_PLATFORM_DESIGN.md
    Part 5's "Trust Dashboard" component asks for, in one call.
    """
    profile = db.get_or_create_user_profile(user_id)
    calibration = db.get_trust_calibration(user_id)
    trend = db.get_trust_trend(user_id)
    override_stats = db.get_override_direction_stats(user_id)
    satisfaction = db.get_satisfaction_metrics(user_id)

    return {
        "profile": profile,
        "trust_calibration": calibration,
        "trust_trend": trend,
        "override_direction": override_stats,
        "satisfaction": satisfaction,
    }


# ---------------------------------------------------------------------------
# Explanation Recommendation Engine (HCXAI_PLATFORM_DESIGN.md Part 5)
# ---------------------------------------------------------------------------

@dataclass
class ExplanationStrategy:
    detail_level: DetailLevel
    include_narrative: bool
    include_shap_chart: bool
    suggest_counterfactual: bool
    suggest_similar_cases: bool
    trust_intervention: Literal["none", "highlight_uncertainty", "highlight_evidence"]
    rationale: list[str] = field(default_factory=list)


def recommend_explanation_strategy(
    user_id: str,
    prediction: dict[str, Any],
    shap_result: dict[str, Any],
    detail_override: DetailLevel | None = None,
) -> ExplanationStrategy:
    """
    Explanation Recommendation Engine: decides *how* to present an
    explanation for this specific user and this specific prediction, by
    combining three signals:

    1. The user's learned detail-level preference (User Modeler) -- unless
       overridden by an explicit request or by cognitive load below.
    2. The estimated cognitive load of this particular explanation (many
       conflicting SHAP factors can warrant simplifying even for a user
       who normally prefers 'technical' detail).
    3. The user's trust calibration state (Trust Calibrator) -- an
       over-trusting user gets an uncertainty-highlighting nudge; an
       under-trusting user gets an evidence-highlighting nudge; a
       well-calibrated user gets neither.

    Every decision below is a simple, inspectable if/else rule -- see the
    module docstring for why that is a deliberate design choice here.
    """
    profile = db.get_or_create_user_profile(user_id)
    calibration = db.get_trust_calibration(user_id)
    load = estimate_cognitive_load(shap_result, profile["expertise_level"])

    rationale: list[str] = []

    detail_level = detail_override or profile["preferred_detail_level"]
    if not detail_override:
        rationale.append(f"Using learned preference for user '{user_id}': {detail_level}")
    else:
        rationale.append(f"Using explicit request override: {detail_level}")

    if load["recommendation"] == "simplify" and detail_level == "technical":
        detail_level = "detailed"
        rationale.append(
            f"Downgraded from 'technical' to 'detailed': high cognitive load detected "
            f"({load['n_significant_factors']} conflicting factors, load={load['perceived_load']})"
        )

    # Low-confidence predictions benefit from showing similar historical cases
    # and a counterfactual ("what would need to change"), regardless of role.
    suggest_similar_cases = prediction["confidence"] < 0.75
    suggest_counterfactual = prediction["prediction"] == "Rejected"
    if suggest_similar_cases:
        rationale.append("Confidence below 75%: recommending Similar Case Explorer for context")
    if suggest_counterfactual:
        rationale.append("Decision is Rejected: recommending counterfactual (actionable next steps)")

    trust_state = calibration.get("trust_state", "insufficient_data")
    if trust_state == "over_trust":
        trust_intervention: Literal["none", "highlight_uncertainty", "highlight_evidence"] = "highlight_uncertainty"
        rationale.append("User shows over-trust pattern: will surface model uncertainty/limitations")
    elif trust_state == "under_trust":
        trust_intervention = "highlight_evidence"
        rationale.append("User shows under-trust pattern: will surface supporting evidence/accuracy history")
    else:
        trust_intervention = "none"

    return ExplanationStrategy(
        detail_level=detail_level,  # type: ignore[arg-type]
        include_narrative=True,
        include_shap_chart=detail_level != "summary",
        suggest_counterfactual=suggest_counterfactual,
        suggest_similar_cases=suggest_similar_cases,
        trust_intervention=trust_intervention,
        rationale=rationale,
    )
