// ══════════════════════════════════════════════════════════════
// CONFIG
// ══════════════════════════════════════════════════════════════
const SUPABASE_URL  = 'https://tjyoynizwezgdwooagnr.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRqeW95bml6d2V6Z2R3b29hZ25yIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgxMzU5MjMsImV4cCI6MjA5MzcxMTkyM30.MVYC2MP4Z6LhohKHopC_dByo2J82FMINwvJKoCfWHY8';

// ── Supabase client ────────────────────────────────────────────
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON);

// ══════════════════════════════════════════════════════════════
// TAB STATE
// ══════════════════════════════════════════════════════════════
let activeTab = 'binance';
let vnLoaded  = false; // lazy: chỉ load khi user click tab

function switchTab(tab) {
  activeTab = tab;

  // Toggle panels
  document.getElementById('panel-binance').style.display  = tab === 'binance' ? '' : 'none';
  document.getElementById('panel-vnstock').style.display  = tab === 'vnstock' ? '' : 'none';

  // Toggle tab buttons
  document.getElementById('tab-binance').classList.toggle('active', tab === 'binance');
  document.getElementById('tab-vnstock').classList.toggle('active', tab === 'vnstock');

  // Lazy load VN data on first visit
  if (tab === 'vnstock' && !vnLoaded) {
    loadVnData();
  }

  // Update header meta context
  updateHeaderMeta();
}

function refreshCurrent() {
  if (activeTab === 'binance') {
    loadData();
  } else {
    vnLoaded = false;
    loadVnData();
  }
}

// ══════════════════════════════════════════════════════════════
// ════════════════════  BINANCE TAB  ═══════════════════════════
// ══════════════════════════════════════════════════════════════

// ── Binance State ──────────────────────────────────────────────
let allRows     = [];
let sortCol     = '';
let sortDir     = 'desc';
let searchTerm  = '';
let currentPage = 1;
const PAGE_SIZE = 80;

// ── Favorites ─────────────────────────────────────────────────
const LS_KEY = 'bvt_favorites';
let favorites   = new Set(JSON.parse(localStorage.getItem(LS_KEY) || '[]'));
let favFilterOn = false;

function saveFavorites() {
  localStorage.setItem(LS_KEY, JSON.stringify([...favorites]));
}
function toggleFavorite(symbol) {
  favorites.has(symbol) ? favorites.delete(symbol) : favorites.add(symbol);
  saveFavorites();
  updateFavCount();
  renderTable();
}
function toggleFavFilter() {
  favFilterOn = !favFilterOn;
  currentPage = 1;
  document.getElementById('fav-filter-btn').classList.toggle('active', favFilterOn);
  if (allRows.length) renderTable();
}
function updateFavCount() {
  const el = document.getElementById('fav-count');
  el.textContent = favorites.size > 0 ? `(${favorites.size})` : '';
}

// ── Data Fetching ─────────────────────────────────────────────
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

    const latestDate = data[0]?.date || '—';
    updateHeaderMetaValues(allRows.length, latestDate);
    updateFavCount();
    renderTable();

  } catch (err) {
    console.error(err);
    showState('error', `Error: ${err.message}`);
  } finally {
    btn.disabled = false;
  }
}

// ── Computation ───────────────────────────────────────────────
function computeRows(data) {
  const bySymbol = {};
  for (const row of data) {
    if (!bySymbol[row.symbol]) bySymbol[row.symbol] = [];
    bySymbol[row.symbol].push(row);
  }

  const results = [];
  for (const [symbol, rows] of Object.entries(bySymbol)) {
    const n   = rows.length;
    const vol = (i) => (i < n ? rows[i].quote_volume : null);
    const pr  = (i) => (i < n ? rows[i].price        : null);

    const sumRange = (from, to) => {
      let s = 0, valid = 0;
      for (let i = from; i <= to; i++) {
        if (vol(i) !== null) { s += vol(i); valid++; }
      }
      return valid > 0 ? s : null;
    };

    const pct = (curr, prev) =>
      curr !== null && prev !== null && prev !== 0
        ? (curr - prev) / prev * 100 : null;

    const price      = pr(0);
    const pctPrice1d = pct(pr(0), pr(1));
    const pctPrice2d = pct(pr(0), pr(2));
    const pctPrice3d = pct(pr(0), pr(3));
    const pctPrice7d = pct(pr(0), pr(7));
    const pctVol1d   = pct(vol(0), vol(1));
    const pctVol3d   = pct(sumRange(0,2), sumRange(3,5));
    const pctVol7d   = pct(sumRange(0,6), sumRange(7,13));

    const volHistory = [13,12,11,10,9,8,7,6,5,4,3,2,1,0].map(i => vol(i));
    const priceHistory = [13,12,11,10,9,8,7,6,5,4,3,2,1,0].map(i => pr(i));

    results.push({ symbol, price, pctPrice1d, pctPrice2d, pctPrice3d, pctPrice7d,
                   pctVol1d, pctVol3d, pctVol7d, volHistory,priceHistory, _days: n });
  }
  return results;
}

// ── Rendering ─────────────────────────────────────────────────
function renderTable() {
  const q  = searchTerm.toUpperCase();
  let rows = q ? allRows.filter(r => r.symbol.includes(q)) : [...allRows];
  if (favFilterOn) rows = rows.filter(r => favorites.has(r.symbol));

  rows.sort((a, b) => {
    const av = a[sortCol], bv = b[sortCol];
    if (av === null && bv === null) return 0;
    if (av === null) return 1;
    if (bv === null) return -1;
    if (typeof av === 'string') return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
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
  document.getElementById('showing-count').textContent = totalRows;

  const tbody = document.getElementById('tbody');

  if (!favFilterOn && favorites.size > 0) {
    const favRows    = rows.filter(r => favorites.has(r.symbol));
    const normalRows = rows.filter(r => !favorites.has(r.symbol));
    const pageRows   = rows.slice(start, start + PAGE_SIZE);
    const pageFavR   = pageRows.filter(r => favorites.has(r.symbol));
    const pageNormR  = pageRows.filter(r => !favorites.has(r.symbol));

    let html = '';
    if (pageFavR.length > 0) {
      if (start < favRows.length) html += renderDivider('★ WATCHLIST', favRows.length);
      html += pageFavR.map((r, i) => renderRow(r, start + i + 1)).join('');
    }
    if (pageNormR.length > 0) {
      const normalStart = start - favRows.length;
      if (normalStart <= 0 || pageFavR.length > 0) html += renderDivider('ALL PAIRS', normalRows.length);
      const normalRankStart = favRows.length + Math.max(0, normalStart);
      html += pageNormR.map((r, i) => renderRow(r, normalRankStart + i + 1)).join('');
    }
    tbody.innerHTML = html;
  } else {
    tbody.innerHTML = rows.slice(start, start + PAGE_SIZE)
      .map((r, i) => renderRow(r, start + i + 1)).join('');
  }

  renderPagination(totalPages);
  hideState();
}

// ── Pagination ────────────────────────────────────────────────
function renderPagination(totalPages) {
  const el = document.getElementById('pagination');
  if (totalPages <= 1) { el.innerHTML = ''; return; }

  let pages = [];
  if (totalPages <= 7) {
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
      ${disabled ? 'disabled' : `onclick="goToPage(${page})"`}>${label}</button>`;

  let html = btn('‹ Prev', currentPage - 1, currentPage === 1);
  for (const p of pages) {
    html += p === '…' ? `<span class="page-ellipsis">…</span>` : btn(p, p, false, p === currentPage);
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
  return `<tr class="section-divider"><td colspan="11">
    <span class="divider-label">${label}</span>
    <span class="divider-count">${count}</span>
  </td></tr>`;
}

function renderRow(r, rank) {
  const base      = r.symbol.replace('USDT', '');
  const isFav     = favorites.has(r.symbol);
  const favClass  = isFav ? ' fav-row' : '';
  const starClass = isFav ? 'star-btn active' : 'star-btn';
  const starIcon  = isFav ? '★' : '☆';

  return `<tr class="${favClass}">
    <td>
      <div class="symbol-cell">
        <button class="${starClass}" onclick="toggleFavorite('${r.symbol}')" title="Add to watchlist">${starIcon}</button>
        <span class="rank">${rank}</span>
        <a class="symbol-name" href="https://www.binance.com/en/trade/${base}_USDT"
           target="_blank" rel="noopener noreferrer" style="color:inherit;text-decoration:none;">${base}</a>
        <span class="symbol-base">USDT</span>
      </div>
    </td>
    <td class="price-cell">${formatPrice(r.price)}</td>
    <td>${pctCell(r.pctPrice1d)}</td>
    <td>${pctCell(r.pctPrice2d)}</td>
    <td>${pctCell(r.pctPrice3d)}</td>
    <td>${pctCell(r.pctPrice7d)}</td>
    <td class="group-sep" style="padding:4px 14px;vertical-align:middle;">${sparkline(r.priceHistory)}</td>
    <td class="group-sep">${pctCell(r.pctVol1d)}</td>
    <td class="group-sep">${pctCell(r.pctVol3d)}</td>
    <td class="group-sep">${pctCell(r.pctVol7d)}</td>
    <td class="group-sep" style="padding:4px 14px;vertical-align:middle;">${sparkline(r.volHistory)}</td>
  </tr>`;
}

// ── Sparkline ─────────────────────────────────────────────────
function sparkline(history) {
  const vals = history.filter(v => v !== null);
  if (vals.length < 2) return '<span class="pct-cell na">—</span>';
  const W = 84, H = 28, pad = 3;
  const min = Math.min(...vals), max = Math.max(...vals);
  const range = max - min || 1;
  const pts   = vals.map((v, i) => [
    parseFloat((pad + (i / (vals.length - 1)) * (W - pad * 2)).toFixed(1)),
    parseFloat((H - pad - ((v - min) / range) * (H - pad * 2)).toFixed(1))
  ]);
  const poly  = pts.map(p => p.join(',')).join(' ');
  const isUp  = vals[vals.length - 1] >= vals[0];
  const color = isUp ? '#00e676' : '#ff4757';
  const fill  = isUp ? '#00e67614' : '#ff475714';
  const area  = `${pts[0][0]},${H} ${poly} ${pts[pts.length-1][0]},${H}`;
  const [lx, ly] = pts[pts.length - 1];
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="display:block;overflow:visible">
    <polygon points="${area}" fill="${fill}" />
    <polyline points="${poly}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="${lx}" cy="${ly}" r="2.2" fill="${color}" />
  </svg>`;
}

// ── Sort & Filter ─────────────────────────────────────────────
function sortBy(col) {
  if (sortCol === col) {
    sortDir = sortDir === 'desc' ? 'asc' : 'desc';
  } else {
    sortCol = col; sortDir = 'desc';
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
  searchTerm = e.target.value; currentPage = 1;
  if (allRows.length) renderTable();
});

// ── UI State ──────────────────────────────────────────────────
function showState(type, msg) {
  document.getElementById('state-container').style.display = 'flex';
  document.getElementById('main-table').style.display      = 'none';
  const el = document.getElementById('state-container');
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
  document.getElementById('main-table').style.display      = 'table';
}

// ══════════════════════════════════════════════════════════════
// ═════════════════════  VN STOCK TAB  ═════════════════════════
// ══════════════════════════════════════════════════════════════

let vnAllRows    = [];    // flat array of processed symbols
let vnSearchTerm = '';
let vnSortCol    = 'pctVol1d';
let vnSortDir    = 'desc';
// Collapse state per sector (true = collapsed)
const vnCollapsed = {};

// ── Load VN data ──────────────────────────────────────────────
async function loadVnData() {
  vnLoaded = true;
  showVnState('loading', 'Loading VN Stock data...');

  try {
    const since = new Date();
    since.setDate(since.getDate() - 15); // Lấy 15 ngày để đảm bảo đủ dữ liệu tính %Vol 5D (trừ cuối tuần)
    const sinceDate = since.toISOString().split('T')[0];

    const { data, error } = await sb
      .from('vn_market_data')
      .select('symbol, sector, date, volume, value')
      .gte('date', sinceDate)
      .order('date', { ascending: false });

    if (error) throw error;
    if (!data || data.length === 0) {
      showVnState('empty', 'No VN Stock data. Collector may not have run yet.');
      return;
    }

    vnAllRows = computeVnRows(data);

    const latestDate = data[0]?.date || '—';
    updateHeaderMetaValues(vnAllRows.length, latestDate);

    renderVnTable();
    hideVnState();

  } catch (err) {
    console.error(err);
    showVnState('error', `Error: ${err.message}`);
  }
}

// ── VN Computation ────────────────────────────────────────────
function computeVnRows(data) {
  const bySymbol = {};
  for (const row of data) {
    if (!bySymbol[row.symbol]) bySymbol[row.symbol] = { sector: row.sector, rows: [] };
    bySymbol[row.symbol].rows.push(row);
  }

  const results = [];
  for (const [symbol, { sector, rows }] of Object.entries(bySymbol)) {
    rows.sort((a, b) => b.date.localeCompare(a.date)); // newest first
    const n = rows.length;

    // Dùng value (tổng GT mua+bán chủ động, VND) để tính %Vol
    const val = (i) => (i < n ? (rows[i].value || 0) : null);

    const pct = (curr, prev) =>
      curr !== null && prev !== null && prev !== 0
        ? (curr - prev) / prev * 100 : null;

    // %Vol 1D: hôm nay vs hôm qua
    const pctVol1d = pct(val(0), val(1));

    // %Vol 5D: tổng 5 ngày gần nhất vs 5 ngày trước đó
    const sum5curr = sumVnRange(rows, 0, 4);
    const sum5prev = sumVnRange(rows, 5, 9);
    const pctVol5d = pct(sum5curr, sum5prev);

    const todayVal = rows[0]?.value || null;

    // Sparkline 5 ngày: cũ → mới
    const volSpark = [4, 3, 2, 1, 0].map(i => (i < n ? (rows[i].value || 0) : null));

    results.push({ symbol, sector, pctVol1d, pctVol5d, todayVal, volSpark });
  }

  return results;
}

function sumVnRange(rows, from, to) {
  let s = 0, valid = 0;
  for (let i = from; i <= to; i++) {
    if (i < rows.length && rows[i].value !== null) { s += rows[i].value; valid++; }
  }
  return valid > 0 ? s : null;
}

// ── VN Rendering ──────────────────────────────────────────────
function renderVnTable() {
  const q    = vnSearchTerm.toUpperCase();
  let rows   = q ? vnAllRows.filter(r => r.symbol.includes(q)) : [...vnAllRows];

  // Tách market index (Toàn sàn) ra khỏi sector rows
  const MARKET_SYMBOLS = ['HOSE', 'HNX'];
  const marketRows  = rows.filter(r => MARKET_SYMBOLS.includes(r.symbol));
  const stockRows   = rows.filter(r => !MARKET_SYMBOLS.includes(r.symbol));

  // Sort stock rows
  stockRows.sort((a, b) => {
    const av = a[vnSortCol], bv = b[vnSortCol];
    if (av === null && bv === null) return 0;
    if (av === null) return 1;
    if (bv === null) return -1;
    return vnSortDir === 'desc' ? bv - av : av - bv;
  });

  // Group by sector (preserve original sector order)
  const sectorOrder = [
    'Ngân hàng', 'Bất động sản', 'Chứng khoán', 'Công nghệ',
    'Năng lượng', 'Thép & Vật liệu', 'Tiêu dùng', 'Thực phẩm',
    'Logistics', 'Hàng không', 'Điện & Tiện ích', 'Dược phẩm'
  ];
  const bySetor = {};
  for (const r of stockRows) {
    if (!bySetor[r.sector]) bySetor[r.sector] = [];
    bySetor[r.sector].push(r);
  }

  // Build ordered sector list
  const sectors = [];
  for (const s of sectorOrder) {
    if (bySetor[s]) sectors.push([s, bySetor[s]]);
  }
  // Append any unlisted sectors
  for (const [s, rs] of Object.entries(bySetor)) {
    if (!sectorOrder.includes(s) && s !== 'Toàn sàn') sectors.push([s, rs]);
  }

  document.getElementById('vn-showing-count').textContent = stockRows.length;

  const container = document.getElementById('vn-sectors-container');

  // Render market overview panel đầu tiên (nếu có data)
  const marketHtml = marketRows.length > 0 ? renderMarketOverview(marketRows) : '';

  container.innerHTML = marketHtml + sectors.map(([sector, srows]) =>
    renderVnSector(sector, srows)
  ).join('');
}

// ── Market Overview Panel (HOSE / HNX) ───────────────────────
function renderMarketOverview(marketRows) {
  // Đảm bảo thứ tự HOSE trước HNX
  const order   = ['HOSE', 'HNX'];
  const ordered = order.map(s => marketRows.find(r => r.symbol === s)).filter(Boolean);

  const cards = ordered.map(r => {
    const label     = r.symbol === 'HOSE' ? 'HOSE (VNINDEX)' : 'HNX';
    const icon      = r.symbol === 'HOSE' ? '🏛' : '🏢';
    const pct1dCls  = r.pctVol1d !== null ? (r.pctVol1d > 0 ? 'pos' : r.pctVol1d < 0 ? 'neg' : 'neu') : 'na';
    const pct5dCls  = r.pctVol5d !== null ? (r.pctVol5d > 0 ? 'pos' : r.pctVol5d < 0 ? 'neg' : 'neu') : 'na';
    const pct1dTxt  = r.pctVol1d !== null ? (r.pctVol1d > 0 ? '+' : '') + r.pctVol1d.toFixed(2) + '%' : 'N/A';
    const pct5dTxt  = r.pctVol5d !== null ? (r.pctVol5d > 0 ? '+' : '') + r.pctVol5d.toFixed(2) + '%' : 'N/A';

    return `
    <div class="market-index-card">
      <div class="mic-header">
        <span class="mic-icon">${icon}</span>
        <span class="mic-label">${label}</span>
      </div>
      <div class="mic-value">${formatVnValue(r.todayVal)}<span class="mic-value-unit">GT hôm nay</span></div>
      <div class="mic-metrics">
        <div class="mic-metric">
          <span class="mic-metric-label">%VOL 1D</span>
          <span class="pct-cell ${pct1dCls} mic-pct">${pct1dTxt}</span>
        </div>
        <div class="mic-metric">
          <span class="mic-metric-label">%VOL 5D</span>
          <span class="pct-cell ${pct5dCls} mic-pct">${pct5dTxt}</span>
        </div>
      </div>
      <div class="mic-spark">${sparklineSmall(r.volSpark)}</div>
    </div>`;
  }).join('');

  return `<div class="market-overview-panel">
    <div class="mop-title">
      <span class="mop-dot"></span>
      TỔNG QUAN THỊ TRƯỜNG
      <span class="mop-sub">Giá trị khớp lệnh toàn sàn</span>
    </div>
    <div class="market-index-cards">${cards}</div>
  </div>`;
}

function renderVnSector(sector, rows) {
  const isCollapsed = vnCollapsed[sector] || false;

  // Compute sector averages for header display
  const avg1d = avgValid(rows.map(r => r.pctVol1d));
  const avg5d = avgValid(rows.map(r => r.pctVol5d));

  const bodyHeight = rows.length * 36 + 33; // 33px thead

  return `
  <div class="vn-sector-block${isCollapsed ? ' collapsed' : ''}" id="sector-${safeid(sector)}">
    <div class="vn-sector-header" onclick="toggleSector('${escAttr(sector)}')">
      <span class="vn-sector-chevron">▾</span>
      <span class="vn-sector-name">${sector}</span>
      <span class="vn-sector-count">${rows.length} mã</span>
      <div class="vn-sector-avg">
        <div class="vn-avg-chip">1D avg: <span class="${avg1d !== null ? (avg1d > 0 ? 'pct-cell pos' : avg1d < 0 ? 'pct-cell neg' : 'pct-cell neu') : 'pct-cell na'}">${avg1d !== null ? (avg1d > 0 ? '+' : '') + avg1d.toFixed(1) + '%' : 'N/A'}</span></div>
        <div class="vn-avg-chip">5D avg: <span class="${avg5d !== null ? (avg5d > 0 ? 'pct-cell pos' : avg5d < 0 ? 'pct-cell neg' : 'pct-cell neu') : 'pct-cell na'}">${avg5d !== null ? (avg5d > 0 ? '+' : '') + avg5d.toFixed(1) + '%' : 'N/A'}</span></div>
      </div>
    </div>
    <div class="vn-sector-body" style="max-height:${isCollapsed ? 0 : bodyHeight}px">
      <table class="vn-table">
        <thead>
          <tr>
            <th onclick="sortVnBy('symbol')"   data-vncol="symbol"   ># SYMBOL <span class="sort-arrow">${vnSortCol==='symbol' ? (vnSortDir==='desc'?'↓':'↑') : '↕'}</span></th>
            <th onclick="sortVnBy('pctVol1d')" data-vncol="pctVol1d" class="${vnSortCol==='pctVol1d'?'active':''}">%VOL 1D <span class="sort-arrow">${vnSortCol==='pctVol1d' ? (vnSortDir==='desc'?'↓':'↑') : '↕'}</span></th>
            <th onclick="sortVnBy('pctVol5d')" data-vncol="pctVol5d" class="${vnSortCol==='pctVol5d'?'active':''}">%VOL 5D <span class="sort-arrow">${vnSortCol==='pctVol5d' ? (vnSortDir==='desc'?'↓':'↑') : '↕'}</span></th>
            <th>GT KHỚP CHỦ ĐỘNG HÔM NAY</th>
            <th>TREND 5D</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((r, i) => renderVnRow(r, i + 1)).join('')}
        </tbody>
      </table>
    </div>
  </div>`;
}

function renderVnRow(r, rank) {
  const rowClass = r.pctVol1d !== null
    ? (r.pctVol1d > 50 ? ' vn-top-gainer' : r.pctVol1d < -50 ? ' vn-top-loser' : '')
    : '';

  return `<tr class="${rowClass}">
    <td>
      <div class="vn-symbol-cell">
        <span class="rank">${rank}</span>
        <a class="vn-symbol-name"
           href="https://finance.vietstock.vn/${r.symbol}/overview.htm"
           target="_blank" rel="noopener noreferrer">${r.symbol}</a>
      </div>
    </td>
    <td>${pctCell(r.pctVol1d)}</td>
    <td>${pctCell(r.pctVol5d)}</td>
    <td class="vn-vol-cell">${formatVnValue(r.todayVal)}</td>
    <td style="padding:4px 14px;vertical-align:middle;">${sparklineSmall(r.volSpark)}</td>
  </tr>`;
}

function toggleSector(sector) {
  vnCollapsed[sector] = !vnCollapsed[sector];
  const block = document.getElementById('sector-' + safeid(sector));
  if (!block) return;
  const body = block.querySelector('.vn-sector-body');
  const rows = block.querySelectorAll('.vn-table tbody tr').length;
  const bodyH = rows * 36 + 33;

  block.classList.toggle('collapsed', vnCollapsed[sector]);
  body.style.maxHeight = vnCollapsed[sector] ? '0' : bodyH + 'px';
}

function sortVnBy(col) {
  if (vnSortCol === col) {
    vnSortDir = vnSortDir === 'desc' ? 'asc' : 'desc';
  } else {
    vnSortCol = col;
    vnSortDir = 'desc';
  }
  renderVnTable();
}

// ── VN sparkline (5 bars) ─────────────────────────────────────
function sparklineSmall(history) {
  const vals = history.filter(v => v !== null && v > 0);
  if (vals.length < 2) return '<span class="pct-cell na">—</span>';
  const W = 60, H = 24, pad = 2;
  const min = Math.min(...vals), max = Math.max(...vals);
  const range = max - min || 1;
  const pts   = vals.map((v, i) => [
    parseFloat((pad + (i / (vals.length - 1)) * (W - pad * 2)).toFixed(1)),
    parseFloat((H - pad - ((v - min) / range) * (H - pad * 2)).toFixed(1))
  ]);
  const poly  = pts.map(p => p.join(',')).join(' ');
  const isUp  = vals[vals.length - 1] >= vals[0];
  const color = isUp ? '#00e676' : '#ff4757';
  const fill  = isUp ? '#00e67614' : '#ff475714';
  const area  = `${pts[0][0]},${H} ${poly} ${pts[pts.length-1][0]},${H}`;
  const [lx, ly] = pts[pts.length - 1];
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="display:block;overflow:visible">
    <polygon points="${area}" fill="${fill}" />
    <polyline points="${poly}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="${lx}" cy="${ly}" r="2" fill="${color}" />
  </svg>`;
}

// ── VN state overlay ──────────────────────────────────────────
function showVnState(type, msg) {
  const el = document.getElementById('vn-state-container');
  const ct = document.getElementById('vn-sectors-container');
  el.style.display = 'flex';
  ct.style.display = 'none';
  if (type === 'loading') {
    el.innerHTML = `<div class="spinner"></div><span>${msg}</span>`;
  } else if (type === 'error') {
    el.innerHTML = `<span class="error-icon">⚠</span><span style="color:var(--red)">${msg}</span>`;
  } else {
    el.innerHTML = `<span class="error-icon">○</span><span>${msg}</span>`;
  }
}
function hideVnState() {
  document.getElementById('vn-state-container').style.display  = 'none';
  document.getElementById('vn-sectors-container').style.display = '';
}

// VN search input
document.getElementById('vn-search').addEventListener('input', e => {
  vnSearchTerm = e.target.value;
  if (vnAllRows.length) renderVnTable();
});

// ══════════════════════════════════════════════════════════════
// HEADER META HELPERS
// ══════════════════════════════════════════════════════════════
function updateHeaderMetaValues(count, date) {
  document.getElementById('total-pairs').textContent = count;
  document.getElementById('data-date').textContent   = date;
  document.getElementById('last-update').textContent = formatTime(new Date());
}

function updateHeaderMeta() {
  if (activeTab === 'binance' && allRows.length > 0) {
    document.getElementById('total-pairs').textContent = allRows.length;
  } else if (activeTab === 'vnstock' && vnAllRows.length > 0) {
    document.getElementById('total-pairs').textContent = vnAllRows.length;
  }
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

function formatVnPrice(p) {
  if (p === null || p === 0) return '—';
  // VN giá tính theo VND (đơn vị nghìn đồng từ TCBS)
  return p.toLocaleString('vi-VN') + ' đ';
}

function formatVnValue(v) {
  if (v === null || v === 0) return '<span class="pct-cell na">—</span>';
  if (v >= 1e12) return `<span>${(v/1e12).toFixed(2)}<span style="color:var(--muted);font-size:10px"> nghìn tỷ</span></span>`;
  if (v >= 1e9)  return `<span>${(v/1e9).toFixed(1)}<span style="color:var(--muted);font-size:10px"> tỷ</span></span>`;
  if (v >= 1e6)  return `<span>${(v/1e6).toFixed(1)}<span style="color:var(--muted);font-size:10px"> tr</span></span>`;
  return v.toLocaleString('vi-VN');
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

// ── Helpers ───────────────────────────────────────────────────
function avgValid(arr) {
  const valid = arr.filter(v => v !== null);
  return valid.length > 0 ? valid.reduce((s, v) => s + v, 0) / valid.length : null;
}

function safeid(str) {
  return str.replace(/[^a-zA-Z0-9]/g, '_');
}

function escAttr(str) {
  return str.replace(/'/g, "\\'");
}

// ══════════════════════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════════════════════
loadData();
