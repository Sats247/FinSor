/* watchlist.js */
let alertDirection = 'above';
let watchTickers = [];
let sparklineCharts = {};
let allTickersCache = [];

async function loadWatchlist() {
  const data = await apiFetch('/api/watchlist/prices');
  if (!data.success) { showToast('Failed to load watchlist', 'error'); return; }
  const prices = data.data;
  watchTickers = Object.keys(prices);
  renderWatchlistCards(prices);
}

function renderWatchlistCards(prices) {
  const grid = document.getElementById('watchlist-grid');
  if (!grid) return;
  if (!Object.keys(prices).length) {
    grid.innerHTML = `<div class="card" style="grid-column:1/-1;padding:40px;text-align:center;">
      <i data-lucide="bookmark" width="32" height="32" style="color:var(--on-surface-muted);margin-bottom:12px;"></i>
      <p style="color:var(--on-surface-muted);">Your watchlist is empty. Click "+ Add Symbol" to track your first stock.</p>
    </div>`;
    lucide.createIcons({ nodes: [grid] });
    return;
  }
  grid.innerHTML = Object.entries(prices).map(([ticker, info]) => {
    const chgClass = (info.change || 0) >= 0 ? 'text-gain' : 'text-loss';
    const chgSign = (info.change || 0) >= 0 ? '+' : '';
    const tickerShort = ticker.replace('.NS', '').replace('=X','').replace('BZ=F','BRENT');
    return `
      <div class="card stock-card" id="card-${ticker.replace(/[^a-zA-Z0-9]/g,'_')}">
        <div class="stock-card-header">
          <div>
            <div class="stock-ticker">${tickerShort}</div>
            <div class="stock-company">${ticker}</div>
          </div>
          <button class="stock-remove" onclick="removeFromWatchlist('${ticker}')" title="Remove">
            <i data-lucide="x" width="16" height="16"></i>
          </button>
        </div>
        <div class="sparkline-wrap">
          <canvas id="spark-${ticker.replace(/[^a-zA-Z0-9]/g,'_')}" style="width:100%;height:48px;"></canvas>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:baseline;">
          <div class="stock-price">${info.price ? fmtINR(info.price) : '—'}</div>
          <div class="${chgClass}" style="font-family:var(--font-display);font-size:var(--text-md);">
            ${chgSign}${(info.change || 0).toFixed(2)}%
          </div>
        </div>
        <div style="display:flex;gap:8px;margin-top:4px;">
          <button class="btn btn-xs btn-ghost" onclick="prefillAlert('${ticker}')">
            <i data-lucide="bell" width="12" height="12"></i> Alert
          </button>
          <a href="/tools?ticker=${ticker}" class="btn btn-xs btn-ghost">
            <i data-lucide="bar-chart-2" width="12" height="12"></i> Chart
          </a>
        </div>
      </div>`;
  }).join('');
  lucide.createIcons({ nodes: [grid] });

  // Draw sparklines
  Object.entries(prices).forEach(([ticker, info]) => {
    const canvasId = `spark-${ticker.replace(/[^a-zA-Z0-9]/g,'_')}`;
    const sparkline = info.sparkline || [];
    drawSparkline(canvasId, sparkline, (info.change || 0) >= 0);
  });
}

function drawSparkline(canvasId, data, isPositive) {
  const canvas = document.getElementById(canvasId);
  if (!canvas || !window.Chart) return;
  if (sparklineCharts[canvasId]) { sparklineCharts[canvasId].destroy(); }
  if (!data.length) return;
  sparklineCharts[canvasId] = new Chart(canvas, {
    type: 'line',
    data: {
      labels: data.map((_, i) => i),
      datasets: [{ data, borderColor: isPositive ? 'var(--gain)' : 'var(--loss)', borderWidth: 1.5, fill: true,
        backgroundColor: isPositive ? 'rgba(0,133,91,0.08)' : 'rgba(192,57,43,0.08)', tension: 0.4, pointRadius: 0 }],
    },
    options: { responsive: true, animation: false, plugins: { legend: { display: false } },
      scales: { x: { display: false }, y: { display: false } } },
  });
}

async function removeFromWatchlist(ticker) {
  await apiFetch('/api/watchlist/remove', { method: 'POST', body: JSON.stringify({ ticker }) });
  showToast(`${ticker.replace('.NS','')} removed`, 'info');
  loadWatchlist();
}

// ─── Alert ────────────────────────────────────────────────────────────────────
function setDir(dir) {
  alertDirection = dir;
  document.getElementById('dir-above').classList.toggle('active', dir === 'above');
  document.getElementById('dir-below').classList.toggle('active', dir === 'below');
}

function prefillAlert(ticker) {
  document.getElementById('alert-ticker').value = ticker.replace('.NS','');
  document.getElementById('alert-ticker').focus();
}

async function setAlert() {
  const ticker = document.getElementById('alert-ticker').value.trim().toUpperCase();
  const rawTarget = parseFloat(document.getElementById('alert-target').value);
  if (!ticker) { showToast('Enter a ticker', 'error'); return; }
  if (isNaN(rawTarget) || rawTarget <= 0) { showToast('Enter a valid target price', 'error'); return; }
  const fullTicker = ticker.includes('.') ? ticker : ticker + '.NS';
  const data = await apiFetch('/api/alerts/set', { method: 'POST', body: JSON.stringify({ ticker: fullTicker, target_price: rawTarget, direction: alertDirection }) });
  if (data.success) { showToast(`Alert set for ₹${rawTarget.toLocaleString('en-IN')} on ${ticker}`, 'success'); loadAlertHistory(); }
  else showToast(data.error || 'Failed to set alert', 'error');
}

async function loadAlertHistory() {
  const data = await apiFetch('/api/alerts/notifications');
  if (!data.success) return;
  const container = document.getElementById('alert-history-container');
  if (!container) return;
  const notifs = data.data.notifications;
  if (!notifs.length) { container.innerHTML = '<p style="color:var(--on-surface-muted);font-size:var(--text-sm);">No notifications yet. Set an alert to get started.</p>'; return; }
  container.innerHTML = notifs.map(n => `
    <div class="alert-history-row">
      <div class="notif-${n.is_read ? 'read-icon' : 'unread-icon'}" style="flex-shrink:0;"><i data-lucide="${n.is_read ? 'check-circle' : 'bell-ring'}" width="16" height="16"></i></div>
      <div>
        <span class="alert-ticker">${(n.ticker||'').replace('.NS','')}</span>
        <span class="alert-msg" style="margin-left:8px;">${n.message}</span>
      </div>
      <span class="alert-time">${n.created_at}</span>
    </div>`).join('');
  lucide.createIcons({ nodes: [container] });
}

async function markAllRead() {
  await apiFetch('/api/alerts/mark-read', { method: 'POST' });
  loadAlertHistory();
  showToast('All notifications marked as read', 'success');
}

// ─── Add Symbol Modal ─────────────────────────────────────────────────────────
async function initModalSearch() {
  try { const r = await fetch('/data/nse_tickers.json'); allTickersCache = await r.json(); } catch {}
}

function openAddModal() {
  document.getElementById('add-modal').classList.add('open');
  document.getElementById('modal-search').focus();
}

function closeAddModal() { document.getElementById('add-modal').classList.remove('open'); }

function modalSearch() {
  const q = document.getElementById('modal-search').value.toLowerCase().trim();
  const dropdown = document.getElementById('modal-search-dropdown');
  dropdown.innerHTML = '';
  if (!q) { dropdown.classList.remove('open'); return; }
  const matches = allTickersCache.filter(t => t.ticker.toLowerCase().includes(q) || t.name.toLowerCase().includes(q)).slice(0, 5);
  if (!matches.length) { dropdown.classList.remove('open'); return; }
  matches.forEach(m => {
    const el = document.createElement('div');
    el.className = 'nav-search-item';
    el.innerHTML = `<strong>${m.ticker.replace('.NS','')}</strong> ${m.name}`;
    el.onclick = () => {
      document.getElementById('modal-search').value = m.name;
      document.getElementById('modal-selected-ticker').value = m.ticker;
      dropdown.classList.remove('open');
    };
    dropdown.appendChild(el);
  });
  dropdown.classList.add('open');
}

async function confirmAdd() {
  const ticker = document.getElementById('modal-selected-ticker').value || document.getElementById('modal-search').value.toUpperCase().trim();
  if (!ticker) { showToast('Select a valid ticker', 'error'); return; }
  const fullTicker = ticker.includes('.') ? ticker : ticker + '.NS';
  const data = await apiFetch('/api/watchlist/add', { method: 'POST', body: JSON.stringify({ ticker: fullTicker }) });
  if (data.success) { showToast(`${fullTicker} added to watchlist`, 'success'); closeAddModal(); loadWatchlist(); }
  else showToast(data.error || 'Failed to add', 'error');
}

// Close modal on overlay click
document.addEventListener('click', (e) => { if (e.target.id === 'add-modal') closeAddModal(); });
// Close modal on Escape
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAddModal(); });

document.addEventListener('DOMContentLoaded', () => {
  loadWatchlist();
  loadAlertHistory();
  initModalSearch();
  // Poll alerts
  setInterval(() => { apiFetch('/api/alerts/check'); loadAlertHistory(); }, 60000);
  lucide.createIcons();

  // Watchlist Manual Refresh
  const refreshWlBtn = document.getElementById('refresh-wl-btn');
  if (refreshWlBtn) {
    refreshWlBtn.addEventListener('click', async () => {
      refreshWlBtn.disabled = true;
      refreshWlBtn.style.opacity = '0.5';
      await loadWatchlist();
      refreshWlBtn.disabled = false;
      refreshWlBtn.style.opacity = '1';
      lucide.createIcons({ nodes: [refreshWlBtn] });
    });
  }

  // Watchlist Live Updates Toggle
  let wlLiveUpdateInterval = null;
  const WL_REFRESH_INTERVAL = 5000;

  function refreshWatchlistData() {
    loadWatchlist().catch(e => console.warn("Auto-refresh error (silent):", e));
  }

  function startWlLiveUpdates() {
    const liveIndicator = document.getElementById('wlLiveIndicator');
    const slider = document.getElementById('wlSliderSpan');
    const knob = document.getElementById('wlKnobSpan');
    if (liveIndicator) liveIndicator.style.display = 'flex';
    if (slider) { slider.style.background = 'var(--primary,#2563eb)'; slider.style.borderColor = 'var(--primary,#2563eb)'; }
    if (knob)   { knob.style.background = '#fff'; knob.style.transform = 'translateX(16px)'; }
    refreshWatchlistData();
    if (wlLiveUpdateInterval) clearInterval(wlLiveUpdateInterval);
    wlLiveUpdateInterval = setInterval(() => {
      refreshWatchlistData();
    }, WL_REFRESH_INTERVAL);
  }

  function stopWlLiveUpdates() {
    const liveIndicator = document.getElementById('wlLiveIndicator');
    const slider = document.getElementById('wlSliderSpan');
    const knob = document.getElementById('wlKnobSpan');
    if (liveIndicator) liveIndicator.style.display = 'none';
    if (slider) { slider.style.background = ''; slider.style.borderColor = ''; }
    if (knob)   { knob.style.background = ''; knob.style.transform = ''; }
    if (wlLiveUpdateInterval) {
      clearInterval(wlLiveUpdateInterval);
      wlLiveUpdateInterval = null;
    }
  }

  const wlLiveUpdateToggle = document.getElementById('wlLiveUpdateToggle');
  if (wlLiveUpdateToggle) {
    wlLiveUpdateToggle.addEventListener('change', function(e) {
      if (e.target.checked) startWlLiveUpdates();
      else stopWlLiveUpdates();
    });
    window.addEventListener('beforeunload', () => stopWlLiveUpdates());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && wlLiveUpdateToggle.checked) stopWlLiveUpdates();
      else if (!document.hidden && wlLiveUpdateToggle.checked) startWlLiveUpdates();
    });
  }
});
