/**
 * collect.js — Binance Daily Volume Collector via CoinGecko
 * Chạy lúc 8h sáng mỗi ngày qua GitHub Actions
 * Lấy dữ liệu NGÀY HÔM TRƯỚC: giá đóng cửa + volume 24h
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

// ── Stablecoin blacklist ─────────────────────────────────────
const STABLECOINS = new Set([
  "USDT","USDC","BUSD","DAI","TUSD","USDP","USDD","GUSD","FRAX","LUSD",
  "SUSD","CUSD","USDJ","USDN","TRIBE","FEI","OUSD","HUSD","USDX","USDK",
  "FDUSD","PYUSD","EURC","EURS","EURT","XAUT","PAXG","WBTC","WETH","WBNB",
]);

// ── Lấy ngày hôm qua dạng YYYY-MM-DD ────────────────────────
function getYesterday() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().split("T")[0]; // "2025-05-08"
}

// ── CoinGecko: lấy tất cả Binance/USDT tickers ──────────────
// Endpoint /exchanges/binance/tickers trả về volume 24h rolling
// và giá last — ta map đây là "ngày hôm qua" vì chạy 8h sáng
async function fetchBinanceTickers() {
  const results = [];
  let page = 1;
  const perPage = 100;
  const apiKey = process.env.COINGECKO_API_KEY;

  while (true) {
    const url =
      `https://api.coingecko.com/api/v3/exchanges/binance/tickers` +
      `?page=${page}&per_page=${perPage}`;

    console.log(`Fetching CoinGecko page ${page}...`);

    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        "x-cg-demo-api-key": apiKey,
      },
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`CoinGecko error ${res.status}: ${body}`);
    }

    const data = await res.json();
    const tickers = data.tickers || [];

    if (tickers.length === 0) break;

    const filtered = tickers.filter(
      (t) =>
        t.target === "USDT" &&
        !STABLECOINS.has(t.base) &&
        t.converted_volume?.usd > 0
    );

    results.push(...filtered);

    if (tickers.length < perPage) break;
    page++;

    // Demo key: 30 req/min → 2s delay
    await new Promise((r) => setTimeout(r, 2000));
  }

  return results;
}

// ── Main ─────────────────────────────────────────────────────
async function main() {
  const yesterday = getYesterday();
  console.log(`[${new Date().toISOString()}] Collecting data for date: ${yesterday}`);

  const tickers = await fetchBinanceTickers();
  console.log(`Fetched ${tickers.length} USDT pairs from CoinGecko (Binance)`);

  if (tickers.length === 0) {
    console.error("No tickers fetched, aborting.");
    process.exit(1);
  }

  // Map tickers → rows
  const rows = tickers.map((t) => ({
    symbol:       `${t.base}USDT`,
    price:        parseFloat(t.last),                           // giá đóng cửa gần nhất
    volume:       parseFloat(t.volume),                         // volume base asset 24h
    quote_volume: parseFloat(t.converted_volume?.usd || 0),     // volume USD 24h
    date:         yesterday,
  }));

  // Dedup: giữ row có quote_volume cao nhất nếu trùng symbol
  const deduped = Object.values(
    rows.reduce((acc, row) => {
      if (
        !acc[row.symbol] ||
        row.quote_volume > acc[row.symbol].quote_volume
      ) {
        acc[row.symbol] = row;
      }
      return acc;
    }, {})
  );

  console.log(`Upserting ${deduped.length} rows for ${yesterday}...`);

  // Upsert (idempotent nếu chạy lại)
  const { error: insertErr } = await supabase
    .from("market_data")
    .upsert(deduped, { onConflict: "symbol,date" });

  if (insertErr) {
    console.error("Insert error:", insertErr.message);
    process.exit(1);
  }

  // Xoá dữ liệu cũ hơn 30 ngày
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - 30);
  const cutoffDate = cutoff.toISOString().split("T")[0];

  const { error: deleteErr } = await supabase
    .from("market_data")
    .delete()
    .lt("date", cutoffDate);

  if (deleteErr) {
    console.warn("Cleanup warning:", deleteErr.message);
  } else {
    console.log(`✓ Cleanup: removed rows older than ${cutoffDate}`);
  }

  console.log(`✓ Inserted/updated ${deduped.length} rows for ${yesterday}`);
  console.log(`[${new Date().toISOString()}] Done.`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
