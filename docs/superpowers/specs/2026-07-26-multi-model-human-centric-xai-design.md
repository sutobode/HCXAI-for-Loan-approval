# Thiết kế: Đa dạng hóa Model + Human-Centric XAI mở rộng (LLM là lớp dịch)

Ngày: 2026-07-26
Trạng thái: Đã duyệt bởi người dùng, chờ viết implementation plan

## 1. Mục tiêu

Hai phần độc lập nhưng liên quan, triển khai tuần tự trong cùng một đợt:

- **(A) Đa dạng hóa Model**: cho phép train model bằng nhiều thuật toán dạng cây
  khác nhau (không chỉ XGBoost), để XAI/HCXAI có thể áp dụng trên nhiều model.
- **(B) Human-Centric XAI mở rộng** (trọng tâm chính): mở rộng lớp "dịch sang
  ngôn ngữ tự nhiên" (đã có cho SHAP narrative) sang mọi output kỹ thuật khác
  của XAI (LIME, Counterfactual, Explanation Quality, Fairness, Monitoring,
  Trust Dashboard), cộng thêm cơ chế Human-in-the-loop bắt buộc cho các hồ sơ
  rủi ro cao.

## 2. Nguyên tắc thiết kế / Non-goals (quan trọng, đã thống nhất qua thảo luận)

- **LLM KHÔNG phải một tác nhân ra quyết định độc lập.** LLM chỉ nhận input đã
  tính toán sẵn (SHAP values, LIME fidelity, parity ratio, drift stats...) và
  dịch sang văn xuôi tiếng Việt dễ hiểu cho nghiệp vụ — không tự suy luận,
  không tự "đồng ý/không đồng ý" với model. Đây là sự khác biệt cốt lõi so với
  ý tưởng ban đầu ("LLM ý kiến thứ 2") đã bị loại bỏ khỏi phạm vi.
- Mọi lời gọi LLM mới đều **on-demand** (nút "Diễn giải bằng AI"), không tự
  động chạy nền, để tránh tốn chi phí/độ trễ không cần thiết — nhất quán với
  phát hiện trước đó rằng DeepSeek API có thể timeout ~60-70s trong môi trường
  hiện tại. Mọi lời gọi LLM mới đều tái sử dụng đúng pattern resilient đã có:
  timeout ngắn, fallback về template tiếng Việt cố định nếu LLM lỗi/timeout.
- LightGBM/CatBoost là "best-effort": nếu Windows Smart App Control (hoặc môi
  trường tương tự) chặn file biên dịch của các thư viện này, hệ thống phải
  **tự động ẩn** lựa chọn đó khỏi UI thay vì crash — không có cách "giả lập"
  như đã làm với `numba` (numba là phụ trợ không dùng tới; LightGBM/CatBoost
  là chính bộ máy tính toán, không thể thay thế bằng stub).
- Các ngưỡng nghiệp vụ cho Human-in-the-loop (độ tin cậy, số tiền vay) là cấu
  hình qua biến môi trường (`config.py`), không hardcode — vì đây là quyết
  định nghiệp vụ, không phải hằng số kỹ thuật.

## 3. Phần A — Đa dạng hóa Model

### 3.1 Model factory

Thêm dict ánh xạ thuật toán → (constructor, default hyperparameters) trong
`backend/app/model_registry.py`:

```python
MODEL_FACTORIES: dict[str, tuple[type, dict]] = {
    "xgboost": (XGBClassifier, DEFAULT_XGB_HYPERPARAMETERS),          # đã có
    "random_forest": (RandomForestClassifier, DEFAULT_RF_HYPERPARAMETERS),
    "gradient_boosting": (GradientBoostingClassifier, DEFAULT_GB_HYPERPARAMETERS),
    "extra_trees": (ExtraTreesClassifier, DEFAULT_ET_HYPERPARAMETERS),
}
# LightGBM / CatBoost: đăng ký có điều kiện bằng try/except import;
# nếu import lỗi (bị chặn hoặc chưa cài), không thêm vào dict, log warning,
# và endpoint /model/train/algorithms trả về danh sách KHÔNG có chúng.
```

- `train_new_version()` nhận thêm `algorithm: str = "xgboost"` — mặc định giữ
  nguyên hành vi cũ.
- Cột `algorithm` trong bảng `model_versions` **đã tồn tại sẵn** — không cần
  migration.
- Người dùng **không** tự chỉnh hyperparameter qua UI — chỉ chọn thuật toán,
  dùng bộ mặc định hợp lý cho từng loại (đã chốt qua thảo luận).

### 3.2 XAI/HCXAI — không cần sửa

`explainer.py` dùng `shap.TreeExplainer(self.model)`, hoạt động nguyên vẹn với
mọi model dạng cây (sklearn/XGBoost/LightGBM/CatBoost). `lime_explainer.py`,
`counterfactual.py`, `explanation_quality.py`, `global_explainability.py`, và
toàn bộ `hcxai.py` chỉ thao tác trên `shap_result` dict trung lập hoặc gọi
`explainer.model.predict_proba(...)` — không phụ thuộc loại model gốc. **Không
cần sửa các module này.**

`compare_versions()` (Champion-Challenger) đã hoạt động cross-algorithm sẵn vì
chỉ so sánh dict `metrics`.

### 3.3 API/Frontend

- `GET /model/train/algorithms` (mới) — trả về danh sách thuật toán khả dụng
  hiện tại (đã lọc bỏ LightGBM/CatBoost nếu import lỗi).
- `TrainModelRequest` (schemas.py) thêm field `algorithm: str = "xgboost"`.
- Trang **AI Model Center**: thêm dropdown "Thuật toán" trong dialog train
  model mới, load option từ endpoint trên.
- Bảng danh sách version: cột `Algorithm` đã hiện sẵn (`v.algorithm`), không
  cần sửa.

## 4. Phần B — Human-Centric XAI mở rộng (trọng tâm)

### 4.1 LLM như lớp dịch cho mọi output XAI

Áp dụng lại đúng pattern của `generate_narrative_explanation` /
`build_template_explanation` (gọi DeepSeek, timeout ngắn, fallback template
tiếng Việt cố định) cho các chỗ hiện đang chỉ hiện số liệu kỹ thuật:

| Nguồn dữ liệu | Endpoint mới (on-demand) | Input gửi LLM |
|---|---|---|
| LIME | `POST /explain/lime/interpret` | `fidelity_r2`, top contributions |
| Explanation Quality | `POST /explain/quality/interpret` | stability/completeness/sparsity + composite |
| Counterfactual | `POST /explain/counterfactual/interpret` | danh sách `changes` + `resulting_probability` |
| Fairness Report | `POST /fairness/interpret` | `by_attribute` (parity ratio, model_vs_label_delta) |
| Monitoring | `POST /monitoring/interpret` | `drift_report`, `prediction_drift` |
| Trust Dashboard | `GET /trust/{user_id}/interpret` | profile, calibration, trend |
| Override Analysis | `GET /hcxai/override-analysis/interpret` | by_confidence, direction stats |
| Fairness mitigation | mở rộng `generate_mitigation_recommendations` với field `llm_detailed_writeup` (tính khi FE gọi kèm query `?elaborate=true`) | recommendation dict hiện có |

Mỗi endpoint: nhận dữ liệu đã tính sẵn (không tính lại từ đầu), gọi 1 hàm mới
trong `deepseek_client.py` (vd `interpret_lime_result(...)`,
`interpret_fairness_report(...)`) theo đúng khuôn `generate_narrative_explanation`,
trả về `{"narrative": str, "narrative_model": "deepseek"|"template-fallback"}`.

Frontend: mỗi trang/khối tương ứng thêm 1 nút **"Diễn giải bằng AI"** — bấm
mới gọi, không tự động, hiện kết quả ngay dưới số liệu kỹ thuật hiện có
(không thay thế, chỉ bổ sung).

### 4.2 Chat hỏi-đáp theo ngữ cảnh giải thích

- `POST /predictions/{id}/ask` — body `{question: str}`. Backend lấy lại
  `shap_result`, `narrative`, `application` đã lưu của prediction đó từ DB,
  ghép vào prompt cùng câu hỏi, gọi DeepSeek, trả lời ngắn gọn bằng tiếng
  Việt. Stateless theo từng câu hỏi (không lưu lịch sử hội thoại phía server;
  frontend giữ transcript hiển thị tại chỗ, mất khi rời trang — đơn giản, đủ
  dùng, tránh phải thiết kế thêm bảng lưu hội thoại).
- Frontend: ô chat nhỏ trên Application Detail, dưới phần "Xem chi tiết kỹ
  thuật", chỉ hiện khi đã có prediction.
- Vẫn đúng nguyên tắc "LLM = lớp dịch": prompt bắt buộc chỉ dựa trên dữ liệu
  đã có của hồ sơ đó, không cho LLM tự suy đoán ngoài phạm vi dữ liệu.

### 4.3 Human-in-the-loop: Hàng chờ duyệt bắt buộc

**Cấu hình** (`backend/app/config.py`, đọc từ `.env`):
```
REVIEW_CONFIDENCE_THRESHOLD=0.75
REVIEW_LOAN_AMOUNT_THRESHOLD=30000000
```

**Dữ liệu** — thêm cột vào bảng `predictions` qua lightweight migration
(`db._run_lightweight_migrations`, pattern đã có sẵn trong `db.py`):
- `needs_review INTEGER NOT NULL DEFAULT 0`
- `review_reasons TEXT` (JSON list: `"low_confidence"`, `"high_loan_amount"`,
  `"fairness_group_flag"`, `"self_flagged"`)
- `reviewed_by TEXT`
- `reviewed_at TEXT`
- `review_decision TEXT` (`"confirmed"` | `"overridden"`)
- `review_note TEXT`

**Logic trigger** (chạy trong `/explain`, ngay sau khi có prediction):
1. `confidence < REVIEW_CONFIDENCE_THRESHOLD` → `low_confidence`
2. `loan_amount > REVIEW_LOAN_AMOUNT_THRESHOLD` → `high_loan_amount`
   (làm rõ phạm vi: lựa chọn "số tiền vay lớn / rủi ro cao" được gộp thành
   một tín hiệu duy nhất — số tiền vay. `risk_score` cao tự thân không phải
   tín hiệu độc lập hữu ích ở đây vì nó chỉ là `1 - approval_probability`,
   tức đã được phản ánh gián tiếp qua `low_confidence`/quyết định Rejected;
   nếu sau này nghiệp vụ muốn tách riêng ngưỡng `risk_score`, có thể thêm
   `REVIEW_RISK_SCORE_THRESHOLD` cùng cơ chế mà không đổi kiến trúc.)
3. Nhóm nhân khẩu học (education/self_employed) của applicant đang bị
   Fairness Report gắn cờ vi phạm Four-Fifths Rule → `fairness_group_flag`
   (dùng fairness report **cache sẵn**, làm mới khi model được activate lại
   — không tính lại từ đầu mỗi lần `/explain`, tránh làm chậm mọi lượt nộp
   hồ sơ).

Nếu khớp ≥1 điều kiện → `needs_review=true`, lưu list lý do.

**Tự nguyện gắn cờ**: `POST /predictions/{id}/flag-for-review` — bất kỳ user
nào đã tương tác với hồ sơ đó đều gắn được cờ `self_flagged`.

**Duyệt**: `GET /review-queue` (admin/risk_manager) — danh sách hồ sơ
`needs_review=true` và `reviewed_by IS NULL`. `POST
/review-queue/{prediction_id}/resolve` — body `{decision, note}`, ghi
`reviewed_by/reviewed_at/review_decision/review_note`, đồng thời gọi
`hcxai.record_human_decision(user_id=current_user.email, ...)` để quyết định
của người duyệt cũng nuôi Trust Calibrator/User Modeler của chính họ.

**Frontend**:
- Sidebar mới: "Hàng chờ duyệt" (admin/risk_manager), badge số lượng đang chờ.
- Trang Hàng chờ duyệt: bảng hồ sơ + badge lý do + nút "Xem & Duyệt".
- Application Detail: badge "Cần xem xét: <lý do>" nếu chưa duyệt; nút "Đánh
  dấu cần xem xét" cho tự nguyện; khối duyệt (chọn Xác nhận/Ghi đè + ghi chú)
  hiện khi role phù hợp và hồ sơ đang chờ.
- Loan Queue: thêm cột/badge trạng thái cần xem xét.

## 5. Tổng hợp thay đổi dữ liệu

- `model_versions.algorithm` — đã có, không đổi.
- `predictions` — thêm 6 cột review-related (mục 4.3), migration nhẹ.

## 6. Tổng hợp API mới/đổi

- `GET /model/train/algorithms`
- `POST /model/train` — thêm field `algorithm`
- `POST /explain/lime/interpret`
- `POST /explain/quality/interpret`
- `POST /explain/counterfactual/interpret`
- `POST /fairness/interpret`
- `POST /monitoring/interpret`
- `GET /trust/{user_id}/interpret`
- `GET /hcxai/override-analysis/interpret`
- `GET /fairness/mitigation-recommendations?elaborate=true` (mở rộng field)
- `POST /predictions/{id}/ask`
- `POST /predictions/{id}/flag-for-review`
- `GET /review-queue`
- `POST /review-queue/{prediction_id}/resolve`

## 7. Rủi ro & giảm thiểu

| Rủi ro | Giảm thiểu |
|---|---|
| LightGBM/CatBoost bị Smart App Control chặn (giống sự cố numba trước đó) | try/except import, tự ẩn khỏi UI nếu lỗi, không crash toàn backend |
| Thêm nhiều endpoint gọi DeepSeek → tăng rủi ro timeout mạng | Mọi endpoint mới đều on-demand (không tự động), timeout ngắn + fallback template giống pattern hiện có |
| Tính fairness-group-flag mỗi lần `/explain` làm chậm submit | Dùng fairness report cache, làm mới khi activate model mới, không tính lại mỗi request |
| Ngưỡng review cứng không phù hợp thực tế nghiệp vụ | Đưa vào `.env`, nghiệp vụ tự chỉnh không cần sửa code |

## 8. Ngoài phạm vi (Non-goals)

- LLM không đóng vai trò ra quyết định/second-opinion độc lập.
- Không cho chỉnh hyperparameter qua UI ở giai đoạn này.
- Không lưu lịch sử hội thoại chat phía server (stateless theo câu hỏi).
- Không tự động escalate liên tục — chỉ trigger 1 lần tại thời điểm `/explain`.

## 9. Gợi ý thứ tự triển khai (cho bước lập plan)

1. Phần A (đa dạng hóa model) — nền tảng độc lập, rủi ro thấp, làm trước.
2. Phần B.1 (LLM-dịch cho LIME/Quality/Counterfactual/Fairness/Monitoring/Trust) —
   giá trị cao, rủi ro thấp (chỉ thêm, không sửa hành vi cũ).
3. Phần B.3 (Human-in-the-loop Review Queue) — cần B.1 xong trước (dùng
   chung fairness cache) nhưng độc lập về mặt chức năng.
4. Phần B.2 (Chat hỏi-đáp) — làm sau cùng, ít phụ thuộc các phần trên nhất
   nhưng cần UI mới (chat box) nhiều công sức hơn.
