// ══════════════════════════════════════════════════════════════
// CONFIG
// ══════════════════════════════════════════════════════════════
const SUPABASE_URL  = 'https://tjyoynizwezgdwooagnr.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRqeW95bml6d2V6Z2R3b29hZ25yIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgxMzU5MjMsImV4cCI6MjA5MzcxMTkyM30.MVYC2MP4Z6LhohKHopC_dByo2J82FMINwvJKoCfWHY8';

// ── State ──────────────────────────────────────────────────────
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON);

let allRows     = [];
let sortCol     = '';
let sortDir     = 'desc';
let searchTerm  = '';
let currentPage = 1;
const PAGE_SIZE = 80;

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
  currentPage = 1;
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
// ══════════════════════════════════════════════════════════════

async function loadData() {
  const btn = document.getElementById('refresh-btn');
  btn.disabled = true;
  showState('loading', 'Fetching data...');

  try {
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
// ══════════════════════════════════════════════════════════════

function computeRows(data) {
  const bySymbol = {};
  for (const row of data) {
    if (!bySymbol[row.symbol]) bySymbol[row.symbol] = [];
    bySymbol[row.symbol].push(row);
  }

  const results = [];

  for (const [symbol, rows] of Object.entries(bySymbol)) {
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

    const price      = pr(0);
    const pctPrice1d = pct(pr(0), pr(1));
    const pctPrice2d = pct(pr(0), pr(2));
    const pctPrice3d = pct(pr(0), pr(3));

    const pctVol1d   = pct(vol(0), vol(1));

    const vol3d_curr = sumRange(0, 2);
    const vol3d_prev = sumRange(3, 5);
    const pctVol3d   = pct(vol3d_curr, vol3d_prev);

    const vol7d_curr = sumRange(0, 6);
    const vol7d_prev = sumRange(7, 13);
    const pctVol7d   = pct(vol7d_curr, vol7d_prev);

    // ── Sparkline: lấy volume 7 ngày gần nhất, đảo ngược để cũ → mới
    const volHistory = [vol(13), vol(12), vol(11), vol(10), vol(9), vol(8), vol(7), vol(6), vol(5), vol(4), vol(3), vol(2), vol(1), vol(0)];

    results.push({
      symbol,
      price,
      pctPrice1d,
      pctPrice2d,
      pctPrice3d,
      pctVol1d,
      pctVol3d,
      pctVol7d,
      volHistory,
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

  if (favFilterOn) {
    rows = rows.filter(r => favorites.has(r.symbol));
  }

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

  if (!favFilterOn) {
    const favRows    = rows.filter(r => favorites.has(r.symbol));
    const normalRows = rows.filter(r => !favorites.has(r.symbol));
    rows = [...favRows, ...normalRows];
  }

  const totalRows  = rows.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / PAGE_SIZE));
  if (currentPage > totalPages) currentPage = totalPages;

  const start = (currentPage - 1) * PAGE_SIZE;
  const end   = start + PAGE_SIZE;

  document.getElementById('showing-count').textContent = totalRows;

  const tbody = document.getElementById('tbody');

  if (!favFilterOn && favorites.size > 0) {
    const favRows    = rows.filter(r => favorites.has(r.symbol));
    const normalRows = rows.filter(r => !favorites.has(r.symbol));

    const pageRows = rows.slice(start, end);
    let html = '';

    const pageFavRows    = pageRows.filter(r => favorites.has(r.symbol));
    const pageNormalRows = pageRows.filter(r => !favorites.has(r.symbol));

    if (pageFavRows.length > 0) {
      if (start < favRows.length) {
        html += renderDivider('★ WATCHLIST', favRows.length);
      }
      html += pageFavRows.map((r, i) => renderRow(r, start + i + 1)).join('');
    }

    if (pageNormalRows.length > 0) {
      const normalStart = start - favRows.length;
      if (normalStart <= 0 || pageFavRows.length > 0) {
        html += renderDivider('ALL PAIRS', normalRows.length);
      }
      const normalRankStart = favRows.length + Math.max(0, normalStart);
      html += pageNormalRows.map((r, i) => renderRow(r, normalRankStart + i + 1)).join('');
    }

    tbody.innerHTML = html;
  } else {
    const pageRows = rows.slice(start, end);
    tbody.innerHTML = pageRows.map((r, i) => renderRow(r, start + i + 1)).join('');
  }

  renderPagination(totalPages);
  hideState();
}

// ══════════════════════════════════════════════════════════════
// PAGINATION
// ══════════════════════════════════════════════════════════════

function renderPagination(totalPages) {
  const el = document.getElementById('pagination');
  if (totalPages <= 1) { el.innerHTML = ''; return; }

  const maxVisible = 7;
  let pages = [];

  if (totalPages <= maxVisible) {
    pages = Array.from({ length: totalPages }, (_, i) => i + 1);
  } else {
    const left  = Math.max(2, currentPage - 2);
    const right = Math.min(totalPages - 1, currentPage + 2);

    pages.push(1);
    if (left > 2) pages.push('…');
    for (let p = left; p <= right; p++) pages.push(p);
    if (right < totalPages - 1) pages.push('…');
    pages.push(totalPages);
  }

  const btn = (label, page, disabled = false, active = false) =>
    `<button class="page-btn${active ? ' active' : ''}"
      ${disabled ? 'disabled' : `onclick="goToPage(${page})"`}>
      ${label}
    </button>`;

  let html = '';
  html += btn('‹ Prev', currentPage - 1, currentPage === 1);
  for (const p of pages) {
    if (p === '…') {
      html += `<span class="page-ellipsis">…</span>`;
    } else {
      html += btn(p, p, false, p === currentPage);
    }
  }
  html += btn('Next ›', currentPage + 1, currentPage === totalPages);

  html += `<span class="page-info">Page ${currentPage} / ${totalPages}</span>`;

  el.innerHTML = html;
}

function goToPage(page) {
  currentPage = page;
  renderTable();
  document.querySelector('.table-wrap').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderDivider(label, count) {
  return `<tr class="section-divider">
    <td colspan="9">
      <span class="divider-label">${label}</span>
      <span class="divider-count">${count}</span>
    </td>
  </tr>`;
}

function renderRow(r, rank) {
  const base     = r.symbol.replace('USDT', '');
  const isFav    = favorites.has(r.symbol);
  const favClass  = isFav ? ' fav-row' : '';
  const starClass = isFav ? 'star-btn active' : 'star-btn';
  const starIcon  = isFav ? '★' : '☆';

  return `<tr class="${favClass}">
    <td>
      <div class="symbol-cell">
        <button class="${starClass}" onclick="toggleFavorite('${r.symbol}')" title="Add to watchlist">${starIcon}</button>
        <span class="rank">${rank}</span>
        <a class="symbol-name" 
           href="https://www.binance.com/en/trade/${base}_USDT" 
           target="_blank" 
           rel="noopener noreferrer" 
           title="Trade on Binance"
           style="color:inherit;text-decoration:none;">${base}</a>
        <span class="symbol-base">USDT</span>
      </div>
    </td>
    <td class="price-cell">${formatPrice(r.price)}</td>
    <td>${pctCell(r.pctPrice1d)}</td>
    <td>${pctCell(r.pctPrice2d)}</td>
    <td>${pctCell(r.pctPrice3d)}</td>
    <td class="group-sep">${pctCell(r.pctVol1d)}</td>
    <td class="group-sep">${pctCell(r.pctVol3d)}</td>
    <td class="group-sep">${pctCell(r.pctVol7d)}</td>
    <td class="group-sep" style="padding: 4px 14px; vertical-align: middle;">${sparkline(r.volHistory)}</td>
  </tr>`;
}

// ══════════════════════════════════════════════════════════════
// SPARKLINE
// ══════════════════════════════════════════════════════════════

function sparkline(history) {
  // Lọc bỏ null, giữ nguyên index để biết vị trí
  const vals = history.filter(v => v !== null);
  if (vals.length < 2) return '<span class="pct-cell na">—</span>';

  const W = 84, H = 28, pad = 3;
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const range = max - min || 1;

  // Tính tọa độ từng điểm
  const pts = vals.map((v, i) => {
    const x = pad + (i / (vals.length - 1)) * (W - pad * 2);
    const y = H - pad - ((v - min) / range) * (H - pad * 2);
    return [parseFloat(x.toFixed(1)), parseFloat(y.toFixed(1))];
  });

  const polyPoints = pts.map(p => p.join(',')).join(' ');

  // Màu: xanh nếu ngày cuối >= ngày đầu, đỏ nếu ngược lại
  const isUp  = vals[vals.length - 1] >= vals[0];
  const color = isUp ? '#00e676' : '#ff4757';
  const fillColor = isUp ? '#00e67614' : '#ff475714';

  // Vùng fill (area chart)
  const areaPoints =
    `${pts[0][0]},${H} ` +
    polyPoints +
    ` ${pts[pts.length - 1][0]},${H}`;

  // Điểm cuối (dot)
  const [lx, ly] = pts[pts.length - 1];

  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="display:block;overflow:visible">
    <polygon points="${areaPoints}" fill="${fillColor}" />
    <polyline points="${polyPoints}"
      fill="none"
      stroke="${color}"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"/>
    <circle cx="${lx}" cy="${ly}" r="2.2" fill="${color}" />
  </svg>`;
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
  currentPage = 1;
  updateSortHeaders();
  if (allRows.length) renderTable();
}

function updateSortHeaders() {
  document.querySelectorAll('th[data-col]').forEach(th => {
    const col   = th.dataset.col;
    const arrow = th.querySelector('.sort-arrow');
    if (col === sortCol) {
      th.classList.add('active');
      if (arrow) arrow.textContent = sortDir === 'desc' ? '↓' : '↑';
    } else {
      th.classList.remove('active');
      if (arrow) arrow.textContent = '↕';
    }
  });
}

document.getElementById('search').addEventListener('input', e => {
  searchTerm  = e.target.value;
  currentPage = 1;
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