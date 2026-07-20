"""
Explanation Quality / Fidelity Metrics (HCXAI_PLATFORM_DESIGN.md Part 4,
"Explanation Validation Framework" + "Explanation Quality Metrics").

Implements objective, computable proxies for explanation quality that do
not require human evaluation:

1. Stability: how much do SHAP attributions change under small, realistic
   perturbations of the input? A faithful, trustworthy explanation should
   be locally stable -- tiny input changes shouldn't wildly reorder which
   features "matter". Measured as the average rank correlation (Spearman)
   between the original feature-importance ranking and rankings under N
   small perturbations. High stability -> high score.

2. Completeness: SHAP values are exactly additive by construction
   (base_value + sum(contributions) == raw model output), so completeness
   is verified directly rather than estimated -- this is a correctness
   check on the explanation pipeline itself, not just a quality proxy.

3. Sparsity / Conciseness: what fraction of total attribution magnitude is
   captured by the top-3 features? A more concise explanation (few
   features carry most of the signal) is easier for a human to act on.

These feed the "Explanation Satisfaction Score" / "Explanation Quality
Score" concepts named in the design doc as objective inputs, complementing
the subjective trust_rating/confidence_rating collected via human feedback.
"""
from __future__ import annotations

from typing import Any

import numpy as np
from scipy.stats import spearmanr

from .data_processing import FEATURE_COLUMNS, encode_single_application
from .explainer import LoanExplainer

STABILITY_N_PERTURBATIONS = 8
STABILITY_NOISE_FRACTION = 0.03  # perturb each numeric feature by up to +/-3% of its value


def _perturb_application(application: dict[str, Any], rng: np.random.Generator) -> dict[str, Any]:
    perturbed = dict(application)
    for feature in FEATURE_COLUMNS:
        value = application[feature]
        if isinstance(value, str):
            continue  # leave categorical features untouched
        noise = rng.normal(loc=0.0, scale=abs(value) * STABILITY_NOISE_FRACTION or 1.0)
        perturbed[feature] = value + noise
    return perturbed


def compute_stability_score(
    explainer: LoanExplainer, application: dict[str, Any], random_state: int = 42
) -> dict[str, Any]:
    """Spearman rank correlation between original and perturbed SHAP rankings."""
    rng = np.random.default_rng(random_state)

    original_df = encode_single_application(application, explainer.encoders)
    original_explanation = explainer.explain(original_df)
    original_ranking = [c["feature"] for c in original_explanation["contributions"]]

    correlations = []
    for _ in range(STABILITY_N_PERTURBATIONS):
        perturbed_app = _perturb_application(application, rng)
        try:
            perturbed_df = encode_single_application(perturbed_app, explainer.encoders)
        except (ValueError, KeyError):
            continue
        perturbed_explanation = explainer.explain(perturbed_df)
        perturbed_ranking = [c["feature"] for c in perturbed_explanation["contributions"]]

        original_ranks = {f: i for i, f in enumerate(original_ranking)}
        perturbed_ranks = [original_ranks[f] for f in perturbed_ranking]
        corr, _ = spearmanr(list(range(len(perturbed_ranking))), perturbed_ranks)
        if not np.isnan(corr):
            correlations.append(corr)

    mean_stability = float(np.mean(correlations)) if correlations else None

    return {
        "stability_score": round(mean_stability, 4) if mean_stability is not None else None,
        "n_perturbations_tested": len(correlations),
        "interpretation": (
            "highly_stable" if mean_stability and mean_stability > 0.8
            else "moderately_stable" if mean_stability and mean_stability > 0.5
            else "unstable" if mean_stability is not None
            else "insufficient_data"
        ),
    }


def verify_completeness(shap_result: dict[str, Any], model_output_logodds: float) -> dict[str, Any]:
    """
    SHAP's additivity property: base_value + sum(contributions) should equal
    the raw model output (log-odds for XGBoost binary classification). This
    directly verifies the explanation pipeline is not silently dropping or
    misattributing feature contributions.
    """
    total_contribution = sum(c["shap_contribution"] for c in shap_result["contributions"])
    reconstructed = shap_result["base_value"] + total_contribution
    error = abs(reconstructed - model_output_logodds)

    return {
        "base_value": round(shap_result["base_value"], 6),
        "sum_contributions": round(total_contribution, 6),
        "reconstructed_output": round(reconstructed, 6),
        "actual_model_output": round(model_output_logodds, 6),
        "reconstruction_error": round(error, 6),
        "is_complete": bool(error < 1e-3),
    }


def compute_sparsity_score(shap_result: dict[str, Any], top_k: int = 3) -> dict[str, Any]:
    """What fraction of total |SHAP| magnitude is captured by the top-k features."""
    magnitudes = sorted((abs(c["shap_contribution"]) for c in shap_result["contributions"]), reverse=True)
    total = sum(magnitudes) or 1.0
    top_k_sum = sum(magnitudes[:top_k])
    ratio = top_k_sum / total

    return {
        "top_k": top_k,
        "concentration_ratio": round(float(ratio), 4),
        "interpretation": (
            "concise" if ratio > 0.8 else "moderately_concise" if ratio > 0.5 else "diffuse"
        ),
    }


def compute_explanation_quality_report(
    explainer: LoanExplainer, application: dict[str, Any]
) -> dict[str, Any]:
    """Combined quality report: stability + completeness + sparsity for one explanation."""
    df = encode_single_application(application, explainer.encoders)
    shap_result = explainer.explain(df)

    # Raw log-odds model output (what SHAP values sum to, for TreeExplainer on XGBoost)
    margin_output = float(explainer.model.predict(df[FEATURE_COLUMNS], output_margin=True)[0])

    stability = compute_stability_score(explainer, application)
    completeness = verify_completeness(shap_result, margin_output)
    sparsity = compute_sparsity_score(shap_result)

    # Composite score: equally weight the three normalized sub-scores (0-1)
    sub_scores = [
        stability["stability_score"] if stability["stability_score"] is not None else 0.5,
        1.0 if completeness["is_complete"] else 0.0,
        sparsity["concentration_ratio"],
    ]
    composite = round(float(np.mean(sub_scores)), 4)

    return {
        "stability": stability,
        "completeness": completeness,
        "sparsity": sparsity,
        "composite_quality_score": composite,
    }
