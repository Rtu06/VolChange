// ══════════════════════════════════════════════════════════════
// CONFIG — thay bằng credentials của bạn
// ══════════════════════════════════════════════════════════════
const SUPABASE_URL  = 'https://tjyoynizwezgdwooagnr.supabase.co';   // ví dụ: https://xxxx.supabase.co
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRqeW95bml6d2V6Z2R3b29hZ25yIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgxMzU5MjMsImV4cCI6MjA5MzcxMTkyM30.MVYC2MP4Z6LhohKHopC_dByo2J82FMINwvJKoCfWHY8';

// ── State ──────────────────────────────────────────────────────
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON);

let allRows      = [];   // dữ liệu đã tính toán
let sortCol      = 'pct1h';
let sortDir      = 'desc';
let searchTerm   = '';
let countdownVal = 300;  // 5 phút
let countdownTimer;

// ══════════════════════════════════════════════════════════════
// DATA FETCHING
// ══════════════════════════════════════════════════════════════

async function loadData() {
  const btn = document.getElementById('refresh-btn');
  btn.disabled = true;
  showState('loading', 'Fetching data...');
  resetCountdown();

  try {
    // Lấy 48 giờ gần nhất để tính được %4H và %1D
    const since = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

    const { data, error } = await sb
      .from('market_data')
      .select('symbol, price, volume, quote_volume, created_at')
      .gte('created_at', since)
      .order('created_at', { ascending: false });

    if (error) throw error;
    if (!data || data.length === 0) {
      showState('empty', 'No data found. Collector may not have run yet.');
      return;
    }

    allRows = computeRows(data);
    document.getElementById('total-pairs').textContent = allRows.length;
    document.getElementById('last-update').textContent = formatTime(new Date());
    renderTable();

  } catch (err) {
    console.error(err);
    showState('error', `Error: ${err.message}`);
  } finally {
    btn.disabled = false;
  }
}

// ══════════════════════════════════════════════════════════════
// COMPUTATION
// ══════════════════════════════════════════════════════════════

/**
 * data: array of {symbol, price, quote_volume, created_at}
 * grouped by symbol, sorted newest first
 *
 * Ký hiệu: t=0 (newest), t=1 (1h ago), ...
 * %1H  = (t0 - t1) / t1 * 100
 * vol4H_curr = t0+t1+t2+t3
 * vol4H_prev = t4+t5+t6+t7
 * %4H  = (curr4 - prev4) / prev4 * 100
 * vol1D_curr = t0..t23
 * vol1D_prev = t24..t47
 * %1D  = (curr1d - prev1d) / prev1d * 100
 */
function computeRows(data) {
  // Group by symbol
  const bySymbol = {};
  for (const row of data) {
    if (!bySymbol[row.symbol]) bySymbol[row.symbol] = [];
    bySymbol[row.symbol].push(row);
  }

  const results = [];

  for (const [symbol, rows] of Object.entries(bySymbol)) {
    // rows đã sort DESC (newest first từ query)
    const qv = rows.map(r => r.quote_volume);
    const n  = qv.length;

    const t = (i) => (i < n ? qv[i] : null);
    const sumRange = (from, to) => {  // inclusive
      let s = 0, valid = 0;
      for (let i = from; i <= to; i++) {
        if (t(i) !== null) { s += t(i); valid++; }
      }
      return valid > 0 ? s : null;
    };
    const pct = (curr, prev) =>
      (curr !== null && prev !== null && prev !== 0)
        ? (curr - prev) / prev * 100
        : null;

    const vol1h = t(0);
    const pct1h = pct(t(0), t(1));

    const vol4h_curr = sumRange(0, 3);
    const vol4h_prev = sumRange(4, 7);
    const pct4h      = pct(vol4h_curr, vol4h_prev);

    const vol1d_curr = sumRange(0, 23);
    const vol1d_prev = sumRange(24, 47);
    const pct1d      = pct(vol1d_curr, vol1d_prev);

    results.push({
      symbol,
      price:    rows[0].price,
      vol1h,
      pct1h,
      vol4h:    vol4h_curr,
      pct4h,
      vol1d:    vol1d_curr,
      pct1d,
      _hours:   n,
    });
  }

  return results;
}

// ══════════════════════════════════════════════════════════════
// RENDERING
// ══════════════════════════════════════════════════════════════

function renderTable() {
  const q   = searchTerm.toUpperCase();
  let rows  = q
    ? allRows.filter(r => r.symbol.includes(q))
    : [...allRows];

  // Sort
  rows.sort((a, b) => {
    const av = a[sortCol];
    const bv = b[sortCol];
    if (av === null && bv === null) return 0;
    if (av === null) return 1;
    if (bv === null) return -1;
    if (typeof av === 'string') return sortDir === 'asc'
      ? av.localeCompare(bv) : bv.localeCompare(av);
    return sortDir === 'asc' ? av - bv : bv - av;
  });

  document.getElementById('showing-count').textContent = rows.length;

  const tbody = document.getElementById('tbody');
  tbody.innerHTML = rows.map(renderRow).join('');

  hideState();
}

function renderRow(r) {
  const base = r.symbol.replace('USDT', '');
  return `<tr>
    <td>
      <div class="symbol-cell">
        <span class="symbol-name">${base}</span>
        <span class="symbol-base">USDT</span>
      </div>
    </td>
    <td class="price-cell">${formatPrice(r.price)}</td>
    <td class="vol-cell group-sep">${formatVol(r.vol1h)}</td>
    <td>${pctCell(r.pct1h)}</td>
    <td class="vol-cell group-sep">${formatVol(r.vol4h)}</td>
    <td>${pctCell(r.pct4h)}</td>
    <td class="vol-cell group-sep">${formatVol(r.vol1d)}</td>
    <td>${pctCell(r.pct1d)}</td>
  </tr>`;
}

// ══════════════════════════════════════════════════════════════
// FORMATTERS
// ══════════════════════════════════════════════════════════════

function formatPrice(p) {
  if (p === null) return '<span class="na">—</span>';
  if (p >= 1000)  return p.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (p >= 1)     return p.toFixed(4);
  if (p >= 0.001) return p.toFixed(6);
  return p.toExponential(4);
}

function formatVol(v) {
  if (v === null) return '<span class="na">—</span>';
  if (v >= 1e9) return `${(v/1e9).toFixed(2)}<span class="unit">B</span>`;
  if (v >= 1e6) return `${(v/1e6).toFixed(2)}<span class="unit">M</span>`;
  if (v >= 1e3) return `${(v/1e3).toFixed(1)}<span class="unit">K</span>`;
  return v.toFixed(0);
}

function pctCell(v) {
  if (v === null) return '<span class="pct-cell na">N/A</span>';
  const cls = v > 0 ? 'pos' : v < 0 ? 'neg' : 'neu';
  const sign = v > 0 ? '+' : '';
  return `<span class="pct-cell ${cls}">${sign}${v.toFixed(2)}%</span>`;
}

function formatTime(d) {
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// ══════════════════════════════════════════════════════════════
// SORT & FILTER
// ══════════════════════════════════════════════════════════════

function sortBy(col) {
  if (sortCol === col) {
    sortDir = sortDir === 'desc' ? 'asc' : 'desc';
  } else {
    sortCol = col;
    sortDir = 'desc';
  }
  updateSortHeaders();
  if (allRows.length) renderTable();
}

function updateSortHeaders() {
  document.querySelectorAll('th[data-col]').forEach(th => {
    const col = th.dataset.col;
    const arrow = th.querySelector('.sort-arrow');
    if (col === sortCol) {
      th.classList.add('active');
      arrow.textContent = sortDir === 'desc' ? '↓' : '↑';
    } else {
      th.classList.remove('active');
      arrow.textContent = '↕';
    }
  });
}

function applyQuickSort(val) {
  const [col, dir] = val.split('_');
  const map = {
    '%1h': 'pct1h', '%4h': 'pct4h', '%1d': 'pct1d',
    'vol1h': 'vol1h', 'vol1d': 'vol1d',
  };
  sortCol = map[col] || col;
  sortDir = dir;
  updateSortHeaders();
  if (allRows.length) renderTable();
}

document.getElementById('search').addEventListener('input', e => {
  searchTerm = e.target.value;
  if (allRows.length) renderTable();
});

// ══════════════════════════════════════════════════════════════
// UI STATE
// ══════════════════════════════════════════════════════════════

function showState(type, msg) {
  const el = document.getElementById('state-container');
  document.getElementById('main-table').style.display = 'none';
  el.style.display = 'flex';

  if (type === 'loading') {
    el.innerHTML = `<div class="spinner"></div><span>${msg}</span>`;
  } else if (type === 'error') {
    el.innerHTML = `<span class="error-icon">⚠</span><span style="color:var(--red)">${msg}</span>`;
  } else {
    el.innerHTML = `<span class="error-icon">○</span><span>${msg}</span>`;
  }
}

function hideState() {
  document.getElementById('state-container').style.display = 'none';
  document.getElementById('main-table').style.display = 'table';
}

// ══════════════════════════════════════════════════════════════
// AUTO REFRESH COUNTDOWN (5 min)
// ══════════════════════════════════════════════════════════════

function resetCountdown() {
  clearInterval(countdownTimer);
  countdownVal = 300;
  countdownTimer = setInterval(() => {
    countdownVal--;
    const m = Math.floor(countdownVal / 60);
    const s = String(countdownVal % 60).padStart(2, '0');
    document.getElementById('countdown').textContent = `${m}:${s}`;
    if (countdownVal <= 0) loadData();
  }, 1000);
}

// ══════════════════════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════════════════════
loadData();