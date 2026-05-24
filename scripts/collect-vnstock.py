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

# Chỉ số toàn sàn: VNINDEX → lưu là HOSE, HNX → lưu là HNX
MARKET_INDICES = {
    "HOSE": "VNINDEX",  # symbol lưu DB : symbol gọi API
    "HNX":  "HNX",
}

# ─────────────────────────────────────────────
# DATE
# ─────────────────────────────────────────────
today     = datetime.now()
today_str = today.strftime("%Y-%m-%d")

print(f"Collecting VNStock intraday active volume — {today_str}")
print(f"Total symbols: {len(ALL_SYMBOLS)}")

# ─────────────────────────────────────────────
# FETCH — MARKET INDICES (history volume)
# ─────────────────────────────────────────────
rows = []

print("\n── Market Indices ──")
for db_symbol, api_symbol in MARKET_INDICES.items():
    try:
        print(f"Fetching index {api_symbol} ({db_symbol}) ...", end=" ", flush=True)

        quote = Quote(symbol=api_symbol, source="KBS")
        # Lấy 2 ngày: hôm nay + hôm qua để tính % (lấy nhiều hơn để chắc)
        df_hist = quote.history(
            symbol=api_symbol,
            length="5D",
            interval="1D",
        )

        if df_hist is None or df_hist.empty:
            print("empty — skip")
            time.sleep(1)
            continue

        df_hist = df_hist.sort_values("time", ascending=False).reset_index(drop=True)
        today_row = df_hist.iloc[0]

        # value = volume * close (ước tính GT giao dịch toàn sàn, VND)
        # KBS history: volume đơn vị cổ phiếu, close đơn vị VND
        index_value = float(today_row["volume"]) * float(today_row["close"])
        index_vol   = float(today_row["volume"])

        if index_value == 0:
            print("market closed — skip")
            time.sleep(1)
            continue

        print(f"Vol={index_vol/1e6:.1f}M cp  GT≈{index_value/1e9:.0f}B VND")

        rows.append({
            "symbol": db_symbol,
            "sector": "Toàn sàn",
            "date":   today_str,
            "volume": index_vol,
            "value":  index_value,
        })

    except Exception as e:
        print(f"ERROR: {e}")

    time.sleep(1)

# ─────────────────────────────────────────────
# FETCH — INDIVIDUAL STOCKS
# ─────────────────────────────────────────────
print("\n── Individual Stocks ──")
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

        active   = df[df["match_type"].isin(["Buy", "Sell"])]
        buy_val  = active[active["match_type"] == "Buy"]["value_vnd"].sum()
        sell_val = active[active["match_type"] == "Sell"]["value_vnd"].sum()
        total    = buy_val + sell_val

        # Thị trường đóng cửa (T7, CN, lễ) → bỏ qua, không upsert row rỗng
        if total == 0:
            print("market closed — skip")
            time.sleep(1)
            continue

        print(f"Mua={buy_val/1e9:.1f}B  Bán={sell_val/1e9:.1f}B  Total={total/1e9:.1f}B VND")

        rows.append({
            "symbol": symbol,
            "sector": SYMBOL_TO_SECTOR[symbol],
            "date":   today_str,
            "volume": float(active["volume"].sum()),
            "value":  float(total),
        })

    except Exception as e:
        print(f"ERROR: {e}")

    time.sleep(1)  # KBS community: 60 req/min

print(f"\nCollected: {len(rows)}/{len(ALL_SYMBOLS)} symbols")

if not rows:
    print("No trading data today (market closed?) — exiting cleanly")
    raise SystemExit(0)

# ─────────────────────────────────────────────
# UPSERT
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
