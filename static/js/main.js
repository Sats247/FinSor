/* main.js — Shared utilities for all pages */

// ─── Formatters ──────────────────────────────────────────────────────────────
function fmtINR(n) {
  if (n == null) return '—';
  const abs = Math.abs(n);
  if (abs >= 1e7) return '₹' + (n / 1e7).toFixed(2) + ' Cr';
  if (abs >= 1e5) return '₹' + (n / 1e5).toFixed(2) + ' L';
  if (abs >= 1000) return '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 0 });
  return '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtPct(n, signed = true) {
  if (n == null) return '—';
  const s = signed && n > 0 ? '+' : '';
  return s + n.toFixed(2) + '%';
}

function fmtNum(n, dec = 2) {
  if (n == null) return '—';
  return n.toLocaleString('en-IN', { maximumFractionDigits: dec });
}

function fmtChg(val, chg) {
  const sign = chg >= 0 ? '+' : '';
  return `${sign}${chg.toFixed(2)}%`;
}

// ─── Toast ────────────────────────────────────────────────────────────────────
let _toastTimeout = null;
function showToast(msg, type = 'info', duration = 3500) {
  let el = document.getElementById('finsor-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'finsor-toast';
    el.className = 'finsor-toast';
    document.body.appendChild(el);
  }
  if (_toastTimeout) clearTimeout(_toastTimeout);
  el.className = `finsor-toast finsor-toast-${type}`;
  const icons = { success: 'circle-check', error: 'circle-x', info: 'info' };
  el.innerHTML = `<i data-lucide="${icons[type] || 'info'}" width="16" height="16"></i> ${msg}`;
  lucide.createIcons({ nodes: [el] });
  requestAnimationFrame(() => el.classList.add('toast-visible'));
  _toastTimeout = setTimeout(() => el.classList.remove('toast-visible'), duration);
}

// ─── API Fetch Helper ─────────────────────────────────────────────────────────
async function apiFetch(url, opts = {}) {
  try {
    const res = await fetch(url, {
      headers: { 'Content-Type': 'application/json' },
      ...opts,
    });
    const data = await res.json();
    return data;
  } catch (e) {
    console.error(`apiFetch(${url}) failed:`, e);
    return { success: false, error: e.message };
  }
}

// ─── Global Nav Search ────────────────────────────────────────────────────────
let _tickers = [];
async function initNavSearch() {
  try {
    const r = await fetch('/static/js/nse_tickers_cache.json'); // preloaded, or use data endpoint
    _tickers = await r.json();
  } catch {
    // Fallback to static hardcoded set
    _tickers = [
      {ticker:'RELIANCE.NS',name:'Reliance Industries',sector:'Energy'},
      {ticker:'HDFCBANK.NS',name:'HDFC Bank',sector:'Banking'},
      {ticker:'TCS.NS',name:'Tata Consultancy Services',sector:'IT'},
      {ticker:'INFY.NS',name:'Infosys',sector:'IT'},
      {ticker:'HINDUNILVR.NS',name:'Hindustan Unilever',sector:'FMCG'},
    ];
  }

  const input = document.getElementById('nav-search-input');
  const dropdown = document.getElementById('nav-search-dropdown');
  if (!input || !dropdown) return;

  input.addEventListener('input', () => {
    const q = input.value.toLowerCase().trim();
    dropdown.innerHTML = '';
    if (!q) { dropdown.classList.remove('open'); return; }
    const matches = _tickers.filter(t =>
      t.ticker.toLowerCase().includes(q) || t.name.toLowerCase().includes(q)
    ).slice(0, 6);
    if (!matches.length) { dropdown.classList.remove('open'); return; }
    matches.forEach(m => {
      const el = document.createElement('div');
      el.className = 'nav-search-item';
      el.innerHTML = `<i data-lucide="trending-up" width="14" height="14"></i><strong>${m.ticker.replace('.NS','')}</strong> <span>${m.name}</span>`;
      el.onclick = () => { input.value = ''; dropdown.classList.remove('open'); window.location.href = `/tools?ticker=${m.ticker}`; };
      dropdown.appendChild(el);
    });
    lucide.createIcons({ nodes: [dropdown] });
    dropdown.classList.add('open');
  });
  document.addEventListener('click', (e) => { if (!e.target.closest('.nav-search-wrap')) dropdown.classList.remove('open'); });
}

// ─── Notifications ────────────────────────────────────────────────────────────
async function pollNotifications() {
  const data = await apiFetch('/api/alerts/notifications');
  if (!data.success) return;
  const unread = data.data.unread_count;
  const badge = document.getElementById('notif-badge');
  const dot = document.getElementById('notif-dot');
  const dropdown = document.getElementById('notif-dropdown');
  if (!badge || !dot || !dropdown) return;

  if (unread > 0) {
    badge.textContent = unread > 9 ? '9+' : unread;
    badge.style.display = 'flex';
    dot.style.display = 'block';
  } else {
    badge.style.display = 'none';
    dot.style.display = 'none';
  }

  const notifs = data.data.notifications;
  if (!notifs.length) {
    dropdown.innerHTML = '<div class="notif-empty">No notifications</div>';
  } else {
    dropdown.innerHTML = notifs.slice(0, 10).map(n => `
      <div class="notif-item ${n.is_read ? '' : 'unread'}">
        <i data-lucide="${n.is_read ? 'bell' : 'bell-ring'}" width="14" height="14" class="${n.is_read ? 'notif-read-icon' : 'notif-unread-icon'}"></i>
        <div>
          <div class="notif-message">${n.message}</div>
          <div class="notif-time">${n.created_at}</div>
        </div>
      </div>`).join('');
    lucide.createIcons({ nodes: [dropdown] });
  }
}

// ─── Sidebar Nifty ────────────────────────────────────────────────────────────
async function updateSidebarNifty() {
  const data = await apiFetch('/api/macro');
  if (!data.success) return;
  const nifty = data.data.nifty50;
  const el = document.getElementById('sidebar-nifty');
  const dot = document.getElementById('sidebar-live-dot');
  const label = document.getElementById('sidebar-status-label');
  if (el && nifty && nifty.value) {
    const sign = nifty.change >= 0 ? '+' : '';
    el.innerHTML = `${fmtINR(nifty.value)} <span class="${nifty.change >= 0 ? 'text-gain' : 'text-loss'}">${sign}${nifty.change.toFixed(2)}%</span>`;
  }
  // Market open check (IST 9:15–15:30 weekdays)
  const now = new Date();
  const ist = new Date(now.getTime() + (5.5 * 60 * 60 * 1000));
  const h = ist.getUTCHours(), m = ist.getUTCMinutes(), d = ist.getUTCDay();
  const mins = h * 60 + m;
  const open = d >= 1 && d <= 5 && mins >= 555 && mins <= 930;
  if (dot) dot.classList.toggle('closed', !open);
  if (label) label.textContent = open ? 'LIVE' : 'CLOSED';
}

// ─── User Menu Toggle ─────────────────────────────────────────────────────────
function initUserMenu() {
  const pill = document.getElementById('user-pill');
  const menu = document.getElementById('user-menu');
  if (!pill || !menu) return;
  pill.addEventListener('click', (e) => {
    e.stopPropagation();
    menu.classList.toggle('open');
  });
  document.addEventListener('click', () => menu.classList.remove('open'));
}

// ─── Notifications Dropdown Toggle ───────────────────────────────────────────
function initNotifDropdown() {
  const wrapper = document.getElementById('notif-wrapper');
  const dropdown = document.getElementById('notif-dropdown');
  if (!wrapper || !dropdown) return;
  wrapper.addEventListener('click', (e) => {
    e.stopPropagation();
    dropdown.classList.toggle('open');
    if (dropdown.classList.contains('open')) {
      apiFetch('/api/alerts/mark-read', { method: 'POST' });
      document.getElementById('notif-badge').style.display = 'none';
      document.getElementById('notif-dot').style.display = 'none';
    }
  });
  document.addEventListener('click', () => dropdown.classList.remove('open'));
}

// ─── Bootstrap ───────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  lucide.createIcons();
  initNavSearch();
  initUserMenu();
  initNotifDropdown();
  updateSidebarNifty();
  pollNotifications();
  setInterval(pollNotifications, 30000);
  setInterval(updateSidebarNifty, 60000);

  // Animate landing page progress bars if present
  document.querySelectorAll('.progress-fill[data-target]').forEach(el => {
    requestAnimationFrame(() => {
      setTimeout(() => { el.style.width = el.dataset.target + '%'; }, 400);
    });
  });
});
