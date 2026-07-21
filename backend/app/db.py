"""
Local persistence layer using SQLite (Python stdlib `sqlite3`).

This is a deliberate, documented substitution for the enterprise PostgreSQL
design described in HCXAI_PLATFORM_DESIGN.md Part 14. It keeps the same
logical entities (applications, predictions, feedback, user cognitive
profiles, trust events) but stores them in a single local .db file with
zero external services required — matching the "no DB server" constraint
for this demo/dev environment.

Tables:
- applications        : submitted loan application feature snapshots
- predictions          : model prediction + SHAP summary for an application
- feedback             : human feedback/override on a prediction (Feedback Learner)
- user_profiles        : per-user cognitive model (HCXAI User Modeler)
- trust_events         : agreement/disagreement events used by the Trust Calibrator
"""
from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator

from .config import settings

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    full_name TEXT NOT NULL,
    hashed_password TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'loan_officer',
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS applications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL,
    features_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS predictions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    application_id INTEGER NOT NULL REFERENCES applications(id),
    created_at TEXT NOT NULL,
    prediction TEXT NOT NULL,
    approval_probability REAL NOT NULL,
    risk_score REAL NOT NULL,
    confidence REAL NOT NULL,
    shap_json TEXT NOT NULL,
    narrative TEXT,
    narrative_model TEXT,
    model_version TEXT DEFAULT 'unknown'   -- Decision Provenance: which model version produced this
);

CREATE TABLE IF NOT EXISTS feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    prediction_id INTEGER NOT NULL REFERENCES predictions(id),
    user_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    action TEXT NOT NULL,              -- 'approve' | 'reject' | 'override'
    human_decision TEXT,               -- 'Approved' | 'Rejected' (if overriding)
    confidence_rating INTEGER,         -- 1-5 human confidence in their own decision
    trust_rating INTEGER,              -- 1-5 human trust in the AI recommendation
    comment TEXT
);

CREATE TABLE IF NOT EXISTS user_profiles (
    user_id TEXT PRIMARY KEY,
    role TEXT NOT NULL DEFAULT 'loan_officer',
    expertise_level REAL NOT NULL DEFAULT 0.5,   -- 0 (novice) .. 1 (expert)
    preferred_detail_level TEXT NOT NULL DEFAULT 'detailed',  -- summary|detailed|technical
    total_interactions INTEGER NOT NULL DEFAULT 0,
    agreements INTEGER NOT NULL DEFAULT 0,
    disagreements INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS trust_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    prediction_id INTEGER NOT NULL REFERENCES predictions(id),
    created_at TEXT NOT NULL,
    ai_prediction TEXT NOT NULL,
    ai_confidence REAL NOT NULL,
    human_decision TEXT NOT NULL,
    agreed INTEGER NOT NULL            -- 1 if human_decision == ai_prediction else 0
);

CREATE TABLE IF NOT EXISTS model_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL,
    metrics_json TEXT NOT NULL
);

-- Model Registry / Experiment Tracking (AI Model Center)
CREATE TABLE IF NOT EXISTS model_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    version_label TEXT NOT NULL UNIQUE,   -- e.g. 'v1', 'v2'
    created_at TEXT NOT NULL,
    trained_by TEXT,                      -- user_id/email that triggered training, or 'system'
    algorithm TEXT NOT NULL,
    hyperparameters_json TEXT NOT NULL,
    metrics_json TEXT NOT NULL,           -- accuracy, f1, auc, confusion_matrix, roc_curve, calibration_curve
    artifact_dir TEXT NOT NULL,           -- relative path under backend/models/versions/<label>/
    is_active INTEGER NOT NULL DEFAULT 0, -- exactly one row should be 1 (the "champion")
    notes TEXT
);

-- Audit Trail (AI Governance / Responsible AI / Compliance)
CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL,
    user_id TEXT,                         -- email or 'system'
    action TEXT NOT NULL,                 -- e.g. 'login', 'predict', 'explain', 'model.activate'
    resource_type TEXT,                   -- e.g. 'prediction', 'model_version', 'user'
    resource_id TEXT,
    details_json TEXT
);

-- Prediction Drift tracking: rolling snapshot of predicted-probability distribution
CREATE TABLE IF NOT EXISTS prediction_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL,
    model_version TEXT NOT NULL,
    approval_probability REAL NOT NULL
);
"""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _run_lightweight_migrations(conn: sqlite3.Connection) -> None:
    """
    Additive-only schema migrations for columns introduced after the initial
    table creation, so existing local SQLite files (created by an earlier
    version of this app) keep working without deleting user data. This is
    intentionally minimal (no down-migrations, no Alembic) given the SQLite
    single-file, no-server deployment model documented in app/db.py's module
    docstring.
    """
    existing_columns = {row[1] for row in conn.execute("PRAGMA table_info(predictions)").fetchall()}
    if "model_version" not in existing_columns:
        conn.execute("ALTER TABLE predictions ADD COLUMN model_version TEXT DEFAULT 'unknown'")


def init_db(db_path: Path | None = None) -> None:
    path = db_path or settings.SQLITE_PATH
    path.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(path) as conn:
        conn.executescript(SCHEMA)
        _run_lightweight_migrations(conn)
        conn.commit()


@contextmanager
def get_connection(db_path: Path | None = None) -> Iterator[sqlite3.Connection]:
    path = db_path or settings.SQLITE_PATH
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    try:
        conn.execute("PRAGMA foreign_keys = ON")
        yield conn
        conn.commit()
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Applications & Predictions
# ---------------------------------------------------------------------------

def save_application(features: dict[str, Any]) -> int:
    with get_connection() as conn:
        cur = conn.execute(
            "INSERT INTO applications (created_at, features_json) VALUES (?, ?)",
            (_now(), json.dumps(features)),
        )
        return cur.lastrowid


def save_prediction(
    application_id: int,
    prediction: dict[str, Any],
    shap_result: dict[str, Any],
    narrative: str | None = None,
    narrative_model: str | None = None,
    model_version: str = "unknown",
) -> int:
    with get_connection() as conn:
        cur = conn.execute(
            """INSERT INTO predictions
               (application_id, created_at, prediction, approval_probability,
                risk_score, confidence, shap_json, narrative, narrative_model, model_version)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                application_id,
                _now(),
                prediction["prediction"],
                prediction["approval_probability"],
                prediction["risk_score"],
                prediction["confidence"],
                json.dumps(shap_result),
                narrative,
                narrative_model,
                model_version,
            ),
        )
        return cur.lastrowid


def get_prediction(prediction_id: int) -> dict[str, Any] | None:
    with get_connection() as conn:
        row = conn.execute("SELECT * FROM predictions WHERE id = ?", (prediction_id,)).fetchone()
        return dict(row) if row else None


def list_recent_predictions(limit: int = 50) -> list[dict[str, Any]]:
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT * FROM predictions ORDER BY id DESC LIMIT ?", (limit,)
        ).fetchall()
        return [dict(r) for r in rows]


# ---------------------------------------------------------------------------
# Feedback (Feedback Learner)
# ---------------------------------------------------------------------------

def save_feedback(
    prediction_id: int,
    user_id: str,
    action: str,
    human_decision: str | None = None,
    confidence_rating: int | None = None,
    trust_rating: int | None = None,
    comment: str | None = None,
) -> int:
    with get_connection() as conn:
        cur = conn.execute(
            """INSERT INTO feedback
               (prediction_id, user_id, created_at, action, human_decision,
                confidence_rating, trust_rating, comment)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                prediction_id,
                user_id,
                _now(),
                action,
                human_decision,
                confidence_rating,
                trust_rating,
                comment,
            ),
        )
        return cur.lastrowid


def get_feedback_for_prediction(prediction_id: int) -> list[dict[str, Any]]:
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT * FROM feedback WHERE prediction_id = ? ORDER BY id", (prediction_id,)
        ).fetchall()
        return [dict(r) for r in rows]


def get_override_analytics() -> dict[str, Any]:
    """Aggregate stats used by the Human Feedback Center / Override Analysis."""
    with get_connection() as conn:
        total = conn.execute("SELECT COUNT(*) AS c FROM feedback").fetchone()["c"]
        by_action = conn.execute(
            "SELECT action, COUNT(*) AS c FROM feedback GROUP BY action"
        ).fetchall()
        avg_trust = conn.execute(
            "SELECT AVG(trust_rating) AS avg_trust FROM feedback WHERE trust_rating IS NOT NULL"
        ).fetchone()["avg_trust"]
        return {
            "total_feedback_events": total,
            "by_action": {r["action"]: r["c"] for r in by_action},
            "average_trust_rating": avg_trust,
        }


# ---------------------------------------------------------------------------
# User profiles (HCXAI User Modeler)
# ---------------------------------------------------------------------------

def get_or_create_user_profile(user_id: str, role: str = "loan_officer") -> dict[str, Any]:
    with get_connection() as conn:
        row = conn.execute("SELECT * FROM user_profiles WHERE user_id = ?", (user_id,)).fetchone()
        if row:
            return dict(row)

        conn.execute(
            """INSERT INTO user_profiles
               (user_id, role, expertise_level, preferred_detail_level,
                total_interactions, agreements, disagreements, updated_at)
               VALUES (?, ?, 0.5, 'detailed', 0, 0, 0, ?)""",
            (user_id, role, _now()),
        )
        row = conn.execute("SELECT * FROM user_profiles WHERE user_id = ?", (user_id,)).fetchone()
        return dict(row)


def update_user_profile_from_event(user_id: str, agreed: bool) -> dict[str, Any]:
    """
    Simple, transparent User Modeler update rule:
    - Each interaction nudges `expertise_level` up slightly (more exposure).
    - Agreement/disagreement counters feed the Trust Calibrator.
    - preferred_detail_level auto-escalates from 'summary' -> 'detailed' ->
      'technical' as total_interactions grows (proxy for growing familiarity).
    """
    profile = get_or_create_user_profile(user_id)
    total = profile["total_interactions"] + 1
    agreements = profile["agreements"] + (1 if agreed else 0)
    disagreements = profile["disagreements"] + (0 if agreed else 1)

    expertise = min(1.0, profile["expertise_level"] + 0.01)

    if total < 5:
        detail_level = "summary"
    elif total < 20:
        detail_level = "detailed"
    else:
        detail_level = "technical"

    with get_connection() as conn:
        conn.execute(
            """UPDATE user_profiles
               SET total_interactions = ?, agreements = ?, disagreements = ?,
                   expertise_level = ?, preferred_detail_level = ?, updated_at = ?
               WHERE user_id = ?""",
            (total, agreements, disagreements, expertise, detail_level, _now(), user_id),
        )

    return get_or_create_user_profile(user_id)


# ---------------------------------------------------------------------------
# Trust events (Trust Calibrator)
# ---------------------------------------------------------------------------

def save_trust_event(
    user_id: str,
    prediction_id: int,
    ai_prediction: str,
    ai_confidence: float,
    human_decision: str,
) -> None:
    agreed = 1 if human_decision == ai_prediction else 0
    with get_connection() as conn:
        conn.execute(
            """INSERT INTO trust_events
               (user_id, prediction_id, created_at, ai_prediction, ai_confidence,
                human_decision, agreed)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (user_id, prediction_id, _now(), ai_prediction, ai_confidence, human_decision, agreed),
        )
    update_user_profile_from_event(user_id, agreed=bool(agreed))


def get_trust_calibration(user_id: str) -> dict[str, Any]:
    """
    Compute a simple trust-calibration read-out for a user:
    - agreement_rate: how often the human agrees with the AI
    - avg_ai_confidence_on_agreement / disagreement: whether the human tends to
      disagree specifically when the AI was less confident (well-calibrated)
      or disagrees even on high-confidence predictions (potential under-trust),
      or agrees even on low-confidence predictions (potential over-trust).
    """
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT * FROM trust_events WHERE user_id = ? ORDER BY id", (user_id,)
        ).fetchall()

    events = [dict(r) for r in rows]
    if not events:
        return {
            "user_id": user_id,
            "events": 0,
            "agreement_rate": None,
            "trust_state": "insufficient_data",
        }

    agreements = [e for e in events if e["agreed"]]
    disagreements = [e for e in events if not e["agreed"]]
    agreement_rate = len(agreements) / len(events)

    avg_conf_agree = (
        sum(e["ai_confidence"] for e in agreements) / len(agreements) if agreements else None
    )
    avg_conf_disagree = (
        sum(e["ai_confidence"] for e in disagreements) / len(disagreements)
        if disagreements
        else None
    )

    # Heuristic trust-state classification (mirrors design doc's TrustCalibrator)
    if agreement_rate > 0.9 and (avg_conf_agree or 0) < 0.7:
        trust_state = "over_trust"
    elif agreement_rate < 0.5 and (avg_conf_disagree or 1) > 0.85:
        trust_state = "under_trust"
    else:
        trust_state = "well_calibrated"

    return {
        "user_id": user_id,
        "events": len(events),
        "agreement_rate": agreement_rate,
        "avg_ai_confidence_on_agreement": avg_conf_agree,
        "avg_ai_confidence_on_disagreement": avg_conf_disagree,
        "trust_state": trust_state,
    }


# ---------------------------------------------------------------------------
# Model monitoring runs
# ---------------------------------------------------------------------------

def save_model_run(metrics: dict[str, Any]) -> int:
    with get_connection() as conn:
        cur = conn.execute(
            "INSERT INTO model_runs (created_at, metrics_json) VALUES (?, ?)",
            (_now(), json.dumps(metrics)),
        )
        return cur.lastrowid


def get_latest_model_run() -> dict[str, Any] | None:
    with get_connection() as conn:
        row = conn.execute(
            "SELECT * FROM model_runs ORDER BY id DESC LIMIT 1"
        ).fetchone()
        if not row:
            return None
        result = dict(row)
        result["metrics"] = json.loads(result.pop("metrics_json"))
        return result


# ---------------------------------------------------------------------------
# Users (authentication / RBAC)
# ---------------------------------------------------------------------------

VALID_ROLES = ("admin", "risk_manager", "loan_officer", "customer")


def create_user(email: str, full_name: str, hashed_password: str, role: str = "loan_officer") -> dict[str, Any]:
    if role not in VALID_ROLES:
        raise ValueError(f"Invalid role '{role}'. Must be one of {VALID_ROLES}")
    with get_connection() as conn:
        cur = conn.execute(
            """INSERT INTO users (email, full_name, hashed_password, role, is_active, created_at)
               VALUES (?, ?, ?, ?, 1, ?)""",
            (email.lower(), full_name, hashed_password, role, _now()),
        )
        user_id = cur.lastrowid
    return get_user_by_id(user_id)  # type: ignore[return-value]


def get_user_by_email(email: str) -> dict[str, Any] | None:
    with get_connection() as conn:
        row = conn.execute("SELECT * FROM users WHERE email = ?", (email.lower(),)).fetchone()
        return dict(row) if row else None


def get_user_by_id(user_id: int) -> dict[str, Any] | None:
    with get_connection() as conn:
        row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        return dict(row) if row else None


def list_users(limit: int = 100, offset: int = 0) -> list[dict[str, Any]]:
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT * FROM users ORDER BY id LIMIT ? OFFSET ?", (limit, offset)
        ).fetchall()
        return [dict(r) for r in rows]


def update_user_password(user_id: int, hashed_password: str) -> None:
    with get_connection() as conn:
        conn.execute("UPDATE users SET hashed_password = ? WHERE id = ?", (hashed_password, user_id))


def count_users() -> int:
    with get_connection() as conn:
        return conn.execute("SELECT COUNT(*) AS c FROM users").fetchone()["c"]


def user_exists() -> bool:
    return count_users() > 0


# ---------------------------------------------------------------------------
# Model Registry / Experiment Tracking (AI Model Center)
# ---------------------------------------------------------------------------

def create_model_version(
    version_label: str,
    algorithm: str,
    hyperparameters: dict[str, Any],
    metrics: dict[str, Any],
    artifact_dir: str,
    trained_by: str = "system",
    notes: str | None = None,
) -> dict[str, Any]:
    with get_connection() as conn:
        cur = conn.execute(
            """INSERT INTO model_versions
               (version_label, created_at, trained_by, algorithm, hyperparameters_json,
                metrics_json, artifact_dir, is_active, notes)
               VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)""",
            (
                version_label,
                _now(),
                trained_by,
                algorithm,
                json.dumps(hyperparameters),
                json.dumps(metrics),
                artifact_dir,
                notes,
            ),
        )
        version_id = cur.lastrowid
    return get_model_version(version_id)  # type: ignore[return-value]


def _deserialize_model_version(row: dict[str, Any]) -> dict[str, Any]:
    row = dict(row)
    row["hyperparameters"] = json.loads(row.pop("hyperparameters_json"))
    row["metrics"] = json.loads(row.pop("metrics_json"))
    row["is_active"] = bool(row["is_active"])
    return row


def get_model_version(version_id: int) -> dict[str, Any] | None:
    with get_connection() as conn:
        row = conn.execute("SELECT * FROM model_versions WHERE id = ?", (version_id,)).fetchone()
        return _deserialize_model_version(dict(row)) if row else None


def get_model_version_by_label(version_label: str) -> dict[str, Any] | None:
    with get_connection() as conn:
        row = conn.execute(
            "SELECT * FROM model_versions WHERE version_label = ?", (version_label,)
        ).fetchone()
        return _deserialize_model_version(dict(row)) if row else None


def list_model_versions() -> list[dict[str, Any]]:
    with get_connection() as conn:
        rows = conn.execute("SELECT * FROM model_versions ORDER BY id DESC").fetchall()
        return [_deserialize_model_version(dict(r)) for r in rows]


def get_active_model_version() -> dict[str, Any] | None:
    with get_connection() as conn:
        row = conn.execute("SELECT * FROM model_versions WHERE is_active = 1").fetchone()
        return _deserialize_model_version(dict(row)) if row else None


def activate_model_version(version_label: str) -> dict[str, Any]:
    """Champion switch: mark one version active, deactivate all others (atomic)."""
    with get_connection() as conn:
        existing = conn.execute(
            "SELECT id FROM model_versions WHERE version_label = ?", (version_label,)
        ).fetchone()
        if not existing:
            raise ValueError(f"Model version '{version_label}' not found")
        conn.execute("UPDATE model_versions SET is_active = 0")
        conn.execute(
            "UPDATE model_versions SET is_active = 1 WHERE version_label = ?", (version_label,)
        )
    return get_model_version_by_label(version_label)  # type: ignore[return-value]


# ---------------------------------------------------------------------------
# Audit Trail (AI Governance)
# ---------------------------------------------------------------------------

def log_audit_event(
    user_id: str | None,
    action: str,
    resource_type: str | None = None,
    resource_id: str | None = None,
    details: dict[str, Any] | None = None,
) -> int:
    with get_connection() as conn:
        cur = conn.execute(
            """INSERT INTO audit_log (created_at, user_id, action, resource_type, resource_id, details_json)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (_now(), user_id, action, resource_type, resource_id, json.dumps(details or {})),
        )
        return cur.lastrowid


def list_audit_log(limit: int = 100, offset: int = 0, action: str | None = None) -> list[dict[str, Any]]:
    with get_connection() as conn:
        if action:
            rows = conn.execute(
                "SELECT * FROM audit_log WHERE action = ? ORDER BY id DESC LIMIT ? OFFSET ?",
                (action, limit, offset),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM audit_log ORDER BY id DESC LIMIT ? OFFSET ?", (limit, offset)
            ).fetchall()
        results = []
        for r in rows:
            d = dict(r)
            d["details"] = json.loads(d.pop("details_json"))
            results.append(d)
        return results


def count_audit_log() -> int:
    with get_connection() as conn:
        return conn.execute("SELECT COUNT(*) AS c FROM audit_log").fetchone()["c"]


# ---------------------------------------------------------------------------
# Prediction Drift snapshots
# ---------------------------------------------------------------------------

def save_prediction_snapshot(model_version: str, approval_probability: float) -> None:
    with get_connection() as conn:
        conn.execute(
            "INSERT INTO prediction_snapshots (created_at, model_version, approval_probability) VALUES (?, ?, ?)",
            (_now(), model_version, approval_probability),
        )


def get_prediction_snapshots(limit: int = 1000) -> list[dict[str, Any]]:
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT * FROM prediction_snapshots ORDER BY id DESC LIMIT ?", (limit,)
        ).fetchall()
        return [dict(r) for r in rows]


# ---------------------------------------------------------------------------
# Rich HCXAI analytics (read-path only; write-path tables stay lean above)
# ---------------------------------------------------------------------------

def get_override_direction_stats(user_id: str) -> dict[str, Any]:
    """
    Risk tolerance signal: when a user overrides the AI, which direction do
    they lean? 'reject_to_approve' (AI said Rejected, human approved anyway
    -> lenient) vs 'approve_to_reject' (AI said Approved, human rejected
    anyway -> conservative).
    """
    with get_connection() as conn:
        rows = conn.execute(
            """SELECT f.human_decision AS human_decision, p.prediction AS ai_decision
               FROM feedback f JOIN predictions p ON f.prediction_id = p.id
               WHERE f.user_id = ? AND f.action = 'override' AND f.human_decision IS NOT NULL""",
            (user_id,),
        ).fetchall()

    reject_to_approve = sum(1 for r in rows if r["ai_decision"] == "Rejected" and r["human_decision"] == "Approved")
    approve_to_reject = sum(1 for r in rows if r["ai_decision"] == "Approved" and r["human_decision"] == "Rejected")
    total = len(rows)

    risk_tolerance = (
        round((reject_to_approve - approve_to_reject) / total, 4) if total > 0 else None
    )

    return {
        "total_overrides": total,
        "reject_to_approve_count": reject_to_approve,
        "approve_to_reject_count": approve_to_reject,
        "risk_tolerance": risk_tolerance,  # -1 (very conservative) .. +1 (very lenient)
    }


def get_feedback_stats_for_user(user_id: str) -> dict[str, Any]:
    with get_connection() as conn:
        row = conn.execute(
            """SELECT COUNT(*) AS n, AVG(trust_rating) AS avg_trust, AVG(confidence_rating) AS avg_conf,
                      SUM(CASE WHEN action = 'override' THEN 1 ELSE 0 END) AS n_override
               FROM feedback WHERE user_id = ?""",
            (user_id,),
        ).fetchone()
    n = row["n"] or 0
    return {
        "n_feedback_events": n,
        "avg_trust_rating": round(row["avg_trust"], 3) if row["avg_trust"] is not None else None,
        "avg_confidence_rating": round(row["avg_conf"], 3) if row["avg_conf"] is not None else None,
        "override_rate": round(row["n_override"] / n, 4) if n > 0 else None,
    }


def get_trust_trend(user_id: str, recent_window: int = 10) -> dict[str, Any]:
    """
    Compare the human's agreement rate with the AI in their most recent
    `recent_window` interactions vs. the window before that, to detect
    whether trust calibration is improving, worsening, or stable over time.
    """
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT agreed FROM trust_events WHERE user_id = ? ORDER BY id DESC LIMIT ?",
            (user_id, recent_window * 2),
        ).fetchall()

    agreed_flags = [r["agreed"] for r in rows]
    if len(agreed_flags) < recent_window + 1:
        return {"trend": "insufficient_data", "recent_agreement_rate": None, "prior_agreement_rate": None}

    recent = agreed_flags[:recent_window]
    prior = agreed_flags[recent_window : recent_window * 2]

    recent_rate = sum(recent) / len(recent)
    prior_rate = sum(prior) / len(prior) if prior else None

    if prior_rate is None:
        trend = "insufficient_data"
    elif recent_rate - prior_rate > 0.15:
        trend = "increasing"
    elif recent_rate - prior_rate < -0.15:
        trend = "decreasing"
    else:
        trend = "stable"

    return {
        "trend": trend,
        "recent_agreement_rate": round(recent_rate, 4),
        "prior_agreement_rate": round(prior_rate, 4) if prior_rate is not None else None,
    }


CONFIDENCE_BUCKETS = [(0.5, 0.6), (0.6, 0.7), (0.7, 0.8), (0.8, 0.9), (0.9, 1.0)]


def get_override_analysis_by_confidence(user_id: str | None = None) -> dict[str, Any]:
    """
    Human Override Analysis: bucket trust_events by the AI's confidence at
    prediction time and compute the human disagreement (override) rate per
    bucket. A well-calibrated human should disagree more often in low-
    confidence buckets and less often in high-confidence buckets; the
    opposite pattern signals miscalibrated trust.
    """
    with get_connection() as conn:
        if user_id:
            rows = conn.execute(
                "SELECT ai_confidence, agreed FROM trust_events WHERE user_id = ?", (user_id,)
            ).fetchall()
        else:
            rows = conn.execute("SELECT ai_confidence, agreed FROM trust_events").fetchall()

    buckets = []
    for low, high in CONFIDENCE_BUCKETS:
        in_bucket = [r for r in rows if low <= r["ai_confidence"] < high or (high == 1.0 and r["ai_confidence"] == 1.0)]
        n = len(in_bucket)
        disagreements = sum(1 for r in in_bucket if not r["agreed"])
        buckets.append(
            {
                "confidence_range": f"{int(low*100)}-{int(high*100)}%",
                "n_events": n,
                "disagreement_rate": round(disagreements / n, 4) if n > 0 else None,
            }
        )

    # Well-calibrated pattern check: disagreement rate should be monotonically
    # non-increasing as confidence increases (allowing for None/sparse buckets).
    rates = [b["disagreement_rate"] for b in buckets if b["disagreement_rate"] is not None]
    is_monotonic_decreasing = all(rates[i] >= rates[i + 1] for i in range(len(rates) - 1)) if len(rates) > 1 else None

    return {
        "scope": user_id or "platform-wide",
        "buckets": buckets,
        "well_calibrated_pattern": is_monotonic_decreasing,
    }


def get_satisfaction_metrics(user_id: str | None = None) -> dict[str, Any]:
    """Explanation Satisfaction Metrics: aggregate trust/confidence ratings, optionally scoped to one user."""
    with get_connection() as conn:
        if user_id:
            overall = conn.execute(
                "SELECT AVG(trust_rating) AS t, AVG(confidence_rating) AS c, COUNT(*) AS n FROM feedback WHERE user_id = ?",
                (user_id,),
            ).fetchone()
            by_action = conn.execute(
                "SELECT action, AVG(trust_rating) AS avg_trust, COUNT(*) AS n FROM feedback WHERE user_id = ? GROUP BY action",
                (user_id,),
            ).fetchall()
        else:
            overall = conn.execute(
                "SELECT AVG(trust_rating) AS t, AVG(confidence_rating) AS c, COUNT(*) AS n FROM feedback"
            ).fetchone()
            by_action = conn.execute(
                "SELECT action, AVG(trust_rating) AS avg_trust, COUNT(*) AS n FROM feedback GROUP BY action"
            ).fetchall()

    return {
        "scope": user_id or "platform-wide",
        "n_ratings": overall["n"] or 0,
        "avg_trust_rating": round(overall["t"], 3) if overall["t"] is not None else None,
        "avg_confidence_rating": round(overall["c"], 3) if overall["c"] is not None else None,
        "by_action": [
            {"action": r["action"], "avg_trust_rating": round(r["avg_trust"], 3) if r["avg_trust"] else None, "n": r["n"]}
            for r in by_action
        ],
    }


def get_explanation_history(user_id: str, limit: int = 50) -> list[dict[str, Any]]:
    """
    Explanation History: every prediction a given user has requested an
    explanation for (approximated via feedback + trust_events they've
    generated, since /explain does not require pre-registering a viewer),
    joined with the prediction's narrative and outcome.
    """
    with get_connection() as conn:
        rows = conn.execute(
            """SELECT DISTINCT p.id, p.created_at, p.prediction, p.approval_probability,
                      p.confidence, p.narrative, p.narrative_model, p.model_version
               FROM predictions p
               LEFT JOIN feedback f ON f.prediction_id = p.id AND f.user_id = ?
               LEFT JOIN trust_events t ON t.prediction_id = p.id AND t.user_id = ?
               WHERE f.id IS NOT NULL OR t.id IS NOT NULL
               ORDER BY p.id DESC LIMIT ?""",
            (user_id, user_id, limit),
        ).fetchall()
        return [dict(r) for r in rows]


def get_decision_provenance(prediction_id: int) -> dict[str, Any] | None:
    """
    Decision Provenance: the full lineage of one decision -- which
    application produced it, which model version scored it, and every
    human feedback/trust event recorded against it since.
    """
    prediction = get_prediction(prediction_id)
    if prediction is None:
        return None

    with get_connection() as conn:
        application_row = conn.execute(
            "SELECT * FROM applications WHERE id = ?", (prediction["application_id"],)
        ).fetchone()

    application = dict(application_row) if application_row else None
    if application:
        application["features"] = json.loads(application.pop("features_json"))

    model_version = get_model_version_by_label(prediction["model_version"]) if prediction.get("model_version") else None

    return {
        "prediction_id": prediction_id,
        "application": application,
        "model_version": model_version,
        "prediction_summary": {
            "prediction": prediction["prediction"],
            "approval_probability": prediction["approval_probability"],
            "confidence": prediction["confidence"],
            "created_at": prediction["created_at"],
        },
        "feedback_events": get_feedback_for_prediction(prediction_id),
    }
