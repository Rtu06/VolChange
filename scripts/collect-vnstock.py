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


# ─────────────────────────────────────────────
# DATE
# ─────────────────────────────────────────────
today     = datetime.now()
today_str = today.strftime("%Y-%m-%d")

print(f"Collecting VNStock daily volume — {today_str}")
print(f"Total symbols: {len(ALL_SYMBOLS)}")

# ─────────────────────────────────────────────
# FETCH — INDIVIDUAL STOCKS
# ─────────────────────────────────────────────
rows = []

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
            value = vol * float(row["close"])*1000
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
