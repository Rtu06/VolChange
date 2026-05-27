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
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Referer": "https://cafef.vn/",
}

INDICES = {
    "HOSE": "VNINDEX",
    "HNX":  "HNXINDEX",
}

today      = datetime.now()
today_str  = today.strftime("%Y-%m-%d")
cafef_date = today.strftime("%d/%m/%Y")

print(f"Collecting market index from CafeF — {today_str}")

# ─────────────────────────────────────────────
# FETCH
# ─────────────────────────────────────────────
rows = []

for db_symbol, cafef_symbol in INDICES.items():
    try:
        url = (
            "https://s.cafef.vn/ajax/PageNew/DataHistory/PriceHistory.ashx"
            f"?Symbol={cafef_symbol}"
            f"&StartDate={cafef_date}&EndDate={cafef_date}"
            "&PageIndex=1&PageSize=1"
        )
        resp = requests.get(url, headers=HEADERS, timeout=10)
        resp.raise_for_status()
        data = resp.json()

        items = data.get("Data", {}).get("Data", [])
        if not items:
            print(f"{db_symbol} ({cafef_symbol}): no data — market closed?")
            continue

        item = items[0]

        # Debug lần đầu: in keys để xác nhận field name
        print(f"  Fields: {list(item.keys())}")

        volume = item.get("TongKhoiLuongKhopLenh", 0) or 0
        # Đơn vị CafeF: tỷ VND → nhân 1e9 để ra VND
        value_ty = item.get("TongGiaTriKhopLenh", 0) or 0
        value = float(value_ty) * 1_000_000_000

        if volume == 0:
            print(f"{db_symbol}: zero volume — market closed")
            continue

        print(f"{db_symbol}: Vol={volume/1e6:.0f}M cp  GT={value/1e9:.0f}B VND")

        rows.append({
            "symbol": db_symbol,
            "sector": "Toàn sàn",
            "date":   today_str,
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