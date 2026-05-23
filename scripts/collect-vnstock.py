import os
import pandas as pd
from datetime import datetime, timedelta
from supabase import create_client
from vnstock_data import Quote
import time

# ─────────────────────────────────────────────
# SUPABASE
# ─────────────────────────────────────────────
SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY")

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

# ─────────────────────────────────────────────
# DANH SÁCH CỔ PHIẾU + SECTOR
# ─────────────────────────────────────────────
SECTORS = {
    "Ngân hàng": ["VCB", "BID", "CTG", "MBB", "TCB", "ACB", "STB", "VPB"],
    "Chứng khoán": ["SSI", "VND", "HCM", "VCI", "FTS"],
    "Bất động sản": ["VIC", "VHM", "NVL", "DXG", "PDR", "KDH"],
    "Thép & Vật liệu": ["HPG", "HSG", "NKG"],
    "Công nghệ": ["FPT", "CMG"],
    "Tiêu dùng": ["MWG", "DGW", "PNJ"],
    "Thực phẩm": ["VNM", "MSN", "DBC"],
    "Năng lượng": ["GAS", "POW", "PVD", "PVS"],
    "Điện & Tiện ích": ["REE", "NT2", "PC1"],
    "Logistics": ["GMD", "HAH", "VSC"],
    "Hàng không": ["HVN", "VJC"]
}

# flatten
ALL_SYMBOLS = []
SYMBOL_TO_SECTOR = {}

for sector, symbols in SECTORS.items():
    for s in symbols:
        ALL_SYMBOLS.append(s)
        SYMBOL_TO_SECTOR[s] = sector

# ─────────────────────────────────────────────
# DATE — chỉ upsert ngày hôm nay
# ─────────────────────────────────────────────
today      = datetime.now()
today_str  = today.strftime("%Y-%m-%d")

print(f"Collecting VNStock intraday active volume — {today_str}")

rows = []

# ─────────────────────────────────────────────
# FETCH DATA — intraday để tính tổng mua + bán chủ động
# ─────────────────────────────────────────────
quote = Quote(
    source="VCI",
    api_key=os.environ.get("VNSTOCK_API_KEY")
)

for symbol in ALL_SYMBOLS:
    try:
        print("Fetching intraday:", symbol)

        df = quote.intraday(symbol=symbol, page_size=10000)

        if df is None or df.empty:
            print("  Empty:", symbol)
            time.sleep(1)
            continue

        # Tính giá trị từng lệnh (giá đơn vị nghìn VND × volume × 1000)
        df["value_vnd"] = df["price"] * df["volume"] * 1000

        # Chỉ lấy lệnh mua + bán chủ động
        active_df   = df[df["match_type"].isin(["Buy", "Sell"])]
        active_value = active_df["value_vnd"].sum()

        # Log để debug
        buy_val  = active_df[active_df["match_type"] == "Buy"]["value_vnd"].sum()
        sell_val = active_df[active_df["match_type"] == "Sell"]["value_vnd"].sum()
        print(f"  Mua={buy_val/1e9:.1f}B  Bán={sell_val/1e9:.1f}B  Total={active_value/1e9:.1f}B VND")

        rows.append({
            "symbol":  symbol,
            "sector":  SYMBOL_TO_SECTOR[symbol],
            "date":    today_str,
            "volume":  float(active_df["volume"].sum()),   # tổng KL chủ động
            "value":   float(active_value),                # tổng GT chủ động (VND)
        })

        time.sleep(1)  # tránh rate limit 60 req/min

    except Exception as e:
        print(f"  {symbol} error:", e)
        time.sleep(1)

print(f"\nTotal symbols collected: {len(rows)}")

if len(rows) == 0:
    raise Exception("No VN stock rows collected")

# ─────────────────────────────────────────────
# UPSERT — mỗi ngày 1 row per symbol
# ─────────────────────────────────────────────
response = supabase.table("vn_market_data").upsert(
    rows,
    on_conflict="symbol,date",
    ignore_duplicates=False
).execute()

print("Upsert done:", len(rows), "rows")

# ─────────────────────────────────────────────
# CLEAN OLD DATA — giữ 30 ngày để tính %VOL 5D
# ─────────────────────────────────────────────
cutoff = (today - timedelta(days=30)).strftime("%Y-%m-%d")

supabase.table("vn_market_data") \
    .delete() \
    .lt("date", cutoff) \
    .execute()

print("Cleanup done — kept data since", cutoff)
