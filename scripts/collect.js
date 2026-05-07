/**
 * collect.js — Binance Volume Collector via CoinGecko
 * Chạy mỗi giờ qua GitHub Actions
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

// ── CoinGecko: lấy tất cả trang của Binance tickers ─────────
async function fetchCoinGeckoTickers() {
  const results = [];
  let page = 1;
  const perPage = 100;
  const apiKey = process.env.COINGECKO_API_KEY;

  while (true) {
    const url = `https://api.coingecko.com/api/v3/exchanges/binance/tickers?page=${page}&per_page=${perPage}`;
    console.log(`Fetching page ${page}...`);

    const res = await fetch(url, {
      headers: {
        "Accept": "application/json",
        "x-cg-demo-api-key": apiKey,
      },
    });

    if (!res.ok) throw new Error(`CoinGecko API error: ${res.status}`);

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

    // Demo key: 30 req/min → delay 2s để an toàn
    await new Promise((r) => setTimeout(r, 2000));
  }

  return results;
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

  const tickers = await fetchCoinGeckoTickers();
  console.log(`Fetched ${tickers.length} USDT pairs from CoinGecko (Binance)`);

  if (tickers.length === 0) {
    console.error("No tickers fetched, aborting.");
    process.exit(1);
  }

  const hourTs = floorToHour();

  const rows = tickers.map((t) => ({
    symbol:       `${t.base}USDT`,
    price:        parseFloat(t.last),
    volume:       parseFloat(t.volume),
    quote_volume: parseFloat(t.converted_volume?.usd || 0),
    created_at:   hourTs,
  }));

  const deduped = Object.values(
    rows.reduce((acc, row) => {
      if (!acc[row.symbol] || row.quote_volume > acc[row.symbol].quote_volume) {
        acc[row.symbol] = row;
      }
      return acc;
    }, {})
  );

  const [insertResult, deleteResult] = await Promise.all([
    supabase
      .from("market_data")
      .upsert(deduped, { onConflict: "symbol,created_at" })
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
  console.log(`✓ Cleanup executed`);
  console.log(`[${new Date().toISOString()}] Done.`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
