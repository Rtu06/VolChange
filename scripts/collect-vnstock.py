import os
import pandas as pd
from datetime import datetime, timedelta
from supabase import create_client
from vnstock import Vnstock

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
# DATE
# ─────────────────────────────────────────────
today = datetime.now()
start_date = (today - timedelta(days=20)).strftime("%Y-%m-%d")
end_date = today.strftime("%Y-%m-%d")

print(f"Collecting VNStock data {start_date} -> {end_date}")

rows = []

# ─────────────────────────────────────────────
# FETCH DATA
# ─────────────────────────────────────────────
for symbol in ALL_SYMBOLS:
    try:
        print("Fetching", symbol)

        stock = Vnstock().stock(symbol=symbol, source="VCI")

        df = stock.quote.history(
            start=start_date,
            end=end_date,
            interval="1D"
        )

        if df.empty:
            print("Empty:", symbol)
            continue

        for _, r in df.iterrows():

            date_str = str(r["time"]).split(" ")[0]

            rows.append({
                "symbol": symbol,
                "sector": SYMBOL_TO_SECTOR[symbol],
                "date": date_str,
                "close": float(r["close"]),
                "volume": float(r["volume"]),
                "value": float(r["volume"]) * float(r["close"])
            })

    except Exception as e:
        print(symbol, e)

print("Total rows:", len(rows))

if len(rows) == 0:
    raise Exception("No VN stock rows collected")

# ─────────────────────────────────────────────
# UPSERT
# ─────────────────────────────────────────────
response = supabase.table("vn_market_data").upsert(
    rows,
    on_conflict="symbol,date",
    ignore_duplicates=False
).execute()

print("Upsert done")

# ─────────────────────────────────────────────
# CLEAN OLD DATA
# ─────────────────────────────────────────────
cutoff = (today - timedelta(days=30)).strftime("%Y-%m-%d")

supabase.table("vn_market_data") \
    .delete() \
    .lt("date", cutoff) \
    .execute()

print("Cleanup done")