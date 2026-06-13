import os
import requests
from datetime import datetime, timedelta
from supabase import create_client

# ─────────────────────────────────────────────
# SUPABASE
# ─────────────────────────────────────────────
SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY")

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

HEADERS = {
    "User-Agent":      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Referer":         "https://cafef.vn/",
    "Accept":          "application/json, text/plain, */*",
    "Accept-Language": "vi-VN,vi;q=0.9",
}

INDICES = {
    "HOSE": "VNINDEX",
    "HNX":  "HNX-INDEX",   # ← đúng tên CafeF dùng
}

today      = datetime.now()
today_str  = today.strftime("%Y-%m-%d")
cafef_date = today.strftime("%Y/%m/%d")

print(f"Collecting market index from CafeF — {today_str}")

# ─────────────────────────────────────────────
# FETCH
# ─────────────────────────────────────────────
rows = []

BASE_URL = "https://cafef.vn/du-lieu/ajax/pagenew/datahistory/pricehistory.ashx"

for db_symbol, cafef_symbol in INDICES.items():
    try:
        row_data = None
        for days_back in range(1, 7):  # thử tối đa 5 ngày lùi
            target = today - timedelta(days=days_back)
            cafef_date = target.strftime("%Y/%m/%d")

            params = {
                "Symbol":    cafef_symbol,
                "StartDate": cafef_date,
                "EndDate":   cafef_date,
                "PageIndex": "1",
                "PageSize":  "1",
            }

            resp = requests.get(BASE_URL, params=params, headers=HEADERS, timeout=10)
            resp.raise_for_status()
            data = resp.json()

            if not data.get("Success"):
                print(f"{db_symbol}: API Success=false — {data.get('Message')}")
                break

            items = data.get("Data", {}).get("Data", [])
            if not items:
                print(f"{db_symbol}: no data for {cafef_date} — thử ngày trước")
                continue

            item = items[0]
            value_ty = item.get("GiaTriKhopLenh", 0) or 0
            value    = float(value_ty) * 1_000_000_000

            if value == 0:
                print(f"{db_symbol}: GT=0 cho {cafef_date} — thử ngày trước")
                continue

            raw_date = item.get("Ngay", "")
            try:
                record_date = datetime.strptime(raw_date[:10], "%Y/%m/%d").strftime("%Y-%m-%d")
            except Exception:
                record_date = target.strftime("%Y-%m-%d")

            volume = item.get("KhoiLuongKhopLenh", 0) or 0
            print(f"{db_symbol} ({record_date}): Vol={volume/1e6:.0f}M cp  GT={value/1e9:.0f}B VND")

            row_data = {
                "symbol": db_symbol,
                "sector": "Toàn sàn",
                "date":   record_date,
                "volume": int(volume),
                "value":  value,
            }
            break

        if row_data:
            rows.append(row_data)
        else:
            print(f"{db_symbol}: không tìm được dữ liệu GT>0 trong 5 ngày — skip")

    except Exception as e:
        print(f"{db_symbol}: ERROR — {e}")

# ─────────────────────────────────────────────
# UPSERT
# ─────────────────────────────────────────────
if not rows:
    print("No index data — exiting cleanly")
    raise SystemExit(0)

supabase.table("vn_market_data").upsert(
    rows,
    on_conflict="symbol,date",
    ignore_duplicates=False,
).execute()

print(f"Upsert done: {len(rows)} rows")