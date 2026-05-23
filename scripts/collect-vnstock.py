import os
import pandas as pd
from datetime import datetime, timedelta
from supabase import create_client
from vnstock import Quote
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
    "Ngân hàng":       ["VCB", "BID", "CTG", "MBB", "TCB", "ACB", "STB", "VPB"],
    "Chứng khoán":     ["SSI", "VND", "HCM", "VCI", "FTS"],
    "Bất động sản":    ["VIC", "VHM", "NVL", "DXG", "PDR", "KDH"],
    "Thép & Vật liệu": ["HPG", "HSG", "NKG"],
    "Công nghệ":       ["FPT", "CMG"],
    "Tiêu dùng":       ["MWG", "DGW", "PNJ"],
    "Thực phẩm":       ["VNM", "MSN", "DBC"],
    "Năng lượng":      ["GAS", "POW", "PVD", "PVS"],
    "Điện & Tiện ích": ["REE", "NT2", "PC1"],
    "Logistics":       ["GMD", "HAH", "VSC"],
    "Hàng không":      ["HVN", "VJC"],
}

ALL_SYMBOLS      = []
SYMBOL_TO_SECTOR = {}
for sector, symbols in SECTORS.items():
    for s in symbols:
        ALL_SYMBOLS.append(s)
        SYMBOL_TO_SECTOR[s] = sector

# ─────────────────────────────────────────────
# DATE
# ─────────────────────────────────────────────
today     = datetime.now()
today_str = today.strftime("%Y-%m-%d")

print(f"Collecting VNStock intraday active volume — {today_str}")
print(f"Total symbols: {len(ALL_SYMBOLS)}")

# ─────────────────────────────────────────────
# QUOTE — dùng vnstock (free) với source KBS
# KBS ổn định, không bị chặn IP trên cloud
# ─────────────────────────────────────────────
rows = []

for symbol in ALL_SYMBOLS:
    try:
        print(f"Fetching {symbol} ...", end=" ", flush=True)

        quote = Quote(symbol=symbol, source="KBS")
        df = quote.intraday(page_size=10000, show_log=False)

        if df is None or df.empty:
            print("empty — skip")
            time.sleep(1)
            continue

        # Giá KBS đơn vị VND (không nhân 1000)
        df["value_vnd"] = df["price"] * df["volume"]

        active = df[df["match_type"].isin(["Buy", "Sell"])]

        buy_val  = active[active["match_type"] == "Buy"]["value_vnd"].sum()
        sell_val = active[active["match_type"] == "Sell"]["value_vnd"].sum()
        total    = buy_val + sell_val

        print(f"Mua={buy_val/1e9:.1f}B  Bán={sell_val/1e9:.1f}B  Total={total/1e9:.1f}B VND")

        rows.append({
            "symbol": symbol,
            "sector": SYMBOL_TO_SECTOR[symbol],
            "date":   today_str,
            "volume": float(active["volume"].sum()),  # KL chủ động (cổ phiếu)
            "value":  float(total),                   # GT chủ động (VND)
        })

    except Exception as e:
        print(f"ERROR: {e}")

    # KBS rate limit ~60 req/min với community key → 1s/request là đủ
    time.sleep(1)

print(f"\nCollected: {len(rows)}/{len(ALL_SYMBOLS)} symbols")

if not rows:
    raise SystemExit("No data collected — aborting upsert")

# ─────────────────────────────────────────────
# UPSERT — conflict key: (symbol, date)
# ─────────────────────────────────────────────
supabase.table("vn_market_data").upsert(
    rows,
    on_conflict="symbol,date",
    ignore_duplicates=False,
).execute()

print(f"Upsert done: {len(rows)} rows")

# ─────────────────────────────────────────────
# CLEANUP — giữ 30 ngày để tính %VOL 5D
# ─────────────────────────────────────────────
cutoff = (today - timedelta(days=30)).strftime("%Y-%m-%d")
supabase.table("vn_market_data").delete().lt("date", cutoff).execute()
print(f"Cleanup done — data kept since {cutoff}")
