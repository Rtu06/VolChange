/**
 * collect_vn.js — Vietnam Stock Daily Volume Collector
 * Nguồn: TCBS public API (không cần auth)
 * Chạy T2–T6 lúc 09:15 UTC (16:15 giờ VN) qua GitHub Actions
 * Lấy dữ liệu ngày hiện tại (phiên vừa đóng cửa)
 */

const { createClient } = require("@supabase/supabase-js");
const axios = require("axios");

// ── Supabase client ──────────────────────────────────────────
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ══════════════════════════════════════════════════════════════
// DANH SÁCH MÃ VN THEO NGÀNH (~70 mã, ưu tiên vốn hóa lớn)
// ══════════════════════════════════════════════════════════════
const VN_SYMBOLS = [
  // ── Ngân hàng (14 mã) ─────────────────────────────────────
  { symbol: "VCB",  sector: "Ngân hàng" },
  { symbol: "BID",  sector: "Ngân hàng" },
  { symbol: "CTG",  sector: "Ngân hàng" },
  { symbol: "TCB",  sector: "Ngân hàng" },
  { symbol: "MBB",  sector: "Ngân hàng" },
  { symbol: "VPB",  sector: "Ngân hàng" },
  { symbol: "ACB",  sector: "Ngân hàng" },
  { symbol: "HDB",  sector: "Ngân hàng" },
  { symbol: "STB",  sector: "Ngân hàng" },
  { symbol: "LPB",  sector: "Ngân hàng" },
  { symbol: "VIB",  sector: "Ngân hàng" },
  { symbol: "MSB",  sector: "Ngân hàng" },
  { symbol: "TPB",  sector: "Ngân hàng" },
  { symbol: "SSB",  sector: "Ngân hàng" },

  // ── Bất động sản (10 mã) ──────────────────────────────────
  { symbol: "VIC",  sector: "Bất động sản" },
  { symbol: "VHM",  sector: "Bất động sản" },
  { symbol: "NVL",  sector: "Bất động sản" },
  { symbol: "PDR",  sector: "Bất động sản" },
  { symbol: "KDH",  sector: "Bất động sản" },
  { symbol: "DXG",  sector: "Bất động sản" },
  { symbol: "DIG",  sector: "Bất động sản" },
  { symbol: "CEO",  sector: "Bất động sản" },
  { symbol: "HDG",  sector: "Bất động sản" },
  { symbol: "NLG",  sector: "Bất động sản" },

  // ── Chứng khoán (7 mã) ────────────────────────────────────
  { symbol: "SSI",  sector: "Chứng khoán" },
  { symbol: "VND",  sector: "Chứng khoán" },
  { symbol: "HCM",  sector: "Chứng khoán" },
  { symbol: "MBS",  sector: "Chứng khoán" },
  { symbol: "VCI",  sector: "Chứng khoán" },
  { symbol: "FTS",  sector: "Chứng khoán" },
  { symbol: "BSI",  sector: "Chứng khoán" },

  // ── Công nghệ & Viễn thông (5 mã) ────────────────────────
  { symbol: "FPT",  sector: "Công nghệ" },
  { symbol: "VGI",  sector: "Công nghệ" },
  { symbol: "CMG",  sector: "Công nghệ" },
  { symbol: "ELC",  sector: "Công nghệ" },
  { symbol: "POT",  sector: "Công nghệ" },

  // ── Năng lượng & Dầu khí (6 mã) ──────────────────────────
  { symbol: "GAS",  sector: "Năng lượng" },
  { symbol: "PLX",  sector: "Năng lượng" },
  { symbol: "PVD",  sector: "Năng lượng" },
  { symbol: "BSR",  sector: "Năng lượng" },
  { symbol: "PVT",  sector: "Năng lượng" },
  { symbol: "OIL",  sector: "Năng lượng" },

  // ── Thép & Vật liệu (5 mã) ───────────────────────────────
  { symbol: "HPG",  sector: "Thép & Vật liệu" },
  { symbol: "NKG",  sector: "Thép & Vật liệu" },
  { symbol: "HSG",  sector: "Thép & Vật liệu" },
  { symbol: "VGC",  sector: "Thép & Vật liệu" },
  { symbol: "BMP",  sector: "Thép & Vật liệu" },

  // ── Tiêu dùng & Bán lẻ (5 mã) ────────────────────────────
  { symbol: "MWG",  sector: "Tiêu dùng" },
  { symbol: "PNJ",  sector: "Tiêu dùng" },
  { symbol: "FRT",  sector: "Tiêu dùng" },
  { symbol: "DGW",  sector: "Tiêu dùng" },
  { symbol: "AST",  sector: "Tiêu dùng" },

  // ── Thực phẩm & Đồ uống (5 mã) ───────────────────────────
  { symbol: "VNM",  sector: "Thực phẩm" },
  { symbol: "MSN",  sector: "Thực phẩm" },
  { symbol: "SAB",  sector: "Thực phẩm" },
  { symbol: "QNS",  sector: "Thực phẩm" },
  { symbol: "KDC",  sector: "Thực phẩm" },

  // ── Logistics & Cảng biển (4 mã) ─────────────────────────
  { symbol: "GMD",  sector: "Logistics" },
  { symbol: "HAH",  sector: "Logistics" },
  { symbol: "VSC",  sector: "Logistics" },
  { symbol: "SGP",  sector: "Logistics" },

  // ── Hàng không & Du lịch (3 mã) ──────────────────────────
  { symbol: "HVN",  sector: "Hàng không" },
  { symbol: "VJC",  sector: "Hàng không" },
  { symbol: "VTP",  sector: "Hàng không" },

  // ── Điện & Utilities (4 mã) ───────────────────────────────
  { symbol: "POW",  sector: "Điện & Tiện ích" },
  { symbol: "NT2",  sector: "Điện & Tiện ích" },
  { symbol: "REE",  sector: "Điện & Tiện ích" },
  { symbol: "PC1",  sector: "Điện & Tiện ích" },

  // ── Dược phẩm & Y tế (3 mã) ──────────────────────────────
  { symbol: "DHG",  sector: "Dược phẩm" },
  { symbol: "IMP",  sector: "Dược phẩm" },
  { symbol: "DMC",  sector: "Dược phẩm" },
];

// ══════════════════════════════════════════════════════════════
// TCBS API
// ══════════════════════════════════════════════════════════════
const TCBS_BASE = "https://apipubaws.tcbs.com.vn/stock-insight/v1/stock";

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  "Accept": "application/json",
  "Accept-Language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7",
  "Origin": "https://tcinvest.tcbs.com.vn",
  "Referer": "https://tcinvest.tcbs.com.vn/",
};

/**
 * Lấy lịch sử giá ngày của 1 mã từ TCBS
 * @param {string} symbol - Mã CK, ví dụ "VCB"
 * @param {number} countBack - Số phiên lấy về
 * @returns {Array} mảng { date, open, high, low, close, volume }
 */
async function fetchHistory(symbol, countBack = 15) {
  const to   = Math.floor(Date.now() / 1000);
  const from = to - countBack * 2 * 86400; // lấy dư để đủ countBack phiên
  const url  = `${TCBS_BASE}/bars-long-term?ticker=${symbol}&type=stock&resolution=D&from=${from}&to=${to}`;

  const res = await axios.get(url, {
    headers: HEADERS,
    timeout: 15000,
  });

  const raw = res.data?.data || [];
  return raw.map((d) => ({
    date:   d.tradingDate?.split("T")[0] || d.date || String(d.t ? new Date(d.t * 1000).toISOString().split("T")[0] : ""),
    close:  d.close,
    volume: d.volume,  // volume cổ phiếu (đơn vị: cổ)
    value:  (d.close || 0) * (d.volume || 0), // giá trị khớp ước tính (VND)
  })).filter(d => d.date).sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * Sleep helper
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ══════════════════════════════════════════════════════════════
// MAIN
// ══════════════════════════════════════════════════════════════
async function main() {
  console.log(`[${new Date().toISOString()}] VN Stock Collector starting...`);
  console.log(`Symbols: ${VN_SYMBOLS.length} mã`);

  const rows = [];
  const errors = [];

  for (let i = 0; i < VN_SYMBOLS.length; i++) {
    const { symbol, sector } = VN_SYMBOLS[i];
    try {
      const history = await fetchHistory(symbol, 15);

      for (const h of history) {
        if (!h.date || h.volume === undefined) continue;
        rows.push({
          symbol,
          sector,
          date:   h.date,
          close:  h.close,
          volume: h.volume,
          value:  h.value,
        });
      }

      process.stdout.write(`  [${i + 1}/${VN_SYMBOLS.length}] ${symbol}: ${history.length} rows\n`);
    } catch (err) {
      console.warn(`  ✗ ${symbol}: ${err.message}`);
      errors.push(symbol);
    }

    // Rate limit: ~4 req/s để không bị throttle
    if (i < VN_SYMBOLS.length - 1) await sleep(250);
  }

  if (rows.length === 0) {
    console.error("No data fetched. Aborting.");
    process.exit(1);
  }

  console.log(`\nFetched ${rows.length} rows total. Upserting to Supabase...`);

  // Upsert theo batch 200 rows
  const BATCH = 200;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const { error } = await supabase
      .from("vn_market_data")
      .upsert(batch, { onConflict: "symbol,date" });

    if (error) {
      console.error(`Upsert error (batch ${i}):`, error.message);
      process.exit(1);
    }
  }

  // Dọn dữ liệu cũ hơn 25 ngày
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 25);
  const cutoffDate = cutoff.toISOString().split("T")[0];

  const { error: deleteErr } = await supabase
    .from("vn_market_data")
    .delete()
    .lt("date", cutoffDate);

  if (deleteErr) {
    console.warn("Cleanup warning:", deleteErr.message);
  } else {
    console.log(`✓ Cleanup: removed rows older than ${cutoffDate}`);
  }

  if (errors.length > 0) {
    console.warn(`\n⚠ Failed symbols (${errors.length}): ${errors.join(", ")}`);
  }

  console.log(`\n✓ Done. ${rows.length} rows upserted.`);
  console.log(`[${new Date().toISOString()}] Finished.`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
