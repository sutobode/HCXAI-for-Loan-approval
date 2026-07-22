# HƯỚNG DẪN SỬ DỤNG NHANH — HCXAI PLATFORM

**Thời gian đọc**: 5 phút  
**Mục đích**: Hướng dẫn nhanh nhất để chạy và trải nghiệm hệ thống

---

## 🚀 KHỞI ĐỘNG HỆ THỐNG (5 PHÚT)

### Bước 1: Backend

```powershell
# Vào thư mục backend
cd c:\Users\X1\Project\demo_seminar1\backend

# Activate conda environment
conda activate hcxai

# Nếu chưa train model, chạy lần đầu:
python -m app.model_registry

# Chạy API server
uvicorn app.main:app --port 8000
```

**Kiểm tra**: Mở http://127.0.0.1:8000/docs → thấy Swagger UI → Backend OK ✅

### Bước 2: Frontend

```powershell
# Mở terminal mới, vào thư mục frontend
cd c:\Users\X1\Project\demo_seminar1\frontend

# Chạy dev server
npm run dev
```

**Kiểm tra**: Mở http://localhost:3000 → thấy trang login → Frontend OK ✅

### Bước 3: Login

- **Email**: `admin@hcxai.local`
- **Password**: `ChangeMe123!`

→ Đăng nhập thành công → vào Dashboard

---

## 📊 TẠO DỮ LIỆU MẪU (TÙY CHỌN)

**Vấn đề**: Hệ thống mới có rất ít dữ liệu → Dashboard/Trust trống

**Giải pháp nhanh**: Chấm thủ công 5-8 hồ sơ

### Cách Tạo Hồ sơ Mẫu Nhanh

1. **Vào "Submit Application"** (sidebar)

2. **Copy-paste 3 profile mẫu** này:

#### Profile A (Approved — High Confidence)
```
Dependents: 2
Education: Graduate
Self-employed: No
Annual Income: 9,600,000
Loan Amount: 29,900,000
Loan Term: 12
CIBIL Score: 778
Residential Assets: 2,400,000
Commercial Assets: 17,600,000
Luxury Assets: 22,700,000
Bank Assets: 8,000,000
```
→ Submit → AI sẽ Duyệt (87% confidence) → Bấm "Đồng ý với AI"

#### Profile B (Rejected — Low CIBIL)
```
Dependents: 3
Education: Not Graduate
Self-employed: Yes
Annual Income: 3,500,000
Loan Amount: 38,000,000
Loan Term: 20
CIBIL Score: 420
Residential Assets: 500,000
Commercial Assets: 0
Luxury Assets: 0
Bank Assets: 200,000
```
→ Submit → AI sẽ Từ chối (89% confidence) → Bấm "Đồng ý với AI"

#### Profile C (Borderline — Medium Confidence)
```
Dependents: 1
Education: Graduate
Self-employed: No
Annual Income: 5,800,000
Loan Amount: 32,000,000
Loan Term: 15
CIBIL Score: 618
Residential Assets: 1,200,000
Commercial Assets: 3,000,000
Luxury Assets: 500,000
Bank Assets: 1,500,000
```
→ Submit → AI có thể Duyệt hoặc Từ chối (58-65% confidence) → Thử **Ghi đè quyết định** (override) → Chọn ngược lại với AI

3. **Lặp lại 2-3 lần** với số liệu khác nhau

→ Sau 5-8 lần: Trust Dashboard sẽ có data đầy đủ

---

## 🎯 LUỒNG SỬ DỤNG CƠ BẢN

### 1. Chấm Hồ Sơ Vay

**Đường đi**: Dashboard → Submit Application

1. Điền form (hoặc copy profile mẫu ở trên)
2. Bấm "Nhận quyết định"
3. Xem kết quả:
   - Badge Duyệt/Từ chối + Confidence %
   - SHAP chart (feature importance)
   - Narrative tiếng Việt (giải thích tự nhiên)
4. Cho feedback: "Đồng ý" / "Từ chối" / "Ghi đè"

### 2. Xem Chi Tiết Hồ Sơ

**Đường đi**: Khách hàng → Click vào một hồ sơ đã chấm

**Xem được**:
- Risk Gauge (biểu đồ tròn)
- SHAP chart interactive
- Narrative đầy đủ
- Decision provenance (ai chấm, lúc nào, model version nào)

**Công cụ bổ sung** (tab "Công cụ phân tích"):
- **LIME**: Cross-check SHAP (phương pháp XAI độc lập)
- **Counterfactual**: "Thay đổi gì để decision đảo ngược?"
- **Explanation Quality**: Độ ổn định/đầy đủ của giải thích

### 3. Trust Dashboard (HCXAI Core)

**Đường đi**: Sidebar → Bảng Tin cậy

**Xem được**:
- **User Profile**: Expertise level, preferred detail level
- **Trust Calibration**: Agreement rate, trust state (well-calibrated / over-trust / under-trust)
- **Trust Trend**: Biểu đồ 7 ngày
- **Override Direction**: Xu hướng risk-averse hay risk-tolerant
- **Satisfaction**: Đánh giá chất lượng giải thích

**Ý nghĩa**:
- Trust state = "over_trust" → Lần sau narrative sẽ nhấn mạnh **uncertainty**
- Trust state = "under_trust" → Lần sau narrative sẽ nhấn mạnh **evidence**
- → **Closed-loop**: feedback → trust state → narrative thay đổi

### 4. Global Explainability

**Đường đi**: Sidebar → Giải thích → Giải thích Toàn cục

**Xem được**: Ranking feature quan trọng toàn hệ thống (mean |SHAP|)

```
1. CIBIL score       49.2%  ████████████████████
2. Loan term         20.1%  ████████
3. Loan amount        9.3%  ████
...
```

### 5. What-If Lab

**Đường đi**: Sidebar → What-If Lab

**Thao tác**:
1. Điền base scenario (hoặc load từ hồ sơ cũ)
2. Sửa một vài trường (ví dụ: tăng income, giảm loan amount)
3. Xem approval probability thay đổi
4. Hoặc chạy **Sensitivity Sweep**: quét một feature qua toàn bộ range → biểu đồ line chart

### 6. Similar Cases

**Đường đi**: Sidebar → Similar Cases

**Thao tác**:
1. Điền hồ sơ cần so sánh
2. Xem 5 hồ sơ lịch sử "giống nhất" (k-NN)
3. Xem tỷ lệ Approved/Rejected trong 5 case đó

---

## 🔐 PHÂN QUYỀN (RBAC)

| Vai trò | Quyền truy cập |
|---------|---------------|
| **admin** | Toàn bộ (quản lý user, train model, audit log) |
| **risk_manager** | Predictions, XAI, HCXAI, Fairness, Monitoring, Model Center (xem only) |
| **loan_officer** | Predictions, XAI, What-If, Global Explainability, Similar Cases |
| **customer** | Chỉ xem giải thích và feedback hồ sơ của mình |

**Lưu ý**: Sidebar tự động ẩn các trang không có quyền

---

## 🛠️ TROUBLESHOOTING

### Backend không chạy
```powershell
# Kiểm tra conda environment
conda env list
# Nếu không có 'hcxai' → tạo lại:
conda env create -f environment.yml

# Kiểm tra port 8000 có bị chiếm không
netstat -ano | findstr :8000
# Nếu có → kill process hoặc đổi port
```

### Frontend không connect backend
```powershell
# Kiểm tra file .env.local
type frontend\.env.local
# Phải có: NEXT_PUBLIC_API_URL=http://127.0.0.1:8000

# Nếu không có → tạo:
copy frontend\.env.local.example frontend\.env.local
```

### Login bị từ chối
- **Lỗi "Invalid credentials"**: Check email/password chính tả
- **Lỗi "Network error"**: Backend chưa chạy → mở http://127.0.0.1:8000/docs kiểm tra

### Trust Dashboard trống
- **Nguyên nhân**: Chưa có feedback events (cần ít nhất 3-5 feedback)
- **Giải pháp**: Chấm thêm 5-8 hồ sơ và cho feedback

### Narrative không tiếng Việt
- **Nguyên nhân**: DeepSeek API key chưa set → dùng fallback template
- **Giải pháp**: 
  1. Lấy API key từ https://platform.deepseek.com
  2. Thêm vào `backend/.env`: `DEEPSEEK_API_KEY=sk-...`
  3. Restart backend

---

## 📚 TÀI LIỆU THAM KHẢO

### Chi Tiết Kỹ Thuật
- **README.md**: Kiến trúc đầy đủ, API reference, technology stack
- **TAI_LIEU_HE_THONG.md**: Tài liệu kỹ thuật 855 dòng (data flow, architecture)
- **AI_XAI_HCXAI_DEEP_DIVE.md**: Deep dive vào Model AI, XAI methods, HCXAI logic (1600+ dòng)
- **MODEL_AI_XAI_HCXAI_CORRECTNESS_AUDIT.md**: Audit report 9.2/10 (correctness verification)

### Hướng Dẫn Sử Dụng
- **HUONG_DAN_SU_DUNG.md**: Hướng dẫn từng trang web chi tiết
- **KICH_BAN_DEMO_CHI_TIET.md**: Kịch bản demo 20 phút cho seminar

### Checklist
- **CHECKLIST_DEMO.md**: Checklist chuẩn bị demo (setup, data, rehearsal)
- **UI_FEATURE_VISIBILITY.md**: 19/19 tính năng visible trên UI

### Code Quality
- **CODE_AUDIT_FINAL.md**: Code review 8.5/10 (architecture, modularity, documentation)

---

## 🎯 5 TÍNH NĂNG PHẢI THỬ

1. ✅ **Chấm 1 hồ sơ** → xem SHAP + Narrative
2. ✅ **Override AI decision** → xem Trust Dashboard cập nhật
3. ✅ **Chạy Counterfactual** → xem "thay đổi gì để flip decision"
4. ✅ **Xem Global Explainability** → ranking feature quan trọng
5. ✅ **Chấm thêm vài hồ sơ** → narrative content sẽ thay đổi theo trust state

---

## ⚡ ONE-LINER COMMANDS

```powershell
# Khởi động cả backend + frontend (chạy 2 terminal riêng)

# Terminal 1 (Backend):
cd backend && conda activate hcxai && uvicorn app.main:app --port 8000

# Terminal 2 (Frontend):
cd frontend && npm run dev
```

→ Mở http://localhost:3000 → Login → Bắt đầu!

---

**Hỗ trợ**: Nếu gặp vấn đề, check `README.md` mục "Known Limitations & Future Work" hoặc `HUONG_DAN_SU_DUNG.md` mục "Câu hỏi thường gặp"
