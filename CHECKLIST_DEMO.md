# ✅ Checklist Chuẩn bị Demo Seminar

## 📋 Trước ngày demo (1 tuần)

### Backend
- [ ] Đảm bảo conda environment `hcxai` đã cài đặt (`conda env create -f environment.yml`)
- [ ] Đã train model v1 (`python -m app.model_registry`)
- [ ] Đã seed 50 applicants (`python scripts/seed_applicants.py --count 50 --scored-ratio 0.35`)
- [ ] Backend chạy được (`uvicorn app.main:app --port 8000`)
- [ ] Kiểm tra http://127.0.0.1:8000/docs — Swagger UI hiện đầy đủ endpoints

### Frontend
- [ ] `npm install` thành công (không có warning critical)
- [ ] `npm run build` thành công (exit code 0)
- [ ] `npm run dev` → http://localhost:3000 mở được
- [ ] Đăng nhập thành công với `admin@hcxai.local` / `ChangeMe123!`

### Database
- [ ] File `backend/data/hcxai.db` tồn tại và có kích thước >100KB
- [ ] Có ít nhất 1 user trong bảng `users`
- [ ] Có 50 applicants trong bảng `applicants`
- [ ] Có ít nhất 15-20 predictions đã chấm (seed script tự tạo 35% scored)

### DeepSeek API (optional nhưng khuyến nghị)
- [ ] Có API key DeepSeek (`backend/.env` chứa `DEEPSEEK_API_KEY=sk-...`)
- [ ] Test 1 lần chấm điểm → narrative tiếng Việt xuất hiện (không phải SHAP values raw)
- [ ] Nếu không có key: xác nhận fallback template vẫn hoạt động

---

## 🎯 Trước demo 15 phút

### 1. Tạo dữ liệu Trust Dashboard (QUAN TRỌNG!)
Trust Dashboard sẽ trống nếu chưa có feedback → không ấn tượng.

**Cần làm**:
```bash
# Chạy backend + frontend
# Đăng nhập → Khách hàng → Chấm 8 hồ sơ như sau:
```

| Hồ sơ thứ | Hành động | Lý do |
|-----------|-----------|-------|
| 1-3 | "Đồng ý với AI" (3 lần) | Xây baseline agreement |
| 4 | "Ghi đè quyết định" | Tạo disagreement |
| 5-6 | "Đồng ý với AI" (2 lần) | Tiếp tục pattern |
| 7 | "Ghi đè quyết định" | Disagreement thứ 2 |
| 8 | "Đồng ý với AI" | Kết thúc với agreement |

→ Sau 8 lần này: `agreement_rate = 75%` → trust_state có thể là `well_calibrated` hoặc `under_trust` (tuỳ confidence)

### 2. Kiểm tra các trang demo quan trọng

Mở từng trang sau để đảm bảo data hiển thị:
- [ ] Dashboard: 3 stat cards + 28 chờ chấm + Recent Predictions table có data
- [ ] Khách hàng: 50 cards, filter hoạt động, badge "Duyệt"/"Từ chối"/"Chờ chấm" đúng
- [ ] Trust Dashboard: trust_state không còn "Chưa đủ dữ liệu", có chart trend
- [ ] Công bằng AI: biểu đồ nhóm hiện 2 attributes, có alert xanh hoặc đỏ
- [ ] Giám sát Mô hình: Feature Drift + Prediction Drift có số liệu
- [ ] Trung tâm Mô hình: v1 active, metrics table đầy đủ

### 3. Chọn 2 hồ sơ demo mẫu

**Hồ sơ A** (để demo luồng Approved):
- Tên khách: (chọn 1 người có CIBIL >700, income cao, loan_amount thấp)
- Trạng thái: "Chờ chấm"
- Dùng để: Demo full flow → Duyệt → SHAP → Counterfactual → Similar Cases

**Hồ sơ B** (để demo luồng Rejected):
- Tên khách: (chọn 1 người có CIBIL <500, income thấp, loan_amount cao)
- Trạng thái: "Chờ chấm"
- Dùng để: Demo What-If Lab (thay đổi thu nhập → flip decision)

Ghi tên 2 người này vào giấy nháp để không phải tìm trong lúc demo.

---

## 🎤 Kịch bản demo 15 phút

### Phần 1: Tổng quan + Luồng nghiệp vụ (4 phút)

1. **Login** (30s)
   - Chỉ credentials trên màn hình: "Admin mặc định, production sẽ đổi"
   - Đăng nhập → Dashboard

2. **Dashboard** (1 phút)
   - Chỉ 3 stat cards: "Hệ thống đã chấm X hồ sơ, Y được duyệt, độ tin cậy trung bình Z%"
   - Chỉ badge "28 chờ chấm": "Đây là Loan Queue"
   - Bấm "Khách hàng"

3. **Loan Queue** (1 phút)
   - "50 khách hàng, 22 đã chấm, 28 đợi"
   - Filter theo status → chỉ badge màu
   - Click Hồ sơ A (chờ chấm)

4. **Chấm điểm** (1.5 phút)
   - Form tự điền: "Hệ thống prefill từ hồ sơ khách hàng"
   - Nhấn "Nhận quyết định" → Loading → Kết quả hiện
   - Chỉ: Badge Duyệt + tin cậy 87% + narrative tiếng Việt
   - "Đây là giải thích AI generate tự động"
   - Nhấn "Đồng ý với AI" → Panel xanh "Hoàn tất"

### Phần 2: XAI — Giải thích (4 phút)

5. **Detail page** (1 phút)
   - Quay lại Loan Queue → click Hồ sơ A (giờ có badge "Duyệt")
   - Trang detail: Risk Gauge + narrative + SHAP chart
   - Giải thích SHAP: "Cột xanh tăng duyệt, đỏ giảm. CIBIL score ảnh hưởng mạnh nhất"

6. **LIME cross-check** (1 phút)
   - Mở "Công cụ phân tích chuyên sâu" → chạy LIME
   - So sánh: "SHAP nói CIBIL quan trọng, LIME cũng đồng ý → giải thích đáng tin"

7. **Counterfactual** (1 phút)
   - Chạy Counterfactual
   - "Nếu hồ sơ này bị từ chối, cần thay đổi gì? Ví dụ: tăng CIBIL lên 628"

8. **Global Explainability** (1 phút)
   - Sidebar → "Giải thích Toàn cục"
   - Bar chart: "Xếp hạng yếu tố quan trọng toàn hệ thống: CIBIL 45%, income 22%..."

### Phần 3: HCXAI — Closed Loop (4 phút)

9. **Trust Dashboard** (2 phút)
   - Sidebar → "Bảng Tin cậy"
   - Chỉ: trust_state, agreement_rate 75%, trend chart
   - Giải thích: "Sau 8 lần phản hồi, hệ thống phát hiện tôi tin AI mức độ vừa phải"
   - Chỉ Override Direction: "Tôi có xu hướng ghi đè khi AI quá chắc chắn"

10. **Trust Intervention → Narrative** (2 phút)
    - Chấm 1 hồ sơ mới (Hồ sơ B)
    - Nhận kết quả → mở "Xem chi tiết kỹ thuật"
    - Chỉ rationale: "User shows over-trust: will surface model uncertainty"
    - Giải thích: **"Đây là điểm mới (novelty): narrative NỘI DUNG thay đổi theo trust state"**
    - So sánh: "Lần đầu không có cảnh báo, giờ có vì hệ thống phát hiện tôi over-trust"

### Phần 4: Fairness + Monitoring (3 phút)

11. **Fairness** (1.5 phút)
    - "Công bằng AI" → biểu đồ 2 nhóm
    - Giải thích Four-Fifths Rule: "Tỷ lệ duyệt nhóm thấp ≥ 80% nhóm cao → pass"
    - Alert: xanh = công bằng, đỏ = thiên vị

12. **Monitoring** (1 phút)
    - "Giám sát Mô hình" → Feature Drift + Prediction Drift
    - "Hệ thống tự động phát hiện khi dữ liệu thực tế khác training → cần retrain"

13. **Model Center** (0.5 phút)
    - "Trung tâm Mô hình" → v1 active, metrics table
    - "Champion-Challenger: so sánh versions, click Activate để switch"

---

## ❓ Câu hỏi giáo sư + Câu trả lời mẫu

### Q1: "HCXAI khác gì XAI thông thường?"
**Demo**: Mở Trust Dashboard → chỉ trust_state → chấm hồ sơ mới → mở rationale → chỉ "narrative thay đổi"
**Nói**: "XAI chỉ giải thích 1 chiều. HCXAI học từ phản hồi con người, điều chỉnh cách giải thích real-time. Đây là closed-loop."

### Q2: "Adaptive Explainability cụ thể là gì?"
**Demo**: Mở backend/app/hcxai.py dòng 150-200 (Recommendation Engine rules)
**Nói**: "Hệ thống dùng IF/ELSE rules đơn giản, KIỂM TOÁN ĐƯỢC. Không phải black-box meta-model. Rationale giải thích tại sao chọn strategy này."

### Q3: "Model có bias không?"
**Demo**: Fairness page → biểu đồ
**Nói**: "Dataset công khai chỉ có 2 attributes (education, self_employed). Framework hỗ trợ mở rộng cho race/gender khi có data."

### Q4: "Ghi đè có tác dụng gì?"
**Demo**: Trust Dashboard → chỉ trend chart trước/sau override
**Nói**: "Mỗi override cập nhật trust_state → lần chấm sau, strategy thay đổi → narrative content khác."

### Q5: "Code thật hay mock?"
**Demo**: Mở VSCode → backend/app/hcxai.py + TAI_LIEU_HE_THONG.md
**Nói**: "900+ dòng code thật, 855 dòng tài liệu kỹ thuật, 15 trang frontend. Không placeholder."

### Q6: "Novelty/đóng góp nghiên cứu ở đâu?"
**Trả lời**: "Closed-loop HCXAI với Trust Intervention:
1. Tự động phát hiện over/under-trust
2. Điều chỉnh KHÔNG CHỈ style mà cả NỘI DUNG narrative
3. Logic adaptation dùng heuristic rules auditable (không phải meta-model)
→ Khác các hệ thống XAI truyền thống (giải thích 1 chiều, không học từ feedback)."

---

## 🛠️ Troubleshooting nhanh

| Vấn đề | Nguyên nhân | Giải pháp |
|--------|-------------|-----------|
| Trust Dashboard trống | Chưa đủ 3 feedback events | Chấm 5-6 hồ sơ trước demo |
| Narrative không tiếng Việt | DeepSeek key không có | Bình thường, fallback template vẫn OK |
| Loan Queue không có data | Chưa seed | `python scripts/seed_applicants.py` |
| Frontend không connect backend | Port sai | Check NEXT_PUBLIC_API_URL=http://127.0.0.1:8000 |
| Model chưa train | Lần đầu chạy | `python -m app.model_registry` |

---

## 📊 Metrics thành công

Sau khi demo xong, hệ thống nên có:
- ✅ 50 applicants
- ✅ 25-30 predictions (22 từ seed + 5-8 từ demo live)
- ✅ 15+ feedback events (từ chuẩn bị + demo)
- ✅ Trust Dashboard có data cho ít nhất 1 user
- ✅ All pages load <2s
- ✅ Không có error console.log trên browser F12

---

**Chúc demo thành công! 🎉**
