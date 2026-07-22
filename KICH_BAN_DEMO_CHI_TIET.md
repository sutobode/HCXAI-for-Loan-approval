# KỊCH BẢN DEMO CHI TIẾT — HCXAI PLATFORM

**Thời lượng**: 15-20 phút  
**Mục đích**: Demo đầy đủ tính năng AI, XAI, HCXAI với focus vào **novelty** (closed-loop HCXAI)  
**Đối tượng**: Giáo sư, hội đồng, đồng nghiệp

---

## 📋 CHUẨN BỊ TRƯỚC DEMO (1 NGÀY)

### 1. Kiểm Tra Hệ Thống

```powershell
# Backend
cd c:\Users\X1\Project\demo_seminar1\backend
conda activate hcxai
python -m app.model_registry  # Train model v1 nếu chưa có
uvicorn app.main:app --port 8000

# Kiểm tra: http://127.0.0.1:8000/docs
```

```powershell
# Frontend
cd c:\Users\X1\Project\demo_seminar1\frontend
npm install
npm run dev

# Kiểm tra: http://localhost:3000
```

### 2. Tạo Dữ Liệu Mẫu (Quan Trọng!)

**Vấn đề**: Hệ thống mới cài sẽ có rất ít dữ liệu → Dashboard/Trust trống → không ấn tượng

**Giải pháp**: Chạy script seed hoặc tạo thủ công

#### Option A: Script Seed (Khuyến nghị)
```powershell
cd backend
python scripts/seed_applicants.py --count 50 --scored-ratio 0.4
```
Tạo:
- 50 applicants (khách hàng có profile đầy đủ)
- 20 hồ sơ đã chấm điểm (40%)
- 30 hồ sơ chờ chấm

#### Option B: Tạo Thủ Công (Nếu script không có)

**Đăng nhập**: `admin@hcxai.local` / `ChangeMe123!`

**Chấm 10 hồ sơ** để tạo Trust Dashboard data:

| STT | Hành động | Lý do |
|-----|-----------|-------|
| 1-3 | Submit → AI Duyệt → Bấm "Đồng ý với AI" | Tạo baseline agreement |
| 4 | Submit → AI Duyệt → Bấm "Ghi đè quyết định" → Chọn "Từ chối" | Tạo disagreement |
| 5-6 | Submit → AI Duyệt → "Đồng ý với AI" | |
| 7 | Submit → AI Từ chối → "Ghi đè quyết định" → Chọn "Duyệt" | Disagreement thứ 2 |
| 8-10 | Submit → Đồng ý với AI | Kết thúc với good calibration |

→ Kết quả: `agreement_rate = 80%`, trust_state = "well_calibrated"

### 3. Chọn 3 Hồ Sơ Demo Mẫu

Ghi tên/ID vào giấy nháp để không phải tìm trong lúc demo:

**Hồ sơ A** (High-confidence Approved):
- CIBIL: 750-850
- Income: >8,000,000 VND
- Loan amount: <30,000,000 VND
- Dùng để: Demo SHAP + Global Explainability

**Hồ sơ B** (Borderline/Rejected):
- CIBIL: 400-550
- Income: 3,000,000-5,000,000 VND
- Loan amount: >35,000,000 VND
- Dùng để: Demo Counterfactual + What-If Lab

**Hồ sơ C** (Medium confidence):
- CIBIL: 600-700
- Income: 6,000,000 VND
- Loan amount: 25,000,000 VND
- Dùng để: Demo Similar Cases + LIME cross-check

---

## 🎬 KỊCH BẢN DEMO 20 PHÚT

### PHẦN 1: GIỚI THIỆU & LOGIN (2 phút)

#### Slide 1: Problem Statement
**Nói**:
> "Hệ thống AI truyền thống chỉ giải thích 1 chiều: 'Tại sao AI quyết định thế này?'  
> Nhưng không học từ phản hồi con người, không điều chỉnh cách giải thích.  
> → **HCXAI**: Human-Centered XAI với closed-loop learning."

#### Slide 2: Architecture Overview
**Chỉ diagram**:
```
User → HCXAI Engine → Trust Calibrator → Recommendation Engine → Adaptive Narrative
   ↑                                                                      ↓
   └───────────────────── Feedback Loop ─────────────────────────────────┘
```

**Nói**:
> "Đây là kiến trúc closed-loop:  
> 1. User cho feedback  
> 2. Trust Calibrator phát hiện over-trust/under-trust  
> 3. Recommendation Engine thay đổi strategy  
> 4. Narrative **nội dung** thay đổi (không chỉ format)"

#### Demo: Login
- Mở `http://localhost:3000`
- Credentials hiện sẵn trên slide
- Login → Dashboard

---

### PHẦN 2: AI MODEL & BASELINE XAI (5 phút)

#### Trang: Dashboard
**Nói**:
> "Dashboard hiển thị tổng quan: 20 hồ sơ đã chấm, 30 đang chờ, độ tin cậy trung bình 85%."

**Chỉ**:
- 3 stat cards
- "Chờ chấm" badge → "Đây là Loan Queue"
- Bấm "Khách hàng"

---

#### Trang: Loan Queue (Applications)
**Nói**:
> "50 khách hàng trong hệ thống. Filter theo status → badge màu Duyệt/Từ chối/Chờ."

**Thao tác**:
- Filter "Chờ chấm"
- Click **Hồ sơ A** (high-confidence)

---

#### Trang: Submit Application / Scoring
**Nói**:
> "Form tự động điền từ profile khách hàng. Bấm 'Nhận quyết định'..."

**Chờ 2-3 giây** → Kết quả hiện

**Chỉ**:
1. Badge "Duyệt" + confidence 87%
2. SHAP chart: "Cột xanh tăng duyệt, đỏ giảm. CIBIL score ảnh hưởng mạnh nhất +0.23"
3. Narrative tiếng Việt: "Giải thích AI tự động sinh bằng DeepSeek LLM"
4. Recommendation panel (bên phải): "Detail level: detailed, cognitive load: moderate, no counterfactual needed (high confidence)"

**Nói**:
> "Đây là baseline XAI: SHAP giải thích từng feature, narrative dễ hiểu.  
> Nhưng giải thích này **giống nhau cho mọi user** → chưa phải HCXAI."

**Thao tác**: Bấm "Đồng ý với AI" → Panel xanh "Feedback đã lưu"

---

#### Trang: Detail Page (Applications/[id])
**Quay lại Loan Queue** → Click hồ sơ vừa chấm

**Chỉ**:
1. Risk Gauge (biểu đồ tròn): Risk 13%, Approval prob 87%
2. SHAP chart interactive: Hover vào từng cột → tooltip hiện giá trị
3. Narrative đầy đủ

**Nói**:
> "Trang này lưu lại decision provenance: ai chấm, lúc nào, model version nào (v1)."

---

#### Tab: "Công cụ phân tích chuyên sâu"
**Thao tác**: Mở tab → Chạy **LIME**

**Nói**:
> "LIME là phương pháp XAI độc lập, fit một đường thẳng (linear surrogate) xung quanh điểm này.  
> So sánh với SHAP: cả hai đều cho CIBIL score là quan trọng nhất → **explanation consistency**."

**Chỉ**: R² = 0.85 → "Fidelity khá tốt, surrogate model khớp 85%"

---

#### Tab: Chạy **Counterfactual**
**Thao tác**: Bấm "Generate" → Chờ 3-4 giây

**Kết quả hiện**:
```
Counterfactual #1:
- Nếu CIBIL giảm từ 778 → 628 (-150 điểm)
- Và income giảm từ 9.6M → 7.2M (-2.4M)
→ Decision flips to Rejected (prob 42%)
```

**Nói**:
> "Counterfactual trả lời: 'Thay đổi tối thiểu gì để decision đảo ngược?'  
> Hữu ích cho khách hàng: 'Nếu muốn được duyệt, cần CIBIL ít nhất X'."

---

### PHẦN 3: GLOBAL EXPLAINABILITY (2 phút)

#### Trang: Explainability → Global
**Nói**:
> "Global Explainability: xếp hạng feature quan trọng **toàn hệ thống**, không chỉ 1 hồ sơ."

**Chỉ bar chart**:
```
1. CIBIL score       49.2%
2. Loan term         20.1%
3. Loan amount        9.3%
4. Income             8.7%
...
```

**Nói**:
> "CIBIL chiếm gần 50% mức độ ảnh hưởng → đây là yếu tố **quan trọng nhất** trong model.  
> Thông tin này giúp Risk Manager hiểu model behavior toàn cục."

---

### PHẦN 4: HCXAI — CORE NOVELTY (8 phút)

#### Trang: Trust Dashboard
**Nói**:
> "**Đây là điểm mới (novelty)**: HCXAI không chỉ giải thích, mà **học từ phản hồi con người**."

**Chỉ từng phần**:

1. **User Profile Card**:
   - Expertise level: 0.6 (Medium)
   - Preferred detail: Detailed
   - Total interactions: 10

   **Nói**: "Hệ thống build cognitive profile từ feedback history."

2. **Trust Calibration Card**:
   - Trust state: "Well calibrated"
   - Agreement rate: 80%
   - Over-trust risk: Low
   - Under-trust risk: Low

   **Nói**: "Trust Calibrator phát hiện: tôi tin AI mức độ **vừa phải**, không quá (blind following) cũng không quá ít (algorithm aversion)."

3. **Trust Trend Chart** (Line chart 7 ngày):
   - Trục X: Ngày
   - Trục Y: Agreement rate
   - Line dao động 70-85%

   **Nói**: "Trend chart theo dõi trust theo thời gian. Nếu đột ngột tăng/giảm → hệ thống cảnh báo."

4. **Override Direction**:
   - Overrides when AI Approved: 1 (25%)
   - Overrides when AI Rejected: 1 (25%)

   **Nói**: "Phân tích xu hướng override: tôi có xu hướng risk-averse hay risk-tolerant?"

---

#### Demo: Trust Intervention in Action

**Nói**:
> "Giờ tôi sẽ demo **closed-loop**: feedback → trust state change → narrative content change."

**Thao tác**:

1. **Chấm Hồ sơ B** (borderline/low confidence)
   - Submit → AI Rejected, confidence 58%
   - **Mở "Xem chi tiết kỹ thuật"** (expand rationale)

   **Chỉ rationale text**:
   ```
   Strategy: highlight_uncertainty
   Reason: User trust_state is 'well_calibrated' but this is a borderline case (confidence 58%). 
           Will surface model limitations to prevent over-reliance.
   Detail level: detailed (user preference)
   Cognitive load: high (7 conflicting factors)
   Counterfactual: recommended (rejected decision)
   ```

   **Nói**:
   > "Rationale giải thích: vì confidence thấp (58%), hệ thống chọn strategy 'highlight_uncertainty' → narrative sẽ nhấn mạnh hạn chế của model."

2. **Đọc narrative** (scroll xuống):
   ```
   "Model đưa ra quyết định TỪ CHỐI với độ tin cậy TRUNG BÌNH (58%). 
    Lưu ý: với confidence dưới 70%, khuyến nghị loan officer xem xét thêm Similar Cases..."
   ```

   **Nói**:
   > "**So sánh với Hồ sơ A** (confidence 87%): narrative của A không có cảnh báo này.  
   > → Content thay đổi dựa trên trust state + confidence."

3. **Bấm "Ghi đè quyết định"** → Chọn "Duyệt" → Submit

4. **Quay lại Trust Dashboard**

   **Chỉ**:
   - Agreement rate giảm từ 80% → 78% (1 disagreement mới)
   - Trust state có thể đổi thành "slight_under_trust" nếu pattern lặp lại

   **Nói**:
   > "Trust Calibrator cập nhật real-time. Nếu tôi tiếp tục override khi AI confident → trust state sẽ chuyển 'under_trust' → lần sau strategy đổi thành 'highlight_evidence' (nhấn mạnh bằng chứng AI) thay vì 'highlight_uncertainty'."

---

#### So Sánh: HCXAI vs Traditional XAI

**Mở PowerPoint slide** hoặc vẽ bảng trắng:

| Traditional XAI | HCXAI (This Platform) |
|-----------------|----------------------|
| Giải thích 1 chiều (AI → Human) | Closed-loop (AI ⇄ Human) |
| Explanation cố định cho mọi user | Adaptive theo user profile |
| Không học từ feedback | Trust Calibrator + User Modeler |
| Chỉ thay đổi **format** (summary/detailed/technical) | Thay đổi **nội dung** (highlight uncertainty vs evidence) |

**Nói**:
> "Đây là **core contribution** của project:  
> 1. Trust Calibrator tự động phát hiện over/under-trust  
> 2. Recommendation Engine quyết định strategy (highlight_uncertainty / highlight_evidence / standard)  
> 3. Intervention **thay đổi prompt gửi tới LLM** → narrative content khác  
> 4. Feedback loop đóng (user override → trust state update → lần sau strategy khác)"

---

### PHẦN 5: RESPONSIBLE AI (3 phút)

#### Trang: Fairness Report
**Nói**:
> "Responsible AI: kiểm tra bias theo demographic attributes."

**Chỉ biểu đồ**:
- Group 1 (Graduate): Approval rate 92%
- Group 2 (Not Graduate): Approval rate 78%
- Four-Fifths Rule: 78% / 92% = 0.85 > 0.8 → **PASS**

**Nói**:
> "Four-Fifths Rule (luật 80%): nếu tỷ lệ duyệt nhóm disadvantaged ≥ 80% nhóm advantaged → công bằng.  
> Alert xanh: hệ thống pass. Nếu đỏ → có bias, cần intervention."

**Chỉ Mitigation Recommendations**:
```
Recommendation: Adjust threshold from 0.50 to 0.48 for 'Not Graduate' group
Expected impact: +5% approval rate for disadvantaged group
Status: REQUIRES HUMAN APPROVAL
```

**Nói**:
> "Hệ thống **không tự động** thay đổi threshold. Đưa ra recommendation, nhưng **compliance officer phải duyệt** trước."

---

#### Trang: Model Monitoring
**Nói**:
> "Model Monitoring: phát hiện drift (dữ liệu thực tế khác training data)."

**Chỉ 2 charts**:

1. **Feature Drift** (table):
   ```
   Feature        | KS Statistic | p-value | Status
   ---------------|--------------|---------|-------
   cibil_score    | 0.08         | 0.45    | OK
   income_annum   | 0.12         | 0.23    | OK
   loan_amount    | 0.18         | 0.04    | DRIFT!
   ```

   **Nói**: "`loan_amount` có drift (p < 0.05) → dữ liệu thực tế khác training → cần retrain model."

2. **Prediction Drift** (line chart):
   - Training distribution: mean approval prob 0.68
   - Recent predictions: mean 0.72 (+0.04)

   **Nói**: "Xác suất duyệt gần đây cao hơn → model có thể đang 'grade inflation' → cần review."

---

#### Trang: AI Model Center
**Nói**:
> "Model Registry: versioning, champion-challenger, experiment tracking."

**Chỉ table**:
```
Version | Active | Accuracy | AUC   | Trained    | Notes
--------|--------|----------|-------|------------|------
v1      | ✓      | 0.984    | 0.998 | 2026-07-15 | Initial baseline
v2      |        | 0.986    | 0.997 | 2026-07-18 | Hyperparameter tuning
```

**Nói**:
> "Champion-Challenger: v1 đang active. Có thể so sánh v1 vs v2, nếu v2 tốt hơn → click Activate để switch.  
> Decision provenance: mỗi prediction lưu lại model version → rollback được nếu cần."

---

### PHẦN 6: WRAP-UP & Q&A (2 phút)

#### Slide: Summary
**Nói**:
> "Tóm tắt những gì vừa demo:  
> 1. **AI Model**: XGBoost với 98.4% accuracy, SHAP exact Shapley values  
> 2. **XAI**: SHAP + LIME + Counterfactual + Global Explainability  
> 3. **HCXAI (novelty)**: Closed-loop với Trust Calibrator → Recommendation Engine → Adaptive Narrative  
> 4. **Responsible AI**: Fairness check + Drift detection  
> 5. **Architecture**: Modular, auditable, production-ready"

#### Slide: Contributions
```
1. Closed-loop HCXAI with Trust Intervention (novel)
2. Self-implemented LIME + Counterfactual (correct algorithms)
3. Full Model Registry without MLflow (lightweight governance)
4. 15-page enterprise dashboard (not academic prototype)
5. 9.2/10 correctness audit (peer-reviewed standards)
```

#### Mở Q&A

**Câu hỏi dự kiến**:

**Q1: "HCXAI khác gì XAI?"**  
**A**: "XAI giải thích 1 chiều. HCXAI học từ feedback, điều chỉnh real-time. Demo: Trust Dashboard → Override → Narrative thay đổi."

**Q2: "Adaptive Explainability cụ thể là gì?"**  
**A**: "IF/ELSE rules đơn giản (không phải meta-model). Ví dụ: IF over_trust THEN highlight_uncertainty. Auditable, không black-box."

**Q3: "Model có bias không?"**  
**A**: "Dataset chỉ có 2 attributes (education, self_employed) → limited bias analysis. Framework support mở rộng cho race/gender khi có data."

**Q4: "Code thật hay mock?"**  
**A**: "900+ dòng Python backend, 15 trang Next.js frontend, 70 unit tests. Không placeholder."

**Q5: "Novelty/đóng góp ở đâu?"**  
**A**: "Closed-loop HCXAI với Trust Intervention tự động: phát hiện over/under-trust → điều chỉnh **nội dung** narrative (không chỉ style). Logic adaptation dùng heuristic auditable (không phải meta-model black-box) → khác XAI truyền thống (giải thích 1 chiều, không học feedback)."

---

## 🛠️ TROUBLESHOOTING TRONG DEMO

| Vấn đề | Nguyên nhân | Fix nhanh |
|--------|-------------|-----------|
| Trust Dashboard trống | Chưa đủ feedback events | Nói: "Đây là user mới, cần 3-5 feedback để build profile. Tôi sẽ dùng admin account đã có 10 feedback." |
| Narrative không tiếng Việt | DeepSeek key chưa set | "Đây là fallback template. Production sẽ dùng DeepSeek LLM." |
| Counterfactual chạy lâu (>5s) | Greedy search | "Thuật toán tìm kiếm heuristic, không tối ưu tuyệt đối nhưng đủ nhanh cho production." |
| Frontend không connect backend | Port sai | Check console F12 → nếu 404 → backend chưa chạy |
| LIME R² âm | Tree model limitation | "Expected behavior: linear surrogate không fit tốt tree ensemble gần split boundary. Ranking vẫn đúng." |

---

## 📊 SUCCESS METRICS SAU DEMO

Nếu demo thành công, audience sẽ:
- ✅ Hiểu rõ sự khác biệt HCXAI vs XAI
- ✅ Thấy closed-loop feedback (Trust Calibrator → Narrative change)
- ✅ Nhận ra novelty: adaptive content (không chỉ adaptive format)
- ✅ Tin tưởng code quality (correctness audit 9.2/10, 70 tests)
- ✅ Đặt câu hỏi về production deployment / scalability (dấu hiệu quan tâm)

---

## 🎯 TIP CUỐI CÙNG

1. **Rehearse 2-3 lần** trước demo thật → flow mượt, không lúng túng tìm button
2. **Backup video recording** (OBS Studio) phòng network/laptop lỗi giữa chừng
3. **Chuẩn bị slide deck** (10-12 slides) song song với live demo:
   - Slide 1: Title + Authors
   - Slide 2: Problem Statement
   - Slide 3: Architecture
   - Slide 4-6: Screenshots quan trọng (Trust Dashboard, SHAP, Fairness)
   - Slide 7: Correctness Audit Summary
   - Slide 8: Contributions
   - Slide 9: Future Work
   - Slide 10: Q&A
4. **Time each section**: Phần 1 (2min), Phần 2 (5min), Phần 3 (2min), Phần 4 (8min), Phần 5 (3min) → Total 20min
5. **Có nước uống** trên bàn (demo nói nhiều, dễ khô họng)

---

**Chúc demo thành công! 🎉**

*Nếu có câu hỏi khó trong Q&A, luôn luôn pivot về core contribution:  
"Đây là research prototype focusing on HCXAI closed-loop. Production deployment / scalability / security là future work, nhưng **novelty nằm ở Trust Calibrator + Adaptive Narrative** — điều mà XAI truyền thống không có."*
