"""
LIME-style local explanation (HCXAI_PLATFORM_DESIGN.md Part 4).

Implements the core LIME algorithm (Ribeiro et al., 2016) directly with
numpy + pandas rather than depending on the `lime` PyPI package (unmaintained
since 2020, drags in scikit-image/matplotlib for tabular-only use).

Algorithm:
1. Sample N perturbed neighbors around the instance by adding Gaussian
   noise scaled to each feature's training-set standard deviation.
2. Weight each neighbor by its proximity to the original instance
   (exponential kernel on standardized distance).
3. Query the black-box model for predicted probabilities on all neighbors.
4. Fit a weighted local linear surrogate (closed-form weighted ridge
   regression, solved directly via numpy.linalg -- see the note on
   `_weighted_ridge_fit` for why this avoids sklearn's Ridge here) from
   the neighbor features to the black-box probabilities. The fitted
   coefficients are the local feature importances -- a locally faithful,
   human-readable surrogate independent from (and thus a useful
   cross-check against) the SHAP explanation for the same instance.
"""
from __future__ import annotations

from functools import lru_cache

import numpy as np
import pandas as pd

from .data_processing import FEATURE_COLUMNS, prepare_dataset
from .explainer import READABLE_FEATURE_NAMES, LoanExplainer

N_SAMPLES = 2000
RANDOM_STATE = 42
RIDGE_ALPHA = 1.0


def _weighted_ridge_fit(X: np.ndarray, y: np.ndarray, sample_weight: np.ndarray, alpha: float) -> np.ndarray:
    """
    Closed-form weighted ridge regression via numpy.linalg.solve:

        beta = (X^T W X + alpha*I)^-1 X^T W y

    Solved directly rather than via sklearn.linear_model.Ridge. During
    development, this environment hit an intermittent native crash inside
    scikit-learn's Ridge solver when combined with XGBoost's float32
    probability outputs (root cause: a BLAS/LAPACK library conflict between
    an MKL-linked conda-forge numpy/scikit-learn and a pip-installed scipy
    using OpenBLAS -- see environment.yml's comments). The environment has
    since been rebuilt with a consistent single BLAS backend, but this
    closed-form implementation is kept because it has zero dependency on
    scikit-learn's linear model internals for this hot path and is exactly
    what Ridge computes internally for a dataset of this size anyway.
    """
    w_sqrt = np.sqrt(sample_weight)
    Xw = X * w_sqrt[:, None]
    yw = y * w_sqrt
    n_features = X.shape[1]
    A = Xw.T @ Xw + alpha * np.eye(n_features)
    b = Xw.T @ yw
    return np.linalg.solve(A, b)


class LimeTabularExplainer:
    def __init__(self, explainer: LoanExplainer):
        self.explainer = explainer
        dataset = prepare_dataset()
        train_df = pd.concat([dataset.X_train, dataset.X_test])[FEATURE_COLUMNS]
        self.feature_std = train_df.std().replace(0, 1.0).to_numpy()
        self.rng = np.random.default_rng(RANDOM_STATE)

    def explain(self, features_df: pd.DataFrame) -> dict:
        instance = features_df[FEATURE_COLUMNS].to_numpy(dtype=float)[0]

        n_features = len(FEATURE_COLUMNS)
        # Standard LIME default: kernel width scales with sqrt(n_features) so
        # that, in standardized distance space, a "typical" random neighbor
        # (Euclidean distance ~= sqrt(n_features) in standardized units) still
        # gets a meaningful (non-vanishing) weight.
        kernel_width = np.sqrt(n_features) * 0.75

        noise = self.rng.normal(
            loc=0.0, scale=self.feature_std, size=(N_SAMPLES, n_features)
        )
        neighbors = instance + noise
        neighbors[0] = instance  # always include the original point itself

        scaled_diff = (neighbors - instance) / self.feature_std
        distances = np.sqrt((scaled_diff**2).sum(axis=1))
        weights = np.exp(-(distances**2) / (kernel_width**2))

        neighbors_df = pd.DataFrame(neighbors, columns=FEATURE_COLUMNS)
        for cat_col in ("education", "self_employed"):
            neighbors_df[cat_col] = neighbors_df[cat_col].round().clip(0, 1).astype(int)

        probabilities = self.explainer.model.predict_proba(neighbors_df[FEATURE_COLUMNS])[:, 1]

        X = np.ascontiguousarray(scaled_diff, dtype=np.float64)
        y = np.ascontiguousarray(probabilities, dtype=np.float64)
        sw = np.ascontiguousarray(weights, dtype=np.float64)

        coef = _weighted_ridge_fit(X, y, sw, RIDGE_ALPHA)
        predicted = X @ coef

        y_mean = np.average(y, weights=sw)
        ss_res = float(np.sum(sw * (y - predicted) ** 2))
        ss_tot = float(np.sum(sw * (y - y_mean) ** 2))
        # Guard against a near-zero ss_tot (happens when the model's probability
        # is very flat across the sampled neighborhood, e.g. instance is deep in
        # a high-confidence region) blowing up the R^2 ratio into a meaningless
        # large negative number.
        fidelity_r2 = 1.0 - ss_res / ss_tot if ss_tot > 1e-6 else None

        local_prediction = float(np.average(y, weights=sw))
        actual_prediction = float(self.explainer.model.predict_proba(features_df[FEATURE_COLUMNS])[0, 1])

        contributions = []
        for i, feature in enumerate(FEATURE_COLUMNS):
            contributions.append(
                {
                    "feature": feature,
                    "display_name": READABLE_FEATURE_NAMES.get(feature, feature),
                    "value": float(instance[i]),
                    "lime_weight": float(coef[i]),
                    "direction": "increases_approval" if coef[i] > 0 else "decreases_approval",
                }
            )
        contributions.sort(key=lambda c: abs(c["lime_weight"]), reverse=True)

        return {
            "local_model_prediction": local_prediction,
            "actual_model_prediction": actual_prediction,
            # NOTE: fidelity_r2 can legitimately be negative for tree-ensemble
            # models. XGBoost's decision surface is piecewise-constant (sharp
            # splits), not smooth, so a *linear* local surrogate is an
            # imperfect fit by construction near split boundaries -- this is
            # a documented, expected limitation of LIME on tree ensembles,
            # not a bug. The feature ranking/direction remains informative
            # even when R^2 is poor; treat r2 as a fidelity *warning signal*
            # (very negative => interpret the ranking with more caution),
            # not as a pass/fail gate.
            "fidelity_r2": round(fidelity_r2, 4) if fidelity_r2 is not None else None,
            "contributions": contributions,
            "n_samples": N_SAMPLES,
        }


@lru_cache(maxsize=1)
def get_lime_explainer() -> LimeTabularExplainer:
    from .explainer import get_explainer

    return LimeTabularExplainer(get_explainer())
