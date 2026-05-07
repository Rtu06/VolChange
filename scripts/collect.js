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
const BINANCE_ENDPOINTS = [
  "https://api.binance.com/api/v3/ticker/24hr",
  "https://api1.binance.com/api/v3/ticker/24hr",
  "https://api2.binance.com/api/v3/ticker/24hr",
  "https://api3.binance.com/api/v3/ticker/24hr",
];

async function fetchBinanceTickers() {
  let lastError;

  for (const url of BINANCE_ENDPOINTS) {
    try {
      console.log(`Trying endpoint: ${url}`);
      const res = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; VolumeTracker/1.0)",
          "Accept": "application/json",
        },
      });

      if (!res.ok) {
        lastError = new Error(`HTTP ${res.status} from ${url}`);
        console.warn(`Failed: ${lastError.message}`);
        continue;
      }

      const data = await res.json();

      return data.filter(
        (t) =>
          t.symbol.endsWith("USDT") &&
          !t.symbol.match(/(UP|DOWN|BULL|BEAR)USDT$/)
      );
    } catch (err) {
      lastError = err;
      console.warn(`Error with ${url}: ${err.message}`);
    }
  }

  throw lastError || new Error("All Binance endpoints failed");
}

function floorToHour(date = new Date()) {
  const d = new Date(date);
  d.setMinutes(0, 0, 0);
  return d.toISOString();
}

async function main() {
  console.log(`[${new Date().toISOString()}] Starting collection...`);

  const tickers = await fetchBinanceTickers();
  console.log(`Fetched ${tickers.length} USDT pairs from Binance`);

  const hourTs = floorToHour();

  const rows = tickers.map((t) => ({
    symbol:       t.symbol,
    price:        parseFloat(t.lastPrice),
    volume:       parseFloat(t.volume),
    quote_volume: parseFloat(t.quoteVolume),
    created_at:   hourTs,
  }));

  const [insertResult, deleteResult] = await Promise.all([
    supabase
      .from("market_data")
      .upsert(rows, { onConflict: "symbol,created_at" })
      .select("id"),

    supabase
      .from("market_data")
      .delete()
      .lt("created_at", new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString()),
  ]);

  if (insertResult.error) {
    console.error("Insert error:", insertResult.error.message);
    process.exit(1);
  }

  if (deleteResult.error) {
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
