/**
 * collect.js — Binance Volume Collector
 * Chạy mỗi giờ qua GitHub Actions
 * Thu thập tất cả cặp *USDT trên Binance Spot và lưu vào Supabase
 */

const { createClient } = require("@supabase/supabase-js");
const ws = require("ws");

// ── Supabase client ──────────────────────────────────────────
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  {
    global: { fetch },
    realtime: { transport: ws },
  }
);

// ── Binance API ──────────────────────────────────────────────
const BINANCE_TICKER_URL = "https://api.binance.com/api/v3/ticker/24hr";

async function fetchBinanceTickers() {
  const res = await fetch(BINANCE_TICKER_URL);
  if (!res.ok) throw new Error(`Binance API error: ${res.status}`);
  const data = await res.json();

  // Chỉ lấy cặp USDT, bỏ đòn bẩy (UPUSDT, DOWNUSDT, BULLUSDT, BEARUSDT)
  return data.filter(
    (t) =>
      t.symbol.endsWith("USDT") &&
      !t.symbol.match(/(UP|DOWN|BULL|BEAR)USDT$/)
  );
}

// ── Làm tròn timestamp xuống đầu giờ ────────────────────────
function floorToHour(date = new Date()) {
  const d = new Date(date);
  d.setMinutes(0, 0, 0);
  return d.toISOString();
}

// ── Main ─────────────────────────────────────────────────────
async function main() {
  console.log(`[${new Date().toISOString()}] Starting collection...`);

  // 1. Fetch từ Binance
  const tickers = await fetchBinanceTickers();
  console.log(`Fetched ${tickers.length} USDT pairs from Binance`);

  const hourTs = floorToHour();

  // 2. Chuẩn bị payload bulk insert
  const rows = tickers.map((t) => ({
    symbol:       t.symbol,
    price:        parseFloat(t.lastPrice),
    volume:       parseFloat(t.volume),
    quote_volume: parseFloat(t.quoteVolume),
    created_at:   hourTs,
  }));

  // 3. Bulk insert + cleanup cũ chạy song song
  const [insertResult, deleteResult] = await Promise.all([
    // Insert tất cả trong 1 lần, upsert để tránh duplicate nếu cron bị trigger 2 lần
    supabase
      .from("market_data")
      .upsert(rows, { onConflict: "symbol,created_at" })
      .select("id"),

    // Xóa dữ liệu cũ hơn 15 ngày
    supabase
      .from("market_data")
      .delete()
      .lt("created_at", new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString()),
  ]);

  // 4. Kiểm tra kết quả
  if (insertResult.error) {
    console.error("Insert error:", insertResult.error.message);
    process.exit(1);
  }

  if (deleteResult.error) {
    // Không fatal — log và tiếp tục
    console.warn("Cleanup warning:", deleteResult.error.message);
  }

  console.log(`✓ Inserted/updated ${rows.length} rows at ${hourTs}`);
  console.log(`✓ Cleanup executed (records older than 15 days removed)`);
  console.log(`[${new Date().toISOString()}] Done.`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
