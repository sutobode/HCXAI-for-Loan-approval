# Hướng Dẫn Sử Dụng — HCXAI Loan Approval Platform

Tài liệu này hướng dẫn cách dùng **giao diện web** (frontend) sau khi backend và
frontend đã chạy (`http://localhost:3000`). Xem `README.md` nếu cần hướng dẫn
cài đặt/khởi động lại từ đầu.

---

## 1. Đăng nhập

Mở `http://localhost:3000`, hệ thống sẽ chuyển tới trang `/login`.

Tài khoản admin mặc định (tự tạo lần đầu backend khởi động nếu chưa có user
nào trong DB):

- Email: `admin@hcxai.local`
- Password: `ChangeMe123!`

> Nên đổi mật khẩu này sau lần đăng nhập đầu tiên nếu dùng lâu dài — đây là
> mật khẩu mặc định, ai đọc README cũng biết.

---

## 2. Vì sao dữ liệu trong web còn ít?

Đây là hiểu lầm dễ gặp, vì project có **hai loại dữ liệu hoàn toàn khác nhau**:

| Loại dữ liệu | Số lượng hiện tại | Dùng để làm gì |
|---|---|---|
| **Dataset huấn luyện** (`loan_approval_dataset.csv`) | 4.269 hồ sơ vay lịch sử | Chỉ dùng **một lần** để train model XGBoost (`python -m app.model_registry`). Không hiển thị trực tiếp thành danh sách "applications" trên web. |
| **Dữ liệu vận hành** (trong `backend/data/hcxai.db`) | Hiện tại: 1 user, **2 applications**, 2 predictions, 1 feedback | Đây là dữ liệu do chính bạn tạo ra khi **thao tác trên web** (bấm "Submit Application", cho feedback...). Mới cài xong nên còn rất ít — điều này bình thường, không phải lỗi. |

Nói cách khác: mô hình AI đã "học" từ 4.269 hồ sơ, nhưng **Dashboard, Loan
Queue, Trust Dashboard, Override Analysis...** trên web chỉ hiển thị những gì
*bạn* đã nộp/thao tác qua giao diện — hiện mới có 2 hồ sơ vì mới thử nghiệm.

### Cách để có nhiều dữ liệu hơn (trải nghiệm đầy đủ tính năng)

1. Vào **Submit Application** → nộp thêm nhiều hồ sơ với thông số khác nhau
   (thu nhập cao/thấp, CIBIL score cao/thấp, có/không tài sản...) để thấy đủ
   trường hợp Approved/Rejected.
2. Sau mỗi hồ sơ, vào chi tiết và bấm **feedback** (Approve/Reject/Override) —
   dữ liệu này nuôi Trust Calibrator, làm phong phú **Trust Dashboard** và
   **Override Analysis**.
3. (Admin) Vào **Admin · Users** tạo thêm vài tài khoản với role khác nhau
   (`risk_manager`, `loan_officer`, `customer`) để thấy sự khác biệt về quyền
   truy cập và để mỗi user có **cognitive profile** riêng.
4. Muốn xoá sạch làm lại từ đầu: dừng backend rồi chạy (xem README mục
   *Common local maintenance commands*):
   ```powershell
   Remove-Item -Recurse -Force backend/data
   Remove-Item -Recurse -Force backend/models/versions
   ```
   rồi train lại model (`python -m app.model_registry`) và khởi động lại
   backend. **Lưu ý: thao tác này xoá toàn bộ user/hồ sơ/model đã tạo.**

---

## 3. Vai trò & quyền truy cập

| Vai trò | Thấy được |
|---|---|
| **Administrator** (`admin`) | Toàn bộ trang, bao gồm quản lý user, train/activate model, và Audit Trail |
| **Risk Manager** (`risk_manager`) | Dự đoán, mọi trang XAI/HCXAI, Fairness, Monitoring, Model Center (xem + so sánh, không train/activate) |
| **Loan Officer** (`loan_officer`) | Dự đoán, giải thích, What-If, Global Explainability, Similar Cases |
| **Customer** (`customer`) | Chỉ xem giải thích và gửi feedback cho hồ sơ của mình |

Sidebar bên trái sẽ **tự ẩn** các mục bạn không có quyền — nếu không thấy một
trang nào đó, khả năng cao là do role hiện tại không được cấp quyền, không
phải lỗi.

---

## 4. Hướng dẫn từng trang (theo thứ tự trên sidebar)

### 🏠 Dashboard
Tổng quan nhanh: số quyết định gần đây, thống kê tóm tắt. Điểm khởi đầu sau
khi đăng nhập.

### 📋 Loan Queue (`/applications`)
Danh sách phân trang toàn bộ hồ sơ đã nộp qua hệ thống (chính là bảng
`predictions` trong DB). Hiện chỉ có 2 dòng vì mới thử — xem mục 2 ở trên để
có thêm dữ liệu.

### ➕ Submit Application (`/applications/new`)
**Trang quan trọng nhất để test hệ thống.** Điền form với các trường:

- Dependents (số người phụ thuộc)
- Education (Graduate / Not Graduate)
- Self-employed (Yes/No)
- Annual income
- Loan amount requested
- Loan term (months)
- Residential / Commercial / Luxury assets
- Bank assets
- Credit score (CIBIL)

Sau khi bấm submit, hệ thống trả về ngay: kết quả Approved/Rejected, biểu đồ
SHAP (yếu tố nào ảnh hưởng đến quyết định), narrative giải thích bằng ngôn
ngữ tự nhiên (do DeepSeek LLM sinh ra, hoặc template nếu chưa cấu hình API
key), và gợi ý từ Explanation Recommendation Engine (có nên xem
counterfactual, có nên xem hồ sơ tương tự...). Cuối cùng bạn có thể **cho
feedback** (đồng ý/ từ chối/ override quyết định của AI).

### 🧪 What-If Lab (`/whatif`)
Sửa thử một hồ sơ (ví dụ tăng thu nhập, giảm khoản vay) để xem xác suất được
duyệt thay đổi ra sao — không cần submit hồ sơ thật. Có cả chế độ "sensitivity
sweep": quét một trường qua toàn bộ khoảng giá trị để xem ảnh hưởng.

### 🔍 Similar Cases (`/similar-cases`)
Tìm các hồ sơ lịch sử "giống" nhất với hồ sơ đang xem (thuật toán k-NN trên
dataset huấn luyện) và tỷ lệ Approved/Rejected trong nhóm đó — giúp người
dùng đối chiếu quyết định của AI với các case thực tế tương tự.

### 🛡️ Trust Dashboard (`/trust`)
Hồ sơ "nhận thức" cá nhân của bạn: mức độ tin tưởng AI theo thời gian, tỷ lệ
đồng ý/không đồng ý với AI, xu hướng override, và (nếu là admin/risk_manager)
thống kê feedback toàn platform.

### 🕘 Explanation History (`/hcxai/explanation-history`)
Dòng thời gian toàn bộ hồ sơ bạn đã tương tác — tiện để xem lại một quyết
định cũ.

### ⚖️ Override Analysis (`/hcxai/override-analysis`) — *admin, risk_manager*
Tỷ lệ con người **không đồng ý** với AI, chia theo mức độ tự tin (confidence)
của AI — dùng để đánh giá mô hình có "well-calibrated" hay không.

### 🧩 Global Explainability (`/explainability/global`) — *admin, risk_manager, loan_officer*
Xếp hạng tầm quan trọng trung bình của từng feature trên toàn bộ dataset
(mean |SHAP|). Hiện tại `cibil_score` chiếm ~49% mức độ ảnh hưởng.

### ⚖️ Fairness Report (`/fairness`) — *admin, risk_manager*
Kiểm tra công bằng (demographic parity, luật four-fifths) theo `education` và
`self_employed` — đây là hai thuộc tính duy nhất trong dataset có thể dùng
làm proxy phân tích công bằng (dataset không có giới tính/tuổi/chủng tộc).
Có gợi ý điều chỉnh ngưỡng, nhưng **luôn cần con người/compliance duyệt
trước khi áp dụng** — hệ thống không tự động thay đổi gì.

### 📈 Model Monitoring (`/monitoring`) — *admin, risk_manager*
Chỉ số huấn luyện + phát hiện feature drift / prediction drift (kiểm định
Kolmogorov–Smirnov) so với dữ liệu gốc.

### 🖥️ AI Model Center (`/model-center`) — *admin, risk_manager*
Danh sách các phiên bản model đã train (hiện có v1, v2), so sánh chỉ số giữa
hai phiên bản, và (chỉ admin) train phiên bản mới / kích hoạt (activate)
phiên bản làm "champion".

### 👤 Admin · Users (`/admin/users`) — *chỉ admin*
Tạo tài khoản mới, gán role.

### 📜 Admin · Audit Trail (`/admin/audit`) — *chỉ admin*
Nhật ký mọi hành động quan trọng trên platform (ai làm gì, khi nào) — phục vụ
governance/compliance.

---

## 5. Gợi ý một luồng trải nghiệm đầy đủ

1. Đăng nhập bằng admin.
2. **Submit Application** 5–6 hồ sơ khác nhau (cố tình có cả case rõ ràng
   được duyệt, rõ ràng bị từ chối, và vài case "mập mờ" — CIBIL trung bình,
   thu nhập vừa phải).
3. Với mỗi hồ sơ: xem SHAP + narrative, thử mở **counterfactual** và **LIME
   cross-check** ở trang chi tiết hồ sơ, rồi bấm feedback (thử cả Approve,
   Reject, và Override để xem khác biệt).
4. Vào **Trust Dashboard** xem hồ sơ tin tưởng của chính bạn cập nhật ra sao.
5. Tạo thêm 1 user role `loan_officer` ở **Admin · Users**, đăng nhập bằng
   user đó, lặp lại bước 2–4 để thấy Override Analysis có nhiều điểm dữ liệu
   hơn.
6. Quay lại admin, xem **Fairness Report**, **Model Monitoring**, **AI Model
   Center** để thấy các trang "toàn cục" đã có ý nghĩa hơn.

---

## 6. Câu hỏi thường gặp

**Vì sao chỉ số LIME (R²) đôi khi âm?**
Đây là hiện tượng đã biết, không phải lỗi: LIME cố fit một đường thẳng
(linear surrogate) vào một model dạng cây (tree ensemble) vốn có ranh giới
quyết định dạng bậc thang — ở gần điểm rẽ nhánh hoặc vùng AI rất tự tin, việc
fit tuyến tính có thể cho R² âm. Thứ tự/chiều ảnh hưởng của feature vẫn có giá
trị tham khảo, chỉ nên coi R² âm là "cảnh báo độ khớp thấp", không phải
"kết quả sai".

**Vì sao Fairness Report không có giới tính/tuổi?**
Dataset gốc (`loan_approval_dataset.csv`) không thu thập các thuộc tính nhân
khẩu học được bảo vệ đó — chỉ có `education` và `self_employed` để phân
tích. Muốn phân tích công bằng đầy đủ hơn cần dataset có các trường đó.

**Counterfactual chạy hơi lâu (~4 giây) có bình thường không?**
Có — đây là thuật toán tìm kiếm heuristic (không đảm bảo tối ưu tuyệt đối) tự
viết, đủ tốt để tìm ra một thay đổi tối thiểu khả thi, đổi lại tốc độ không
tức thời như tra cứu.

**Đăng nhập xong bị văng ra ngoài / phiên hết hạn?**
JWT mặc định hết hạn sau 8 giờ (`ACCESS_TOKEN_EXPIRE_MINUTES`). Nếu chưa đặt
`JWT_SECRET_KEY` cố định trong `.env`, mỗi lần restart backend sẽ sinh secret
ngẫu nhiên mới → toàn bộ phiên đăng nhập cũ mất hiệu lực ngay cả khi chưa hết
8 giờ. Đặt `JWT_SECRET_KEY` cố định trong `.env` nếu muốn phiên đăng nhập ổn
định qua các lần restart.
