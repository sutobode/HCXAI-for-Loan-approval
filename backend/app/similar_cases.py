"""
Similar Case Explorer (HCXAI_PLATFORM_DESIGN.md Part 7).

Implements case-based reasoning using scikit-learn's NearestNeighbors over
the encoded training features -- no vector database (Milvus/FAISS) required.
Features are standardized before distance computation so that columns with
larger numeric ranges (e.g. income in millions) don't dominate the distance
metric versus columns like cibil_score or no_of_dependents.
"""
from __future__ import annotations

from functools import lru_cache

import numpy as np
import pandas as pd
from sklearn.neighbors import NearestNeighbors
from sklearn.preprocessing import StandardScaler

from .data_processing import FEATURE_COLUMNS, load_raw_dataframe, prepare_dataset

READABLE_LABELS = {
    "no_of_dependents": "Dependents",
    "income_annum": "Annual income",
    "loan_amount": "Loan amount",
    "loan_term": "Loan term (months)",
    "cibil_score": "Credit score",
    "residential_assets_value": "Residential assets",
    "commercial_assets_value": "Commercial assets",
    "luxury_assets_value": "Luxury assets",
    "bank_asset_value": "Bank assets",
    "education": "Education",
    "self_employed": "Self-employed",
}


class SimilarCaseIndex:
    def __init__(self, k_max: int = 20):
        dataset = prepare_dataset()
        raw_df = load_raw_dataframe()

        # Recombine train+test encoded features (index-aligned with raw_df for display)
        all_encoded = pd.concat([dataset.X_train, dataset.X_test]).sort_index()
        self.encoders = dataset.encoders
        self.raw_df = raw_df.loc[all_encoded.index].reset_index(drop=True)
        self.encoded = all_encoded.reset_index(drop=True)

        self.scaler = StandardScaler()
        scaled = self.scaler.fit_transform(self.encoded[FEATURE_COLUMNS])

        self.model = NearestNeighbors(n_neighbors=min(k_max, len(scaled)), metric="euclidean")
        self.model.fit(scaled)

    def find_similar(self, features_df: pd.DataFrame, k: int = 5) -> list[dict]:
        k = min(k, self.model.n_neighbors)
        scaled_query = self.scaler.transform(features_df[FEATURE_COLUMNS])
        distances, indices = self.model.kneighbors(scaled_query, n_neighbors=k)

        max_dist = float(distances.max()) or 1.0
        results = []
        for dist, idx in zip(distances[0], indices[0]):
            row = self.raw_df.iloc[idx]
            similarity = 1.0 - (float(dist) / max_dist) if max_dist > 0 else 1.0
            results.append(
                {
                    "loan_id": int(row.get("loan_id", idx)),
                    "similarity_score": round(max(0.0, min(1.0, similarity)), 4),
                    "distance": round(float(dist), 4),
                    "outcome": row["loan_status"],
                    "features": {
                        col: (float(row[col]) if col not in ("education", "self_employed") else row[col])
                        for col in FEATURE_COLUMNS
                    },
                }
            )
        return results

    def outcome_distribution(self, similar_cases: list[dict]) -> dict:
        if not similar_cases:
            return {"approved": 0, "rejected": 0, "approval_rate": None}
        approved = sum(1 for c in similar_cases if c["outcome"] == "Approved")
        total = len(similar_cases)
        return {
            "approved": approved,
            "rejected": total - approved,
            "approval_rate": round(approved / total, 4),
        }


@lru_cache(maxsize=1)
def get_similar_case_index() -> SimilarCaseIndex:
    return SimilarCaseIndex()
