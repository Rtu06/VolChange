// ══════════════════════════════════════════════════════════════
// CONFIG
// ══════════════════════════════════════════════════════════════
const SUPABASE_URL  = 'https://tjyoynizwezgdwooagnr.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRqeW95bml6d2V6Z2R3b29hZ25yIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgxMzU5MjMsImV4cCI6MjA5MzcxMTkyM30.MVYC2MP4Z6LhohKHopC_dByo2J82FMINwvJKoCfWHY8';

// ── State ──────────────────────────────────────────────────────
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON);

let allRows    = [];
let sortCol    = 'vol1d';
let sortDir    = 'desc';
let searchTerm = '';

// ══════════════════════════════════════════════════════════════
// FAVORITES  (localStorage)
// ══════════════════════════════════════════════════════════════
const LS_KEY = 'bvt_favorites';
let favorites    = new Set(JSON.parse(localStorage.getItem(LS_KEY) || '[]'));
let favFilterOn  = false;

function saveFavorites() {
  localStorage.setItem(LS_KEY, JSON.stringify([...favorites]));
}

function toggleFavorite(symbol) {
  if (favorites.has(symbol)) {
    favorites.delete(symbol);
  } else {
    favorites.add(symbol);
  }
  saveFavorites();
  updateFavCount();
  renderTable();
}

function toggleFavFilter() {
  favFilterOn = !favFilterOn;
  const btn = document.getElementById('fav-filter-btn');
  btn.classList.toggle('active', favFilterOn);
  if (allRows.length) renderTable();
}

function updateFavCount() {
  const el = document.getElementById('fav-count');
  el.textContent = favorites.size > 0 ? `(${favorites.size})` : '';
}

// ══════════════════════════════════════════════════════════════
// DATA FETCHING
// Lấy 7 ngày gần nhất để tính được vol3d current + vol3d prev
// Lấy 15 ngày gần nhất để tính được vol7d current + vol7d prev
// Lấy thêm 1 ngày vì ngày hiện tại không tính
// ══════════════════════════════════════════════════════════════

async function loadData() {
  const btn = document.getElementById('refresh-btn');
  btn.disabled = true;
  showState('loading', 'Fetching data...');

  try {
    // Lấy 15 ngày để có đủ: 1 ngày hiện tại + 7 ngày curr + 7 ngày prev
    const since = new Date();
    since.setUTCDate(since.getUTCDate() - 15);
    const sinceDate = since.toISOString().split('T')[0];

    const { data, error } = await sb
      .from('market_data')
      .select('symbol, price, quote_volume, date')
      .gte('date', sinceDate)
      .order('date', { ascending: false });

    if (error) throw error;
    if (!data || data.length === 0) {
      showState('empty', 'No data found. Collector may not have run yet.');
      return;
    }

    allRows = computeRows(data);

    // Hiển thị ngày dữ liệu mới nhất
    const latestDate = allRows.length > 0
      ? data.find(d => true)?.date || '—'
      : '—';
    document.getElementById('total-pairs').textContent = allRows.length;
    document.getElementById('data-date').textContent   = latestDate;
    document.getElementById('last-update').textContent = formatTime(new Date());

    updateFavCount();
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
//
// Với dữ liệu daily, mỗi row là 1 ngày:
//   days[0] = ngày mới nhất (D0 = hôm trước)
//   days[1] = D-1 (2 ngày trước), ...
//
// %Price 1D  = (price[D0] - price[D1]) / price[D1] * 100
//
// Vol 1D     = quote_volume[D0]
// %Vol 1D    = (vol[D0] - vol[D1]) / vol[D1] * 100
//
// Vol 7D     = sum(D0..D6)
// %Vol 7D    = (vol7d_curr - vol7d_prev) / vol7d_prev * 100
//              vol7d_prev = sum(D7..D13)
//
// Vol 3D     = sum(D0..D2)
// %Vol 3D    = (vol3d_curr - vol3d_prev) / vol3d_prev * 100
//              vol3d_prev = sum(D3..D5)
// ══════════════════════════════════════════════════════════════

function computeRows(data) {
  // Group by symbol, sort by date DESC (newest first)
  const bySymbol = {};
  for (const row of data) {
    if (!bySymbol[row.symbol]) bySymbol[row.symbol] = [];
    bySymbol[row.symbol].push(row);
  }

  const results = [];

  for (const [symbol, rows] of Object.entries(bySymbol)) {
    // rows đã sort DESC từ query
    const n = rows.length;

    const vol  = (i) => (i < n ? rows[i].quote_volume : null);
    const pr   = (i) => (i < n ? rows[i].price        : null);

    const sumRange = (from, to) => {
      let s = 0, valid = 0;
      for (let i = from; i <= to; i++) {
        if (vol(i) !== null) { s += vol(i); valid++; }
      }
      return valid > 0 ? s : null;
    };

    const pct = (curr, prev) =>
      curr !== null && prev !== null && prev !== 0
        ? (curr - prev) / prev * 100
        : null;

    // Metrics
    const price      = pr(0);
    const pctPrice1d = pct(pr(0), pr(1));

    const vol1d      = vol(0);
    const pctVol1d   = pct(vol(0), vol(1));

    const vol3d_curr = sumRange(0, 2);
    const vol3d_prev = sumRange(3, 5);
    const vol3d      = vol3d_curr;
    const pctVol3d   = pct(vol3d_curr, vol3d_prev);

    const vol7d_curr = sumRange(0, 6);
    const vol7d_prev = sumRange(7, 13);
    const vol7d      = vol7d_curr;
    const pctVol7d   = pct(vol7d_curr, vol7d_prev);


    results.push({
      symbol,
      price,
      pctPrice1d,
      vol1d,
      pctVol1d,
      vol3d,
      pctVol3d,
      vol7d,
      pctVol7d,
      _days: n,
    });
  }

  return results;
}

// ══════════════════════════════════════════════════════════════
// RENDERING
// ══════════════════════════════════════════════════════════════

function renderTable() {
  const q  = searchTerm.toUpperCase();
  let rows = q
    ? allRows.filter(r => r.symbol.includes(q))
    : [...allRows];

  // Nếu đang bật watchlist-only, chỉ giữ các coin favorite
  if (favFilterOn) {
    rows = rows.filter(r => favorites.has(r.symbol));
  }

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

  // Tách favorites lên đầu (chỉ khi không đang filter watchlist-only)
  if (!favFilterOn) {
    const favRows    = rows.filter(r => favorites.has(r.symbol));
    const normalRows = rows.filter(r => !favorites.has(r.symbol));
    rows = [...favRows, ...normalRows];
  }

  document.getElementById('showing-count').textContent = rows.length;

  const tbody = document.getElementById('tbody');

  // Render với divider nếu có favorites và không đang filter
  if (!favFilterOn && favorites.size > 0) {
    const favRows    = rows.filter(r => favorites.has(r.symbol));
    const normalRows = rows.filter(r => !favorites.has(r.symbol));

    let html = '';

    if (favRows.length > 0) {
      html += renderDivider('★ WATCHLIST', favRows.length);
      html += favRows.map((r, i) => renderRow(r, i + 1)).join('');
    }

    if (normalRows.length > 0) {
      html += renderDivider('ALL PAIRS', normalRows.length);
      html += normalRows.map((r, i) => renderRow(r, i + 1)).join('');
    }

    tbody.innerHTML = html;
  } else {
    tbody.innerHTML = rows.map((r, i) => renderRow(r, i + 1)).join('');
  }

  hideState();
}

function renderDivider(label, count) {
  return `<tr class="section-divider">
    <td colspan="7">
      <span class="divider-label">${label}</span>
      <span class="divider-count">${count}</span>
    </td>
  </tr>`;
}

function renderRow(r, rank) {
  const base    = r.symbol.replace('USDT', '');
  const isFav   = favorites.has(r.symbol);
  const favClass = isFav ? ' fav-row' : '';
  const starClass = isFav ? 'star-btn active' : 'star-btn';
  const starIcon  = isFav ? '★' : '☆';

  return `<tr class="${favClass}">
    <td>
      <div class="symbol-cell">
        <button class="${starClass}" onclick="toggleFavorite('${r.symbol}')" title="Add to watchlist">${starIcon}</button>
        <span class="rank">${rank}</span>
        <span class="symbol-name">${base}</span>
        <span class="symbol-base">USDT</span>
      </div>
    </td>
    <td class="price-cell">${formatPrice(r.price)}</td>
    <td>${pctCell(r.pctPrice1d)}</td>
    <td class="vol-cell group-sep">${formatVol(r.vol1d)}</td>
    <td>${pctCell(r.pctVol1d)}</td>
    <td class="vol-cell group-sep">${formatVol(r.vol3d)}</td>
    <td>${pctCell(r.pctVol3d)}</td>
    <td class="vol-cell group-sep">${formatVol(r.vol7d)}</td>
    <td>${pctCell(r.pctVol7d)}</td>
  </tr>`;
}

// ══════════════════════════════════════════════════════════════
// FORMATTERS
// ══════════════════════════════════════════════════════════════

function formatPrice(p) {
  if (p === null) return '<span class="na">—</span>';
  if (p >= 1000)  return '$' + p.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (p >= 1)     return '$' + p.toFixed(4);
  if (p >= 0.001) return '$' + p.toFixed(6);
  return '$' + p.toExponential(4);
}

function formatVol(v) {
  if (v === null) return '<span class="na">—</span>';
  if (v >= 1e9) return `$${(v/1e9).toFixed(2)}<span class="unit">B</span>`;
  if (v >= 1e6) return `$${(v/1e6).toFixed(2)}<span class="unit">M</span>`;
  if (v >= 1e3) return `$${(v/1e3).toFixed(1)}<span class="unit">K</span>`;
  return '$' + v.toFixed(0);
}

function pctCell(v) {
  if (v === null) return '<span class="pct-cell na">N/A</span>';
  const cls  = v > 0 ? 'pos' : v < 0 ? 'neg' : 'neu';
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
    const col   = th.dataset.col;
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
// INIT
// ══════════════════════════════════════════════════════════════
loadData();
