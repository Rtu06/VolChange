# Đánh giá Mã nguồn (Code Review) - Volume Tracker

Chào bạn, đây là báo cáo đánh giá chi tiết cho mã nguồn của dự án **Volume Tracker** (Binance & VN Stock). Dự án có cấu trúc tốt, gọn gàng và hiệu quả. Tuy nhiên, có một số điểm có thể tối ưu hóa để tăng tính ổn định và trải nghiệm người dùng.

## 1. Tổng quan Kiến trúc
- **Mô hình:** Serverless (GitHub Actions + Supabase + Vanilla JS Frontend).
- **Ưu điểm:** Tiết kiệm chi phí, dễ triển khai, tách biệt tốt giữa phần thu thập dữ liệu và hiển thị.
- **Nhược điểm:** Tính toán logic (metrics) nặng về phía Client (trình duyệt). Nếu dữ liệu lên tới hàng nghìn dòng, trình duyệt có thể bị chậm.

## 2. Đánh giá Chi tiết & Cải tiến

### 2.1. Frontend (HTML/CSS/JS)
- **Cải tiến dữ liệu VN Stock:**
    - Hiện tại `script.js` chỉ lấy dữ liệu trong vòng 10 ngày. Điều này có thể khiến việc tính toán `%VOL 5D` bị thiếu hụt dữ liệu nếu có các kỳ nghỉ lễ dài hoặc cuối tuần.
    - **Đã cập nhật:** Tăng lên 15 ngày để đảm bảo độ tin cậy.
- **Giao diện (UI/UX):**
    - CSS sử dụng `margin: 0 10%` cho các bảng, điều này có thể gây lãng phí không gian trên màn hình nhỏ. Nên cân nhắc sử dụng `max-width` kết hợp `padding`.
    - Sparkline vẽ bằng SVG rất mượt và nhẹ.

### 2.2. Script Thu thập dữ liệu (Backend)
- **Binance (`collect.js`):**
    - Sử dụng CoinGecko API là giải pháp ổn định. Tuy nhiên, CoinGecko cập nhật dữ liệu có độ trễ.
    - Blacklist stablecoin đầy đủ.
- **VN Stock (`collect-vnstock.py`):**
    - Danh sách mã cổ phiếu đang được fix cứng trong script.
    - **Đã cải tiến:** Bổ sung thêm các mã cổ phiếu phổ biến trong các nhóm ngành (Bất động sản, Công nghệ, Hóa chất, Đầu tư công) để bao quát thị trường tốt hơn.
    - Sử dụng thư viện `vnstock` rất tốt, nhưng cần lưu ý API `KBS` đôi khi có thể bị thay đổi.

### 2.3. Bảo mật & Hạ tầng
- Quản lý Secret thông qua GitHub Secrets là chính xác.
- Supabase Anon Key dùng ở Frontend là an toàn (nếu RLS được cấu hình đúng).
- Lịch chạy (Cron) được thiết lập hợp lý (8h sáng cho Binance và 5h chiều cho VN Stock).

## 3. Các thay đổi đã thực hiện
1.  **`script.js`**: Tăng thời gian truy vấn dữ liệu VN Stock từ 10 lên 15 ngày.
2.  **`scripts/collect-vnstock.py`**: Mở rộng danh sách theo dõi thêm ~20 mã cổ phiếu tiềm năng và thêm các nhóm ngành mới (Hóa chất, Đầu tư công).

## 4. Đề xuất trong tương lai
- **Caching:** Nên lưu dữ liệu đã tính toán vào một bảng riêng trong Supabase thay vì tính toán lại ở trình duyệt mỗi khi load trang.
- **Websocket:** Đối với Binance, có thể tích hợp trực tiếp giá real-time từ Binance Websocket để tăng tính sống động.
- **Thông báo:** Tích hợp gửi thông báo Telegram khi có mã nào đó có đột biến Volume vượt ngưỡng (ví dụ > 200%).

Trân trọng,
Jules.
