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
    "Bất động sản":    ["VIC", "VHM", "NVL", "DXG", "PDR", "KDH", "DIG", "NLG"],
    "Thép & Vật liệu": ["HPG", "HSG", "NKG", "VGS"],
    "Công nghệ":       ["FPT", "CMG", "CTR", "ELC"],
    "Tiêu dùng":       ["MWG", "DGW", "PNJ", "FRT"],
    "Thực phẩm":       ["VNM", "MSN", "DBC", "PAN"],
    "Năng lượng":      ["GAS", "POW", "PVD", "PVS", "PLX"],
    "Điện & Tiện ích": ["REE", "NT2", "PC1", "GEX", "HDG"],
    "Logistics":       ["GMD", "HAH", "VSC", "PVT"],
    "Hàng không":      ["HVN", "VJC", "ACV"],
    "Hóa chất":        ["DGC", "DCM", "DPM", "CSV"],
    "Đầu tư công":     ["HHV", "VCG", "LCG", "C4G", "FCN"],
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

print(f"Collecting VNStock daily volume — {today_str}")
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

        index_vol = float(today_row["volume"])

        # Ưu tiên dùng cột value từ sàn (chính xác hơn), fallback volume × close
        if "value" in df_hist.columns and float(today_row["value"]) > 0:
            index_value = float(today_row["value"])
            print(f"Vol={index_vol/1e6:.1f}M cp  GT={index_value/1e9:.0f}B VND (from value col)")
        else:
            index_value = index_vol * float(today_row["close"])
            print(f"Vol={index_vol/1e6:.1f}M cp  GT≈{index_value/1e9:.0f}B VND (vol×close)")

        if index_vol == 0:
            print("market closed — skip")
            time.sleep(1)
            continue

        rows.append({
            "symbol": db_symbol,
            "sector": "Toàn sàn",
            "date":   today_str,
            "volume": int(index_vol),
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
        df = quote.history(
            symbol=symbol,
            start=today_str,
            end=today_str,
            interval="1D",
        )

        if df is None or df.empty:
            print("no data — skip")
            time.sleep(1)
            continue

        row = df.iloc[0]
        vol = float(row["volume"])

        if vol == 0:
            print("zero volume — skip")
            time.sleep(1)
            continue

        # Ưu tiên dùng cột value từ sàn (chính xác hơn), fallback volume × close
        if "value" in df.columns and float(row["value"]) > 0:
            value = float(row["value"])
            print(f"Vol={vol/1e6:.2f}M cp  GT={value/1e9:.1f}B VND (from value col)")
        else:
            value = vol * float(row["close"])
            print(f"Vol={vol/1e6:.2f}M cp  GT≈{value/1e9:.1f}B VND (vol×close)")

        rows.append({
            "symbol": symbol,
            "sector": SYMBOL_TO_SECTOR[symbol],
            "date":   today_str,
            "volume": int(vol),
            "value":  value,
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
