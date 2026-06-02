import os
import requests
from datetime import datetime
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
        # Dùng params= thay vì nối string để tránh mất params khi redirect
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
            print(f"{db_symbol}: API trả về Success=false — {data.get('Message')}")
            continue

        items = data.get("Data", {}).get("Data", [])
        if not items:
            print(f"{db_symbol} ({cafef_symbol}): no data — market closed?")
            continue

        item = items[0]

        # Lấy ngày từ response — CafeF có thể trả ngày gần nhất, không phải today
        raw_date = item.get("Ngay", "")
        try:
            record_date = datetime.strptime(raw_date[:10], "%Y/%m/%d").strftime("%Y-%m-%d")
        except Exception:
            record_date = today_str
        print(f"  {db_symbol} record date: {record_date}")

        volume   = item.get("KhoiLuongKhopLenh", 0) or 0
        # GiaTriKhopLenh đơn vị tỷ VND → nhân 1e9 ra VND
        value_ty = item.get("GiaTriKhopLenh", 0) or 0
        value    = float(value_ty) * 1_000_000_000

        if volume == 0:
            print(f"{db_symbol}: zero volume — skip")
            continue

        print(f"{db_symbol}: Vol={volume/1e6:.0f}M cp  GT={value/1e9:.0f}B VND")

        rows.append({
            "symbol": db_symbol,
            "sector": "Toàn sàn",
            "date":   record_date,   # ← dùng ngày từ response, không phải today
            "volume": int(volume),
            "value":  value,
        })

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
