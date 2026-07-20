# HCXAI for Loan Approval

Enterprise-style **Human-Centered Explainable AI (HCXAI)** platform for intelligent
loan approval decisions. The platform's development priority is, in order:

1. **HCXAI** (human-centered explainability: trust calibration, adaptive
   explanations, cognitive load management, human-in/on-the-loop feedback) — the
   core research contribution of this project.
2. **XAI** (SHAP, LIME, counterfactuals, global explainability, explanation
   quality/fidelity metrics).
3. **AI Model lifecycle** (training, versioning, evaluation, monitoring).
4. The underlying loan-approval CRUD application, as supporting infrastructure.

This document is the single source of truth for what has been built, how it is
architected, how to run it, and how it maps to (and deviates from) the original
design blueprint.

---

## Table of Contents

1. [What This Is](#what-this-is)
2. [Deviations from the Design Document](#deviations-from-the-design-document)
3. [System Architecture](#system-architecture)
4. [Technology Stack](#technology-stack)
5. [Prerequisites](#prerequisites)
6. [Setup & Running Locally](#setup--running-locally)
7. [Database Schema](#database-schema)
8. [Backend Module Reference](#backend-module-reference)
9. [Full API Reference](#full-api-reference)
10. [Frontend Page Reference](#frontend-page-reference)
11. [Authentication & RBAC](#authentication--rbac)
12. [AI Model Details](#ai-model-details)
13. [Testing](#testing)
14. [Security Notes](#security-notes)
15. [Repository Layout](#repository-layout)
16. [Known Limitations & Future Work](#known-limitations--future-work)

---

## What This Is

A working, end-to-end implementation of an HCXAI platform for a binary loan
approval decision (Approved / Rejected), built around:

- An **XGBoost** classifier trained on `loan_approval_dataset.csv` (4,269 loan
  applications, 11 features).
- A **Model Registry** (`backend/app/model_registry.py`) that versions every
  trained model, tracks full evaluation metrics, and supports champion/challenger
  promotion — all backed by SQLite, no external MLOps server required.
- A **SHAP-based explainability layer** (local + global), cross-checked by an
  independently implemented **LIME** surrogate and a self-written
  **counterfactual search engine**.
- A **Human-Centered XAI logic layer** (`backend/app/hcxai.py`) that models each
  user's cognitive profile, calibrates trust between the human and the AI over
  time, estimates the cognitive load of a given explanation, and recommends how
  to present that explanation (level of detail, whether to surface a
  counterfactual, whether to highlight uncertainty or evidence).
- A **Fairness & Responsible AI** module that checks demographic parity (the
  four-fifths rule) and generates bias-mitigation recommendations that always
  require human/compliance approval before being applied.
- A **Model Monitoring** module that detects both feature drift and prediction
  drift using the Kolmogorov-Smirnov two-sample test.
- An **Audit Trail** that logs every significant platform action for AI
  Governance and compliance review.
- A **Next.js 15 + React 19 + TypeScript** enterprise dashboard (shadcn/ui +
  Tailwind v4) that consumes every one of the above through a typed API client.

The reference design document, `HCXAI_PLATFORM_DESIGN.md`, describes a much
larger enterprise blueprint (PostgreSQL, Kafka, Kubernetes, MLflow, Evidently,
Captum, microservices). This implementation delivers the same *logical*
capabilities with a deliberately lighter infrastructure footprint — see the
next section for exactly what was substituted and why.

---

## Deviations from the Design Document

| Design doc component | Implemented as | Rationale |
|---|---|---|
| PostgreSQL | SQLite (`backend/app/db.py`) | Single-file, zero-server persistence. Same logical schema (users, applications, predictions, feedback, trust events, user profiles, model versions, audit log, prediction snapshots). |
| Kafka / Celery / Redis | Synchronous FastAPI request handling | No message queue needed at this scale; training, drift checks, and explanations run in-process and return synchronously. |
| MLflow / Weights & Biases | `backend/app/model_registry.py` + SQLite `model_versions` table | Versioned artifact storage (`backend/models/versions/<label>/`) plus full evaluation metrics (confusion matrix, ROC curve, precision-recall curve, calibration curve) recorded per version, without a separate tracking server. |
| Evidently AI | `backend/app/monitoring.py` | Feature drift (KS-test vs. training distribution) + prediction drift (KS-test on rolling probability windows), computed in-process against the SQLite store. |
| Kubernetes / Docker Swarm / MinIO | Local `uvicorn` / `npm run dev` processes, local filesystem for model artifacts | Out of scope for this project's deployment target. The FastAPI app is stateless and would containerize normally if that became a requirement. |
| **Captum** | **Not implemented — architecturally not applicable.** | Captum is a PyTorch/deep-learning attribution library. The trained model is an XGBoost gradient-boosted tree ensemble, not a neural network, so Captum's attribution methods (Integrated Gradients, DeepLIFT, etc.) do not apply. SHAP's `TreeExplainer` — which computes *exact* Shapley values for tree ensembles, not an approximation — is the correct tool for this model family and is what is actually used. |
| **dice-ml** (counterfactuals) | Self-written greedy coordinate-descent search (`backend/app/counterfactual.py`) | `dice-ml` hard-pins `pandas<2.0`, which conflicted with and downgraded this project's pandas 2.2.3, breaking the rest of the numeric stack. The self-written search is also a better fit for tree ensembles: it evaluates the actual model directly at each candidate point rather than relying on a differentiable-surrogate assumption. |
| **`lime` PyPI package** | Self-written LIME-style local surrogate (`backend/app/lime_explainer.py`) | The `lime` package is unmaintained and pulls in `scikit-image` / `matplotlib` unnecessarily for a tabular-only use case. The core algorithm (weighted local linear surrogate fit via closed-form ridge regression) is reimplemented directly with `numpy.linalg`, with the standard kernel-width heuristic (`sqrt(n_features) * 0.75`). |
| Microservices (Loan Service, Document Service, Embedding Service, Vector DB, LLM gateway, etc.) | Single FastAPI monolith with clearly separated internal modules | At this scale, a modular monolith gives the same separation of concerns with far less operational overhead. Each concern (model registry, XAI, HCXAI, fairness, monitoring, audit) is its own Python module and could be extracted into a service later without a rewrite. |

---

## System Architecture

```
loan_approval_dataset.csv
        │
        ▼
data_processing.py  (load, clean, encode categorical features)
        │
        ▼
model_registry.py  ──►  backend/models/versions/<label>/  (versioned XGBoost model + encoders)
        │                        │
        │                        ▼
        │                SQLite: model_versions table (metrics, champion pointer)
        ▼
explainer.py  (SHAP TreeExplainer, loads the active version from the registry)
        │
        ├──► global_explainability.py   Aggregate SHAP feature importance across the dataset
        ├──► lime_explainer.py           Independent local linear surrogate (SHAP cross-check)
        ├──► counterfactual.py           Self-written minimal-perturbation search
        ├──► explanation_quality.py      Stability / completeness / sparsity metrics
        ├──► fairness.py                 Demographic parity + four-fifths rule + mitigation recs
        ├──► monitoring.py               Feature drift + prediction drift (KS-test)
        ├──► similar_cases.py            Case-Based Reasoning (k-NN over training data)
        ├──► whatif.py                   Interactive what-if scenario + sensitivity sweep
        │
        ▼
hcxai.py  (Human-Centered XAI logic layer — the core novel contribution)
        │  - User Modeler: cognitive profile built from feedback/trust history
        │  - Trust Calibrator: agreement rate, trust state, trust trend over time
        │  - Cognitive Load Adaptation: conflict/complexity-aware load estimate
        │  - Explanation Recommendation Engine: detail level + modality + trust intervention
        │  - Progressive Disclosure: summary / detailed / technical rendering
        ▼
deepseek_client.py  (DeepSeek LLM narrative generation, role-aware, template fallback)
        │
        ▼
main.py  (FastAPI application: ~35 endpoints across auth, predictions, XAI,
          HCXAI, fairness, monitoring, model registry, audit)
        │
        ▼
db.py  (SQLite persistence: 10 tables, read-path analytics functions)
        │
        ▼
frontend/  (Next.js dashboard consuming every endpoint above through a typed
            API client — see Frontend Page Reference)
```

### Request flow for a single loan decision

1. User submits an application via the frontend (`POST /explain`).
2. `explainer.py` loads the active model version and produces a prediction
   (`approval_probability`, `risk_score`, `confidence`).
3. `explainer.py` computes SHAP contributions for every feature.
4. `deepseek_client.py` generates a role-aware natural-language narrative
   (falls back to a deterministic template if no API key is configured).
5. `hcxai.py::recommend_explanation_strategy()` looks at the user's cognitive
   profile, the cognitive load of this specific explanation, and the user's
   trust state, and decides: which detail level to show, whether to suggest a
   counterfactual, whether to suggest the Similar Case Explorer, and whether to
   nudge the user toward more caution or more confidence.
6. The application, prediction, SHAP result, and narrative are persisted to
   SQLite; a prediction snapshot is recorded for drift tracking; an audit log
   entry is written.
7. The response includes the prediction, SHAP contributions, narrative, the
   progressive-disclosure payload, the user's cognitive profile, and the full
   explanation strategy with its human-readable rationale.
8. When the human later approves/rejects/overrides the decision
   (`POST /feedback`), that event feeds back into the Trust Calibrator and User
   Modeler, closing the human-feedback loop.

---

## Technology Stack

### Backend
| Layer | Technology |
|---|---|
| Framework | FastAPI 0.109 (Python 3.11) |
| ML model | XGBoost 2.0 (gradient-boosted trees) |
| Explainability | SHAP 0.45 (`TreeExplainer`), self-written LIME, self-written counterfactual search |
| Data | pandas 2.2, numpy 1.26, scipy 1.12, scikit-learn 1.4 |
| Persistence | SQLite (Python stdlib `sqlite3`) |
| Auth | PyJWT (HS256) + bcrypt |
| LLM narrative | DeepSeek API via the `openai` SDK (OpenAI-compatible endpoint) |
| Testing | pytest 8.0 |

### Frontend
| Layer | Technology |
|---|---|
| Framework | Next.js 15.5 (App Router, Turbopack), React 19.1, TypeScript |
| Styling | Tailwind CSS v4, shadcn/ui (customized, `@base-ui/react` primitives) |
| Data fetching | TanStack Query 5, Axios |
| State | Zustand (auth store) |
| Charts | Apache ECharts (`echarts-for-react`), Recharts |
| Forms | React Hook Form + Zod |
| Animation | Framer Motion |
| Icons | lucide-react |
| Notifications | Sonner (toasts) |

---

## Prerequisites

- [Miniconda/Anaconda](https://docs.conda.io/en/latest/miniconda.html)
- Node.js 20+ and npm
- A DeepSeek API key (optional — the backend falls back to a deterministic
  template narrative if not configured)

---

## Setup & Running Locally

### Backend

```powershell
# 1. Create the conda environment.
#    IMPORTANT: numpy/pandas/scipy/scikit-learn are installed via pip wheels
#    (not conda-forge) to avoid a BLAS/LAPACK backend conflict that causes
#    silent native crashes in numpy.linalg / sklearn. See environment.yml.
conda env create -f environment.yml
conda activate hcxai

# 2. Configure secrets.
copy .env.example .env
# Edit .env:
#   DEEPSEEK_API_KEY=sk-...          (optional)
#   JWT_SECRET_KEY=<a long random string>   (recommended for stable sessions)
#   DEFAULT_ADMIN_EMAIL / DEFAULT_ADMIN_PASSWORD (optional overrides)

# 3. Train the first model version.
#    This writes backend/models/versions/v1/, registers it in the SQLite
#    Model Registry, and activates it as the champion.
cd backend
python -m app.model_registry

# 4. Run the API server.
uvicorn app.main:app --reload --port 8000
```

The interactive API docs (Swagger UI) are at `http://127.0.0.1:8000/docs`.
The OpenAPI JSON schema is at `http://127.0.0.1:8000/openapi.json`.

On first run, if no users exist yet, a default admin account is created
automatically:
- Email: `admin@hcxai.local` (or `DEFAULT_ADMIN_EMAIL`)
- Password: `ChangeMe123!` (or `DEFAULT_ADMIN_PASSWORD`)

**Change this password immediately after first login** — it is a well-known
default and must not be used in any shared or production environment.

### Frontend

```powershell
cd frontend
npm install
copy .env.local.example .env.local
# .env.local should contain: NEXT_PUBLIC_API_URL=http://127.0.0.1:8000

npm run dev
```

Open `http://localhost:3000` and log in with the admin account above.

### Common local maintenance commands

```powershell
# Retrain and activate a new model version (from backend/)
python -m app.model_registry

# Reset local state entirely (SQLite DB + versioned model artifacts)
Remove-Item -Recurse -Force backend/data
Remove-Item -Recurse -Force backend/models/versions

# Run the backend test suite
cd backend
pytest -v

# Type-check and build the frontend
cd frontend
npx tsc --noEmit
npm run build
```

---

## Database Schema

All tables live in a single SQLite file at `backend/data/hcxai.db` (path
configurable via `SQLITE_PATH`). Schema is created idempotently on startup
(`db.init_db()`), with a lightweight additive-migration step for columns added
after initial release (see `db._run_lightweight_migrations()`).

| Table | Purpose | Key columns |
|---|---|---|
| `users` | Accounts + RBAC | `email` (unique), `hashed_password` (bcrypt), `role` |
| `applications` | Raw feature snapshot of every submitted application | `features_json` |
| `predictions` | Model output + SHAP summary for one application | `prediction`, `approval_probability`, `risk_score`, `confidence`, `shap_json`, `narrative`, `model_version` |
| `feedback` | Human approve/reject/override events (Feedback Learner) | `action`, `human_decision`, `confidence_rating`, `trust_rating`, `comment` |
| `user_profiles` | Per-user cognitive model (User Modeler) | `expertise_level`, `preferred_detail_level`, `total_interactions`, `agreements`, `disagreements` |
| `trust_events` | Agreement/disagreement events (Trust Calibrator input) | `ai_prediction`, `ai_confidence`, `human_decision`, `agreed` |
| `model_versions` | Model Registry / Experiment Tracking | `version_label` (unique), `algorithm`, `hyperparameters_json`, `metrics_json`, `artifact_dir`, `is_active` |
| `audit_log` | AI Governance audit trail | `user_id`, `action`, `resource_type`, `resource_id`, `details_json` |
| `prediction_snapshots` | Rolling probability history (Prediction Drift input) | `model_version`, `approval_probability` |
| `model_runs` | Legacy training-run log (superseded by `model_versions`, kept for backward compatibility) | `metrics_json` |

### Entity relationships

```
users ──────────────┐
                     │ (user_id, string FK, not enforced)
applications ──1:N──► predictions ──1:N──► feedback
                            │                  │
                            │                  └──► feeds Trust Calibrator (trust_events)
                            └──1:N──► trust_events
                            └── model_version (string FK) ──► model_versions
                            └──1:N──► prediction_snapshots (via model_version)

user_profiles (keyed by user_id string, one row per human user of the platform)
audit_log (append-only, references resource_type + resource_id loosely)
```

---

## Backend Module Reference

All modules live under `backend/app/`.

| Module | Responsibility |
|---|---|
| `config.py` | Centralized settings, all read from environment variables (via `.env`) |
| `db.py` | SQLite schema, connection management, all persistence + read-path analytics functions |
| `auth.py` | Password hashing (bcrypt), JWT issuance/verification, RBAC dependency factory |
| `data_processing.py` | Dataset loading, cleaning, categorical encoding, train/test split |
| `model_registry.py` | **AI Model Center**: train, version, evaluate, activate, compare model versions |
| `explainer.py` | Loads the active model version; SHAP `TreeExplainer`-based prediction + local explanation |
| `global_explainability.py` | Aggregate SHAP feature importance across a sample of the dataset |
| `lime_explainer.py` | Self-written LIME-style local linear surrogate |
| `counterfactual.py` | Self-written greedy coordinate-descent counterfactual search |
| `explanation_quality.py` | Stability (perturbation robustness), completeness (SHAP additivity check), sparsity metrics |
| `hcxai.py` | **Human-Centered XAI logic layer**: User Modeler, Trust Calibrator, Cognitive Load Adaptation, Explanation Recommendation Engine, Progressive Disclosure |
| `fairness.py` | Demographic parity report, four-fifths rule check, bias-mitigation recommendations |
| `monitoring.py` | Feature drift (KS-test) and prediction drift (KS-test) detection |
| `similar_cases.py` | k-NN similar-case retrieval over the training set (Case-Based Reasoning) |
| `whatif.py` | Single-scenario what-if comparison and single-feature sensitivity sweep |
| `deepseek_client.py` | DeepSeek LLM narrative generation with a deterministic template fallback |
| `schemas.py` | Pydantic request/response models for every endpoint |
| `main.py` | FastAPI application: route definitions, RBAC wiring, startup/shutdown lifecycle |

### `hcxai.py` in detail (the core contribution)

Every adaptation rule in this module is a simple, auditable, human-readable
heuristic — never a black-box meta-model. This is a deliberate design
principle: a platform whose purpose is explainability should not itself
contain unexplainable adaptation logic.

- **`resolve_detail_level(user_id, override)`** — returns the user's learned
  preferred detail level, unless explicitly overridden.
- **`estimate_cognitive_load(shap_result, user_expertise)`** — computes a
  "conflict score" (how many significant SHAP factors push in opposite
  directions) and combines it with the user's expertise level to estimate how
  much mental effort a given explanation would demand right now. Returns a
  recommendation: `simplify`, `standard`, or `can_show_full_detail`.
- **`build_progressive_explanation(...)`** — renders the same underlying data
  at `summary` / `detailed` / `technical` fidelity.
- **`recommend_explanation_strategy(user_id, prediction, shap_result, ...)`** —
  the **Explanation Recommendation Engine**. Combines the User Modeler's
  learned preference, the Cognitive Load estimate (which can downgrade a
  user's preferred detail level for a specific hard case), whether the
  decision is a rejection (triggers a counterfactual suggestion) or low-
  confidence (triggers a Similar Case Explorer suggestion), and the user's
  Trust Calibration state (over-trust → highlight uncertainty; under-trust →
  highlight evidence). Returns a full rationale trail explaining every
  decision it made.
- **`record_human_decision(...)`** — feeds a human approve/reject/override
  event into the Trust Calibrator and User Modeler.
- **`get_trust_dashboard(user_id)`** — combines cognitive profile, trust
  calibration state, trust trend over time, override direction (risk
  tolerance), and satisfaction ratings into one dashboard payload.

---

## Full API Reference

Base URL: `http://127.0.0.1:8000` (default). All endpoints except `/health`
and `/auth/login` require a `Bearer <JWT>` header. Full request/response
schemas are defined in `backend/app/schemas.py` and are browsable live at
`/docs`.

### Health

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/health` | Public | Liveness check: model loaded, DeepSeek enabled, DB path |

### Auth & Users

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/auth/register` | admin | Create a new user account |
| POST | `/auth/login` | Public | Exchange email/password for a JWT |
| GET | `/auth/me` | any | Current authenticated user's profile |
| GET | `/auth/users` | admin | List all users |

### Predictions

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/predict` | admin, risk_manager, loan_officer | Risk prediction only, no explanation, no persistence |
| POST | `/explain` | any | Full HCXAI explanation: prediction + SHAP + LLM narrative + Explanation Recommendation Engine output; persists to SQLite |
| GET | `/predictions` | any | Paginated list of recent predictions (`limit`, `offset`) |
| GET | `/predictions/{id}` | any | Single prediction detail including stored SHAP result and feedback |

### XAI (Explainability Center)

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/explain/lime` | any | LIME-style local surrogate explanation (independent cross-check vs. SHAP) |
| POST | `/explain/counterfactual` | any | Minimal-change counterfactual search (`n_results` configurable) |
| GET | `/explain/global` | admin, risk_manager, loan_officer | Aggregate SHAP feature importance across the dataset |
| POST | `/explain/quality` | any | Stability / completeness / sparsity metrics for one explanation |

### HCXAI (Human-Centered XAI Center)

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/feedback` | any | Record approve/reject/override + optional ratings; updates Trust Calibrator + User Modeler |
| GET | `/trust/{user_id}` | any | Trust Dashboard: profile, calibration, trend, override direction, satisfaction |
| GET | `/feedback/analytics` | admin, risk_manager | Platform-wide override analytics |
| GET | `/hcxai/override-analysis` | admin, risk_manager | Disagreement rate bucketed by AI confidence; optional `user_id` filter |
| GET | `/hcxai/satisfaction` | any | Aggregate explanation satisfaction ratings; optional `user_id` filter |
| GET | `/hcxai/explanation-history/{user_id}` | any | Every prediction a user has interacted with |
| GET | `/hcxai/provenance/{prediction_id}` | any | Full decision lineage: application, model version, feedback events |

### Fairness & Responsible AI

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/fairness/report` | admin, risk_manager | Demographic parity + four-fifths rule check across `education` and `self_employed` |
| GET | `/fairness/mitigation-recommendations` | admin, risk_manager | Threshold-adjustment recommendations (recommendation-only; requires human approval) |

### Model Monitoring

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/monitoring/snapshot` | admin, risk_manager | Training metrics + feature drift + prediction drift |

### AI Model Center (Model Registry)

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/model/versions` | admin, risk_manager | List all trained model versions with metrics |
| GET | `/model/versions/active` | any | Currently active (champion) version |
| POST | `/model/train` | admin | Train a new version (Continuous Learning trigger); `activate` flag controls auto-promotion |
| POST | `/model/activate` | admin | Champion-Challenger switch: promote a specific version |
| POST | `/model/compare` | admin, risk_manager | Side-by-side metric comparison between two versions |

### AI Governance

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/audit` | admin | Paginated audit trail (`limit`, `offset`, optional `action` filter) |

### Interactive Tools

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/whatif` | admin, risk_manager, loan_officer | Compare base application vs. an overridden scenario |
| POST | `/whatif/sensitivity` | admin, risk_manager, loan_officer | Sweep one feature across its range, tracking approval probability |
| POST | `/similar-cases` | any | k-NN similar historical applications + outcome distribution |

### Example request

```powershell
curl -X POST http://127.0.0.1:8000/explain `
  -H "Authorization: Bearer <token>" `
  -H "Content-Type: application/json" `
  -d '{
    "application": {
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
      "bank_asset_value": 8000000
    },
    "role": "loan_officer",
    "user_id": "demo@test.local"
  }'
```

---

## Frontend Page Reference

All pages live under `frontend/src/app/(app)/` (protected by `AuthGuard`) plus
the public `/login` page. Roles listed are the ones with sidebar visibility;
the backend independently enforces RBAC on every underlying API call.

| Route | Page | Roles | Purpose |
|---|---|---|---|
| `/login` | Sign in | Public | JWT login |
| `/dashboard` | Dashboard | All | Recent decisions overview, quick stats |
| `/applications` | Loan Queue | All | Paginated list of all predictions |
| `/applications/new` | Submit Application | All | Submit a new application, view SHAP explanation, narrative, Explanation Recommendation Engine output, and give feedback |
| `/applications/[id]` | Application Detail | All | Full prediction detail: SHAP chart, narrative, feedback history, on-demand LIME cross-check, counterfactual search, explanation quality check |
| `/trust` | Trust Dashboard | All | Cognitive profile, trust calibration, trust trend, override direction, satisfaction, platform-wide feedback analytics |
| `/hcxai/explanation-history` | Explanation History | All | Timeline of every prediction a given user has interacted with |
| `/hcxai/override-analysis` | Human Override Analysis | admin, risk_manager | Disagreement rate by AI confidence bucket, well-calibration check, override direction |
| `/explainability/global` | Global Explainability | admin, risk_manager, loan_officer | Aggregate SHAP feature importance ranking across the dataset |
| `/fairness` | Fairness Report | admin, risk_manager | Demographic parity charts, four-fifths rule compliance, bias-mitigation recommendations |
| `/monitoring` | Model Monitoring | admin, risk_manager | Training metrics, feature drift report, prediction drift report |
| `/model-center` | AI Model Center | admin, risk_manager | Model version table, train/activate actions, Champion-Challenger comparison |
| `/whatif` | What-If Lab | admin, risk_manager, loan_officer | Interactive scenario editing + single-feature sensitivity sweep |
| `/similar-cases` | Similar Case Explorer | All | k-NN similar historical applications |
| `/admin/users` | User Management | admin | Create/list users, assign roles |
| `/admin/audit` | Audit Trail | admin | Paginated, filterable platform action log |

---

## Authentication & RBAC

- **Password storage**: bcrypt, salted per-password, never logged.
- **Session**: signed JWT (HS256), 8-hour expiry by default
  (`ACCESS_TOKEN_EXPIRE_MINUTES`), sent as `Authorization: Bearer <token>`.
- **Roles**: `admin`, `risk_manager`, `loan_officer`, `customer`.
- **Enforcement**: every protected endpoint declares its allowed roles via the
  `auth.require_roles(...)` FastAPI dependency; there is no endpoint that
  performs authorization only on the frontend.

| Role | Typical access |
|---|---|
| `admin` | Everything, including user management, model training/activation, and the audit trail |
| `risk_manager` | Predictions, all XAI/HCXAI views, fairness, monitoring, model registry (read + compare, not train/activate) |
| `loan_officer` | Predictions, explanations, what-if, global explainability, similar cases |
| `customer` | Explanations and feedback only (cannot see `/predict`, fairness, monitoring, or admin views) |

---

## AI Model Details

- **Algorithm**: `XGBClassifier` (gradient-boosted decision trees).
- **Features** (11 total): `no_of_dependents`, `income_annum`, `loan_amount`,
  `loan_term`, `cibil_score`, `residential_assets_value`,
  `commercial_assets_value`, `luxury_assets_value`, `bank_asset_value`
  (numeric) + `education`, `self_employed` (categorical, label-encoded).
- **Target**: `loan_status` (`Approved` / `Rejected`), stratified 80/20
  train/test split.
- **Default hyperparameters** (`model_registry.DEFAULT_HYPERPARAMETERS`):
  `n_estimators=200`, `max_depth=4`, `learning_rate=0.1`, `subsample=0.9`,
  `colsample_bytree=0.9`.

### Latest known performance (v1, 80/20 split)

| Metric | Value |
|---|---|
| Accuracy | 0.984 |
| Precision | 0.985 |
| Recall | 0.989 |
| F1 Score | 0.987 |
| AUC | 0.998 |

Full metrics per version — confusion matrix, ROC curve, precision-recall
curve, calibration curve — are computed at training time
(`model_registry._compute_rich_metrics`) and available via
`GET /model/versions`.

### Global feature importance (mean |SHAP|, v1)

`cibil_score` dominates at roughly 49% of total attribution, followed by
`loan_term` (~20%) and `loan_amount` (~9%). Exact figures shift slightly per
retrain and are always available live via `GET /explain/global`.

---

## Testing

```powershell
cd backend
pytest -v
```

56 tests across 9 files:

| File | Covers |
|---|---|
| `test_auth.py` | JWT auth, RBAC enforcement, default admin bootstrap |
| `test_data_processing.py` | Dataset loading/encoding |
| `test_deepseek_client.py` | Narrative generation (mocked, no network dependency) |
| `test_explainer.py` | SHAP prediction + explanation correctness (approved/rejected cases, contribution ordering) |
| `test_model_registry.py` | Train, version increment, activate, compare, artifact loading |
| `test_xai_modules.py` | Global explainability, counterfactual search, LIME, explanation quality |
| `test_hcxai.py` | Progressive disclosure, cognitive load estimation, Explanation Recommendation Engine, Trust Dashboard |
| `test_db_analytics.py` | Override direction, feedback stats, trust trend, confidence-bucket analysis, satisfaction, explanation history, decision provenance |
| `test_fairness_mitigation.py` | Bias mitigation recommendation generation |
| `test_monitoring_drift.py` | Prediction drift detection (insufficient data, stable, shifted distributions) |

The DeepSeek integration is mocked in the automated suite to avoid a network
dependency in CI; it has been separately verified against the live API.

### Frontend

```powershell
cd frontend
npx tsc --noEmit   # type-check
npm run build      # production build + lint
```

---

## Security Notes

- `DEEPSEEK_API_KEY` and `JWT_SECRET_KEY` are read only from the environment
  (`.env` or system env var). Neither is ever logged, hardcoded, or returned
  in any API response.
- If `JWT_SECRET_KEY` is unset, an ephemeral key is generated at process
  startup (logged as a warning) — sessions will not survive a server restart.
  Set a stable secret for any persistent deployment.
- Only anonymized feature names/values and SHAP numbers are sent to the
  DeepSeek LLM — no applicant PII, no free-text fields.
- Passwords are hashed with bcrypt; plaintext passwords are never persisted
  or logged.
- `.env` and `.env.local` are gitignored; only `.env.example` /
  `.env.local.example` (with placeholder values) are committed.
- The default admin credentials are a well-known placeholder
  (`admin@hcxai.local` / `ChangeMe123!`) and **must** be changed before any
  non-local use.
- All write-side HCXAI adaptation logic (`hcxai.py`) is simple, auditable
  if/else heuristics by design — there is no black-box meta-model deciding
  what a user sees, which matters for the platform's own governance story.

---

## Repository Layout

```
demo_seminar1/
├── README.md                   # This document
├── HCXAI_PLATFORM_DESIGN.md    # Original enterprise design blueprint (see Deviations section)
├── loan_approval_dataset.csv   # Training dataset (4,269 rows)
├── environment.yml             # Conda environment spec (pip-only numeric stack)
├── .env.example                 # Backend environment variable template
├── backend/
│   ├── app/
│   │   ├── config.py
│   │   ├── db.py
│   │   ├── auth.py
│   │   ├── data_processing.py
│   │   ├── model_registry.py
│   │   ├── explainer.py
│   │   ├── global_explainability.py
│   │   ├── lime_explainer.py
│   │   ├── counterfactual.py
│   │   ├── explanation_quality.py
│   │   ├── hcxai.py
│   │   ├── fairness.py
│   │   ├── monitoring.py
│   │   ├── similar_cases.py
│   │   ├── whatif.py
│   │   ├── deepseek_client.py
│   │   ├── schemas.py
│   │   └── main.py
│   ├── tests/                  # pytest suite (56 tests, 9 files)
│   ├── models/                 # Trained model artifacts (gitignored)
│   │   └── versions/<label>/   # model.joblib, encoders.joblib, metadata.json
│   ├── data/                   # SQLite database file (gitignored)
│   └── requirements.txt
└── frontend/
    ├── .env.local.example
    ├── src/
    │   ├── app/
    │   │   ├── login/
    │   │   └── (app)/
    │   │       ├── dashboard/
    │   │       ├── applications/ (+ new/, [id]/)
    │   │       ├── trust/
    │   │       ├── hcxai/ (explanation-history/, override-analysis/)
    │   │       ├── explainability/global/
    │   │       ├── fairness/
    │   │       ├── monitoring/
    │   │       ├── model-center/
    │   │       ├── whatif/
    │   │       ├── similar-cases/
    │   │       └── admin/ (users/, audit/)
    │   ├── components/
    │   │   ├── charts/          # risk-gauge, shap-chart
    │   │   ├── layout/          # app-sidebar, top-bar, page-header, auth-guard
    │   │   ├── loan/            # loan-application-form
    │   │   └── ui/              # shadcn/ui component library
    │   ├── lib/
    │   │   ├── api.ts           # Axios client + interceptors
    │   │   ├── endpoints.ts     # Typed wrapper for every backend endpoint
    │   │   ├── types.ts         # TypeScript types mirroring backend schemas
    │   │   └── utils.ts
    │   ├── hooks/
    │   └── stores/
    │       └── auth-store.ts    # Zustand auth state
    └── package.json
```

---

## Known Limitations & Future Work

- **Dataset has no protected demographic attributes** (race, gender, age).
  The Fairness module analyzes `education` and `self_employed` as the only
  available categorical proxies. A production deployment with real demographic
  data would need additional sensitive-attribute analysis.
- **LIME fidelity R² can be negative** on this model. This is a documented,
  expected property of fitting a *linear* surrogate to a *tree ensemble's*
  piecewise-constant decision surface, especially near split boundaries or in
  high-confidence regions with near-zero local variance — not a bug. The
  feature ranking/direction remains informative even when R² is poor; treat
  it as a fidelity warning signal, not a pass/fail gate.
- **Counterfactual search is a heuristic, not a guaranteed-optimal solver.**
  It reliably finds *a* minimal, actionable counterfactual in most cases
  (~4 seconds) but is not guaranteed to find the globally minimal one.
- **No horizontal scaling / job queue.** Training and drift computation run
  synchronously in the request thread. Fine for a single-model demo/dev
  deployment; would need a background worker for frequent retraining at scale.
- **Single-tenant.** There is no multi-tenant data isolation; all users share
  one SQLite database and one active model version.
- **Notification system**: the top bar previously had a placeholder
  notification bell with no backing logic; it has been removed rather than
  shipped as dead UI. A real notification system (e.g. for drift alerts or
  fairness violations) would be a natural next feature.
