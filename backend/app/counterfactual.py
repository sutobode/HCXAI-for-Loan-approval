"""
Counterfactual Explanation Engine (HCXAI_PLATFORM_DESIGN.md Part 4 & 6).

Self-implemented, DiCE-inspired minimal-perturbation counterfactual search.
Given a rejected (or approved) application, finds the smallest realistic
change to feature values that flips the model's decision.

Why self-implemented instead of the `dice-ml` package: dice-ml pins
pandas<2.0 as a hard dependency, which conflicted with and downgraded this
project's pandas 2.2.3 installation, breaking the rest of the stack (see
project history). The core DiCE idea for a tabular gradient-boosted model
is straightforward to reimplement directly:

Algorithm (greedy coordinate search with decaying step size, no external
optimizer dependency -- well suited to tree-ensemble models like XGBoost
which are piecewise-constant rather than smoothly differentiable, so a
gradient-based optimizer would not apply cleanly anyway):
1. Start from the original instance.
2. Each iteration, for every actionable feature (in randomized order per
   restart, for diversity), evaluate a small set of candidate deltas
   (+step, -step, +step/2, -step/2) and greedily keep whichever candidate
   value moves the predicted probability closest to the target class.
3. Shrink the step size geometrically each iteration (coarse-to-fine search).
4. Track the best (lowest total normalized distance from the original
   instance) counterfactual found that actually flips the decision.
5. Return the top-N diverse counterfactuals found across independent search
   restarts (diversity = different feature(s) changed).

Only features that are practically actionable by an applicant are
perturbed (e.g. `cibil_score`, `income_annum`, `loan_amount`, `loan_term`,
asset values); `education` category or the number of dependents are not
proposed as "advice" here, though the search allows them if configured.
"""
from __future__ import annotations

import copy
from dataclasses import dataclass
from typing import Any

import numpy as np
import pandas as pd

from .data_processing import FEATURE_COLUMNS, encode_single_application
from .explainer import READABLE_FEATURE_NAMES, LoanExplainer

# Features an applicant could realistically change, with (min, max) bounds.
ACTIONABLE_FEATURE_BOUNDS: dict[str, tuple[float, float]] = {
    "cibil_score": (300, 900),
    "income_annum": (200_000, 50_000_000),
    "loan_amount": (100_000, 50_000_000),
    "loan_term": (2, 20),
    "residential_assets_value": (0, 50_000_000),
    "commercial_assets_value": (0, 50_000_000),
    "bank_asset_value": (0, 50_000_000),
}

N_RESTARTS = 4
N_ITERATIONS = 12
INITIAL_STEP_FRACTION = 0.25  # fraction of feature range moved per step, before decay
STEP_DECAY = 0.8


@dataclass
class CounterfactualCandidate:
    changes: dict[str, float]
    distance: float
    new_probability: float


def _normalized_distance(original: dict[str, Any], candidate: dict[str, Any]) -> float:
    """Sum of |change| / feature_range across all perturbed actionable features."""
    total = 0.0
    for feature, (low, high) in ACTIONABLE_FEATURE_BOUNDS.items():
        span = high - low or 1.0
        total += abs(candidate[feature] - original[feature]) / span
    return total


def _predict_probability(explainer: LoanExplainer, application: dict[str, Any]) -> float:
    df = encode_single_application(application, explainer.encoders)
    return explainer.predict(df)["approval_probability"]


def _single_search(
    explainer: LoanExplainer,
    original_application: dict[str, Any],
    target_approved: bool,
    rng: np.random.Generator,
) -> CounterfactualCandidate | None:
    """
    Greedy coordinate descent: each iteration, sweep through the actionable
    features (in a random order for this restart) and for each one, try a
    handful of candidate step sizes, keeping whichever single-feature move
    improves the probability gap to the target the most. Step size decays
    each iteration for coarse-to-fine refinement.
    """
    current = dict(original_application)
    current_proba = _predict_probability(explainer, current)
    target_value = 1.0 if target_approved else 0.0

    best: CounterfactualCandidate | None = None
    features = list(ACTIONABLE_FEATURE_BOUNDS.keys())

    for iteration in range(N_ITERATIONS):
        step_fraction = INITIAL_STEP_FRACTION * (STEP_DECAY**iteration)
        rng.shuffle(features)

        for feature in features:
            low, high = ACTIONABLE_FEATURE_BOUNDS[feature]
            span = high - low
            step = span * step_fraction

            best_candidate_value = current[feature]
            best_candidate_proba = current_proba
            best_gap = abs(current_proba - target_value)

            for direction in (+1, -1, +0.5, -0.5):
                candidate_value = float(np.clip(current[feature] + direction * step, low, high))
                if abs(candidate_value - current[feature]) < 1e-9:
                    continue
                trial = dict(current)
                trial[feature] = candidate_value
                trial_proba = _predict_probability(explainer, trial)
                gap = abs(trial_proba - target_value)
                if gap < best_gap:
                    best_gap = gap
                    best_candidate_value = candidate_value
                    best_candidate_proba = trial_proba

            current[feature] = best_candidate_value
            current_proba = best_candidate_proba

            flipped = (current_proba >= 0.5) == target_approved
            if flipped:
                distance = _normalized_distance(original_application, current)
                if best is None or distance < best.distance:
                    changes = {
                        f: current[f]
                        for f in ACTIONABLE_FEATURE_BOUNDS
                        if abs(current[f] - original_application[f]) > 1e-6
                    }
                    best = CounterfactualCandidate(
                        changes=changes, distance=distance, new_probability=current_proba
                    )

    return best


def find_counterfactuals(
    explainer: LoanExplainer,
    application: dict[str, Any],
    n_results: int = 3,
    random_state: int = 42,
) -> dict[str, Any]:
    """
    Search for the top `n_results` diverse, minimal counterfactual
    explanations that flip the model's current decision.
    """
    base_proba = _predict_probability(explainer, application)
    base_decision = "Approved" if base_proba >= 0.5 else "Rejected"
    target_approved = base_proba < 0.5  # flip the current decision

    rng = np.random.default_rng(random_state)
    candidates: list[CounterfactualCandidate] = []

    for restart in range(N_RESTARTS):
        result = _single_search(explainer, application, target_approved, rng)
        if result is not None:
            candidates.append(result)

    # Deduplicate by the set of changed features; keep the lowest-distance
    # candidate per unique feature-set for diversity, then sort by distance.
    best_per_featureset: dict[frozenset, CounterfactualCandidate] = {}
    for c in candidates:
        key = frozenset(c.changes.keys())
        if key not in best_per_featureset or c.distance < best_per_featureset[key].distance:
            best_per_featureset[key] = c

    ranked = sorted(best_per_featureset.values(), key=lambda c: c.distance)[:n_results]

    formatted = []
    for c in ranked:
        feature_changes = []
        for feature, new_value in c.changes.items():
            feature_changes.append(
                {
                    "feature": feature,
                    "display_name": READABLE_FEATURE_NAMES.get(feature, feature),
                    "original_value": round(float(application[feature]), 2),
                    "suggested_value": round(float(new_value), 2),
                    "delta": round(float(new_value - application[feature]), 2),
                }
            )
        formatted.append(
            {
                "changes": feature_changes,
                "resulting_decision": "Approved" if target_approved else "Rejected",
                "resulting_probability": round(c.new_probability, 4),
                "normalized_distance": round(c.distance, 4),
                "n_features_changed": len(feature_changes),
            }
        )

    return {
        "original_decision": base_decision,
        "original_probability": round(base_proba, 4),
        "target_decision": "Approved" if target_approved else "Rejected",
        "counterfactuals": formatted,
        "search_config": {
            "n_restarts": N_RESTARTS,
            "n_iterations_per_restart": N_ITERATIONS,
            "actionable_features": list(ACTIONABLE_FEATURE_BOUNDS.keys()),
        },
    }
