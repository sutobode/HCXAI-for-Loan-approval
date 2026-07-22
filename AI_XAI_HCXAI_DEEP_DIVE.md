# AI, XAI, HCXAI — Phân tích Kỹ thuật Chuyên sâu

> **Tài liệu này dành cho**: Giáo sư, research reviewer, người có nền tảng AI/ML muốn hiểu chi tiết thuật toán, code implementation, và đóng góp nghiên cứu của hệ thống HCXAI Loan Approval.

---

## Mục lục

1. [Model AI — XGBoost Binary Classifier](#1-model-ai--xgboost-binary-classifier)
2. [XAI Layer — 7 phương pháp giải thích](#2-xai-layer--7-phương-pháp-giải-thích)
3. [HCXAI Layer — Closed-loop Human-Centered Explainability](#3-hcxai-layer--closed-loop-human-centered-explainability)
4. [So sánh với State-of-the-Art](#4-so-sánh-với-state-of-the-art)
5. [Research Contribution (Novelty)](#5-research-contribution-novelty)
6. [Hạn chế và Hướng phát triển](#6-hạn-chế-và-hướng-phát-triển)

---

## 1. Model AI — XGBoost Binary Classifier

### 1.1 Lựa chọn thuật toán

**Tại sao XGBoost?**

| Tiêu chí | XGBoost | Neural Networks | Logistic Regression |
|----------|---------|-----------------|---------------------|
| Accuracy trên tabular data | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ |
| Explainability (TreeExplainer exact SHAP) | ⭐⭐⭐⭐⭐ | ⭐⭐ | ⭐⭐⭐⭐ |
| Training speed | ⭐⭐⭐⭐ | ⭐⭐ | ⭐⭐⭐⭐⭐ |
| Overfitting resistance | ⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐ |
| Feature interaction capture | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐ |

XGBoost được chọn vì:
1. **TreeExplainer cho EXACT Shapley values** (không phải approximation như KernelExplainer) — crucial cho XAI
2. **Dominant trên tabular data** — Kaggle competitions, production finance systems
3. **Feature interaction tự động** — không cần manual feature engineering
4. **Calibration tốt** — probability outputs đáng tin (quan trọng cho trust calibration)

### 1.2 Dataset

**Source**: `loan_approval_dataset.csv` (4,269 hồ sơ vay lịch sử)

**Features** (11 total):

```python
NUMERIC_COLUMNS = [
    "no_of_dependents",           # 0-5 người
    "income_annum",               # 200K - 50M VND
    "loan_amount",                # 100K - 50M VND
    "loan_term",                  # 2-20 tháng
    "cibil_score",                # 300-900 (credit score)
    "residential_assets_value",   # 0 - 50M VND
    "commercial_assets_value",    # 0 - 50M VND
    "luxury_assets_value",        # 0 - 50M VND
    "bank_asset_value"            # 0 - 50M VND
]

CATEGORICAL_COLUMNS = [
    "education",       # Graduate (1) / Not Graduate (0)
    "self_employed"    # Yes (1) / No (0)
]
```

**Target**: `loan_status` → Approved (1) / Rejected (0)

**Encoding**: Ordinal encoding (0/1) cho categorical — phù hợp cho tree models (không cần one-hot).

### 1.3 Train/Test Split

```python
train_test_split(
    X_encoded, y, 
    test_size=0.2,      # 80% train, 20% test
    random_state=42,    # Reproducible
    stratify=y          # Giữ tỷ lệ Approved/Rejected trong train và test
)
```

**Kết quả**:
- Train: 3,415 samples
- Test: 854 samples
- Class distribution: ~68% Approved, ~32% Rejected (cả train và test)

### 1.4 Hyperparameters

```python
DEFAULT_HYPERPARAMETERS = {
    "n_estimators": 200,        # 200 trees
    "max_depth": 4,             # Shallow trees → less overfit, easier interpret
    "learning_rate": 0.1,       # Standard
    "subsample": 0.9,           # Row sampling → prevent overfit
    "colsample_bytree": 0.9,    # Column sampling → feature diversity
    "eval_metric": "logloss",   # Probability calibration
    "random_state": 42
}
```

**Không có hyperparameter tuning** (deliberate choice):
- Focus của project là HCXAI platform, không phải squeeze 1% accuracy
- Default hyperparams đạt >95% accuracy trên dataset này → đủ để demo explainability stack
- Production system nên thêm Optuna/Hyperopt grid search

### 1.5 Evaluation Metrics

Code: `backend/app/model_registry.py` → `_compute_rich_metrics()`

```python
metrics = {
    "accuracy": 0.9578,          # 95.78%
    "precision": 0.9812,         # 98.12% (of predicted Approved, 98% thật sự Approved)
    "recall": 0.9623,            # 96.23% (of actual Approved, 96% được predict đúng)
    "f1_score": 0.9716,          # Harmonic mean
    "auc": 0.9891,               # AUC-ROC: 98.91%
    
    "confusion_matrix": [[TN, FP], [FN, TP]],
    "roc_curve": [...],          # 50 điểm (fpr, tpr)
    "precision_recall_curve": [...],
    "calibration_curve": [...]   # 10 bins (mean_predicted, fraction_positive)
}
```

**Calibration Curve** — Quan trọng cho Trust Calibration:
- Model predict 70% → thực tế ~70% được duyệt (well-calibrated)
- Nếu model predict 70% nhưng thực tế 90% → over-confident → cần recalibration

### 1.6 Model Versioning (Champion-Challenger)

Code: `backend/app/model_registry.py` → `train_new_version()`

**Flow**:
```
Train → Evaluate → Persist artifacts → Register metadata → Activate
```

**Artifacts** (lưu vào `backend/models/versions/v1/`):
- `model.joblib` — Trained XGBClassifier
- `encoders.joblib` — Categorical encoders (để inference)
- `metadata.json` — Features + metrics

**Database**: SQLite `model_versions` table

| Field | Type | Mô tả |
|-------|------|-------|
| version_label | TEXT | v1, v2, v3... |
| algorithm | TEXT | "XGBClassifier" |
| hyperparameters_json | TEXT | Full config |
| metrics_json | TEXT | accuracy, f1, auc, curves... |
| artifact_dir | TEXT | Path to .joblib files |
| is_active | BOOLEAN | Only 1 version active tại 1 thời điểm |
| trained_by | TEXT | User ID |
| created_at | TIMESTAMP | |

**Champion-Challenger**: UI cho phép compare 2 versions → activate version tốt hơn → switch tức thì (không cần restart backend).

---

## 2. XAI Layer — 7 phương pháp giải thích

### 2.1 SHAP (SHapley Additive exPlanations)

**Paper**: Lundberg & Lee, NeurIPS 2017

**Code**: `backend/app/explainer.py`

#### Lý thuyết

SHAP values dựa trên **game theory (Shapley values)**:
- Xem prediction như "payout" của trò chơi hợp tác
- Mỗi feature là 1 "player"
- SHAP value = đóng góp công bằng của feature đó vào prediction

**Công thức** (Shapley value):

```
φᵢ = Σ_{S ⊆ F\{i}} [|S|! (|F|-|S|-1)!] / |F|! × [f(S ∪ {i}) - f(S)]
```

Với:
- F: tập tất cả features
- S: tập con của F không chứa feature i
- f(S): prediction khi chỉ dùng features trong S

**Tính chất**:
1. **Additivity**: base_value + Σ φᵢ = model output (log-odds cho XGBoost)
2. **Local accuracy**: giải thích chính xác cho instance này
3. **Missingness**: feature không có → φ = 0
4. **Consistency**: feature đóng góp nhiều hơn → φ lớn hơn

#### Implementation — TreeExplainer

```python
import shap

class LoanExplainer:
    def __init__(self):
        self.model = load_xgboost_model()
        # TreeExplainer: EXACT Shapley values cho tree models
        # Không phải approximation như KernelExplainer
        self.tree_explainer = shap.TreeExplainer(self.model)
```

**Tại sao TreeExplainer?**
- **Exact**: tính CHÍNH XÁC Shapley values (polynomial time cho trees)
- **Fast**: không cần sampling như KernelExplainer (exponential → polynomial)
- **Proven**: Lundberg et al. đã chứng minh correctness cho tree ensembles

#### Output

```python
shap_values = tree_explainer.shap_values(features_df)
# Shape: (1, 11) — 1 instance, 11 features
# Mỗi giá trị: contribution (log-odds) của feature đó

# Ví dụ:
# cibil_score: -4.387      → giảm mạnh approval probability
# income_annum: +2.145     → tăng approval probability
# loan_amount: -1.893      → giảm approval probability
```

**Interpretation**:
- base_value = -0.523 (log-odds trung bình của training set)
- Σ contributions = -0.523 + (-4.387) + 2.145 + (-1.893) + ... = -3.2
- Final log-odds = -3.2 → probability = sigmoid(-3.2) = 0.04 → **Rejected (4%)**

#### Visualization

Frontend: `components/charts/shap-chart.tsx`

```tsx
<ResponsiveContainer>
  <BarChart data={sortedByMagnitude}>
    <XAxis dataKey="display_name" />
    <Bar dataKey="shap_contribution" fill={(entry) => 
      entry.shap_contribution > 0 ? '#10b981' : '#ef4444'
    } />
  </BarChart>
</ResponsiveContainer>
```

- Xanh = tăng approval (positive contribution)
- Đỏ = giảm approval (negative contribution)
- Sắp xếp theo |magnitude| giảm dần

---

### 2.2 LIME (Local Interpretable Model-agnostic Explanations)

**Paper**: Ribeiro et al., KDD 2016

**Code**: `backend/app/lime_explainer.py` — **Tự implement** (không dùng `lime` package)

#### Lý do tự implement

Package `lime` trên PyPI:
- ❌ Unmaintained từ 2020
- ❌ Pin pandas<2.0 → conflict với project stack
- ❌ Kéo theo scikit-image, matplotlib (không cần cho tabular)

→ Tự implement core algorithm (300 lines, clean, documented)

#### Algorithm

**Input**: 1 instance x

**Steps**:
1. **Perturb**: Sinh N samples xung quanh x (Gaussian noise × feature_std)
2. **Weight**: Tính proximity weight w = exp(-d²/kernel_width²)
3. **Query**: Chạy black-box model trên N samples → predictions
4. **Fit**: Ridge regression (weighted) từ perturbed features → predictions

**Output**: Linear coefficients = local feature importances

#### Code implementation

```python
class LimeTabularExplainer:
    def explain(self, features_df: pd.DataFrame):
        instance = features_df.to_numpy()[0]  # (11,)
        
        # 1. Perturb
        noise = self.rng.normal(
            loc=0.0, 
            scale=self.feature_std,  # training set std per feature
            size=(N_SAMPLES, n_features)  # (2000, 11)
        )
        neighbors = instance + noise
        neighbors[0] = instance  # always include original
        
        # 2. Weight
        scaled_diff = (neighbors - instance) / self.feature_std
        distances = np.sqrt((scaled_diff**2).sum(axis=1))
        kernel_width = np.sqrt(n_features) * 0.75  # Standard LIME default
        weights = np.exp(-(distances**2) / (kernel_width**2))
        
        # 3. Query black-box
        probabilities = self.explainer.model.predict_proba(neighbors_df)[:, 1]
        
        # 4. Fit weighted ridge
        coef = _weighted_ridge_fit(
            X=scaled_diff,  # perturbations in standardized space
            y=probabilities,
            sample_weight=weights,
            alpha=1.0
        )
        
        return {
            "contributions": [
                {"feature": f, "lime_weight": coef[i]} 
                for i, f in enumerate(FEATURE_COLUMNS)
            ],
            "fidelity_r2": compute_r2(...)
        }
```

#### Weighted Ridge Regression (closed-form)

```python
def _weighted_ridge_fit(X, y, sample_weight, alpha):
    """
    Solve: β = (X^T W X + αI)^{-1} X^T W y
    
    Không dùng sklearn.linear_model.Ridge vì:
    - Project từng gặp BLAS/LAPACK conflict (MKL vs OpenBLAS)
    - Closed-form này đơn giản, zero dependency
    """
    w_sqrt = np.sqrt(sample_weight)
    Xw = X * w_sqrt[:, None]
    yw = y * w_sqrt
    A = Xw.T @ Xw + alpha * np.eye(X.shape[1])
    b = Xw.T @ yw
    return np.linalg.solve(A, b)
```

#### Fidelity R²

```python
fidelity_r2 = 1 - SS_res / SS_tot
```

**Interpretation**:
- R² > 0.8: Linear surrogate fit tốt → giải thích đáng tin
- R² < 0 (negative): Surrogate fit kém → **cảnh báo** user

**Tại sao R² có thể âm?**
- XGBoost là piecewise-constant (step functions)
- Linear surrogate không thể fit tốt ở ranh giới split
- Đây là **documented limitation** của LIME trên tree ensembles (Ribeiro et al. 2016)
- Feature ranking vẫn informative, chỉ cần cảnh báo fidelity thấp

#### LIME vs SHAP

| | SHAP | LIME |
|---|------|------|
| Lý thuyết | Game theory (Shapley) | Local linear approximation |
| Exactness | Exact cho trees | Approximate |
| Speed | Fast (TreeExplainer) | Slower (2000 samples) |
| Consistency | Always consistent | Có thể inconsistent giữa các runs |
| Use case | Primary explanation | Cross-check SHAP |

**Trong hệ thống này**: LIME dùng như **independent cross-check**. Nếu SHAP và LIME đồng ý về feature importance ranking → giải thích đáng tin hơn.

---

### 2.3 Counterfactual Explanation

**Papers**:
- Wachter et al., 2017 (Counterfactual Explanations)
- Mothilal et al., 2020 (DiCE: Diverse Counterfactual Explanations)

**Code**: `backend/app/counterfactual.py` — **Tự implement** (DiCE-inspired)

#### Lý do tự implement

Package `dice-ml`:
- ❌ Pin pandas<2.0 → conflict
- ❌ Overkill dependencies (TensorFlow optional backend)

#### Problem formulation

**Input**: Instance x với prediction y = Rejected

**Goal**: Tìm x' sao cho:
1. model(x') = Approved (flip decision)
2. ||x - x'|| nhỏ nhất (minimal change)
3. x' realistic (trong bounds, actionable features only)

**Constraints**:
- Chỉ thay đổi **actionable features**: income, cibil_score, loan_amount, assets
- KHÔNG đề xuất thay đổi: education, dependents (phi đạo đức, không thực tế)
- Mỗi feature có bounds: cibil_score ∈ [300, 900], income ∈ [200K, 50M], ...

#### Algorithm — Greedy Coordinate Search

```python
def _single_search(explainer, original, target_approved):
    """
    Greedy coordinate descent with decaying step size.
    Phù hợp cho tree ensembles (không smooth → gradient không apply).
    """
    current = dict(original)
    step_fraction = INITIAL_STEP_FRACTION  # 0.25
    
    for iteration in range(N_ITERATIONS):  # 12
        # Decay step
        step_fraction *= STEP_DECAY  # 0.8
        
        # Random feature order per iteration (diversity)
        random.shuffle(features)
        
        for feature in features:
            low, high = ACTIONABLE_FEATURE_BOUNDS[feature]
            span = high - low
            step = span * step_fraction
            
            # Try multiple candidate steps
            for direction in (+1, -1, +0.5, -0.5):
                candidate_value = clip(current[feature] + direction*step, low, high)
                trial = dict(current)
                trial[feature] = candidate_value
                
                trial_proba = predict_probability(trial)
                
                # Greedy: keep if closer to target
                if abs(trial_proba - target_value) < best_gap:
                    best_gap = abs(trial_proba - target_value)
                    current[feature] = candidate_value
        
        # Check if flipped
        if (current_proba >= 0.5) == target_approved:
            return current  # Success
    
    return None  # Not found
```

**Tại sao không dùng gradient-based optimization?**
- XGBoost decision surface = piecewise constant (step functions)
- Gradient = 0 hầu hết nơi, undefined tại split points
- Greedy coordinate search robust hơn cho tree models

#### Diversity via Multi-restart

```python
candidates = []
for restart in range(N_RESTARTS):  # 4
    result = _single_search(...)  # Random feature order mỗi lần
    if result: candidates.append(result)

# Deduplicate by feature-set changed
best_per_featureset = {}
for c in candidates:
    key = frozenset(c.changes.keys())
    if key not in best_per_featureset or c.distance < best_per_featureset[key].distance:
        best_per_featureset[key] = c

# Return top-3 diverse
return sorted(best_per_featureset.values(), key=lambda c: c.distance)[:3]
```

**Tại sao cần diversity?**
- User muốn có options: "Tôi có thể tăng CIBIL HOẶC giảm loan_amount"
- Mỗi option thay đổi features khác nhau → user chọn cái nào feasible

#### Output

```json
{
  "original_decision": "Rejected",
  "original_probability": 0.12,
  "counterfactuals": [
    {
      "changes": [
        {"feature": "cibil_score", "original": 417, "suggested": 628, "delta": +211},
        {"feature": "loan_amount", "original": 12200000, "suggested": 8000000, "delta": -4200000}
      ],
      "resulting_probability": 0.72,
      "normalized_distance": 0.43,
      "n_features_changed": 2
    },
    {
      "changes": [
        {"feature": "income_annum", "original": 3500000, "suggested": 6800000, "delta": +3300000}
      ],
      "resulting_probability": 0.68,
      "normalized_distance": 0.51,
      "n_features_changed": 1
    }
  ]
}
```

#### Ethical considerations

Code explicitly excludes:
```python
# NOT actionable (philosophical/ethical reasons):
# - education: Can't change degree retroactively
# - no_of_dependents: Telling user to "have fewer kids" is unethical
# - self_employed: Career change not instant

ACTIONABLE_FEATURE_BOUNDS = {
    "cibil_score": (300, 900),        # Can improve credit
    "income_annum": (200_000, 50_000_000),  # Can get raise/job
    "loan_amount": (100_000, 50_000_000),   # Can borrow less
    "loan_term": (2, 20),                   # Can adjust term
    "residential_assets_value": ...,        # Can sell/buy assets
    "commercial_assets_value": ...,
    "bank_asset_value": ...
}
```

---

### 2.4 Global Explainability

**Code**: `backend/app/global_explainability.py`

#### Method: Mean |SHAP| aggregation

```python
def compute_global_importance(explainer, sample_size=500):
    """
    Global feature importance = mean |SHAP| over population.
    Standard method (Lundberg et al. 2020 Nature Machine Intelligence).
    """
    dataset = prepare_dataset()
    combined = pd.concat([dataset.X_train, dataset.X_test])
    sample = combined.sample(n=min(sample_size, len(combined)), random_state=42)
    
    # Compute SHAP for all samples at once (vectorized)
    shap_values = explainer.tree_explainer.shap_values(sample)  # (500, 11)
    
    # Aggregate
    mean_abs = np.abs(shap_values).mean(axis=0)      # (11,)
    mean_signed = shap_values.mean(axis=0)           # (11,)
    std_abs = np.abs(shap_values).std(axis=0)        # (11,)
    
    results = []
    for i, feature in enumerate(FEATURE_COLUMNS):
        results.append({
            "feature": feature,
            "mean_abs_shap": mean_abs[i],              # Magnitude: bao nhiêu ảnh hưởng
            "mean_signed_shap": mean_signed[i],        # Direction: tăng/giảm duyệt
            "std_abs_shap": std_abs[i],                # Variability
            "overall_direction": "increases_approval" if mean_signed[i] > 0 else "decreases_approval"
        })
    
    # Rank by mean_abs_shap
    results.sort(key=lambda r: r["mean_abs_shap"], reverse=True)
    
    # Compute relative importance
    total = sum(r["mean_abs_shap"] for r in results)
    for r in results:
        r["relative_importance_pct"] = 100 * r["mean_abs_shap"] / total
    
    return results
```

#### Output example

```json
[
  {
    "feature": "cibil_score",
    "mean_abs_shap": 1.823,
    "mean_signed_shap": -1.734,  // Negative = decreases approval on average
    "relative_importance_pct": 45.2,
    "overall_direction": "decreases_approval"
  },
  {
    "feature": "income_annum",
    "mean_abs_shap": 0.891,
    "mean_signed_shap": +0.852,  // Positive = increases approval
    "relative_importance_pct": 22.1,
    "overall_direction": "increases_approval"
  },
  {
    "feature": "loan_amount",
    "mean_abs_shap": 0.623,
    "mean_signed_shap": -0.601,
    "relative_importance_pct": 15.4,
    "overall_direction": "decreases_approval"
  }
  // ... 8 features khác
]
```

#### Interpretation

- **cibil_score chiếm 45%** total importance → yếu tố quan trọng nhất
- **mean_signed < 0** → trung bình, cibil thấp giảm approval (điều này hợp lý)
- **income_annum 22%** → yếu tố thứ 2

Frontend visualization: Horizontal bar chart, color-coded direction.

---

### 2.5 Explanation Quality Metrics

**Code**: `backend/app/explanation_quality.py`

#### Motivation

"How do we know if an explanation is good?"

Objective metrics (không cần human evaluation):
1. **Stability**: Robust dưới nhiễu nhỏ?
2. **Completeness**: Mathematically correct?
3. **Sparsity**: Gọn (ít yếu tố chính)?

#### 2.5.1 Stability

**Paper**: Alvarez-Melis & Jaakkola, NeurIPS 2018

**Method**: Perturb input → compute Spearman rank correlation

```python
def compute_stability_score(explainer, application):
    """
    SHAP ranking có ổn định dưới nhiễu ±3% không?
    """
    # Original
    original_df = encode_single_application(application, explainer.encoders)
    original_explanation = explainer.explain(original_df)
    original_ranking = [c["feature"] for c in original_explanation["contributions"]]
    
    correlations = []
    for _ in range(N_PERTURBATIONS):  # 8
        # Perturb
        perturbed_app = _perturb_application(application, rng)  # ±3% Gaussian noise
        perturbed_df = encode_single_application(perturbed_app, explainer.encoders)
        perturbed_explanation = explainer.explain(perturbed_df)
        perturbed_ranking = [c["feature"] for c in perturbed_explanation["contributions"]]
        
        # Spearman correlation
        original_ranks = {f: i for i, f in enumerate(original_ranking)}
        perturbed_ranks = [original_ranks[f] for f in perturbed_ranking]
        corr, _ = spearmanr(range(len(perturbed_ranking)), perturbed_ranks)
        
        correlations.append(corr)
    
    mean_stability = np.mean(correlations)
    return {
        "stability_score": mean_stability,  # 0-1
        "interpretation": (
            "highly_stable" if mean_stability > 0.8 else
            "moderately_stable" if mean_stability > 0.5 else
            "unstable"
        )
    }
```

**Interpretation**:
- Stability > 0.8: Giải thích đáng tin (ranking không đổi nhiều dưới nhiễu)
- Stability < 0.5: Cảnh báo user (instance gần decision boundary)

#### 2.5.2 Completeness

**Property**: SHAP additivity

```
base_value + Σ φᵢ = model output (log-odds)
```

Code:
```python
def verify_completeness(shap_result, model_output_logodds):
    total_contribution = sum(c["shap_contribution"] for c in shap_result["contributions"])
    reconstructed = shap_result["base_value"] + total_contribution
    error = abs(reconstructed - model_output_logodds)
    
    return {
        "reconstruction_error": error,
        "is_complete": error < 1e-3  # Numerical tolerance
    }
```

**Mục đích**: Verify pipeline correctness (không silent bug trong SHAP computation).

#### 2.5.3 Sparsity (Cognitive Load Proxy)

**Cognitive science**: Miller's 7±2 (1956) — humans can hold ~7 items in working memory

**Metric**: Top-k concentration ratio

```python
def compute_sparsity_score(shap_result, top_k=3):
    magnitudes = sorted(
        (abs(c["shap_contribution"]) for c in shap_result["contributions"]),
        reverse=True
    )
    total = sum(magnitudes)
    top_k_sum = sum(magnitudes[:top_k])
    ratio = top_k_sum / total
    
    return {
        "concentration_ratio": ratio,  # 0-1
        "interpretation": (
            "concise" if ratio > 0.8 else        # Top-3 chiếm >80%
            "moderately_concise" if ratio > 0.5 else
            "diffuse"                             # Cần nhiều yếu tố → khó hiểu
        )
    }
```

**Use case**: Nếu sparsity thấp (diffuse) → Cognitive Load Adaptation trigger "simplify".

#### Composite Quality Score

```python
composite = (
    stability_score * 0.33 +
    (1.0 if completeness else 0.0) * 0.33 +
    sparsity_ratio * 0.33
)
```

Frontend hiển thị: 0-100 score + breakdown by 3 metrics.

---

### 2.6 Similar Cases (Case-Based Reasoning)

**Code**: `backend/app/similar_cases.py`

#### Method: k-Nearest Neighbors

```python
from sklearn.neighbors import NearestNeighbors
from sklearn.preprocessing import StandardScaler

class SimilarCaseIndex:
    def __init__(self, k_max=20):
        dataset = prepare_dataset()
        all_encoded = pd.concat([dataset.X_train, dataset.X_test])
        
        # Standardize (Euclidean distance fair across features)
        self.scaler = StandardScaler()
        scaled = self.scaler.fit_transform(all_encoded[FEATURE_COLUMNS])
        
        # Fit k-NN
        self.model = NearestNeighbors(n_neighbors=k_max, metric="euclidean")
        self.model.fit(scaled)
        
        # Keep raw data for display
        self.raw_df = load_raw_dataframe().loc[all_encoded.index]
    
    def find_similar(self, features_df, k=5):
        scaled_query = self.scaler.transform(features_df[FEATURE_COLUMNS])
        distances, indices = self.model.kneighbors(scaled_query, n_neighbors=k)
        
        results = []
        for dist, idx in zip(distances[0], indices[0]):
            row = self.raw_df.iloc[idx]
            similarity = 1.0 - (dist / max_dist) if max_dist > 0 else 1.0
            results.append({
                "loan_id": row["loan_id"],
                "similarity_score": similarity,  # 0-1
                "distance": dist,
                "outcome": row["loan_status"],  # Approved/Rejected
                "features": {col: row[col] for col in FEATURE_COLUMNS}
            })
        return results
```

**Tại sao StandardScaler?**
- income_annum range: [200K, 50M] → magnitude lớn
- no_of_dependents range: [0, 5] → magnitude nhỏ
- Nếu không scale: Euclidean distance bị dominate bởi income → dependents không ảnh hưởng
- StandardScaler: (x - mean) / std → tất cả features có scale tương đương

#### Output distribution

```python
def outcome_distribution(similar_cases):
    approved = sum(1 for c in similar_cases if c["outcome"] == "Approved")
    total = len(similar_cases)
    return {
        "approved": approved,
        "rejected": total - approved,
        "approval_rate": approved / total
    }
```

**Use case**: "Trong 5 hồ sơ tương tự, 4 được duyệt, 1 bị từ chối → approval_rate = 80%"

Frontend: Cards với similarity bar + outcome badge.

---

### 2.7 What-If Lab

**Code**: `backend/app/whatif.py`

#### Mode 1: Single Override

```python
@app.post("/whatif")
def whatif_single_override(request: WhatIfRequest):
    """User thay đổi 1 feature → compare before/after"""
    original = request.features
    modified = dict(original)
    modified[request.change_feature] = request.new_value
    
    original_pred = explainer.predict(encode(original))
    modified_pred = explainer.predict(encode(modified))
    
    return {
        "original": original_pred,
        "modified": modified_pred,
        "decision_changed": (original_pred["prediction"] != modified_pred["prediction"]),
        "probability_delta": modified_pred["approval_probability"] - original_pred["approval_probability"]
    }
```

Frontend: Form → select feature → input new value → "Chạy so sánh" → Before/After cards.

#### Mode 2: Sensitivity Sweep

```python
@app.post("/whatif/sensitivity")
def whatif_sensitivity(request: SensitivityRequest):
    """Vary 1 feature across range → plot approval probability curve"""
    feature = request.feature
    low, high = request.range_low, request.range_high
    steps = np.linspace(low, high, num=20)
    
    results = []
    for value in steps:
        modified = dict(request.features)
        modified[feature] = value
        pred = explainer.predict(encode(modified))
        results.append({
            "feature_value": value,
            "approval_probability": pred["approval_probability"],
            "prediction": pred["prediction"]
        })
    
    return {"sweep": results}
```

Frontend: ECharts line chart, x-axis = feature value, y-axis = approval probability, threshold line tại 0.5.

---

## 3. HCXAI Layer — Closed-loop Human-Centered Explainability

> **Core research contribution (novelty)** của hệ thống này.

### 3.1 Tổng quan kiến trúc HCXAI

```
┌─────────────────────────────────────────────────────────────────┐
│                     HCXAI Engine (backend/app/hcxai.py)          │
│                                                                   │
│  ┌────────────────┐  ┌──────────────────┐  ┌──────────────────┐ │
│  │  User Modeler  │  │ Trust Calibrator │  │  Explanation     │ │
│  │                │  │                  │  │  Recommendation  │ │
│  │ - expertise    │  │ - detect over/   │  │  Engine          │ │
│  │ - detail pref  │  │   under-trust    │  │                  │ │
│  │ - interactions │  │ - trend analysis │  │ - strategy       │ │
│  └────────────────┘  └──────────────────┘  │ - rationale      │ │
│          │                    │             │ - intervention   │ │
│          └────────────────────┴─────────────┤                  │ │
│                                             └──────────────────┘ │
│                                                       │           │
└───────────────────────────────────────────────────────┼───────────┘
                                                        │
                                    ┌───────────────────▼───────────┐
                                    │ DeepSeek LLM                  │
                                    │ (Narrative Generation)        │
                                    │ Prompt includes:              │
                                    │ - trust_intervention strategy │
                                    └───────────────────────────────┘
```

### 3.2 User Modeler

**Code**: `backend/app/hcxai.py` → `UserModeler` class

#### Tracked attributes

```python
@dataclass
class UserProfile:
    user_id: int
    expertise_level: float = 0.0        # 0.0 → 1.0 (novice → expert)
    preferred_detail_level: str = "summary"  # summary/detailed/technical
    total_interactions: int = 0
    agreements: int = 0
    disagreements: int = 0
    last_updated: datetime
```

#### Update rules

**Expertise evolution**:
```python
def update_from_feedback(profile, feedback):
    profile.total_interactions += 1
    profile.expertise_level = min(1.0, profile.expertise_level + 0.01)
    
    # Learned preference escalation
    if profile.total_interactions < 5:
        profile.preferred_detail_level = "summary"
    elif profile.total_interactions < 20:
        profile.preferred_detail_level = "detailed"
    else:
        profile.preferred_detail_level = "technical"
```

**Agreement tracking**:
```python
if feedback.final_decision == ai_prediction:
    profile.agreements += 1
else:
    profile.disagreements += 1
```

#### Design rationale

**Tại sao dùng simple heuristic (not ML)?**
1. **Auditability**: IF/ELSE rules dễ giải thích cho compliance officer
2. **No cold-start problem**: ML meta-model cần nhiều data per user
3. **Transparent**: User hiểu được "sau 20 lần, hệ thống cho tôi xem chi tiết kỹ thuật"
4. **Philosophy**: "An HCXAI platform whose own adaptation logic cannot itself be explained would undermine its purpose" (tự trích design doc)

---

### 3.3 Trust Calibrator

**Code**: `backend/app/hcxai.py` → `TrustCalibrator` class

#### Problem

Con người có 2 bias phổ biến khi tương tác với AI:
1. **Over-trust** (automation bias): Đồng ý cả khi AI không chắc
2. **Under-trust** (algorithm aversion): Ghi đè cả khi AI rất chắc

→ Cần detect và correct

#### Trust states

```python
@dataclass
class TrustState:
    state: Literal["well_calibrated", "over_trust", "under_trust", "insufficient_data"]
    agreement_rate: float
    avg_ai_confidence_on_agreements: float
    avg_ai_confidence_on_disagreements: float
    trend: Literal["increasing", "decreasing", "stable"]
    override_direction: float  # -1 (reject→approve) to +1 (approve→reject)
```

#### Detection logic

```python
def compute_trust_state(user_id):
    events = db.get_trust_events(user_id, limit=30)
    
    if len(events) < 3:
        return TrustState(state="insufficient_data")
    
    agreement_rate = sum(e.agreement for e in events) / len(events)
    
    agreements = [e for e in events if e.agreement]
    disagreements = [e for e in events if not e.agreement]
    
    avg_conf_agree = mean([e.ai_confidence for e in agreements]) if agreements else 0
    avg_conf_disagree = mean([e.ai_confidence for e in disagreements]) if disagreements else 0
    
    # Over-trust: đồng ý nhiều (>90%) NHƯNG AI không chắc (<70%)
    if agreement_rate > 0.90 and avg_conf_agree < 0.70:
        state = "over_trust"
    
    # Under-trust: ghi đè nhiều (agreement <50%) NHƯNG AI rất chắc (>85%)
    elif agreement_rate < 0.50 and avg_conf_disagree > 0.85:
        state = "under_trust"
    
    else:
        state = "well_calibrated"
    
    return TrustState(state=state, ...)
```

#### Trend analysis

```python
def compute_trend(events):
    """Compare recent 10 vs prior 10"""
    if len(events) < 20:
        return "stable"
    
    recent = events[:10]
    prior = events[10:20]
    
    recent_rate = sum(e.agreement for e in recent) / 10
    prior_rate = sum(e.agreement for e in prior) / 10
    
    delta = recent_rate - prior_rate
    if delta > 0.1:
        return "increasing"  # Trust AI hơn
    elif delta < -0.1:
        return "decreasing"  # Trust AI ít hơn
    else:
        return "stable"
```

#### Override direction

```python
def compute_override_direction(events):
    """
    Phân tích: User có xu hướng ghi đè theo hướng nào?
    -1: reject → approve (risk-taker)
    +1: approve → reject (risk-averse)
    """
    overrides = [e for e in events if not e.agreement]
    
    score = 0.0
    for e in overrides:
        if e.ai_prediction == "Rejected" and e.human_decision == "Approved":
            score -= 1  # Reject → Approve
        elif e.ai_prediction == "Approved" and e.human_decision == "Rejected":
            score += 1  # Approve → Reject
    
    return score / len(overrides) if overrides else 0.0
```

---

### 3.4 Explanation Recommendation Engine

**Code**: `backend/app/hcxai.py` → `ExplanationRecommendationEngine` class

#### Inputs

```python
def recommend_strategy(
    user_profile: UserProfile,
    trust_state: TrustState,
    prediction: dict,
    shap_result: dict
):
```

#### Output

```python
@dataclass
class ExplanationStrategy:
    detail_level: str  # summary/detailed/technical
    suggest_counterfactual: bool
    suggest_similar_cases: bool
    trust_intervention: Optional[str]  # highlight_uncertainty / highlight_evidence
    rationale: List[str]  # Human-readable reasons
```

#### Core logic (Simplified)

```python
def recommend_strategy(user_profile, trust_state, prediction, shap_result):
    rationale = []
    
    # 1. Base detail level from learned preference
    detail_level = user_profile.preferred_detail_level
    rationale.append(f"Using learned preference: {detail_level}")
    
    # 2. Cognitive Load Adaptation
    cognitive_load = estimate_cognitive_load(shap_result, user_profile.expertise_level)
    if cognitive_load.perceived_load > 0.7 and detail_level == "technical":
        detail_level = "detailed"  # Downgrade
        rationale.append(f"Downgraded from technical to detailed due to high cognitive load")
    
    # 3. Confidence-based suggestions
    if prediction["confidence"] < 0.75:
        suggest_similar_cases = True
        rationale.append("Confidence below 75%: recommending Similar Case Explorer")
    else:
        suggest_similar_cases = False
    
    if prediction["prediction"] == "Rejected":
        suggest_counterfactual = True
        rationale.append("Rejected decision: suggesting Counterfactual")
    else:
        suggest_counterfactual = False
    
    # 4. Trust Intervention (KEY NOVELTY)
    trust_intervention = None
    if trust_state.state == "over_trust":
        trust_intervention = "highlight_uncertainty"
        rationale.append("User shows over-trust pattern: will surface model uncertainty/limitations")
    
    elif trust_state.state == "under_trust":
        trust_intervention = "highlight_evidence"
        rationale.append("User shows under-trust pattern: will emphasize supporting evidence")
    
    return ExplanationStrategy(
        detail_level=detail_level,
        suggest_counterfactual=suggest_counterfactual,
        suggest_similar_cases=suggest_similar_cases,
        trust_intervention=trust_intervention,
        rationale=rationale
    )
```

#### Cognitive Load Estimation

**Paper**: Miller (1956) — The Magical Number Seven, Plus or Minus Two

```python
def estimate_cognitive_load(shap_result, expertise_level):
    """
    Cognitive load = f(n_significant_factors, conflict_score)
    """
    contributions = shap_result["contributions"]
    max_abs = max(abs(c["shap_contribution"]) for c in contributions)
    
    # Significant factors: |SHAP| > 10% of max
    significant = [c for c in contributions if abs(c["shap_contribution"]) > 0.1 * max_abs]
    n_factors = len(significant)
    
    # Conflict: positive vs negative contributions
    pos = sum(1 for c in significant if c["shap_contribution"] > 0)
    neg = len(significant) - pos
    conflict_score = min(pos, neg) / len(significant) if significant else 0
    
    # Raw load
    raw_load = (n_factors / 8) * 0.6 + conflict_score * 0.4
    
    # Expertise multiplier
    expertise_multiplier = 1.5 - expertise_level  # novice: 1.5x, expert: 0.5x
    perceived_load = raw_load * expertise_multiplier
    
    return CognitiveLoad(
        n_significant_factors=n_factors,
        conflict_score=conflict_score,
        raw_load=raw_load,
        perceived_load=perceived_load,
        interpretation="high" if perceived_load > 0.7 else "moderate" if perceived_load > 0.4 else "low"
    )
```

---

### 3.5 Trust Intervention → Narrative (Closed Loop)

**Code**: `backend/app/deepseek_client.py` → `generate_explanation_narrative()`

#### Key insight

Trust intervention không chỉ thay đổi **UI layout** (ví dụ: highlight warning box) mà thay đổi **NỘI DUNG** của narrative text.

#### DeepSeek prompt construction

```python
def generate_explanation_narrative(
    application,
    prediction,
    shap_result,
    strategy: ExplanationStrategy  # ← Contains trust_intervention
):
    # Base prompt
    prompt = f"""Bạn là chuyên gia tín dụng ngân hàng. Giải thích quyết định cho khách hàng.

Quyết định: {prediction['prediction']}
Xác suất duyệt: {prediction['approval_probability']:.0%}
Mức tin cậy: {prediction['confidence']:.0%}

Yếu tố quan trọng:
{format_shap_contributions(shap_result)}

Yêu cầu: Viết giải thích TIẾNG VIỆT, {strategy.detail_level} level.
"""
    
    # Trust Intervention modification
    if strategy.trust_intervention == "highlight_uncertainty":
        prompt += """
QUAN TRỌNG: 
- NHẤN MẠNH các giới hạn của mô hình AI (chỉ dựa trên dữ liệu lịch sử)
- Cảnh báo rằng tình huống này GẦN RANH GIỚI quyết định
- Khuyến nghị xem xét thêm yếu tố định tính (không có trong model)
"""
    
    elif strategy.trust_intervention == "highlight_evidence":
        prompt += """
QUAN TRỌNG:
- BỔ SUNG minh chứng hỗ trợ cho quyết định (ví dụ thống kê từ dữ liệu lịch sử)
- Nhấn mạnh các yếu tố MÔ HÌNH ĐÁNH GIÁ CAO (SHAP values lớn)
- Giải thích TẠI SAO mô hình tin tưởng vào kết quả này
"""
    
    response = openai.chat.completions.create(
        model="deepseek-chat",
        messages=[{"role": "user", "content": prompt}]
    )
    
    return response.choices[0].message.content
```

#### Example outputs

**Case 1: Well-calibrated (no intervention)**
```
Hồ sơ này được đánh giá BỊ TỪ CHỐI với xác suất duyệt 12%.

Yếu tố chính:
• Điểm tín dụng CIBIL 417 thấp hơn nhiều so với ngưỡng an toàn 650
• Số tiền vay đề nghị 12.2 triệu cao so với thu nhập hàng năm 3.5 triệu
• Tài sản thế chấp chưa đủ bù đắp rủi ro

Khuyến nghị: Cải thiện điểm CIBIL trước khi nộp lại.
```

**Case 2: Over-trust → highlight_uncertainty**
```
Hồ sơ này được đánh giá BỊ TỪ CHỐI với xác suất duyệt 12%.

Yếu tố chính: [same as above]

⚠️ LƯU Ý: Hồ sơ này NẰM GẦN RANH GIỚI quyết định. Mô hình chỉ dựa trên dữ liệu 
số, KHÔNG XEM XÉT các yếu tố định tính như: lịch sử quan hệ khách hàng, kế hoạch 
kinh doanh chi tiết, hoặc các yếu tố giảm nhẹ đặc biệt. Khuyến nghị loan officer 
xem xét thêm các yếu tố này trước khi quyết định cuối cùng.
```

**Case 3: Under-trust → highlight_evidence**
```
Hồ sơ này được đánh giá BỊ TỪ CHỐI với xác suất duyệt 12%.

Yếu tố chính: [same as above]

📊 MINH CHỨNG HỖ TRỢ: Trong 4,269 hồ sơ lịch sử, các trường hợp có CIBIL <450 
VÀ loan_amount/income >3 có tỷ lệ vỡ nợ 87%. Điểm CIBIL 417 của hồ sơ này thuộc 
nhóm rủi ro cao nhất (bottom 5%). Mô hình đánh giá dựa trên pattern rõ ràng từ 
dữ liệu thực tế, KHÔNG PHẢI dự đoán ngẫu nhiên.
```

#### Verification

Frontend hiển thị `strategy.rationale` trong Collapsible "Xem chi tiết kỹ thuật":

```
Explanation Recommendation Engine rationale:
✓ Using learned preference for user 'admin@hcxai.local': detailed
✓ Confidence below 75%: recommending Similar Case Explorer
✓ Rejected decision: suggesting Counterfactual
✓ User shows over-trust pattern: will surface model uncertainty/limitations
```

→ User (hoặc auditor) có thể xác minh: trust_intervention = "highlight_uncertainty" → narrative có cảnh báo giới hạn mô hình.

---

### 3.6 Closed-loop Summary

```
Time t=0: User chấm 8 hồ sơ
       │
       ▼
  Feedback → Trust Calibrator → detect "over_trust"
       │
       ▼
Time t=1: User chấm hồ sơ thứ 9
       │
       ▼
  Explanation Recommendation Engine:
    trust_state = "over_trust"
    → trust_intervention = "highlight_uncertainty"
       │
       ▼
  DeepSeek prompt includes intervention instructions
       │
       ▼
  Generated narrative THAY ĐỔI NỘI DUNG (có cảnh báo giới hạn)
       │
       ▼
  Frontend hiển thị narrative ĐÃ ĐƯỢC CÁ NHÂN HÓA
       │
       ▼
  User đọc → điều chỉnh hành vi → feedback mới → loop tiếp
```

**Đây là closed-loop THẬT**:
- Không phải chỉ log feedback (open-loop)
- Không phải chỉ thay đổi UI (superficial)
- **Thay đổi NỘI DUNG giải thích** dựa trên xu hướng tin tưởng của user

---

## 4. So sánh với State-of-the-Art

### 4.1 XAI Systems

| Hệ thống | SHAP | LIME | Counterfactual | Explanation Quality | Interactive |
|----------|------|------|----------------|---------------------|-------------|
| **OURS** | ✅ Exact (TreeExplainer) | ✅ Self-impl | ✅ Self-impl (DiCE-inspired) | ✅ 3 metrics | ✅ What-If + Similar Cases |
| IBM AI Explainability 360 | ✅ | ✅ | ✅ (ProtoDash) | ❌ | ⚠️ Limited |
| Google What-If Tool | ⚠️ Approx | ❌ | ✅ | ❌ | ✅ Strong |
| Microsoft InterpretML | ✅ | ✅ | ❌ | ❌ | ⚠️ Limited |
| LIME package (original) | ❌ | ✅ | ❌ | ❌ | ❌ |
| SHAP package (original) | ✅ | ❌ | ❌ | ❌ | ❌ |

**Điểm mạnh của hệ thống này**:
- **7 XAI methods trong 1 platform** (không phải chỉ 1-2 methods riêng lẻ)
- **Self-implementation** LIME + Counterfactual (documented, auditable)
- **Explanation Quality metrics** (Stability/Completeness/Sparsity) — ít hệ thống có

---

### 4.2 HCXAI / Adaptive XAI Systems

| System | User Modeling | Trust Calibration | Adaptive Strategy | Closed-loop Feedback | Production-ready |
|--------|---------------|-------------------|-------------------|----------------------|------------------|
| **OURS** | ✅ Expertise + preference | ✅ Over/under-trust detection | ✅ Detail level + trust intervention | ✅ Narrative content changes | ✅ FastAPI + Next.js |
| Chromik et al. (2021) "Adaptive Explanations" | ✅ Expertise | ❌ | ✅ Detail level | ❌ Open-loop | ❌ Research prototype |
| Kocielnik et al. (2019) "Trust Calibration" | ⚠️ Implicit | ✅ Detect over-trust | ⚠️ Static intervention | ⚠️ Weak loop | ❌ Lab study |
| Tsai & Brusilovsky (2021) "Explanation Personalization" | ✅ Cognitive style | ❌ | ✅ Feature selection | ❌ Open-loop | ❌ Research prototype |
| Google People + AI Guidebook | ⚠️ Guidelines only | ⚠️ Suggested | ⚠️ Suggested | ❌ | ❌ Not a system |

**Papers reference**:
- Chromik et al. (2021): "I think I get your point, AI! The illusion of explanatory depth in explainable AI"
- Kocielnik et al. (2019): "Will You Accept an Imperfect AI? Exploring Designs for Adjusting End-user Expectations of AI Systems"
- Tsai & Brusilovsky (2021): "Enhancing Explainability and Scrutability of Recommender Systems"

**Điểm mạnh của hệ thống này**:
1. **Trust Calibration + Trust Intervention**: Papers trước chỉ detect, không intervene hoặc intervene yếu
2. **Closed-loop thật**: Narrative content thay đổi (không phải chỉ UI layout)
3. **Production-ready code**: FastAPI + Next.js + SQLite, không phải lab prototype
4. **Auditable rules**: IF/ELSE logic, không phải black-box meta-model

---

### 4.3 Explainable Loan Approval Systems

| System | Domain | XAI | HCXAI | Deployment |
|--------|--------|-----|-------|------------|
| **OURS** | Loan approval | ✅ 7 methods | ✅ Full closed-loop | ✅ FastAPI + Next.js |
| Bussmann et al. (2020) "Explainable AI in Credit Scoring" | Credit scoring | ✅ SHAP only | ❌ | ❌ Paper only |
| Kozodoi et al. (2022) "Fairness in Credit Scoring" | Credit scoring | ⚠️ Basic | ❌ | ⚠️ R notebooks |
| Lohmann et al. (2021) "Explaining Loan Decisions" | Loan approval | ✅ LIME + rules | ❌ | ❌ Research prototype |

**Papers reference**:
- Bussmann et al. (2020): "Explainable AI in Credit Scoring: A Survey"
- Kozodoi et al. (2022): "Fairness in Credit Scoring: Assessment, Implementation and Profit Implications"
- Lohmann et al. (2021): "Explaining Loan Decisions to Improve Transparency"

**Điểm mạnh của hệ thống này**:
- **Duy nhất có full HCXAI stack** trong domain loan approval
- **7 XAI methods** (papers khác chỉ 1-2)
- **Deployment-ready** (không phải chỉ paper + notebook)

---
