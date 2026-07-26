# Đa dạng hóa Model + Human-Centric XAI mở rộng — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cho phép train model bằng nhiều thuật toán dạng cây (không chỉ XGBoost), và mở rộng lớp "dịch sang ngôn ngữ tự nhiên" (LLM) sang mọi output kỹ thuật của XAI (LIME, Counterfactual, Explanation Quality, Fairness, Monitoring, Trust Dashboard), cộng thêm cơ chế Human-in-the-loop bắt buộc cho hồ sơ rủi ro cao.

**Architecture:** Model factory pattern trong `model_registry.py` (không đổi XAI/HCXAI vì SHAP TreeExplainer đã tổng quát). Một hàm dịch-LLM dùng chung (`interpret_technical_output`) tái sử dụng cho 6+ endpoint "diễn giải" mới, mỗi endpoint chỉ khác nhau ở dữ liệu đầu vào/instruction. Human-in-the-loop dùng cột mới trên bảng `predictions` + endpoint hàng chờ duyệt riêng.

**Tech Stack:** FastAPI, Pydantic, SQLite (sqlite3 stdlib), scikit-learn, XGBoost, (optional) LightGBM/CatBoost, OpenAI SDK (DeepSeek), Next.js 15 + React 19 + TypeScript, TanStack Query, shadcn/ui.

## Global Constraints

- LLM không bao giờ đóng vai trò ra quyết định độc lập — chỉ dịch dữ liệu đã tính sẵn sang văn xuôi tiếng Việt. Không thiết kế bất kỳ endpoint nào để LLM "tự quyết" hay "đồng ý/không đồng ý" với model.
- Mọi lời gọi LLM mới là on-demand (người dùng bấm nút), không tự động chạy nền.
- Mọi lời gọi LLM mới tái sử dụng đúng pattern resilient đã có trong `deepseek_client.py`: `max_retries=0`, timeout ngắn từ `settings.DEEPSEEK_TIMEOUT_SECONDS`, fallback về câu template tiếng Việt cố định nếu lỗi/timeout — không bao giờ để lỗi 500 lên người dùng.
- Prompt tiếng Việt theo đúng quy ước đã có: văn xuôi tiếng Việt, thuật ngữ chuyên ngành (SHAP, LIME, Counterfactual...) giữ nguyên tiếng Anh.
- Ngưỡng nghiệp vụ Human-in-the-loop (`REVIEW_CONFIDENCE_THRESHOLD`, `REVIEW_LOAN_AMOUNT_THRESHOLD`) đọc từ biến môi trường qua `config.py`, không hardcode trong logic.
- LightGBM/CatBoost đăng ký kiểu try/except — import lỗi (bị Smart App Control chặn hoặc chưa cài) thì tự động ẩn khỏi danh sách thuật toán khả dụng, không crash backend.
- DB thay đổi schema chỉ qua `_run_lightweight_migrations` (additive `ALTER TABLE`, không xóa cột, không Alembic) — đúng pattern đã có trong `db.py`.
- Không thêm hyperparameter tuỳ chỉnh qua UI — chỉ chọn thuật toán, dùng bộ mặc định mỗi loại.
- Mọi field/endpoint mới phải có test; chạy `pytest -q` toàn bộ (không chỉ file mới) trước mỗi commit lớn.

---

## Phần A — Đa dạng hóa Model

### Task 1: Model factory cho scikit-learn tree ensembles

**Files:**
- Modify: `backend/app/model_registry.py`
- Test: `backend/tests/test_model_registry.py`

**Interfaces:**
- Produces: `MODEL_FACTORIES: dict[str, tuple[type, dict]]`, `list_available_algorithms() -> list[str]`, `train_new_version(hyperparameters=None, trained_by="system", notes=None, activate=True, algorithm="xgboost")`

- [ ] **Step 1: Viết test thất bại cho `list_available_algorithms`**

Thêm vào cuối `backend/tests/test_model_registry.py`:

```python
def test_list_available_algorithms_includes_sklearn_and_xgboost(registry_env):
    registry_module, _ = registry_env
    algos = registry_module.list_available_algorithms()
    assert "xgboost" in algos
    assert "random_forest" in algos
    assert "gradient_boosting" in algos
    assert "extra_trees" in algos


def test_train_new_version_with_random_forest(registry_env):
    registry_module, db_module = registry_env
    record = registry_module.train_new_version(
        trained_by="test", algorithm="random_forest", activate=False
    )
    assert record["algorithm"] == "random_forest"
    assert 0.0 <= record["metrics"]["accuracy"] <= 1.0
```

- [ ] **Step 2: Chạy test, xác nhận fail**

Run: `cd backend && pytest tests/test_model_registry.py -v -k "algorithm"`
Expected: FAIL — `AttributeError: module 'app.model_registry' has no attribute 'list_available_algorithms'`

- [ ] **Step 3: Cài đặt model factory**

Trong `backend/app/model_registry.py`, thêm import và factory ngay sau `DEFAULT_HYPERPARAMETERS` hiện có (dòng ~47-55):

```python
from sklearn.ensemble import (
    ExtraTreesClassifier,
    GradientBoostingClassifier,
    RandomForestClassifier,
)

DEFAULT_RF_HYPERPARAMETERS = {
    "n_estimators": 300,
    "max_depth": 8,
    "min_samples_leaf": 3,
    "random_state": 42,
    "n_jobs": -1,
}
DEFAULT_GB_HYPERPARAMETERS = {
    "n_estimators": 150,
    "max_depth": 3,
    "learning_rate": 0.1,
    "random_state": 42,
}
DEFAULT_ET_HYPERPARAMETERS = {
    "n_estimators": 300,
    "max_depth": 10,
    "min_samples_leaf": 3,
    "random_state": 42,
    "n_jobs": -1,
}

MODEL_FACTORIES: dict[str, tuple[type, dict]] = {
    "xgboost": (XGBClassifier, DEFAULT_HYPERPARAMETERS),
    "random_forest": (RandomForestClassifier, DEFAULT_RF_HYPERPARAMETERS),
    "gradient_boosting": (GradientBoostingClassifier, DEFAULT_GB_HYPERPARAMETERS),
    "extra_trees": (ExtraTreesClassifier, DEFAULT_ET_HYPERPARAMETERS),
}

# LightGBM / CatBoost: best-effort registration. On a machine where Windows
# Smart App Control (or an equivalent policy) blocks their compiled native
# library, import raises OSError/ImportError -- catch broadly and simply
# don't register the algorithm, rather than crashing the whole backend.
try:
    from lightgbm import LGBMClassifier

    MODEL_FACTORIES["lightgbm"] = (
        LGBMClassifier,
        {"n_estimators": 200, "max_depth": 6, "learning_rate": 0.1, "random_state": 42, "verbosity": -1},
    )
except Exception:
    logger.warning("LightGBM unavailable (import failed) -- omitted from available algorithms.")

try:
    from catboost import CatBoostClassifier

    MODEL_FACTORIES["catboost"] = (
        CatBoostClassifier,
        {"iterations": 200, "depth": 6, "learning_rate": 0.1, "random_state": 42, "verbose": False},
    )
except Exception:
    logger.warning("CatBoost unavailable (import failed) -- omitted from available algorithms.")


def list_available_algorithms() -> list[str]:
    return sorted(MODEL_FACTORIES.keys())
```

Sửa signature `train_new_version` (giữ tương thích ngược, `algorithm` mặc định `"xgboost"`):

```python
def train_new_version(
    hyperparameters: dict[str, Any] | None = None,
    trained_by: str = "system",
    notes: str | None = None,
    activate: bool = True,
    algorithm: str = "xgboost",
) -> dict[str, Any]:
    if algorithm not in MODEL_FACTORIES:
        raise ValueError(
            f"Unknown or unavailable algorithm '{algorithm}'. "
            f"Available: {list_available_algorithms()}"
        )
    model_class, default_hyperparameters = MODEL_FACTORIES[algorithm]
    hyperparameters = hyperparameters or default_hyperparameters
    dataset = prepare_dataset()

    model = model_class(**hyperparameters)
    logger.info(
        "Training %s classifier (version=%s) on %d samples",
        algorithm, _next_version_label(), len(dataset.X_train),
    )
    model.fit(dataset.X_train, dataset.y_train)

    metrics = _compute_rich_metrics(model, dataset.X_test, dataset.y_test)
    metrics["n_train"] = int(len(dataset.X_train))

    version_label = _next_version_label()
    version_dir = settings.VERSIONS_DIR / version_label
    version_dir.mkdir(parents=True, exist_ok=True)

    joblib.dump(model, version_dir / "model.joblib")
    joblib.dump(dataset.encoders, version_dir / "encoders.joblib")
    (version_dir / "metadata.json").write_text(
        json.dumps(
            {"feature_columns": FEATURE_COLUMNS, "model_type": algorithm, "metrics": metrics},
            indent=2,
        )
    )

    record = db.create_model_version(
        version_label=version_label,
        algorithm=algorithm,
        hyperparameters=hyperparameters,
        metrics=metrics,
        artifact_dir=str(version_dir.relative_to(settings.MODEL_DIR)),
        trained_by=trained_by,
        notes=notes,
    )

    if activate:
        db.activate_model_version(version_label)
        record = db.get_model_version_by_label(version_label)  # type: ignore[assignment]

    db.log_audit_event(
        user_id=trained_by,
        action="model.train",
        resource_type="model_version",
        resource_id=version_label,
        details={"algorithm": algorithm, "metrics": {k: v for k, v in metrics.items() if k in ("accuracy", "f1_score", "auc")}},
    )

    logger.info("Registered model version %s (algorithm=%s, active=%s)", version_label, algorithm, activate)
    return record
```

(Chỉ thay `model = XGBClassifier(**hyperparameters)` → dùng `model_class`/`algorithm` như trên; phần còn lại của hàm giữ nguyên logic cũ.)

- [ ] **Step 4: Chạy test, xác nhận pass**

Run: `cd backend && pytest tests/test_model_registry.py -v`
Expected: PASS toàn bộ (cả test cũ lẫn mới)

- [ ] **Step 5: Chạy toàn bộ test suite backend để chắc không phá vỡ gì**

Run: `cd backend && pytest -q`
Expected: tất cả PASS

- [ ] **Step 6: Commit**

```bash
git add backend/app/model_registry.py backend/tests/test_model_registry.py
git commit -m "feat: support random_forest/gradient_boosting/extra_trees (+ best-effort lightgbm/catboost) via model factory"
```

---

### Task 2: API — chọn thuật toán khi train model mới

**Files:**
- Modify: `backend/app/schemas.py`
- Modify: `backend/app/main.py`
- Test: `backend/tests/test_auth.py` (dùng làm nơi đặt test API nhanh, xem ghi chú Step 1) hoặc file mới `backend/tests/test_model_endpoints.py`

**Interfaces:**
- Consumes: `model_registry.list_available_algorithms()`, `model_registry.train_new_version(..., algorithm=...)` (Task 1)
- Produces: `GET /model/train/algorithms` → `{"algorithms": list[str]}`; `TrainModelRequest.algorithm: str = "xgboost"`

- [ ] **Step 1: Viết test thất bại**

Tạo file mới `backend/tests/test_model_endpoints.py`:

```python
"""Tests for the /model/train/algorithms and algorithm-aware /model/train endpoints."""
from fastapi.testclient import TestClient


def test_list_algorithms_requires_admin_or_risk_manager(client_as_loan_officer: TestClient):
    resp = client_as_loan_officer.get("/model/train/algorithms")
    assert resp.status_code == 403


def test_list_algorithms_returns_at_least_xgboost(client_as_admin: TestClient):
    resp = client_as_admin.get("/model/train/algorithms")
    assert resp.status_code == 200
    assert "xgboost" in resp.json()["algorithms"]


def test_train_rejects_unknown_algorithm(client_as_admin: TestClient):
    resp = client_as_admin.post("/model/train", json={"algorithm": "not_a_real_algorithm"})
    assert resp.status_code == 400
```

Kiểm tra `backend/tests/conftest.py` xem đã có fixture `client_as_admin` / `client_as_loan_officer` chưa:

Run: `grep -n "client_as_admin\|client_as_loan_officer" backend/tests/conftest.py`

Nếu CHƯA có, thêm vào `backend/tests/conftest.py` (theo đúng pattern fixture hiện có trong file đó — copy cách fixture `client` hiện tại tạo `TestClient` + đăng nhập, chỉ đổi role):

```python
@pytest.fixture
def client_as_admin(client, admin_token):
    client.headers.update({"Authorization": f"Bearer {admin_token}"})
    return client


@pytest.fixture
def client_as_loan_officer(client, loan_officer_token):
    client.headers.update({"Authorization": f"Bearer {loan_officer_token}"})
    return client
```

(Nếu file đã có `admin_token`/`loan_officer_token` fixture tương tự thì tái dùng; nếu tên khác, đổi test trên cho khớp tên fixture thật của repo thay vì tạo trùng.)

- [ ] **Step 2: Chạy test, xác nhận fail**

Run: `cd backend && pytest tests/test_model_endpoints.py -v`
Expected: FAIL — 404 (endpoint chưa tồn tại)

- [ ] **Step 3: Thêm field `algorithm` vào `TrainModelRequest`**

Trong `backend/app/schemas.py`, tìm `class TrainModelRequest(BaseModel):` (khoảng dòng 228) và sửa:

```python
class TrainModelRequest(BaseModel):
    notes: str | None = None
    activate: bool = True
    algorithm: str = "xgboost"
```

- [ ] **Step 4: Thêm endpoint `GET /model/train/algorithms` + sửa `/model/train`**

Trong `backend/app/main.py`, sửa dòng import hiện có (khoảng dòng 89) để thêm `list_available_algorithms`, khớp phong cách import trực tiếp đã dùng trong file (không dùng `from . import model_registry` cục bộ trong hàm):

```python
from .model_registry import compare_versions, list_available_algorithms, train_new_version
```

Tìm route `@app.post("/model/train")` và sửa lại + thêm route mới ngay trước nó:

```python
@app.get("/model/train/algorithms")
def list_training_algorithms(
    current_user: dict = Depends(auth.require_roles("admin", "risk_manager")),
):
    """Danh sách thuật toán khả dụng để train (loại trừ những thuật toán bị chặn import, vd LightGBM/CatBoost trên máy có Smart App Control)."""
    return {"algorithms": list_available_algorithms()}


@app.post("/model/train")
def train_model(
    request: TrainModelRequest,
    current_user: dict = Depends(auth.require_roles("admin")),
):
    if request.algorithm not in list_available_algorithms():
        raise HTTPException(
            status_code=400,
            detail=f"Thuật toán '{request.algorithm}' không khả dụng. "
            f"Danh sách hợp lệ: {list_available_algorithms()}",
        )
    result = train_new_version(
        trained_by=current_user["email"],
        notes=request.notes,
        activate=request.activate,
        algorithm=request.algorithm,
    )
    return result
```

(Nếu route `/model/train` hiện tại đã có thân hàm khác — giữ nguyên phần logging/audit đã có bên trong `train_new_version`, chỉ đảm bảo `algorithm=request.algorithm` được truyền xuống và thêm check 400 ở trên.)

- [ ] **Step 5: Chạy test, xác nhận pass**

Run: `cd backend && pytest tests/test_model_endpoints.py -v`
Expected: PASS

- [ ] **Step 6: Chạy toàn bộ test suite**

Run: `cd backend && pytest -q`
Expected: tất cả PASS

- [ ] **Step 7: Commit**

```bash
git add backend/app/schemas.py backend/app/main.py backend/tests/test_model_endpoints.py backend/tests/conftest.py
git commit -m "feat: expose algorithm selection on /model/train + GET /model/train/algorithms"
```

---

### Task 3: Frontend — dropdown chọn thuật toán ở AI Model Center

**Files:**
- Modify: `frontend/src/lib/types.ts`
- Modify: `frontend/src/lib/endpoints.ts`
- Modify: `frontend/src/app/(app)/model-center/page.tsx`

**Interfaces:**
- Consumes: `GET /model/train/algorithms` (Task 2)
- Produces: `listTrainingAlgorithms(): Promise<string[]>`, `trainModelVersion({notes?, activate?, algorithm}): Promise<ModelVersion>` (đổi signature)

- [ ] **Step 1: Thêm hàm gọi API mới**

Trong `frontend/src/lib/endpoints.ts`, sửa `trainModelVersion` và thêm hàm mới ngay phía trên nó:

```typescript
export async function listTrainingAlgorithms(): Promise<string[]> {
  const { data } = await apiClient.get<{ algorithms: string[] }>("/model/train/algorithms");
  return data.algorithms;
}

export async function trainModelVersion(payload: {
  notes?: string;
  activate?: boolean;
  algorithm?: string;
}): Promise<ModelVersion> {
  const { data } = await apiClient.post<ModelVersion>("/model/train", payload);
  return data;
}
```

- [ ] **Step 2: Thêm state + dropdown trong `model-center/page.tsx`**

Thêm import `Select`/`SelectItem`/... (đã có sẵn import ở đầu file), thêm state và query ngay sau `const { data: versions, isLoading } = useQuery(...)`:

```typescript
const [selectedAlgorithm, setSelectedAlgorithm] = useState<string>("xgboost");

const { data: algorithms } = useQuery({
  queryKey: ["training-algorithms"],
  queryFn: listTrainingAlgorithms,
});
```

Sửa `trainMutation` để truyền `algorithm`:

```typescript
const trainMutation = useMutation({
  mutationFn: () =>
    trainModelVersion({
      notes: "Huấn luyện lại thủ công từ Trung tâm Mô hình",
      activate: true,
      algorithm: selectedAlgorithm,
    }),
  onSuccess: (result) => {
    toast.success(`Đã huấn luyện và kích hoạt ${result.version_label} (${result.algorithm})`);
    queryClient.invalidateQueries({ queryKey: ["model-versions"] });
  },
  onError: (error) => toast.error(getApiErrorMessage(error, "Huấn luyện thất bại")),
});
```

Thay `actions={isAdmin ? (<Button onClick={...}>...) : undefined}` trong `<PageHeader>` bằng khối có thêm dropdown:

```tsx
actions={
  isAdmin ? (
    <div className="flex items-center gap-2">
      <Select value={selectedAlgorithm} onValueChange={(v) => v && setSelectedAlgorithm(v)}>
        <SelectTrigger className="w-44">
          <SelectValue placeholder="Thuật toán" />
        </SelectTrigger>
        <SelectContent>
          {(algorithms ?? ["xgboost"]).map((algo) => (
            <SelectItem key={algo} value={algo}>
              {algo}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button onClick={() => trainMutation.mutate()} disabled={trainMutation.isPending}>
        <PlayCircle className="size-4" />
        {trainMutation.isPending ? "Đang huấn luyện..." : "Huấn luyện phiên bản mới"}
      </Button>
    </div>
  ) : undefined
}
```

- [ ] **Step 3: Type-check frontend**

Run: `cd frontend && npx tsc --noEmit`
Expected: không có lỗi mới liên quan đến `model-center/page.tsx`, `endpoints.ts`, `types.ts`

- [ ] **Step 4: Kiểm tra thủ công qua trình duyệt**

Khởi động backend + frontend, đăng nhập admin, vào `/model-center`, xác nhận dropdown hiện đủ thuật toán (`xgboost`, `random_forest`, `gradient_boosting`, `extra_trees`, và `lightgbm`/`catboost` nếu import thành công), chọn `random_forest`, bấm "Huấn luyện phiên bản mới", xác nhận version mới xuất hiện trong bảng với cột Thuật toán = `random_forest`.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/endpoints.ts frontend/src/app/\(app\)/model-center/page.tsx
git commit -m "feat: add algorithm dropdown to AI Model Center training flow"
```

---

## Phần B — Human-Centric XAI mở rộng (trọng tâm)

### Task 4: Hàm dịch-LLM dùng chung (`interpret_technical_output`)

**Files:**
- Modify: `backend/app/deepseek_client.py`
- Test: `backend/tests/test_deepseek_client.py`

**Interfaces:**
- Produces: `interpret_technical_output(instruction: str, data_summary: str, max_tokens: int = 200) -> dict` → `{"narrative": str, "model": str}`

- [ ] **Step 1: Viết test thất bại**

Thêm vào `backend/tests/test_deepseek_client.py`:

```python
from app.deepseek_client import interpret_technical_output


def test_interpret_technical_output_falls_back_without_api_key(monkeypatch):
    monkeypatch.setattr("app.deepseek_client.settings.DEEPSEEK_API_KEY", None)
    result = interpret_technical_output(
        instruction="Diễn giải chỉ số Fidelity R2 của LIME.",
        data_summary="fidelity_r2=-0.141",
    )
    assert result["model"] == "template-fallback"
    assert "chưa thể tạo diễn giải" in result["narrative"].lower()
```

- [ ] **Step 2: Chạy test, xác nhận fail**

Run: `cd backend && pytest tests/test_deepseek_client.py -v -k interpret`
Expected: FAIL — `ImportError: cannot import name 'interpret_technical_output'`

- [ ] **Step 3: Cài đặt hàm dùng chung**

Thêm vào cuối `backend/app/deepseek_client.py`:

```python
_INTERPRET_FALLBACK_NARRATIVE = (
    "Chưa thể tạo diễn giải bằng AI cho phần này lúc này (dịch vụ LLM không khả dụng). "
    "Vui lòng xem trực tiếp các số liệu kỹ thuật ở trên; các badge/chú thích (hình dấu hỏi) "
    "vẫn giải nghĩa từng thuật ngữ."
)


def interpret_technical_output(
    instruction: str,
    data_summary: str,
    max_tokens: int = 200,
) -> dict:
    """
    LLM như lớp dịch (KHÔNG phải tác nhân ra quyết định): nhận một `instruction`
    mô tả cần diễn giải gì, và `data_summary` là số liệu/kết quả kỹ thuật ĐÃ
    tính toán sẵn (không để LLM tự tính lại hay suy đoán ngoài phạm vi này).
    Dùng chung cho mọi endpoint "Diễn giải bằng AI" (LIME, Explanation Quality,
    Counterfactual, Fairness, Monitoring, Trust Dashboard, Override Analysis).

    Trả về cùng khuôn dạng với generate_narrative_explanation: {"narrative", "model"},
    fallback về một câu template tiếng Việt cố định nếu DeepSeek không khả dụng/lỗi.
    """
    client = _get_client()
    if client is None:
        return {"narrative": _INTERPRET_FALLBACK_NARRATIVE, "model": "template-fallback"}

    system_prompt = (
        "Bạn là trợ lý diễn giải kỹ thuật cho nhân viên ngân hàng không chuyên sâu về AI. "
        "Nhiệm vụ DUY NHẤT của bạn là dịch số liệu kỹ thuật đã cho thành 2-4 câu tiếng Việt "
        "dễ hiểu, KHÔNG tự suy luận thêm thông tin ngoài số liệu được cung cấp, KHÔNG đưa ra "
        "quyết định hay khuyến nghị nghiệp vụ mới. " + _VI_INSTRUCTION
    )
    user_prompt = f"{instruction}\n\nSố liệu:\n{data_summary}"

    try:
        response = client.chat.completions.create(
            model=settings.DEEPSEEK_MODEL,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            max_tokens=max_tokens,
            temperature=settings.DEEPSEEK_TEMPERATURE,
            timeout=settings.DEEPSEEK_TIMEOUT_SECONDS,
        )
        narrative = response.choices[0].message.content.strip()
        return {"narrative": narrative, "model": settings.DEEPSEEK_MODEL}
    except (APIError, APITimeoutError) as exc:
        logger.warning("DeepSeek interpret call failed (%s); using template fallback", exc.__class__.__name__)
        return {"narrative": _INTERPRET_FALLBACK_NARRATIVE, "model": "template-fallback"}
```

- [ ] **Step 4: Chạy test, xác nhận pass**

Run: `cd backend && pytest tests/test_deepseek_client.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/deepseek_client.py backend/tests/test_deepseek_client.py
git commit -m "feat: add interpret_technical_output — shared LLM-as-translator helper for XAI surfaces"
```

---

### Task 5: Frontend — component `AiInterpretButton` dùng chung

**Files:**
- Create: `frontend/src/components/ui/ai-interpret-button.tsx`

**Interfaces:**
- Produces: `<AiInterpretButton onRun={() => Promise<{narrative: string; model: string}>} />`

- [ ] **Step 1: Viết component**

```tsx
"use client";

import { useMutation } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { getApiErrorMessage } from "@/lib/api";

interface InterpretResult {
  narrative: string;
  model: string;
}

interface AiInterpretButtonProps {
  onRun: () => Promise<InterpretResult>;
  label?: string;
}

/**
 * Nút "Diễn giải bằng AI" dùng chung cho mọi mặt XAI (LIME, Explanation
 * Quality, Counterfactual, Fairness, Monitoring, Trust Dashboard...).
 * Chỉ gọi khi người dùng bấm (on-demand) -- không tự động chạy nền.
 */
export function AiInterpretButton({ onRun, label = "Diễn giải bằng AI" }: AiInterpretButtonProps) {
  const mutation = useMutation({
    mutationFn: onRun,
    onError: (error) => toast.error(getApiErrorMessage(error, "Diễn giải thất bại")),
  });

  if (mutation.data) {
    return (
      <div className="flex items-start gap-2 rounded-lg border bg-primary/5 p-3">
        <Sparkles className="mt-0.5 size-4 shrink-0 text-primary" />
        <div>
          <p className="text-sm leading-relaxed">{mutation.data.narrative}</p>
          {mutation.data.model === "template-fallback" && (
            <p className="mt-1 text-xs text-muted-foreground">(diễn giải mẫu — dịch vụ AI tạm thời không khả dụng)</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <Button variant="outline" size="sm" disabled={mutation.isPending} onClick={() => mutation.mutate()}>
      <Sparkles className="size-4" />
      {mutation.isPending ? "Đang diễn giải..." : label}
    </Button>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `cd frontend && npx tsc --noEmit`
Expected: không có lỗi trong file mới

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/ui/ai-interpret-button.tsx
git commit -m "feat: add reusable AiInterpretButton component for on-demand LLM interpretation"
```

---

### Task 6: LIME + Explanation Quality + Counterfactual — endpoint diễn giải

**Files:**
- Modify: `backend/app/main.py`
- Modify: `backend/app/schemas.py`
- Test: `backend/tests/test_xai_modules.py`

**Interfaces:**
- Consumes: `interpret_technical_output` (Task 4)
- Produces: `POST /explain/lime/interpret`, `POST /explain/quality/interpret`, `POST /explain/counterfactual/interpret` — mỗi endpoint nhận `{application: LoanApplicationRequest}`, tự chạy lại LIME/Quality/Counterfactual rồi diễn giải kết quả (không nhận kết quả tính sẵn từ client, để tránh client giả mạo số liệu gửi lên LLM).

- [ ] **Step 1: Viết test thất bại**

Thêm vào `backend/tests/test_xai_modules.py`:

```python
def test_lime_interpret_endpoint_returns_narrative(client_as_loan_officer, sample_application_payload):
    resp = client_as_loan_officer.post("/explain/lime/interpret", json={"application": sample_application_payload})
    assert resp.status_code == 200
    body = resp.json()
    assert "narrative" in body and isinstance(body["narrative"], str)
    assert "model" in body


def test_quality_interpret_endpoint_returns_narrative(client_as_loan_officer, sample_application_payload):
    resp = client_as_loan_officer.post("/explain/quality/interpret", json={"application": sample_application_payload})
    assert resp.status_code == 200
    assert "narrative" in resp.json()


def test_counterfactual_interpret_endpoint_returns_narrative(client_as_loan_officer, sample_application_payload):
    resp = client_as_loan_officer.post(
        "/explain/counterfactual/interpret", json={"application": sample_application_payload, "n_results": 3}
    )
    assert resp.status_code == 200
    assert "narrative" in resp.json()
```

Kiểm tra fixture `sample_application_payload` đã tồn tại chưa:

Run: `grep -rn "sample_application_payload" backend/tests/`

Nếu chưa có, thêm vào `backend/tests/conftest.py`:

```python
@pytest.fixture
def sample_application_payload():
    return {
        "no_of_dependents": 2,
        "education": "Graduate",
        "self_employed": "No",
        "income_annum": 9600000,
        "loan_amount": 29900000,
        "loan_term": 12,
        "cibil_score": 550,
        "residential_assets_value": 2400000,
        "commercial_assets_value": 17600000,
        "luxury_assets_value": 22700000,
        "bank_asset_value": 8000000,
    }
```

- [ ] **Step 2: Chạy test, xác nhận fail**

Run: `cd backend && pytest tests/test_xai_modules.py -v -k interpret`
Expected: FAIL — 404 (endpoint chưa tồn tại)

- [ ] **Step 3: Cài đặt 3 endpoint**

Trong `backend/app/main.py`, thêm ngay sau route `@app.post("/explain/quality")` hiện có:

```python
@app.post("/explain/lime/interpret")
def explain_lime_interpret(
    request: LimeExplainRequest,
    current_user: dict = Depends(auth.require_authenticated),
):
    explainer = _get_explainer_or_503()
    features_df = encode_single_application(request.application.model_dump(), explainer.encoders)
    lime_result = get_lime_explainer().explain(features_df)

    top = lime_result["contributions"][:5]
    data_summary = (
        f"fidelity_r2={lime_result['fidelity_r2']}\n"
        + "\n".join(f"- {c['display_name']}: lime_weight={c['lime_weight']:.3f}" for c in top)
    )
    return interpret_technical_output(
        instruction=(
            "Diễn giải kết quả đối chiếu LIME (mô hình thay thế cục bộ độc lập, dùng để "
            "kiểm tra chéo với SHAP) cho một nhân viên tín dụng không chuyên sâu về AI. "
            "fidelity_r2 càng gần 1 thì phép kiểm tra càng đáng tin; fidelity_r2 âm là "
            "hiện tượng đã biết với model dạng cây, không phải lỗi."
        ),
        data_summary=data_summary,
    )


@app.post("/explain/quality/interpret")
def explain_quality_interpret(
    request: ExplanationQualityRequest,
    current_user: dict = Depends(auth.require_authenticated),
):
    explainer = _get_explainer_or_503()
    report = compute_explanation_quality_report(explainer, request.application.model_dump())

    data_summary = (
        f"composite_quality_score={report['composite_quality_score']}\n"
        f"stability={report['stability']['interpretation']} (score={report['stability']['stability_score']})\n"
        f"completeness_is_complete={report['completeness']['is_complete']}\n"
        f"sparsity={report['sparsity']['interpretation']} (concentration_ratio={report['sparsity']['concentration_ratio']})"
    )
    return interpret_technical_output(
        instruction=(
            "Diễn giải báo cáo chất lượng giải thích (Stability/Completeness/Sparsity) cho "
            "một nhân viên tín dụng — họ cần biết có nên tin vào giải thích SHAP của hồ sơ "
            "này hay không, và vì sao."
        ),
        data_summary=data_summary,
    )


@app.post("/explain/counterfactual/interpret")
def explain_counterfactual_interpret(
    request: CounterfactualRequest,
    current_user: dict = Depends(auth.require_authenticated),
):
    explainer = _get_explainer_or_503()
    result = find_counterfactuals(explainer, request.application.model_dump(), n_results=request.n_results)

    if not result["counterfactuals"]:
        cf_summary = "Không tìm được counterfactual khả thi trong phạm vi tìm kiếm."
    else:
        lines = []
        for cf in result["counterfactuals"]:
            changes = "; ".join(f"{c['display_name']}: {c['original_value']} → {c['suggested_value']}" for c in cf["changes"])
            lines.append(f"- Kết quả mới {cf['resulting_decision']} ({cf['resulting_probability']:.0%}): {changes}")
        cf_summary = "\n".join(lines)

    return interpret_technical_output(
        instruction=(
            "Diễn giải các gợi ý Counterfactual (thay đổi tối thiểu để đổi quyết định) thành "
            "lời khuyên thực tế, dễ hành động cho khách hàng/nhân viên tín dụng."
        ),
        data_summary=cf_summary,
    )
```

Thêm import `interpret_technical_output` vào đầu `main.py` (dòng import từ `.deepseek_client`):

```python
from .deepseek_client import generate_narrative_explanation, interpret_technical_output
```

- [ ] **Step 4: Chạy test, xác nhận pass**

Run: `cd backend && pytest tests/test_xai_modules.py -v -k interpret`
Expected: PASS

- [ ] **Step 5: Chạy toàn bộ test suite**

Run: `cd backend && pytest -q`
Expected: tất cả PASS

- [ ] **Step 6: Commit**

```bash
git add backend/app/main.py backend/tests/test_xai_modules.py backend/tests/conftest.py
git commit -m "feat: add LLM-interpret endpoints for LIME, Explanation Quality, Counterfactual"
```

---

### Task 7: Frontend — nút "Diễn giải bằng AI" trên Application Detail (LIME/Quality/Counterfactual)

**Files:**
- Modify: `frontend/src/lib/endpoints.ts`
- Modify: `frontend/src/lib/types.ts`
- Modify: `frontend/src/app/(app)/applications/[id]/page.tsx`

**Interfaces:**
- Consumes: `AiInterpretButton` (Task 5), endpoints từ Task 6

- [ ] **Step 1: Thêm type + hàm gọi API**

Trong `frontend/src/lib/types.ts`, thêm gần `LimeExplanationResult`/`ExplanationQualityReport`/`CounterfactualResult`:

```typescript
export interface InterpretResult {
  narrative: string;
  model: string;
}
```

Trong `frontend/src/lib/endpoints.ts`, thêm ngay sau `getExplanationQuality`:

```typescript
export async function interpretLime(application: LoanApplication): Promise<InterpretResult> {
  const { data } = await apiClient.post<InterpretResult>("/explain/lime/interpret", { application });
  return data;
}

export async function interpretExplanationQuality(application: LoanApplication): Promise<InterpretResult> {
  const { data } = await apiClient.post<InterpretResult>("/explain/quality/interpret", { application });
  return data;
}

export async function interpretCounterfactual(
  application: LoanApplication,
  n_results = 3
): Promise<InterpretResult> {
  const { data } = await apiClient.post<InterpretResult>("/explain/counterfactual/interpret", {
    application,
    n_results,
  });
  return data;
}
```

(Thêm `InterpretResult` vào danh sách import type ở đầu `endpoints.ts`.)

- [ ] **Step 2: Thêm nút vào 3 khối LIME/Counterfactual/Quality**

Trong `frontend/src/app/(app)/applications/[id]/page.tsx`, thêm import:

```typescript
import { AiInterpretButton } from "@/components/ui/ai-interpret-button";
import { interpretCounterfactual, interpretExplanationQuality, interpretLime } from "@/lib/endpoints";
```

Trong khối LIME (`<CardContent>` ngay dưới `<ul>` danh sách contribution, sau dòng `))}\n</ul>` khoảng dòng 215), thêm:

```tsx
{limeMutation.data && applicationFeatures && (
  <AiInterpretButton onRun={() => interpretLime(applicationFeatures)} />
)}
```

Tương tự trong khối Counterfactual (sau phần render danh sách `counterfactualMutation.data.counterfactuals`, khoảng dòng 255):

```tsx
{counterfactualMutation.data && applicationFeatures && (
  <AiInterpretButton onRun={() => interpretCounterfactual(applicationFeatures, 3)} />
)}
```

Và trong khối Explanation Quality (sau khối `<div className="space-y-2 text-sm">` hiện tại, khoảng dòng 310):

```tsx
{qualityMutation.data && applicationFeatures && (
  <AiInterpretButton onRun={() => interpretExplanationQuality(applicationFeatures)} />
)}
```

- [ ] **Step 3: Type-check**

Run: `cd frontend && npx tsc --noEmit`
Expected: sạch, không lỗi mới

- [ ] **Step 4: Kiểm tra thủ công qua trình duyệt**

Mở một hồ sơ bất kỳ, mở "Công cụ phân tích chuyên sâu", chạy LIME → xác nhận nút "Diễn giải bằng AI" xuất hiện, bấm và xác nhận có đoạn văn tiếng Việt hiện ra (hoặc câu fallback nếu DeepSeek không khả dụng). Lặp lại cho Counterfactual và Explanation Quality.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/endpoints.ts frontend/src/lib/types.ts frontend/src/app/\(app\)/applications/\[id\]/page.tsx
git commit -m "feat: wire AiInterpretButton into LIME/Counterfactual/Quality on Application Detail"
```

---

### Task 8: Fairness — endpoint diễn giải + khuyến nghị chi tiết hơn

**Files:**
- Modify: `backend/app/main.py`
- Modify: `backend/app/schemas.py`
- Test: `backend/tests/test_fairness_mitigation.py`

**Interfaces:**
- Consumes: `interpret_technical_output` (Task 4), `compute_fairness_report`, `generate_mitigation_recommendations` (đã có)
- Produces: `POST /fairness/interpret` (không cần body); `GET /fairness/mitigation-recommendations?elaborate=true` (mở rộng, thêm field `llm_detailed_writeup` cho mỗi recommendation khi `elaborate=true`)

- [ ] **Step 1: Viết test thất bại**

Thêm vào `backend/tests/test_fairness_mitigation.py`:

```python
def test_fairness_interpret_endpoint(client_as_risk_manager):
    resp = client_as_risk_manager.post("/fairness/interpret")
    assert resp.status_code == 200
    assert "narrative" in resp.json()


def test_mitigation_recommendations_with_elaborate_flag(client_as_risk_manager):
    resp = client_as_risk_manager.get("/fairness/mitigation-recommendations?elaborate=true")
    assert resp.status_code == 200
    body = resp.json()
    for rec in body:
        assert "llm_detailed_writeup" in rec
```

(Nếu fixture `client_as_risk_manager` chưa có, thêm vào `conftest.py` theo đúng pattern `client_as_admin` ở Task 2.)

- [ ] **Step 2: Chạy test, xác nhận fail**

Run: `cd backend && pytest tests/test_fairness_mitigation.py -v -k "interpret or elaborate"`
Expected: FAIL — 404/`llm_detailed_writeup` không tồn tại

- [ ] **Step 3: Cài đặt endpoint `/fairness/interpret`**

Trong `backend/app/main.py`, ngay sau route `@app.get("/fairness/report")` hiện có:

```python
@app.post("/fairness/interpret")
def fairness_interpret(
    current_user: dict = Depends(auth.require_roles("admin", "risk_manager")),
):
    explainer = _get_explainer_or_503()
    report = compute_fairness_report(explainer)

    lines = [f"Tỷ lệ duyệt tổng thể theo dự đoán: {report['overall_approval_rate_predicted']:.0%}"]
    for attribute, res in report["by_attribute"].items():
        lines.append(
            f"- {attribute}: parity_ratio (mô hình)={res['parity_ratio']}, "
            f"parity_ratio (nhãn gốc)={res['label_parity_ratio']}, "
            f"đạt Four-Fifths Rule={res['passes_four_fifths_rule']}"
        )
    return interpret_technical_output(
        instruction=(
            "Diễn giải báo cáo công bằng (demographic parity, Four-Fifths Rule) cho một "
            "cán bộ quản lý rủi ro — họ cần biết mô hình có đang công bằng không, và có "
            "đang khuếch đại thêm bias vốn có trong dữ liệu hay không."
        ),
        data_summary="\n".join(lines),
    )
```

- [ ] **Step 4: Mở rộng `/fairness/mitigation-recommendations` với `elaborate`**

Tìm route `@app.get("/fairness/mitigation-recommendations")` hiện có, sửa thành:

```python
@app.get("/fairness/mitigation-recommendations")
def fairness_mitigation_recommendations(
    elaborate: bool = False,
    current_user: dict = Depends(auth.require_roles("admin", "risk_manager")),
):
    explainer = _get_explainer_or_503()
    report = compute_fairness_report(explainer)
    db.log_audit_event(user_id=current_user["email"], action="fairness.mitigation_recommendations")

    recommendations = report["mitigation_recommendations"]
    if elaborate:
        for rec in recommendations:
            result = interpret_technical_output(
                instruction=(
                    "Soạn một đoạn văn bản chi tiết hơn (4-6 câu), mang tính compliance/tuân "
                    "thủ, giải thích vì sao cần điều chỉnh ngưỡng cho thuộc tính này, dựa "
                    "đúng trên số liệu đã cho — không tự thêm số liệu mới."
                ),
                data_summary=(
                    f"attribute={rec['attribute']}, advantaged_group={rec['advantaged_group']}, "
                    f"disadvantaged_group={rec['disadvantaged_group']}, "
                    f"approval_rate_gap={rec['approval_rate_gap']}"
                ),
                max_tokens=300,
            )
            rec["llm_detailed_writeup"] = result["narrative"]
    else:
        for rec in recommendations:
            rec["llm_detailed_writeup"] = None

    return recommendations
```

(Giữ nguyên phần đầu hàm nếu code hiện tại khác biệt nhỏ về cách lấy `report`/`explainer` — chỉ đảm bảo tham số `elaborate: bool = False` và vòng lặp gắn `llm_detailed_writeup` được thêm vào.)

- [ ] **Step 5: Chạy test, xác nhận pass**

Run: `cd backend && pytest tests/test_fairness_mitigation.py -v`
Expected: PASS

- [ ] **Step 6: Chạy toàn bộ test suite**

Run: `cd backend && pytest -q`

- [ ] **Step 7: Commit**

```bash
git add backend/app/main.py backend/tests/test_fairness_mitigation.py backend/tests/conftest.py
git commit -m "feat: add /fairness/interpret and elaborate=true detailed mitigation write-ups"
```

---

### Task 9: Frontend — nút diễn giải trên trang Fairness

**Files:**
- Modify: `frontend/src/lib/endpoints.ts`
- Modify: `frontend/src/lib/types.ts`
- Modify: `frontend/src/app/(app)/fairness/page.tsx`

- [ ] **Step 1: Thêm hàm API + type**

Trong `frontend/src/lib/types.ts`, sửa `MitigationRecommendation` (tìm interface hiện có) thêm field:

```typescript
export interface MitigationRecommendation {
  // ...các field hiện có giữ nguyên...
  llm_detailed_writeup: string | null;
}
```

Trong `frontend/src/lib/endpoints.ts`, thêm:

```typescript
export async function interpretFairnessReport(): Promise<InterpretResult> {
  const { data } = await apiClient.post<InterpretResult>("/fairness/interpret");
  return data;
}

export async function getMitigationRecommendations(elaborate = false): Promise<MitigationRecommendation[]> {
  const { data } = await apiClient.get<MitigationRecommendation[]>("/fairness/mitigation-recommendations", {
    params: { elaborate },
  });
  return data;
}
```

- [ ] **Step 2: Thêm nút vào `fairness/page.tsx`**

Import `AiInterpretButton`, `interpretFairnessReport`. Thêm ngay dưới `<Alert>` tổng quan (sau khối `compliance_summary`, trước `<div className="grid gap-4 sm:grid-cols-3">`):

```tsx
<AiInterpretButton onRun={interpretFairnessReport} label="Diễn giải báo cáo công bằng bằng AI" />
```

Trong khối "Khuyến nghị giảm thiểu thiên lệch" (`data.mitigation_recommendations.map((rec) => ...)`), thêm nút bấm để lấy bản chi tiết hơn — thay `useQuery` tĩnh hiện tại (`data.mitigation_recommendations`) bằng một `useMutation` riêng gọi `getMitigationRecommendations(true)` khi người dùng bấm "Xem chi tiết hơn":

```tsx
const elaborateMutation = useMutation({
  mutationFn: () => getMitigationRecommendations(true),
});
```

Và trong mỗi thẻ khuyến nghị, thêm:

```tsx
{elaborateMutation.data?.find((r) => r.attribute === rec.attribute)?.llm_detailed_writeup ? (
  <p className="mt-2 text-sm">{elaborateMutation.data.find((r) => r.attribute === rec.attribute)!.llm_detailed_writeup}</p>
) : (
  <Button variant="ghost" size="sm" className="mt-2" onClick={() => elaborateMutation.mutate()}>
    Xem diễn giải chi tiết hơn bằng AI
  </Button>
)}
```

- [ ] **Step 3: Type-check**

Run: `cd frontend && npx tsc --noEmit`

- [ ] **Step 4: Kiểm tra thủ công qua trình duyệt** — vào `/fairness`, bấm nút diễn giải tổng quan và nút diễn giải chi tiết cho từng khuyến nghị (nếu có vi phạm).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/endpoints.ts frontend/src/lib/types.ts frontend/src/app/\(app\)/fairness/page.tsx
git commit -m "feat: add AI-interpret buttons to Fairness Report page"
```

---

### Task 10: Monitoring + Trust Dashboard + Override Analysis — endpoint diễn giải

**Files:**
- Modify: `backend/app/main.py`
- Test: `backend/tests/test_monitoring_drift.py`, `backend/tests/test_db_analytics.py`

**Interfaces:**
- Produces: `POST /monitoring/interpret`, `GET /trust/{user_id}/interpret`, `GET /hcxai/override-analysis/interpret`

- [ ] **Step 1: Viết test thất bại**

Thêm vào `backend/tests/test_monitoring_drift.py`:

```python
def test_monitoring_interpret_endpoint(client_as_risk_manager):
    resp = client_as_risk_manager.post("/monitoring/interpret")
    assert resp.status_code == 200
    assert "narrative" in resp.json()
```

Thêm vào `backend/tests/test_db_analytics.py`:

```python
def test_trust_interpret_endpoint(client_as_loan_officer):
    resp = client_as_loan_officer.get("/trust/test_user/interpret")
    assert resp.status_code == 200
    assert "narrative" in resp.json()


def test_override_analysis_interpret_endpoint(client_as_risk_manager):
    resp = client_as_risk_manager.get("/hcxai/override-analysis/interpret")
    assert resp.status_code == 200
    assert "narrative" in resp.json()
```

- [ ] **Step 2: Chạy test, xác nhận fail**

Run: `cd backend && pytest tests/test_monitoring_drift.py tests/test_db_analytics.py -v -k interpret`
Expected: FAIL — 404

- [ ] **Step 3: Cài đặt 3 endpoint**

Trong `main.py`, sau `@app.get("/monitoring/snapshot")`:

```python
@app.post("/monitoring/interpret")
def monitoring_interpret(
    current_user: dict = Depends(auth.require_roles("admin", "risk_manager")),
):
    snapshot = get_monitoring_snapshot()
    drift = snapshot["drift_report"]
    pred_drift = snapshot["prediction_drift"]

    lines = [f"Số dự đoán đã xử lý: {snapshot['n_predictions_served']}"]
    if drift.get("status") == "ok":
        lines.append(f"Feature drift: {'phát hiện' if drift['overall_drift_detected'] else 'không phát hiện'}, "
                      f"các yếu tố lệch: {drift.get('drifted_features') or 'không có'}")
    if pred_drift.get("status") == "ok":
        lines.append(f"Prediction drift: {'phát hiện' if pred_drift['drift_detected'] else 'không phát hiện'}, "
                      f"ks_statistic={pred_drift['ks_statistic']}, p_value={pred_drift['p_value']}")

    return interpret_technical_output(
        instruction=(
            "Diễn giải báo cáo giám sát mô hình (feature drift, prediction drift) cho cán bộ "
            "quản lý rủi ro — họ cần biết có nên lo ngại và có nên huấn luyện lại mô hình không."
        ),
        data_summary="\n".join(lines),
    )
```

Sau `@app.get("/trust/{user_id}")`:

```python
@app.get("/trust/{user_id}/interpret")
def trust_dashboard_interpret(
    user_id: str,
    current_user: dict = Depends(auth.require_authenticated),
):
    dashboard = hcxai.get_trust_dashboard(user_id)
    calibration = dashboard["trust_calibration"]
    trend = dashboard["trust_trend"]

    data_summary = (
        f"trust_state={calibration.get('trust_state')}, agreement_rate={calibration.get('agreement_rate')}, "
        f"events={calibration.get('events')}, trend={trend.get('trend')}, "
        f"recent_agreement_rate={trend.get('recent_agreement_rate')}, "
        f"prior_agreement_rate={trend.get('prior_agreement_rate')}"
    )
    return interpret_technical_output(
        instruction=(
            "Diễn giải hồ sơ cân chỉnh độ tin cậy của một người dùng thành 2-3 câu nhận xét "
            "tự nhiên, gần gũi (ví dụ xu hướng tin AI quá mức hay đang cải thiện)."
        ),
        data_summary=data_summary,
    )
```

Sau `@app.get("/hcxai/override-analysis")`:

```python
@app.get("/hcxai/override-analysis/interpret")
def override_analysis_interpret(
    user_id: str | None = None,
    current_user: dict = Depends(auth.require_roles("admin", "risk_manager")),
):
    by_confidence = db.get_override_analysis_by_confidence(user_id)
    direction = db.get_override_direction_stats(user_id) if user_id else None

    lines = [f"- {b['confidence_range']}: {b['n_events']} sự kiện, disagreement_rate={b['disagreement_rate']}" for b in by_confidence]
    if direction:
        lines.append(f"risk_tolerance={direction.get('risk_tolerance')}")

    return interpret_technical_output(
        instruction=(
            "Diễn giải bảng phân tích ghi đè (disagreement rate theo độ tin cậy AI) cho cán bộ "
            "quản lý rủi ro — mô hình có đang được calibrate tốt không (disagreement rate nên "
            "giảm dần khi độ tin cậy AI tăng)."
        ),
        data_summary="\n".join(lines),
    )
```

- [ ] **Step 4: Chạy test, xác nhận pass**

Run: `cd backend && pytest tests/test_monitoring_drift.py tests/test_db_analytics.py -v`

- [ ] **Step 5: Chạy toàn bộ test suite**

Run: `cd backend && pytest -q`

- [ ] **Step 6: Commit**

```bash
git add backend/app/main.py backend/tests/test_monitoring_drift.py backend/tests/test_db_analytics.py
git commit -m "feat: add LLM-interpret endpoints for Monitoring, Trust Dashboard, Override Analysis"
```

---

### Task 11: Frontend — nút diễn giải trên Monitoring + Trust Dashboard

**Files:**
- Modify: `frontend/src/lib/endpoints.ts`
- Modify: `frontend/src/app/(app)/monitoring/page.tsx`
- Modify: `frontend/src/app/(app)/trust/page.tsx`

- [ ] **Step 1: Thêm hàm API**

Trong `frontend/src/lib/endpoints.ts`:

```typescript
export async function interpretMonitoringSnapshot(): Promise<InterpretResult> {
  const { data } = await apiClient.post<InterpretResult>("/monitoring/interpret");
  return data;
}

export async function interpretTrustDashboard(userId: string): Promise<InterpretResult> {
  const { data } = await apiClient.get<InterpretResult>(`/trust/${encodeURIComponent(userId)}/interpret`);
  return data;
}

export async function interpretOverrideAnalysis(userId?: string): Promise<InterpretResult> {
  const { data } = await apiClient.get<InterpretResult>("/hcxai/override-analysis/interpret", {
    params: userId ? { user_id: userId } : undefined,
  });
  return data;
}
```

- [ ] **Step 2: Thêm nút vào `monitoring/page.tsx`**

Import `AiInterpretButton`, `interpretMonitoringSnapshot`. Thêm ngay trước dòng đóng `</>` của nhánh `data ?` (cuối cùng, sau card Prediction Drift):

```tsx
<AiInterpretButton onRun={interpretMonitoringSnapshot} label="Diễn giải toàn bộ báo cáo giám sát bằng AI" />
```

- [ ] **Step 3: Thêm nút vào `trust/page.tsx`**

Import `AiInterpretButton`, `interpretTrustDashboard`. Thêm ngay sau khối `{data && (<div className="grid gap-6 lg:grid-cols-3">...)}` (trước khối `{analytics && (...)}`, chỉ khi `data` tồn tại):

```tsx
{data && (
  <AiInterpretButton
    onRun={() => interpretTrustDashboard(queryUserId)}
    label="Diễn giải hồ sơ tin cậy này bằng AI"
  />
)}
```

- [ ] **Step 4: Type-check**

Run: `cd frontend && npx tsc --noEmit`

- [ ] **Step 5: Kiểm tra thủ công** — `/monitoring` và `/trust`, bấm nút, xác nhận có đoạn văn hiện ra.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/endpoints.ts frontend/src/app/\(app\)/monitoring/page.tsx frontend/src/app/\(app\)/trust/page.tsx
git commit -m "feat: add AI-interpret buttons to Monitoring and Trust Dashboard pages"
```

---

## Phần B — Human-in-the-loop: Hàng chờ duyệt bắt buộc

### Task 12: Cấu hình ngưỡng + migration cột review

**Files:**
- Modify: `backend/app/config.py`
- Modify: `backend/app/db.py`
- Test: `backend/tests/test_db_analytics.py`

**Interfaces:**
- Produces: `settings.REVIEW_CONFIDENCE_THRESHOLD: float`, `settings.REVIEW_LOAN_AMOUNT_THRESHOLD: float`; cột mới trên `predictions`: `needs_review`, `review_reasons`, `reviewed_by`, `reviewed_at`, `review_decision`, `review_note`

- [ ] **Step 1: Viết test thất bại**

Thêm vào `backend/tests/test_db_analytics.py`:

```python
def test_predictions_table_has_review_columns(tmp_path, monkeypatch):
    import importlib
    from app import config as config_module

    monkeypatch.setenv("SQLITE_PATH", str(tmp_path / "review_test.db"))
    importlib.reload(config_module)
    from app import db as db_module

    importlib.reload(db_module)
    db_module.init_db()

    with db_module.get_connection() as conn:
        columns = {row[1] for row in conn.execute("PRAGMA table_info(predictions)").fetchall()}
    assert {"needs_review", "review_reasons", "reviewed_by", "reviewed_at", "review_decision", "review_note"} <= columns
```

- [ ] **Step 2: Chạy test, xác nhận fail**

Run: `cd backend && pytest tests/test_db_analytics.py -v -k review_columns`
Expected: FAIL — cột chưa tồn tại

- [ ] **Step 3: Thêm cấu hình vào `config.py`**

Trong `class Settings:` của `backend/app/config.py`, thêm sau khối `DEEPSEEK_*`:

```python
    # Human-in-the-loop: Review Queue trigger thresholds (ngưỡng nghiệp vụ,
    # chỉnh qua .env, không hardcode trong logic).
    REVIEW_CONFIDENCE_THRESHOLD: float = float(os.getenv("REVIEW_CONFIDENCE_THRESHOLD", "0.75"))
    REVIEW_LOAN_AMOUNT_THRESHOLD: float = float(os.getenv("REVIEW_LOAN_AMOUNT_THRESHOLD", "30000000"))
```

- [ ] **Step 4: Thêm migration trong `db.py`**

Sửa `_run_lightweight_migrations` trong `backend/app/db.py`, thêm vào cuối hàm:

```python
    existing_pred_columns = {row[1] for row in conn.execute("PRAGMA table_info(predictions)").fetchall()}
    review_columns = {
        "needs_review": "INTEGER NOT NULL DEFAULT 0",
        "review_reasons": "TEXT",
        "reviewed_by": "TEXT",
        "reviewed_at": "TEXT",
        "review_decision": "TEXT",
        "review_note": "TEXT",
    }
    for col, col_type in review_columns.items():
        if col not in existing_pred_columns:
            conn.execute(f"ALTER TABLE predictions ADD COLUMN {col} {col_type}")
```

- [ ] **Step 5: Chạy test, xác nhận pass**

Run: `cd backend && pytest tests/test_db_analytics.py -v -k review_columns`

- [ ] **Step 6: Chạy toàn bộ test suite** (xác nhận migration không phá DB test khác)

Run: `cd backend && pytest -q`

- [ ] **Step 7: Commit**

```bash
git add backend/app/config.py backend/app/db.py backend/tests/test_db_analytics.py
git commit -m "feat: add review-queue config thresholds and predictions review columns"
```

---

### Task 13: Fairness report cache (dùng cho trigger + tránh tính lại mỗi request)

**Files:**
- Modify: `backend/app/fairness.py`
- Test: `backend/tests/test_fairness_mitigation.py`

**Interfaces:**
- Produces: `get_cached_fairness_report(explainer) -> dict`, `invalidate_fairness_cache() -> None`, `is_group_flagged(attribute: str, group_value: str) -> bool` (dùng cached report)

- [ ] **Step 1: Viết test thất bại**

Thêm vào `backend/tests/test_fairness_mitigation.py`:

```python
def test_cached_fairness_report_reuses_result(monkeypatch):
    from app import fairness as fairness_module

    call_count = {"n": 0}
    original = fairness_module.compute_fairness_report

    def counting_wrapper(explainer):
        call_count["n"] += 1
        return original(explainer)

    monkeypatch.setattr(fairness_module, "compute_fairness_report", counting_wrapper)
    fairness_module.invalidate_fairness_cache()

    class FakeExplainer:
        pass

    fairness_module.get_cached_fairness_report(FakeExplainer())
    fairness_module.get_cached_fairness_report(FakeExplainer())
    assert call_count["n"] == 1
```

(Test này cần `compute_fairness_report` được gọi gián tiếp qua `get_cached_fairness_report`, không trực tiếp — xem Step 3.)

- [ ] **Step 2: Chạy test, xác nhận fail**

Run: `cd backend && pytest tests/test_fairness_mitigation.py -v -k cached`
Expected: FAIL — `get_cached_fairness_report` chưa tồn tại

- [ ] **Step 3: Cài đặt cache đơn giản (module-level, invalidate khi activate model mới)**

Thêm vào cuối `backend/app/fairness.py`:

```python
_cached_report: dict[str, Any] | None = None


def get_cached_fairness_report(explainer: LoanExplainer) -> dict[str, Any]:
    """
    Cache đơn giản, dùng lại kết quả compute_fairness_report() cho tới khi bị
    invalidate (khi model được train/activate lại -- xem model_registry.py).
    Tránh việc mỗi lượt /explain (kiểm tra trigger review) phải tính lại toàn
    bộ báo cáo fairness (vốn re-evaluate model trên cả tập test).
    """
    global _cached_report
    if _cached_report is None:
        _cached_report = compute_fairness_report(explainer)
    return _cached_report


def invalidate_fairness_cache() -> None:
    global _cached_report
    _cached_report = None


def is_group_flagged(explainer: LoanExplainer, attribute: str, group_value: str) -> bool:
    """True nếu `group_value` (vd 'Not Graduate') thuộc thuộc tính `attribute`
    (vd 'education') hiện đang bị Fairness Report gắn cờ vi phạm Four-Fifths Rule."""
    report = get_cached_fairness_report(explainer)
    attr_result = report["by_attribute"].get(attribute)
    if not attr_result or attr_result["passes_four_fifths_rule"] is not False:
        return False
    rates = attr_result["approval_rate_by_group"]
    if not rates:
        return False
    disadvantaged_group = min(rates, key=rates.get)
    return group_value == disadvantaged_group
```

- [ ] **Step 4: Invalidate cache khi activate model mới**

Trong `backend/app/model_registry.py`, tìm hàm `train_new_version` (đã sửa ở Task 1), thêm vào cuối hàm (trước `return record`):

```python
    from . import fairness as fairness_module
    fairness_module.invalidate_fairness_cache()
```

- [ ] **Step 5: Chạy test, xác nhận pass**

Run: `cd backend && pytest tests/test_fairness_mitigation.py -v -k cached`

- [ ] **Step 6: Chạy toàn bộ test suite**

Run: `cd backend && pytest -q`

- [ ] **Step 7: Commit**

```bash
git add backend/app/fairness.py backend/app/model_registry.py backend/tests/test_fairness_mitigation.py
git commit -m "feat: cache fairness report for review-trigger checks, invalidate on model retrain"
```

---

### Task 14: Logic trigger review tự động trong `/explain`

**Files:**
- Modify: `backend/app/db.py`
- Modify: `backend/app/main.py`
- Test: `backend/tests/test_hcxai.py`

**Interfaces:**
- Produces: `db.save_prediction(..., needs_review: bool = False, review_reasons: list[str] | None = None)` (mở rộng); hàm mới `evaluate_review_triggers(prediction: dict, application: dict, explainer) -> tuple[bool, list[str]]` trong `main.py` (không đặt trong `db.py` vì cần gọi `fairness.is_group_flagged`, tránh import vòng)

- [ ] **Step 1: Viết test thất bại**

Thêm vào `backend/tests/test_hcxai.py` (hoặc file mới `backend/tests/test_review_queue.py` nếu muốn tách riêng — dùng file mới cho rõ ràng):

Tạo `backend/tests/test_review_queue.py`:

```python
"""Tests for Human-in-the-loop review-trigger logic (backend/app/main.py::evaluate_review_triggers)."""
from app.main import evaluate_review_triggers


def test_low_confidence_triggers_review(monkeypatch):
    from app import config as config_module

    monkeypatch.setattr(config_module.settings, "REVIEW_CONFIDENCE_THRESHOLD", 0.75)
    prediction = {"prediction": "Approved", "confidence": 0.6, "approval_probability": 0.6}
    application = {"loan_amount": 1000000, "education": "Graduate", "self_employed": "No"}
    needs_review, reasons = evaluate_review_triggers(prediction, application, explainer=None)
    assert needs_review is True
    assert "low_confidence" in reasons


def test_high_loan_amount_triggers_review(monkeypatch):
    from app import config as config_module

    monkeypatch.setattr(config_module.settings, "REVIEW_LOAN_AMOUNT_THRESHOLD", 30_000_000)
    prediction = {"prediction": "Approved", "confidence": 0.95, "approval_probability": 0.95}
    application = {"loan_amount": 35_000_000, "education": "Graduate", "self_employed": "No"}
    needs_review, reasons = evaluate_review_triggers(prediction, application, explainer=None)
    assert needs_review is True
    assert "high_loan_amount" in reasons


def test_clear_case_does_not_trigger_review(monkeypatch):
    from app import config as config_module

    monkeypatch.setattr(config_module.settings, "REVIEW_CONFIDENCE_THRESHOLD", 0.75)
    monkeypatch.setattr(config_module.settings, "REVIEW_LOAN_AMOUNT_THRESHOLD", 30_000_000)
    prediction = {"prediction": "Approved", "confidence": 0.95, "approval_probability": 0.95}
    application = {"loan_amount": 1_000_000, "education": "Graduate", "self_employed": "No"}
    needs_review, reasons = evaluate_review_triggers(prediction, application, explainer=None)
    assert needs_review is False
    assert reasons == []
```

- [ ] **Step 2: Chạy test, xác nhận fail**

Run: `cd backend && pytest tests/test_review_queue.py -v`
Expected: FAIL — `ImportError: cannot import name 'evaluate_review_triggers'`

- [ ] **Step 3: Cài đặt `evaluate_review_triggers` trong `main.py`**

Thêm vào `backend/app/main.py`, ngay trước route `@app.post("/explain")`:

```python
def evaluate_review_triggers(
    prediction: dict[str, Any],
    application: dict[str, Any],
    explainer: Any,
) -> tuple[bool, list[str]]:
    """
    Human-in-the-loop: quyết định một prediction có cần vào hàng chờ duyệt
    bắt buộc hay không, dựa trên 3 tín hiệu độc lập (ngưỡng cấu hình qua
    settings, xem config.py). `explainer` có thể là None trong test đơn vị
    thuần logic (không cần fairness check thật).
    """
    reasons: list[str] = []

    if prediction["confidence"] < settings.REVIEW_CONFIDENCE_THRESHOLD:
        reasons.append("low_confidence")

    if application.get("loan_amount", 0) > settings.REVIEW_LOAN_AMOUNT_THRESHOLD:
        reasons.append("high_loan_amount")

    if explainer is not None:
        from . import fairness as fairness_module

        for attribute in ("education", "self_employed"):
            group_value = application.get(attribute)
            if group_value and fairness_module.is_group_flagged(explainer, attribute, group_value):
                reasons.append("fairness_group_flag")
                break

    return (len(reasons) > 0, reasons)
```

- [ ] **Step 4: Chạy test, xác nhận pass**

Run: `cd backend && pytest tests/test_review_queue.py -v`

- [ ] **Step 5: Nối vào `/explain` + mở rộng `db.save_prediction`**

Trong `backend/app/db.py`, sửa `save_prediction` thêm 2 tham số:

```python
def save_prediction(
    application_id: int,
    prediction: dict[str, Any],
    shap_result: dict[str, Any],
    narrative: str | None = None,
    narrative_model: str | None = None,
    model_version: str = "unknown",
    needs_review: bool = False,
    review_reasons: list[str] | None = None,
) -> int:
    with get_connection() as conn:
        cur = conn.execute(
            """INSERT INTO predictions
               (application_id, created_at, prediction, approval_probability,
                risk_score, confidence, shap_json, narrative, narrative_model,
                model_version, needs_review, review_reasons)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
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
                int(needs_review),
                json.dumps(review_reasons or []),
            ),
        )
        return cur.lastrowid
```

Trong `backend/app/hcxai.py`, sửa `record_prediction_and_context` để nhận và truyền tiếp 2 tham số mới:

```python
def record_prediction_and_context(
    features: dict[str, Any],
    prediction: dict[str, Any],
    shap_result: dict[str, Any],
    narrative: str,
    narrative_model: str,
    model_version: str = "unknown",
    applicant_id: int | None = None,
    needs_review: bool = False,
    review_reasons: list[str] | None = None,
) -> tuple[int, int]:
    application_id = db.save_application(features, applicant_id=applicant_id)
    prediction_id = db.save_prediction(
        application_id,
        prediction,
        shap_result,
        narrative=narrative,
        narrative_model=narrative_model,
        model_version=model_version,
        needs_review=needs_review,
        review_reasons=review_reasons,
    )
    db.save_prediction_snapshot(model_version, prediction["approval_probability"])
    return application_id, prediction_id
```

Trong `backend/app/main.py`, route `/explain` (đã sửa ở phiên trước để dùng `current_user["role"]`), thêm việc gọi trigger ngay sau khi có `prediction` và trước khi gọi `hcxai.record_prediction_and_context`:

```python
    needs_review, review_reasons = evaluate_review_triggers(
        prediction, request.application.model_dump(), explainer
    )

    application_id, prediction_id = hcxai.record_prediction_and_context(
        request.application.model_dump(),
        prediction,
        shap_result,
        narrative=narrative_result["narrative"],
        narrative_model=narrative_result["model"],
        model_version=explainer.version_label,
        applicant_id=request.applicant_id,
        needs_review=needs_review,
        review_reasons=review_reasons,
    )
```

- [ ] **Step 6: Chạy toàn bộ test suite**

Run: `cd backend && pytest -q`
Expected: tất cả PASS

- [ ] **Step 7: Commit**

```bash
git add backend/app/main.py backend/app/db.py backend/app/hcxai.py backend/tests/test_review_queue.py
git commit -m "feat: auto-flag predictions needing mandatory review (low confidence / high loan amount / fairness group)"
```

---

### Task 15: Tự nguyện gắn cờ + Hàng chờ duyệt (list + resolve)

**Files:**
- Modify: `backend/app/db.py`
- Modify: `backend/app/schemas.py`
- Modify: `backend/app/main.py`
- Test: `backend/tests/test_review_queue.py`

**Interfaces:**
- Produces: `db.flag_prediction_for_review(prediction_id, reason) -> None`, `db.list_review_queue(limit, offset) -> list[dict]`, `db.resolve_review(prediction_id, reviewed_by, decision, note) -> None`; `POST /predictions/{id}/flag-for-review`, `GET /review-queue`, `POST /review-queue/{id}/resolve`

- [ ] **Step 1: Viết test thất bại**

Thêm vào `backend/tests/test_review_queue.py`:

```python
def test_flag_for_review_sets_self_flagged_reason(client_as_loan_officer, seeded_prediction_id):
    resp = client_as_loan_officer.post(f"/predictions/{seeded_prediction_id}/flag-for-review")
    assert resp.status_code == 200
    detail = client_as_loan_officer.get(f"/predictions/{seeded_prediction_id}").json()
    assert detail["needs_review"] == 1
    assert "self_flagged" in json.loads(detail["review_reasons"])


def test_review_queue_lists_only_unresolved(client_as_risk_manager, seeded_prediction_id):
    resp = client_as_risk_manager.get("/review-queue")
    assert resp.status_code == 200
    ids = [item["id"] for item in resp.json()["items"]]
    assert seeded_prediction_id in ids


def test_resolve_review_removes_from_queue(client_as_risk_manager, seeded_prediction_id):
    resp = client_as_risk_manager.post(
        f"/review-queue/{seeded_prediction_id}/resolve",
        json={"decision": "confirmed", "note": "Đã xem xét, giữ nguyên quyết định."},
    )
    assert resp.status_code == 200
    remaining = client_as_risk_manager.get("/review-queue").json()["items"]
    assert seeded_prediction_id not in [item["id"] for item in remaining]
```

Cần thêm `import json` ở đầu file test nếu chưa có, và fixture `seeded_prediction_id` trong `conftest.py` — tạo 1 prediction thật qua `POST /explain` với `loan_amount` vượt `REVIEW_LOAN_AMOUNT_THRESHOLD` để đảm bảo nó chắc chắn vào hàng chờ:

```python
@pytest.fixture
def seeded_prediction_id(client_as_loan_officer, sample_application_payload):
    payload = dict(sample_application_payload)
    payload["loan_amount"] = 40_000_000  # vượt REVIEW_LOAN_AMOUNT_THRESHOLD mặc định
    resp = client_as_loan_officer.post(
        "/explain",
        json={"application": payload, "role": "loan_officer", "user_id": "test_loan_officer@hcxai.local"},
    )
    return resp.json()["prediction_id"]
```

- [ ] **Step 2: Chạy test, xác nhận fail**

Run: `cd backend && pytest tests/test_review_queue.py -v -k "flag_for_review or review_queue or resolve"`
Expected: FAIL — 404

- [ ] **Step 3: Thêm hàm DB**

Thêm vào `backend/app/db.py`, gần `save_prediction`:

```python
def flag_prediction_for_review(prediction_id: int, reason: str = "self_flagged") -> None:
    with get_connection() as conn:
        row = conn.execute("SELECT review_reasons FROM predictions WHERE id = ?", (prediction_id,)).fetchone()
        if row is None:
            raise ValueError(f"Prediction {prediction_id} not found")
        existing = json.loads(row["review_reasons"] or "[]")
        if reason not in existing:
            existing.append(reason)
        conn.execute(
            "UPDATE predictions SET needs_review = 1, review_reasons = ? WHERE id = ?",
            (json.dumps(existing), prediction_id),
        )


def list_review_queue(limit: int = 50, offset: int = 0) -> list[dict[str, Any]]:
    with get_connection() as conn:
        rows = conn.execute(
            """SELECT p.*, a.applicant_id AS applicant_id, ap.full_name AS applicant_name
               FROM predictions p
               LEFT JOIN applications a ON a.id = p.application_id
               LEFT JOIN applicants ap ON ap.id = a.applicant_id
               WHERE p.needs_review = 1 AND p.reviewed_by IS NULL
               ORDER BY p.id ASC LIMIT ? OFFSET ?""",
            (limit, offset),
        ).fetchall()
        total = conn.execute(
            "SELECT COUNT(*) AS c FROM predictions WHERE needs_review = 1 AND reviewed_by IS NULL"
        ).fetchone()["c"]
        return {"items": [dict(r) for r in rows], "total": total}


def resolve_review(prediction_id: int, reviewed_by: str, decision: str, note: str | None) -> None:
    with get_connection() as conn:
        conn.execute(
            """UPDATE predictions
               SET reviewed_by = ?, reviewed_at = ?, review_decision = ?, review_note = ?
               WHERE id = ?""",
            (reviewed_by, _now(), decision, note, prediction_id),
        )
```

- [ ] **Step 4: Thêm schema request**

Trong `backend/app/schemas.py`, thêm:

```python
class ResolveReviewRequest(BaseModel):
    decision: Literal["confirmed", "overridden"]
    note: str | None = None
```

- [ ] **Step 5: Thêm 3 endpoint trong `main.py`**

```python
@app.post("/predictions/{prediction_id}/flag-for-review")
def flag_prediction_for_review_endpoint(
    prediction_id: int,
    current_user: dict = Depends(auth.require_authenticated),
):
    pred = db.get_prediction(prediction_id)
    if pred is None:
        raise HTTPException(status_code=404, detail=f"Prediction {prediction_id} not found")
    db.flag_prediction_for_review(prediction_id, reason="self_flagged")
    db.log_audit_event(
        user_id=current_user["email"], action="review.self_flag",
        resource_type="prediction", resource_id=str(prediction_id),
    )
    return {"status": "flagged"}


@app.get("/review-queue")
def get_review_queue(
    limit: int = 50,
    offset: int = 0,
    current_user: dict = Depends(auth.require_roles("admin", "risk_manager")),
):
    return db.list_review_queue(limit=limit, offset=offset)


@app.post("/review-queue/{prediction_id}/resolve")
def resolve_review_endpoint(
    prediction_id: int,
    request: ResolveReviewRequest,
    current_user: dict = Depends(auth.require_roles("admin", "risk_manager")),
):
    pred = db.get_prediction(prediction_id)
    if pred is None:
        raise HTTPException(status_code=404, detail=f"Prediction {prediction_id} not found")

    db.resolve_review(prediction_id, reviewed_by=current_user["email"], decision=request.decision, note=request.note)

    human_decision = pred["prediction"] if request.decision == "confirmed" else (
        "Rejected" if pred["prediction"] == "Approved" else "Approved"
    )
    hcxai.record_human_decision(
        user_id=current_user["email"],
        prediction_id=prediction_id,
        ai_prediction=pred["prediction"],
        ai_confidence=pred["confidence"],
        human_decision=human_decision,
    )
    db.log_audit_event(
        user_id=current_user["email"], action="review.resolve",
        resource_type="prediction", resource_id=str(prediction_id),
        details={"decision": request.decision},
    )
    return {"status": "resolved"}
```

- [ ] **Step 6: Chạy test, xác nhận pass**

Run: `cd backend && pytest tests/test_review_queue.py -v`

- [ ] **Step 7: Chạy toàn bộ test suite**

Run: `cd backend && pytest -q`

- [ ] **Step 8: Commit**

```bash
git add backend/app/db.py backend/app/schemas.py backend/app/main.py backend/tests/test_review_queue.py backend/tests/conftest.py
git commit -m "feat: add voluntary flag-for-review + review queue list/resolve endpoints"
```

---

### Task 16: Frontend — trang "Hàng chờ duyệt" + sidebar

**Files:**
- Modify: `frontend/src/lib/types.ts`
- Modify: `frontend/src/lib/endpoints.ts`
- Modify: `frontend/src/components/layout/app-sidebar.tsx`
- Create: `frontend/src/app/(app)/review-queue/page.tsx`

**Interfaces:**
- Consumes: `GET /review-queue`, `POST /review-queue/{id}/resolve` (Task 15)

- [ ] **Step 1: Thêm type + hàm API**

Trong `frontend/src/lib/types.ts`:

```typescript
export interface ReviewQueueItem extends PredictionRecord {
  needs_review: number;
  review_reasons: string; // JSON string, parse ở component
  reviewed_by: string | null;
}

export interface ReviewQueueResponse {
  items: ReviewQueueItem[];
  total: number;
}
```

Trong `frontend/src/lib/endpoints.ts`:

```typescript
export async function getReviewQueue(limit = 50, offset = 0): Promise<ReviewQueueResponse> {
  const { data } = await apiClient.get<ReviewQueueResponse>("/review-queue", { params: { limit, offset } });
  return data;
}

export async function resolveReview(
  predictionId: number,
  decision: "confirmed" | "overridden",
  note?: string
): Promise<void> {
  await apiClient.post(`/review-queue/${predictionId}/resolve`, { decision, note });
}

export async function flagPredictionForReview(predictionId: number): Promise<void> {
  await apiClient.post(`/predictions/${predictionId}/flag-for-review`);
}
```

- [ ] **Step 2: Thêm mục sidebar**

Trong `frontend/src/components/layout/app-sidebar.tsx`, thêm vào `NAV_ITEMS` (nhóm "Quản trị", cạnh "Người dùng"/"Nhật ký Kiểm toán"):

```typescript
{
  title: "Hàng chờ duyệt",
  href: "/review-queue",
  icon: ShieldAlert, // thêm import ShieldAlert từ lucide-react nếu chưa có
  roles: ["admin", "risk_manager"],
},
```

- [ ] **Step 3: Viết trang mới**

Tạo `frontend/src/app/(app)/review-queue/page.tsx`:

```tsx
"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ShieldAlert, Eye } from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { getReviewQueue, resolveReview } from "@/lib/endpoints";
import { getApiErrorMessage } from "@/lib/api";

const REASON_LABELS: Record<string, string> = {
  low_confidence: "Độ tin cậy thấp",
  high_loan_amount: "Số tiền vay lớn",
  fairness_group_flag: "Thuộc nhóm vi phạm công bằng",
  self_flagged: "Tự nguyện gắn cờ",
};

export default function ReviewQueuePage() {
  const queryClient = useQueryClient();
  const [noteById, setNoteById] = useState<Record<number, string>>({});

  const { data, isLoading } = useQuery({
    queryKey: ["review-queue"],
    queryFn: () => getReviewQueue(),
  });

  const resolveMutation = useMutation({
    mutationFn: ({ id, decision }: { id: number; decision: "confirmed" | "overridden" }) =>
      resolveReview(id, decision, noteById[id]),
    onSuccess: () => {
      toast.success("Đã duyệt hồ sơ");
      queryClient.invalidateQueries({ queryKey: ["review-queue"] });
    },
    onError: (error) => toast.error(getApiErrorMessage(error, "Duyệt hồ sơ thất bại")),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Hàng chờ duyệt"
        description="Hồ sơ cần con người xem xét trước khi coi là hoàn tất — do độ tin cậy thấp, số tiền vay lớn, thuộc nhóm đang vi phạm công bằng, hoặc được tự nguyện gắn cờ."
      />

      {isLoading ? (
        <Skeleton className="h-64" />
      ) : !data || data.items.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-16 text-center text-muted-foreground">
          <ShieldAlert className="size-8" />
          <p>Không có hồ sơ nào đang chờ duyệt.</p>
        </div>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Mã</TableHead>
                  <TableHead>Khách hàng</TableHead>
                  <TableHead>Quyết định AI</TableHead>
                  <TableHead>Lý do cần duyệt</TableHead>
                  <TableHead>Hành động</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((item) => {
                  const reasons: string[] = JSON.parse(item.review_reasons || "[]");
                  return (
                    <TableRow key={item.id}>
                      <TableCell className="font-medium">#{item.id}</TableCell>
                      <TableCell>{item.applicant_name ?? "—"}</TableCell>
                      <TableCell>
                        <Badge variant={item.prediction === "Approved" ? "default" : "destructive"}>
                          {item.prediction === "Approved" ? "Được duyệt" : "Bị từ chối"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {reasons.map((r) => (
                            <Badge key={r} variant="outline">
                              {REASON_LABELS[r] ?? r}
                            </Badge>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell className="space-x-2">
                        <Button size="sm" variant="outline" render={<Link href={`/applications/${item.id}`} />}>
                          <Eye className="size-4" />
                          Xem
                        </Button>
                        <Button
                          size="sm"
                          disabled={resolveMutation.isPending}
                          onClick={() => resolveMutation.mutate({ id: item.id, decision: "confirmed" })}
                        >
                          Xác nhận
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          disabled={resolveMutation.isPending}
                          onClick={() => resolveMutation.mutate({ id: item.id, decision: "overridden" })}
                        >
                          Ghi đè
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Type-check**

Run: `cd frontend && npx tsc --noEmit`

- [ ] **Step 5: Kiểm tra thủ công** — đăng nhập admin/risk_manager, tạo 1 hồ sơ loan_amount lớn (>ngưỡng) để nó tự vào hàng chờ, vào `/review-queue`, xác nhận hiện đúng badge lý do, bấm "Xác nhận" hoặc "Ghi đè", xác nhận biến mất khỏi danh sách.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/types.ts frontend/src/lib/endpoints.ts frontend/src/components/layout/app-sidebar.tsx frontend/src/app/\(app\)/review-queue/page.tsx
git commit -m "feat: add Review Queue page + sidebar entry for human-in-the-loop resolution"
```

---

### Task 17: Frontend — badge "Cần xem xét" trên Loan Queue + Application Detail + nút tự gắn cờ

**Files:**
- Modify: `frontend/src/lib/types.ts`
- Modify: `frontend/src/app/(app)/applications/page.tsx`
- Modify: `frontend/src/app/(app)/applications/[id]/page.tsx`

- [ ] **Step 1: Mở rộng type**

Trong `frontend/src/lib/types.ts`, thêm vào `PredictionRecord` và `PredictionDetail`:

```typescript
export interface PredictionRecord {
  // ...các field hiện có...
  needs_review?: number;
  review_reasons?: string | null;
  reviewed_by?: string | null;
}
```

- [ ] **Step 2: Badge trên Loan Queue**

Trong `frontend/src/app/(app)/applications/page.tsx`, tìm cột render mỗi hàng (nơi hiện `Badge` cho `prediction`), thêm ngay cạnh:

```tsx
{item.needs_review === 1 && !item.reviewed_by && (
  <Badge variant="outline" className="ml-1 border-warning text-warning">
    Cần xem xét
  </Badge>
)}
```

(Đặt trong cùng `<TableCell>` với badge Quyết định hiện có — kiểm tra file thực tế để xác định đúng vị trí `<TableCell>` chứa `item.prediction`.)

- [ ] **Step 3: Badge + nút tự gắn cờ trên Application Detail**

Trong `frontend/src/app/(app)/applications/[id]/page.tsx`, import `flagPredictionForReview`, thêm state:

```typescript
const flagMutation = useMutation({
  mutationFn: () => flagPredictionForReview(id),
  onSuccess: () => {
    toast.success("Đã đánh dấu hồ sơ cần xem xét thêm");
    queryClient.invalidateQueries({ queryKey: ["prediction", id] });
  },
  onError: (error) => toast.error(getApiErrorMessage(error, "Gắn cờ thất bại")),
});
```

Trong `<PageHeader description={...}>`, thêm badge ngay sau badge "Model {version}" hiện có:

```tsx
{data.needs_review === 1 && !data.reviewed_by && (
  <>
    <span>•</span>
    <Badge variant="outline" className="border-warning text-warning">
      Cần xem xét: {JSON.parse(data.review_reasons || "[]").join(", ")}
    </Badge>
  </>
)}
```

Trong `actions={...}` của `<PageHeader>`, thêm nút bên cạnh "Quay lại":

```tsx
{(!data.needs_review || data.reviewed_by) && (
  <Button variant="ghost" size="sm" onClick={() => flagMutation.mutate()} disabled={flagMutation.isPending}>
    Đánh dấu cần xem xét
  </Button>
)}
```

- [ ] **Step 4: Type-check**

Run: `cd frontend && npx tsc --noEmit`

- [ ] **Step 5: Kiểm tra thủ công** — mở một hồ sơ rõ ràng (không tự động bị flag), bấm "Đánh dấu cần xem xét", xác nhận badge xuất hiện và hồ sơ lên `/review-queue`.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/types.ts frontend/src/app/\(app\)/applications/page.tsx frontend/src/app/\(app\)/applications/\[id\]/page.tsx
git commit -m "feat: show review-needed badges on Loan Queue/Application Detail + voluntary flag button"
```

---

## Phần B — Chat hỏi-đáp theo ngữ cảnh giải thích

### Task 18: Backend — endpoint chat hỏi-đáp

**Files:**
- Modify: `backend/app/deepseek_client.py`
- Modify: `backend/app/schemas.py`
- Modify: `backend/app/main.py`
- Test: `backend/tests/test_deepseek_client.py`, `backend/tests/test_review_queue.py` (hoặc file mới)

**Interfaces:**
- Produces: `answer_question_about_prediction(prediction: dict, shap_result: dict, narrative: str, question: str) -> dict`; `POST /predictions/{id}/ask`

- [ ] **Step 1: Viết test thất bại**

Thêm vào `backend/tests/test_deepseek_client.py`:

```python
from app.deepseek_client import answer_question_about_prediction


def test_answer_question_falls_back_without_api_key(monkeypatch):
    monkeypatch.setattr("app.deepseek_client.settings.DEEPSEEK_API_KEY", None)
    result = answer_question_about_prediction(
        prediction=FAKE_PREDICTION,
        shap_result=FAKE_SHAP_RESULT,
        narrative="Hồ sơ được duyệt vì điểm CIBIL tốt.",
        question="Vì sao thu nhập không giúp nhiều hơn?",
    )
    assert result["model"] == "template-fallback"
```

- [ ] **Step 2: Chạy test, xác nhận fail**

Run: `cd backend && pytest tests/test_deepseek_client.py -v -k answer_question`
Expected: FAIL — `ImportError`

- [ ] **Step 3: Cài đặt hàm trong `deepseek_client.py`**

```python
def answer_question_about_prediction(
    prediction: dict,
    shap_result: dict,
    narrative: str,
    question: str,
) -> dict:
    """
    Chat hỏi-đáp theo ngữ cảnh: LLM CHỈ được trả lời dựa trên dữ liệu của
    chính hồ sơ này (prediction/shap/narrative đã lưu) -- không tự suy đoán
    thông tin ngoài phạm vi. Stateless theo từng câu hỏi (không lưu lịch sử
    hội thoại phía server).
    """
    client = _get_client()
    if client is None:
        return {
            "answer": "Chưa thể trả lời bằng AI lúc này (dịch vụ LLM không khả dụng). Vui lòng xem lại phần SHAP/narrative ở trên.",
            "model": "template-fallback",
        }

    contributions_text = "\n".join(
        f"- {c['display_name']}: value={c['value']}, shap={c['shap_contribution']:.3f}, direction={c['direction']}"
        for c in shap_result["contributions"]
    )
    system_prompt = (
        "Bạn là trợ lý trả lời câu hỏi về MỘT hồ sơ vay cụ thể, CHỈ dựa trên dữ liệu SHAP/"
        "narrative được cung cấp dưới đây. KHÔNG tự suy đoán thông tin không có trong dữ "
        "liệu, KHÔNG đưa ra quyết định hay khuyến nghị nghiệp vụ mới ngoài việc giải thích "
        "số liệu đã có. " + _VI_INSTRUCTION
    )
    user_prompt = (
        f"Kết quả: {prediction['prediction']} (xác suất {prediction['approval_probability']:.2%})\n"
        f"Narrative đã sinh trước đó: {narrative}\n"
        f"Toàn bộ yếu tố SHAP:\n{contributions_text}\n\n"
        f"Câu hỏi của nhân viên: {question}\n\n"
        "Trả lời trong tối đa 100 từ, chỉ dựa trên số liệu trên."
    )

    try:
        response = client.chat.completions.create(
            model=settings.DEEPSEEK_MODEL,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            max_tokens=250,
            temperature=settings.DEEPSEEK_TEMPERATURE,
            timeout=settings.DEEPSEEK_TIMEOUT_SECONDS,
        )
        return {"answer": response.choices[0].message.content.strip(), "model": settings.DEEPSEEK_MODEL}
    except (APIError, APITimeoutError) as exc:
        logger.warning("DeepSeek ask call failed (%s); using template fallback", exc.__class__.__name__)
        return {
            "answer": "Chưa thể trả lời bằng AI lúc này (dịch vụ LLM không khả dụng). Vui lòng xem lại phần SHAP/narrative ở trên.",
            "model": "template-fallback",
        }
```

- [ ] **Step 4: Chạy test, xác nhận pass**

Run: `cd backend && pytest tests/test_deepseek_client.py -v`

- [ ] **Step 5: Thêm schema + endpoint**

Trong `backend/app/schemas.py`:

```python
class AskPredictionRequest(BaseModel):
    question: str = Field(min_length=1, max_length=500)
```

Trong `backend/app/main.py`, thêm import `answer_question_about_prediction` và route mới sau `@app.get("/predictions/{prediction_id}")`:

```python
@app.post("/predictions/{prediction_id}/ask")
def ask_about_prediction(
    prediction_id: int,
    request: AskPredictionRequest,
    current_user: dict = Depends(auth.require_authenticated),
):
    pred = db.get_prediction(prediction_id)
    if pred is None:
        raise HTTPException(status_code=404, detail=f"Prediction {prediction_id} not found")

    shap_result = json.loads(pred["shap_json"])
    prediction_dict = {
        "prediction": pred["prediction"],
        "approval_probability": pred["approval_probability"],
        "risk_score": pred["risk_score"],
        "confidence": pred["confidence"],
    }
    result = answer_question_about_prediction(
        prediction=prediction_dict,
        shap_result=shap_result,
        narrative=pred["narrative"] or "",
        question=request.question,
    )
    db.log_audit_event(
        user_id=current_user["email"], action="prediction.ask",
        resource_type="prediction", resource_id=str(prediction_id),
    )
    return result
```

(Cần `import json` ở đầu `main.py` nếu chưa có ở phạm vi module — kiểm tra: `grep -n "^import json" backend/app/main.py`; nếu chưa, thêm.)

- [ ] **Step 6: Chạy toàn bộ test suite**

Run: `cd backend && pytest -q`

- [ ] **Step 7: Commit**

```bash
git add backend/app/deepseek_client.py backend/app/schemas.py backend/app/main.py backend/tests/test_deepseek_client.py
git commit -m "feat: add context-aware chat Q&A endpoint for a single prediction"
```

---

### Task 19: Frontend — ô chat trên Application Detail

**Files:**
- Modify: `frontend/src/lib/endpoints.ts`
- Modify: `frontend/src/app/(app)/applications/[id]/page.tsx`

- [ ] **Step 1: Thêm hàm API**

Trong `frontend/src/lib/endpoints.ts`:

```typescript
export async function askAboutPrediction(predictionId: number, question: string): Promise<{ answer: string; model: string }> {
  const { data } = await apiClient.post<{ answer: string; model: string }>(
    `/predictions/${predictionId}/ask`,
    { question }
  );
  return data;
}
```

- [ ] **Step 2: Thêm UI chat**

Trong `frontend/src/app/(app)/applications/[id]/page.tsx`, thêm state + mutation:

```typescript
const [question, setQuestion] = useState("");
const [chatHistory, setChatHistory] = useState<{ question: string; answer: string }[]>([]);

const askMutation = useMutation({
  mutationFn: (q: string) => askAboutPrediction(id, q),
  onSuccess: (result, q) => {
    setChatHistory((prev) => [...prev, { question: q, answer: result.answer }]);
    setQuestion("");
  },
  onError: (error) => toast.error(getApiErrorMessage(error, "Không thể trả lời câu hỏi")),
});
```

Thêm 1 `<Card>` mới ngay sau Collapsible "Công cụ phân tích chuyên sâu" (trước Card "Phê duyệt hồ sơ"):

```tsx
<Card>
  <CardHeader>
    <CardTitle className="flex items-center gap-2 text-base">
      <MessageSquare className="size-4 text-primary" />
      Hỏi thêm về giải thích này
    </CardTitle>
    <CardDescription>
      Câu trả lời chỉ dựa trên dữ liệu SHAP/narrative của chính hồ sơ này — không suy đoán ngoài phạm vi.
    </CardDescription>
  </CardHeader>
  <CardContent className="space-y-3">
    {chatHistory.map((entry, i) => (
      <div key={i} className="space-y-1">
        <p className="text-sm font-medium">Bạn: {entry.question}</p>
        <p className="text-sm text-muted-foreground">AI: {entry.answer}</p>
      </div>
    ))}
    <div className="flex gap-2">
      <Input
        placeholder="Vì sao thu nhập không giúp nhiều hơn?"
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && question.trim()) askMutation.mutate(question.trim());
        }}
      />
      <Button
        disabled={!question.trim() || askMutation.isPending}
        onClick={() => askMutation.mutate(question.trim())}
      >
        {askMutation.isPending ? "Đang trả lời..." : "Hỏi"}
      </Button>
    </div>
  </CardContent>
</Card>
```

- [ ] **Step 3: Type-check**

Run: `cd frontend && npx tsc --noEmit`

- [ ] **Step 4: Kiểm tra thủ công** — mở 1 hồ sơ, gõ câu hỏi, bấm "Hỏi" hoặc Enter, xác nhận có câu trả lời (hoặc câu fallback) hiện ra, lặp lại 2-3 câu để xác nhận transcript giữ lại đúng thứ tự.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/endpoints.ts frontend/src/app/\(app\)/applications/\[id\]/page.tsx
git commit -m "feat: add context-aware chat Q&A UI on Application Detail"
```

---

## Self-Review Checklist (đã tự rà soát khi viết plan này)

- **Spec coverage**: Phần A (Task 1-3), Phần B.1 LLM-dịch (Task 4-11), Phần B.3 Human-in-the-loop (Task 12-17), Phần B.2 Chat (Task 18-19) — khớp đủ 4 nhánh trong mục 9 của spec.
- **Placeholder scan**: không còn "TBD"/"implement later" — mọi step đều có code cụ thể.
- **Type consistency**: `InterpretResult { narrative, model }` dùng nhất quán xuyên suốt Task 4-11 (backend trả `{"narrative", "model"}`, frontend type khớp tên field). `needs_review`/`review_reasons`/`reviewed_by` dùng nhất quán từ Task 12 đến Task 17.
- Task 12 (migration) phải chạy TRƯỚC Task 14 (dùng cột mới) — thứ tự trong plan đã đúng.
- Task 13 (fairness cache) phải chạy TRƯỚC Task 14 (gọi `fairness.is_group_flagged`) — thứ tự đã đúng.

## Sau khi hoàn tất toàn bộ

Chạy lại toàn bộ để xác nhận không có regression trước khi coi là xong:

```bash
cd backend && pytest -q
cd frontend && npx tsc --noEmit && npm run build
```

Sau đó verify thủ công qua trình duyệt (Playwright hoặc thao tác tay) toàn bộ luồng: train model mới với thuật toán khác XGBoost → nộp hồ sơ → bấm từng nút "Diễn giải bằng AI" → tạo hồ sơ rơi vào hàng chờ duyệt → duyệt xong → thử chat hỏi đáp.
