# TÀI LIỆU HỆ THỐNG HCXAI - Phê duyệt Khoản vay Thông minh

## Mục lục

1. [Tổng quan hệ thống](#1-tổng-quan-hệ-thống)
2. [Kiến trúc hệ thống](#2-kiến-trúc-hệ-thống)
3. [Luồng nghiệp vụ chính](#3-luồng-nghiệp-vụ-chính)
4. [Luồng XAI (Giải thích AI)](#4-luồng-xai-giải-thích-ai)
5. [Luồng HCXAI (AI Lấy con người làm trung tâm)](#5-luồng-hcxai)
6. [Mô hình AI](#6-mô-hình-ai)
7. [Hướng dẫn cài đặt](#7-hướng-dẫn-cài-đặt)
8. [Hướng dẫn demo từng bước](#8-hướng-dẫn-demo-từng-bước)
9. [Danh sách API](#9-danh-sách-api)
10. [Cấu trúc thư mục](#10-cấu-trúc-thư-mục)

---

## 1. Tổng quan hệ thống

### Mục tiêu
Xây dựng nền tảng **Human-Centered Explainable AI (HCXAI)** cho phê duyệt khoản vay, nơi:
- AI đưa ra quyết định duyệt/từ chối khoản vay
- Mỗi quyết định đi kèm **giải thích minh bạch** (tại sao duyệt/từ chối)
- Con người (loan officer) **xem xét, đồng ý hoặc ghi đè** quyết định AI
- Hệ thống **học từ phản hồi** của con người để cải thiện cách giải thích

### Triết lý thiết kế
- **Human-in-the-loop**: Con người luôn là người ra quyết định cuối cùng
- **Transparency**: Mọi quyết định AI đều có giải thích rõ ràng
- **Adaptive**: Giải thích tự điều chỉnh theo trình độ và xu hướng người dùng
- **Auditable**: Mọi hành động đều được ghi log, có thể kiểm toán

### Đối tượng sử dụng
| Vai trò | Quyền hạn | Mô tả |
|---------|-----------|-------|
| admin | Toàn quyền | Quản trị hệ thống, train model, xem audit |
| risk_manager | Xem fairness, monitoring, override analysis | Quản lý rủi ro |
| loan_officer | Chấm điểm, feedback, what-if | Chuyên viên tín dụng — người dùng chính |
| customer | Xem giải thích của mình | Khách hàng |

---

## 2. Kiến trúc hệ thống

```
┌─────────────────────────────────────────────────────────────────┐
│                        FRONTEND (Next.js 15)                     │
│  React + TypeScript + Tailwind + shadcn/ui + ECharts            │
│  Port: 3000                                                      │
└─────────────────────────┬───────────────────────────────────────┘
                          │ REST API (JSON) + JWT Bearer Auth
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│                        BACKEND (FastAPI + Python)                 │
│  Port: 8000                                                      │
│                                                                   │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────────┐   │
│  │ Auth/RBAC│ │ Predict  │ │ Explain  │ │ HCXAI Engine     │   │
│  │ (JWT)    │ │ (XGBoost)│ │ (SHAP)   │ │ (Trust/User/Rec) │   │
│  └──────────┘ └──────────┘ └──────────┘ └──────────────────┘   │
│                                                                   │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────────┐   │
│  │ LIME     │ │Counter-  │ │ Fairness │ │ Model Registry   │   │
│  │          │ │factual   │ │          │ │ + Monitoring     │   │
│  └──────────┘ └──────────┘ └──────────┘ └──────────────────┘   │
│                                                                   │
│  ┌──────────┐ ┌──────────┐ ┌──────────────────────────────────┐ │
│  │ Similar  │ │ What-If  │ │ DeepSeek LLM (narrative)         │ │
│  │ Cases    │ │ Lab      │ │ (external API, optional)         │ │
│  └──────────┘ └──────────┘ └──────────────────────────────────┘ │
└─────────────────────────┬───────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│                     DATA LAYER                                    │
│  SQLite (hcxai.db) — applicants, applications, predictions,      │
│  feedback, trust_events, user_profiles, model_versions,          │
│  audit_log, prediction_snapshots                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Công nghệ sử dụng
| Layer | Công nghệ |
|-------|-----------|
| Frontend | Next.js 15, React 19, TypeScript, Tailwind CSS, shadcn/ui, TanStack Query, ECharts, Framer Motion |
| Backend | Python 3.11, FastAPI, Pydantic, JWT (PyJWT + bcrypt) |
| AI/ML | XGBoost, SHAP (TreeExplainer), scikit-learn (k-NN, StandardScaler) |
| XAI | SHAP, LIME (tự implement), Counterfactual (tự implement), Explanation Quality |
| LLM | DeepSeek API (tạo narrative tiếng Việt từ SHAP values) |
| Database | SQLite (zero-config, single file) |
| Deployment | Conda environment (hcxai), localhost |

---

## 3. Luồng nghiệp vụ chính

### Luồng 1: Chấm điểm khách hàng (Happy Path)

```
Loan Officer đăng nhập
       │
       ▼
  Dashboard (thấy "28 chờ chấm")
       │
       ▼
  Bấm "Khách hàng" (Loan Queue)
       │
       ▼
  Chọn khách hàng "Chờ chấm"
       │ (click vào card)
       ▼
  Trang "Chấm điểm: Nguyễn Văn A"
  (form đã được điền sẵn từ hồ sơ)
       │
       ▼
  Bấm "Nhận quyết định & giải thích từ AI"
       │
       ▼
  ┌─────────────────────────────────┐
  │ Backend xử lý:                  │
  │ 1. Encode features              │
  │ 2. XGBoost predict              │
  │ 3. SHAP TreeExplainer           │
  │ 4. Recommendation Engine        │
  │ 5. DeepSeek generate narrative  │
  │ 6. Lưu vào SQLite               │
  └─────────────────────────────────┘
       │
       ▼
  Hiển thị kết quả:
  - Badge "Được duyệt" / "Bị từ chối"
  - Mức tin cậy + giải thích (tại sao ≥90%/≥70%/<70%)
  - Risk Gauge (đồng hồ đo rủi ro)
  - Narrative bằng tiếng Việt (DeepSeek)
  - [Ẩn] SHAP chart + Explanation Recommendation Engine rationale
       │
       ▼
  Loan Officer đọc giải thích → quyết định:
  ├── "Đồng ý với AI" → ghi feedback approve
  └── "Ghi đè quyết định" → ghi feedback override
       │
       ▼
  Panel "Đã ghi nhận phản hồi!"
  ├── Nút "Về Khách hàng" → quay lại Loan Queue
  └── Nút "Chấm hồ sơ tiếp" → reset form
```

### Luồng 2: Xem lại hồ sơ đã chấm

```
Loan Queue → Click khách hàng có badge "Duyệt"/"Từ chối"
       │
       ▼
  Trang chi tiết: /applications/{id}
  - Quyết định + Risk Gauge
  - Narrative AI
  - SHAP chart (giải thích từng yếu tố)
  - [Mở rộng] LIME / Counterfactual / Explanation Quality
  - Panel phê duyệt (có thể ghi đè lại + ghi chú + trust rating 1-5 sao)
  - Lịch sử phản hồi trước đó
```

### Luồng 3: Phân tích What-If

```
Loan Officer muốn kiểm tra "nếu thu nhập tăng 20% thì sao?"
       │
       ▼
  Sidebar → "Giả định (What-If)"
  (có thể đi từ Loan Queue với ?applicant_id= → form tự điền)
       │
       ▼
  Chọn yếu tố cần thay đổi + giá trị mới → "Chạy so sánh"
       │
       ▼
  Hiển thị: Gốc (Từ chối 30%) → Sau thay đổi (Duyệt 65%) → "Quyết định ĐÃ thay đổi!"
```

---

## 4. Luồng XAI (Giải thích AI)

### 4.1 SHAP — Giải thích cục bộ (Local Explanation)

```
Input: 1 hồ sơ vay (11 features)
       │
       ▼
  shap.TreeExplainer(XGBoost model)
       │
       ▼
Output: Per-feature SHAP values (log-odds contribution)
  - Ví dụ: cibil_score = -4.387 (giảm mạnh khả năng duyệt)
  - Sắp xếp theo |magnitude| giảm dần
  - Hiển thị: bar chart ngang, xanh = tăng duyệt, đỏ = giảm duyệt
```

**Tại sao dùng TreeExplainer**: Cho SHAP values CHÍNH XÁC (exact Shapley values) trên tree models, không phải approximation. Đây là tiêu chuẩn vàng cho XGBoost.

### 4.2 LIME — Cross-check độc lập

```
Input: 1 hồ sơ vay
       │
       ▼
  1. Sinh 2000 mẫu nhiễu (Gaussian noise × feature_std)
  2. Tính proximity weight (exponential kernel)
  3. Query XGBoost predict_proba trên 2000 mẫu
  4. Fit weighted ridge regression (local linear surrogate)
       │
       ▼
Output:
  - LIME weights (mức ảnh hưởng cục bộ mỗi feature)
  - Fidelity R² (surrogate fit quality)
  - Nếu LIME đồng ý với SHAP → giải thích đáng tin hơn
```

**Tại sao tự implement**: Package `lime` trên PyPI unmaintained từ 2020, kéo theo scikit-image/matplotlib không cần thiết.

### 4.3 Counterfactual — "Cần thay đổi gì?"

```
Input: 1 hồ sơ bị từ chối
       │
       ▼
  Greedy coordinate search (DiCE-inspired):
  - 4 restarts × 12 iterations
  - Chỉ thay đổi features THỰC TẾ (income, cibil, loan_amount, assets)
  - KHÔNG đề xuất đổi education/dependents (phi đạo đức)
  - Step size giảm dần (coarse-to-fine)
       │
       ▼
Output: Top 3 counterfactuals đa dạng nhất
  Ví dụ: "Nếu cibil_score tăng từ 417 → 628 VÀ loan_amount giảm từ 12.2M → 8M
           → Kết quả: Được duyệt (72%)"
```

### 4.4 Global Explainability — "Mô hình hoạt động chung thế nào?"

```
  Sample 500 hồ sơ từ dataset
       │
       ▼
  Tính mean |SHAP| + mean signed SHAP per feature
       │
       ▼
Output: Xếp hạng feature importance toàn cục
  - cibil_score: 45% (giảm duyệt trung bình)
  - income_annum: 22% (tăng duyệt trung bình)
  - loan_amount: 15% (giảm duyệt trung bình)
  ...
```

### 4.5 Explanation Quality — "Giải thích có đáng tin không?"

| Metric | Đo gì | Cách tính |
|--------|--------|-----------|
| **Stability** | SHAP ranking có ổn định dưới nhiễu nhỏ? | Spearman correlation giữa ranking gốc vs 8 perturbations (±3%) |
| **Completeness** | SHAP values cộng lại đúng = model output? | base_value + sum(contributions) == raw log-odds output |
| **Sparsity** | Giải thích có gọn (ít yếu tố chính)? | Top-3 features chiếm bao nhiêu % tổng |magnitude| |

### 4.6 Similar Cases — "Lịch sử cho thấy gì?"

```
Input: 1 hồ sơ vay
       │
       ▼
  StandardScaler normalize → k-NN (Euclidean distance) trên 4269 hồ sơ training
       │
       ▼
Output: 5-8 hồ sơ tương tự nhất + kết quả thực tế của họ
  - Similarity score, outcome (Approved/Rejected)
  - Tỷ lệ duyệt trong nhóm tương tự
```

---

## 5. Luồng HCXAI (AI Lấy con người làm trung tâm)

Đây là **đóng góp nghiên cứu chính** (novelty) của hệ thống. Tất cả dùng **heuristic rules đơn giản, kiểm toán được** — không phải meta-model black-box.

### 5.1 Vòng lặp HCXAI (Closed Loop)

```
┌─── Lần chấm thứ N ────────────────────────────────────────────┐
│                                                                 │
│  User gửi feedback (đồng ý/ghi đè)                            │
│       │                                                         │
│       ▼                                                         │
│  Trust Calibrator:                                              │
│  - Lưu trust_event (ai_prediction, ai_confidence, human_decision)
│  - Tính agreement_rate, trust_state                            │
│       │                                                         │
│       ▼                                                         │
│  User Modeler:                                                  │
│  - expertise_level += 0.01                                     │
│  - Cập nhật preferred_detail_level (summary → detailed → technical)
│  - Cập nhật agreements/disagreements counter                   │
│       │                                                         │
└───────┼─────────────────────────────────────────────────────────┘
        │
        ▼ (Lần chấm thứ N+1)
┌───────────────────────────────────────────────────────────────────┐
│  Explanation Recommendation Engine:                                │
│                                                                    │
│  INPUT:                                                            │
│  ├── User Profile (expertise_level, preferred_detail_level)       │
│  ├── Trust Calibration (trust_state: over/under/well_calibrated)  │
│  ├── Cognitive Load (conflict_score, n_significant_factors)       │
│  └── Prediction (confidence, decision)                            │
│                                                                    │
│  RULES (if/else, không ML):                                       │
│  1. detail_level = user's learned preference (trừ khi override)   │
│  2. Nếu cognitive_load > 0.7 VÀ detail = technical → downgrade   │
│  3. Nếu confidence < 75% → gợi ý Similar Cases                   │
│  4. Nếu decision = Rejected → gợi ý Counterfactual               │
│  5. Nếu trust_state = over_trust → trust_intervention =          │
│     "highlight_uncertainty" (thêm cảnh báo giới hạn vào narrative)│
│  6. Nếu trust_state = under_trust → trust_intervention =         │
│     "highlight_evidence" (thêm minh chứng vào narrative)          │
│                                                                    │
│  OUTPUT:                                                           │
│  - detail_level, suggest_counterfactual, suggest_similar_cases    │
│  - trust_intervention → TRUYỀN VÀO PROMPT DEEPSEEK               │
│  - rationale[] (giải thích TẠI SAO chọn strategy này)            │
└───────────────────────────────────────────────────────────────────┘
        │
        ▼
  DeepSeek generate narrative (NỘI DUNG THAY ĐỔI theo trust_intervention)
        │
        ▼
  Frontend hiển thị giải thích ĐÃ ĐƯỢC CÁ NHÂN HÓA cho user này
```

### 5.2 Trust Calibrator — Phát hiện xu hướng tin tưởng

| Trạng thái | Điều kiện | Hệ quả |
|------------|-----------|--------|
| `well_calibrated` | Mặc định | Không can thiệp |
| `over_trust` | agreement_rate > 90% VÀ avg_AI_confidence_on_agreements < 70% | Thêm cảnh báo "mô hình có thể sai" vào narrative |
| `under_trust` | agreement_rate < 50% VÀ avg_AI_confidence_on_disagreements > 85% | Thêm minh chứng "mô hình đáng tin trong trường hợp này" |
| `insufficient_data` | < 3 events | Chờ thêm dữ liệu |

### 5.3 Cognitive Load Adaptation

```
INPUT: SHAP result + user expertise_level

Tính toán:
- n_significant_factors: số features có |SHAP| > 10% of max (Miller's 7±2)
- conflict_score: 0 (all agree) → 1 (50/50 split giữa tăng/giảm duyệt)
- raw_load = (n_factors/8) × 0.6 + conflict_score × 0.4
- perceived_load = raw_load × (1.5 - expertise × 1.0)
  (novice nhận x1.5, expert nhận x0.5)

OUTPUT:
- Nếu perceived_load > 0.7 → "simplify" (downgrade detail_level)
- Nếu 0.4-0.7 → "standard"
- Nếu < 0.4 → "can_show_full_detail"
```

### 5.4 Progressive Disclosure — 3 tầng thông tin

| Level | Hiển thị gì | Cho ai |
|-------|-------------|--------|
| `summary` | Headline + top 1 reason + narrative | Người mới (<5 interactions) |
| `detailed` | + Top 5 factors + probability + risk_score | Người quen (5-20 interactions) |
| `technical` | + Full SHAP chart + base_value + all contributions | Chuyên gia (≥20 interactions) |

Frontend dùng **Collapsible**: lớp đơn giản luôn hiện, kỹ thuật ẩn sau nút "Xem chi tiết".

---

## 6. Mô hình AI

### Thuật toán: XGBoost (XGBClassifier)
- **Bài toán**: Binary classification (Approved=1, Rejected=0)
- **Dataset**: `loan_approval_dataset.csv` — 4,269 hồ sơ vay lịch sử
- **Features**: 11 (9 numeric + 2 categorical)

### Danh sách features

| Feature | Tên hiển thị | Loại |
|---------|-------------|------|
| no_of_dependents | Số người phụ thuộc | Numeric |
| income_annum | Thu nhập hàng năm | Numeric |
| loan_amount | Số tiền vay đề nghị | Numeric |
| loan_term | Thời hạn vay (tháng) | Numeric |
| cibil_score | Điểm tín dụng (CIBIL) | Numeric |
| residential_assets_value | Tài sản bất động sản để ở | Numeric |
| commercial_assets_value | Tài sản bất động sản thương mại | Numeric |
| luxury_assets_value | Tài sản cao cấp | Numeric |
| bank_asset_value | Tài sản tại ngân hàng | Numeric |
| education | Trình độ học vấn | Categorical (Graduate/Not Graduate) |
| self_employed | Tình trạng tự kinh doanh | Categorical (Yes/No) |

### Train/Test Split
- **Method**: `train_test_split(test_size=0.2, stratify=y, random_state=42)`
- **Train**: ~3,415 samples | **Test**: ~854 samples

### Hyperparameters (mặc định)
```python
n_estimators = 200
max_depth = 4
learning_rate = 0.1
subsample = 0.9
colsample_bytree = 0.9
eval_metric = "logloss"
random_state = 42
```

### Evaluation Metrics (đầy đủ)
Mỗi model version lưu: Accuracy, Precision, Recall, F1, AUC, Confusion Matrix, ROC Curve, Precision-Recall Curve, Calibration Curve.

### Model Registry
- Mỗi lần train → tạo version mới (v1, v2, v3...)
- Lưu artifact (model.joblib + encoders.joblib + metadata.json) vào `backend/models/versions/{label}/`
- **Champion-Challenger**: chỉ 1 version active tại 1 thời điểm, có thể switch qua UI

---

## 7. Hướng dẫn cài đặt

### Yêu cầu
- Python 3.11+ (khuyến nghị dùng Conda)
- Node.js 18+ và npm
- Git

### Bước 1: Clone repo
```bash
git clone https://github.com/sutobode/HCXAI-for-Loan-approval.git
cd HCXAI-for-Loan-approval
```

### Bước 2: Cài đặt Backend
```bash
# Tạo conda environment
conda env create -f environment.yml
conda activate hcxai

# Hoặc dùng pip (nếu không có conda)
cd backend
pip install -r requirements.txt
```

### Bước 3: Train model lần đầu
```bash
cd backend
python -m app.model_registry
# Output: Registered model version v1 (active=True)
```

### Bước 4: Seed dữ liệu khách hàng mẫu
```bash
cd backend
python scripts/seed_applicants.py --count 50 --scored-ratio 0.35
# Output: Seeded 50 applicants: 22 already scored, 28 pending review
```

### Bước 5: Khởi động Backend
```bash
cd backend
uvicorn app.main:app --host 127.0.0.1 --port 8000
# Mở http://127.0.0.1:8000/docs để xem Swagger UI
```

### Bước 6: Cài đặt và khởi động Frontend
```bash
cd frontend
npm install
npm run dev
# Mở http://localhost:3000
```

### Bước 7: Đăng nhập
- Email: `admin@hcxai.local`
- Password: `ChangeMe123!`

### (Tuỳ chọn) Cấu hình DeepSeek API
Tạo file `.env` trong thư mục `backend/`:
```env
DEEPSEEK_API_KEY=sk-your-key-here
```
Nếu không có key, hệ thống tự fallback sang template explanation (deterministic, không cần LLM).

---

## 8. Hướng dẫn demo từng bước

### Chuẩn bị (10 phút trước demo)
1. Đảm bảo backend + frontend đang chạy
2. Đăng nhập, chấm 6-8 hồ sơ (xen kẽ "Đồng ý" và "Ghi đè") để Trust Dashboard có data

### Kịch bản demo đề xuất (15-20 phút)

**Phần 1: Luồng nghiệp vụ cơ bản (5 phút)**
1. Login → Dashboard → giải thích stat cards + 3 CTA nổi bật
2. Bấm "Khách hàng" → thấy 50 khách, 28 "Chờ chấm"
3. Click 1 khách "Chờ chấm" → form tự điền → bấm "Nhận quyết định"
4. Kết quả hiện: badge + tin cậy + giải thích + Risk Gauge
5. Bấm "Đồng ý với AI" → panel xanh "Hoàn tất"

**Phần 2: XAI — Giải thích AI (5 phút)**
6. Quay lại Loan Queue → click khách "Duyệt" → trang detail
7. Giải thích SHAP chart: "cột này cho thấy CIBIL score ảnh hưởng mạnh nhất"
8. Mở "Công cụ phân tích chuyên sâu" → chạy LIME → so sánh với SHAP
9. Chạy Counterfactual → "nếu CIBIL tăng lên 628 thì sẽ được duyệt"
10. Vào "Giải thích Toàn cục" → feature importance toàn dataset

**Phần 3: HCXAI — Closed Loop (5 phút)**
11. Mở "Bảng Tin cậy" → thấy trust_state + agreement_rate + trend
12. Giải thích: "Sau 6 lần đồng ý + 2 lần ghi đè → hệ thống phân tích xu hướng"
13. Chấm 1 hồ sơ mới → mở phần "Xem chi tiết kỹ thuật"
14. Chỉ rationale: "User shows over-trust pattern: will surface model uncertainty"
15. Giải thích: "Narrative đã thay đổi NỘI DUNG vì trust_intervention"

**Phần 4: Fairness + Monitoring (3 phút)**
16. "Công bằng AI" → biểu đồ nhóm + Four-Fifths Rule check
17. "Giám sát Mô hình" → Feature Drift + Prediction Drift
18. "Trung tâm Mô hình" → Model Registry + Champion-Challenger

### Câu hỏi giáo sư thường hỏi + cách trả lời

| Câu hỏi | Trả lời + demo ở đâu |
|----------|----------------------|
| "HCXAI khác gì XAI thường?" | Demo Phần 3: trust state → narrative thay đổi |
| "Adaptive nghĩa là gì cụ thể?" | Mở rationale, chỉ rule đang apply cho user này |
| "AI có bias không?" | Fairness page → Four-Fifths Rule |
| "Ghi đè có tác dụng gì?" | Trust Dashboard trước/sau ghi đè |
| "Code thật hay mock?" | Mở backend/app/hcxai.py trực tiếp |
| "Novelty ở đâu?" | Closed-loop: feedback → trust → intervention → narrative content |

---

## 9. Danh sách API

### Auth
| Method | Path | Mô tả | Role |
|--------|------|--------|------|
| POST | /auth/login | Đăng nhập, nhận JWT token | Public |
| POST | /auth/register | Tạo user mới | admin |
| GET | /auth/me | Thông tin user hiện tại | Any |
| GET | /auth/users | Danh sách users | admin |

### Applicants (Loan Queue)
| Method | Path | Mô tả | Role |
|--------|------|--------|------|
| GET | /applicants | Danh sách khách hàng (search, paginate) | Staff |
| POST | /applicants | Tạo khách hàng mới | Staff |
| GET | /applicants/{id} | Chi tiết + lịch sử hồ sơ | Staff |

### Predictions & Explanations
| Method | Path | Mô tả | Role |
|--------|------|--------|------|
| POST | /predict | Dự đoán (không lưu, không giải thích) | Staff |
| POST | /explain | Dự đoán + SHAP + narrative + lưu DB | Any |
| GET | /predictions | Danh sách hồ sơ đã chấm (paginate) | Any |
| GET | /predictions/{id} | Chi tiết 1 prediction + SHAP + feedback | Any |

### XAI
| Method | Path | Mô tả | Role |
|--------|------|--------|------|
| POST | /explain/lime | LIME local explanation | Any |
| POST | /explain/counterfactual | Tìm counterfactual | Any |
| GET | /explain/global | Global SHAP importance | Staff |
| POST | /explain/quality | Stability/Completeness/Sparsity | Any |

### HCXAI
| Method | Path | Mô tả | Role |
|--------|------|--------|------|
| POST | /feedback | Ghi nhận phản hồi con người | Any |
| GET | /trust/{user_id} | Trust Dashboard (profile + calibration) | Self/Admin |
| GET | /feedback/analytics | Override analytics tổng hợp | Admin/RM |
| GET | /hcxai/override-analysis | Disagreement by confidence bucket | Admin/RM |
| GET | /hcxai/satisfaction | Mức hài lòng với giải thích | Any |
| GET | /hcxai/explanation-history/{user_id} | Lịch sử giải thích | Self/Admin |
| GET | /hcxai/provenance/{prediction_id} | Decision Provenance (full lineage) | Any |

### Interactive Tools
| Method | Path | Mô tả | Role |
|--------|------|--------|------|
| POST | /whatif | So sánh 1 thay đổi | Staff |
| POST | /whatif/sensitivity | Sensitivity sweep | Staff |
| POST | /similar-cases | k-NN similar cases | Any |

### Fairness & Monitoring
| Method | Path | Mô tả | Role |
|--------|------|--------|------|
| GET | /fairness/report | Demographic parity + 80% rule | Admin/RM |
| GET | /monitoring/snapshot | Drift + metrics | Admin/RM |

### Model Center
| Method | Path | Mô tả | Role |
|--------|------|--------|------|
| GET | /model/versions | Liệt kê model versions | Admin/RM |
| POST | /model/train | Train version mới | Admin |
| POST | /model/activate | Champion switch | Admin |
| POST | /model/compare | So sánh 2 versions | Admin/RM |

### Governance
| Method | Path | Mô tả | Role |
|--------|------|--------|------|
| GET | /audit | Audit trail (paginate) | Admin |

---

## 10. Cấu trúc thư mục

```
HCXAI-for-Loan-approval/
├── backend/
│   ├── app/
│   │   ├── main.py              # FastAPI app + all endpoints
│   │   ├── auth.py              # JWT + RBAC
│   │   ├── config.py            # Settings (env vars)
│   │   ├── db.py                # SQLite persistence layer
│   │   ├── schemas.py           # Pydantic request/response models
│   │   ├── hcxai.py             # ★ HCXAI Engine (User Modeler, Trust Calibrator, Recommendation Engine)
│   │   ├── explainer.py         # SHAP TreeExplainer wrapper
│   │   ├── lime_explainer.py    # LIME implementation (tự viết)
│   │   ├── counterfactual.py    # Counterfactual search (tự viết, DiCE-inspired)
│   │   ├── global_explainability.py  # Mean |SHAP| global importance
│   │   ├── explanation_quality.py    # Stability / Completeness / Sparsity
│   │   ├── similar_cases.py     # k-NN similar case explorer
│   │   ├── whatif.py            # What-If Lab logic
│   │   ├── fairness.py          # Demographic parity + Four-Fifths Rule
│   │   ├── monitoring.py        # Feature Drift + Prediction Drift (KS-test)
│   │   ├── model_registry.py    # Train + version + champion-challenger
│   │   ├── deepseek_client.py   # LLM narrative generation (+ trust intervention prompt)
│   │   └── data_processing.py   # CSV loading + encoding
│   ├── data/
│   │   └── hcxai.db             # SQLite database (runtime)
│   ├── models/
│   │   └── versions/v1/         # Trained model artifacts
│   └── scripts/
│       └── seed_applicants.py   # Seed 50 applicants từ CSV
│
├── frontend/
│   └── src/
│       ├── app/
│       │   ├── login/page.tsx
│       │   └── (app)/
│       │       ├── dashboard/page.tsx
│       │       ├── applicants/page.tsx       # ★ Loan Queue
│       │       ├── applications/
│       │       │   ├── page.tsx              # Hồ sơ đã chấm (list)
│       │       │   ├── new/page.tsx          # ★ Chấm điểm + HCXAI results
│       │       │   └── [id]/page.tsx         # Detail + phê duyệt
│       │       ├── trust/page.tsx            # ★ Trust Dashboard
│       │       ├── hcxai/
│       │       │   ├── explanation-history/  # Lịch sử giải thích
│       │       │   └── override-analysis/    # Phân tích ghi đè
│       │       ├── explainability/global/    # Global SHAP
│       │       ├── fairness/page.tsx         # Công bằng AI
│       │       ├── monitoring/page.tsx       # Giám sát mô hình
│       │       ├── model-center/page.tsx     # Model Registry
│       │       ├── whatif/page.tsx            # What-If Lab
│       │       ├── similar-cases/page.tsx    # Hồ sơ tương tự
│       │       └── admin/                    # Users + Audit
│       ├── components/
│       │   ├── layout/ (sidebar, topbar, page-header, auth-guard)
│       │   ├── ui/ (shadcn components + collapsible + glossary-term)
│       │   ├── charts/ (risk-gauge, shap-chart)
│       │   └── loan/ (loan-application-form)
│       ├── lib/
│       │   ├── api.ts            # Axios instance
│       │   ├── endpoints.ts      # Typed API wrappers
│       │   ├── types.ts          # TypeScript interfaces
│       │   └── glossary.ts       # 17 thuật ngữ + giải thích tiếng Việt
│       └── stores/
│           └── auth-store.ts     # Zustand (JWT + user state)
│
├── loan_approval_dataset.csv     # Raw training data (4,269 rows)
├── environment.yml               # Conda environment spec
├── TAI_LIEU_HE_THONG.md          # ★ Tài liệu này
├── HUONG_DAN_SU_DUNG.md          # Hướng dẫn sử dụng ngắn
├── README.md                     # English README
└── HCXAI_PLATFORM_DESIGN.md      # Tài liệu thiết kế gốc
```

---

*Tài liệu này được tạo ngày 21/07/2026 — phản ánh trạng thái cuối cùng sau tất cả các phiên cải thiện.*
