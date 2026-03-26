/* dashboard.js */
let chatHistory = [];
let sipChart = null;
let activeType = 'SIP';
let intentTarget = null;

// ─── Macro Strip ──────────────────────────────────────────────────────────────
async function loadMacro(force = false) {
  const url = force ? '/api/macro?force=true' : '/api/macro';
  const data = await apiFetch(url);
  if (!data.success) return;
  const d = data.data;
  const CHIPS = [
    ['m-nifty',       'm-nifty-chg',       'nifty50'],
    ['m-sensex',      'm-sensex-chg',      'sensex'],
    ['m-vix',         'm-vix-chg',         'india_vix'],
    ['m-usdinr',      'm-usdinr-chg',      'usd_inr'],
    ['m-brent',       'm-brent-chg',       'brent'],
    ['m-gold',        'm-gold-chg',        'gold'],
    ['m-sp500',       'm-sp500-chg',       'sp500'],
    ['m-nasdaq100',   'm-nasdaq100-chg',   'nasdaq100'],
    ['m-eurostoxx50', 'm-eurostoxx50-chg', 'eurostoxx50'],
  ];
  CHIPS.forEach(([valId, chgId, key]) => {
    const info = d[key] || {};
    const valEl = document.getElementById(valId);
    const chgEl = document.getElementById(chgId);
    if (valEl && info.value != null) valEl.textContent = info.value.toLocaleString('en-IN', { maximumFractionDigits: 2 });
    if (chgEl && info.change != null) {
      const sign = info.change >= 0 ? '+' : '';
      chgEl.textContent = `${sign}${info.change.toFixed(2)}%`;
      chgEl.className = `macro-chip-change ${info.change >= 0 ? 'text-gain' : 'text-loss'}`;
    }
  });
}

async function loadRegime() {
  const data = await apiFetch('/api/regime');
  if (!data.success) return;
  const r = data.data;
  const badge = document.getElementById('regime-badge');
  if (badge) { 
    badge.textContent = r.regime; 
    badge.className = `chip ${r.regime === 'Bear' ? 'chip-loss' : r.regime === 'Overheated' ? 'chip-warning' : 'chip-primary'}`; 
    if (r.regime_reason) {
      badge.title = r.regime_reason;
      badge.style.cursor = 'help';
    }
  }
  const dot = document.getElementById('regime-dot');
  if (dot) dot.style.background = r.regime === 'Bear' ? 'var(--loss)' : r.regime === 'Overheated' ? 'var(--warning)' : 'var(--gain)';
  updateMMI(r.mmi_score, r.mmi_label, r.summary);
}

function updateMMI(score, label, summary) {
  const scoreEl = document.getElementById('mmi-score');
  const labelEl = document.getElementById('mmi-label');
  const barFear = document.getElementById('mmi-bar-fear');
  const barGreed = document.getElementById('mmi-bar-greed');
  const summaryEl = document.getElementById('mmi-summary');
  
  if (scoreEl) scoreEl.textContent = score;
  if (labelEl) {
    labelEl.textContent = label;
    const colors = { 'Extreme Fear': 'var(--loss)', 'Fear': 'var(--loss)', 'Neutral': 'var(--on-surface-muted)', 'Greed': 'var(--gain)', 'Extreme Greed': 'var(--gain)' };
    labelEl.style.color = colors[label] || 'var(--primary)';
  }
  
  if (barFear && barGreed) {
    if (score < 50) {
      // Fear: width grows from center to left. Total container is 100%, center is 50%.
      const fearPct = 50 - score;
      barFear.style.width = `${fearPct}%`;
      barGreed.style.width = '0%';
    } else if (score > 50) {
      // Greed: width grows from center to right
      const greedPct = score - 50;
      barGreed.style.width = `${greedPct}%`;
      barFear.style.width = '0%';
    } else {
      // Neutral
      barFear.style.width = '0%';
      barGreed.style.width = '0%';
    }
  }
  
  if (summaryEl) summaryEl.textContent = summary || '';
}

// ─── Predictions ──────────────────────────────────────────────────────────────
async function loadPredictions() {
  const data = await apiFetch('/api/predictions');
  const container = document.getElementById('predictions-container');
  if (!container) return;
  const poly = (data.success && data.data.polymarket) || [];
  if (!poly.length) { container.innerHTML = '<p style="font-size:var(--text-sm);color:var(--on-surface-muted);">No India-relevant predictions found.</p>'; return; }
  container.innerHTML = poly.map((p, i) => `
    <div class="prediction-row">
      <div class="prediction-info">
        <div class="prediction-q">${p.question}</div>
        <div class="prediction-desc">Probability: <strong>${Math.round(p.probability * 100)}%</strong> · Volume: ${p.volume_usd > 1000 ? '$' + (p.volume_usd / 1000).toFixed(0) + 'K' : '$' + p.volume_usd}</div>
      </div>
      <div class="prediction-actions">
        <span class="chip ${p.probability > 0.6 ? 'chip-gain' : p.probability < 0.4 ? 'chip-loss' : 'chip-neutral'}">${Math.round(p.probability * 100)}%</span>
        <button class="intent-btn" onclick="openIntentMenu(this, '${p.question.substring(0,30)}')" title="Research Intent">
          <i data-lucide="bookmark" width="14" height="14"></i>
        </button>
      </div>
    </div>`).join('');
  lucide.createIcons({ nodes: [container] });
}

// ─── News ─────────────────────────────────────────────────────────────────────
async function loadNews() {
  const data = await apiFetch('/api/news');
  const container = document.getElementById('news-container');
  if (!container) return;
  const news = (data.success && data.data) || [];
  if (!news.length) { container.innerHTML = '<p style="color:var(--on-surface-muted);font-size:var(--text-sm);">No headlines available.</p>'; return; }
  container.innerHTML = news.map(h => `
    <div class="news-row">
      <div class="news-dot news-dot-${h.category}"></div>
      <div style="min-width:0;">
        <a href="${h.link}" target="_blank" class="news-title" title="${h.title}" style="text-decoration:none;">${h.title}</a>
        <div class="news-meta">${h.source} · ${h.published}</div>
      </div>
    </div>`).join('');
}

// ─── Fund Cards ───────────────────────────────────────────────────────────────
function riskDots(level) {
  return Array.from({ length: 10 }, (_, i) => `<div class="risk-dot ${i < level ? 'risk-dot-filled' : 'risk-dot-empty'}"></div>`).join('');
}

async function loadFunds(type = 'SIP') {
  const data = await apiFetch(`/api/funds?type=${type}`);
  const container = document.getElementById('fund-cards-row');
  if (!container) return;
  if (!data.success || !data.data.funds.length) {
    container.innerHTML = '<p style="color:var(--on-surface-muted);">No matching funds found.</p>'; return;
  }
  const r = data.data;
  const nudgeBanner = document.getElementById('macro-nudge-banner');
  const nudgeText = document.getElementById('macro-nudge-text');
  if (nudgeBanner && r.macro_nudge_applied && r.nudge_reason) {
    nudgeText.textContent = '⚠ Macro alert: ' + r.nudge_reason;
    nudgeBanner.style.display = 'flex';
  } else if (nudgeBanner) nudgeBanner.style.display = 'none';

  container.innerHTML = r.funds.map(f => `
    <div class="fund-card">
      <div class="fund-amc">${f.amc}</div>
      <div class="fund-name" title="${f.name}">${f.name}</div>
      <div class="fund-data-row">
        <span class="fund-data-label">Risk Level</span>
        <div class="risk-dots">${riskDots(f.risk_level)}</div>
      </div>
      <div class="fund-data-row">
        <span class="fund-data-label">Expense Ratio</span>
        <span class="fund-data-val">${f.expense_ratio}%</span>
      </div>
      <div class="fund-data-row">
        <span class="fund-data-label">NAV</span>
        <span class="fund-data-val">${f.nav ? '₹' + f.nav.toFixed(2) : '—'}</span>
      </div>
      <div class="fund-data-row" style="margin-top:4px;">
        <span class="chip chip-neutral">${f.category}</span>
        <span class="chip chip-primary">${r.adjusted_category}</span>
      </div>
    </div>`).join('');

  // Update health row
  const h = r.health;
  if (h) {
    const er = document.getElementById('avg-er'); if (er) er.textContent = h.avg_expense_ratio + '%';
    const ds = document.getElementById('div-score'); if (ds) ds.textContent = '78/100';
    const te = document.getElementById('tax-eff'); if (te) te.textContent = h.tax_efficiency;
  }

  // SIP Projection Chart
  const proj = r.projection;
  if (proj && window.Chart) {
    const ctx = document.getElementById('sip-projection-chart');
    if (!ctx) return;
    if (sipChart) sipChart.destroy();
    sipChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: proj.years.map(y => y + 'Y'),
        datasets: [
          { label: 'Worst (8%)', data: proj.worst, borderColor: 'var(--loss)', borderWidth: 2, fill: false, tension: 0.4, pointRadius: 2 },
          { label: 'Base (12%)', data: proj.base,  borderColor: 'var(--primary)', borderWidth: 2.5, fill: false, tension: 0.4, pointRadius: 3 },
          { label: 'Best (15%)', data: proj.best,  borderColor: 'var(--gain)',  borderWidth: 2, fill: false, tension: 0.4, pointRadius: 2 },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false, animation: { duration: 600 },
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { display: false }, ticks: { font: { family: 'Inter' } } },
          y: { grid: { color: 'rgba(194,198,214,0.15)' }, ticks: { callback: v => v >= 1e7 ? (v/1e7).toFixed(1)+'Cr' : v >= 1e5 ? (v/1e5).toFixed(0)+'L' : v, font: { family: 'Inter' } } },
        },
      },
    });
  }
}

// ─── Health Ring ─────────────────────────────────────────────────────────────
async function loadPortfolioHealth() {
  const data = await apiFetch('/api/portfolio/holdings');
  if (!data.success) return;
  const s = data.data.summary;
  const score = s.health_score || 0;
  const ring = document.getElementById('health-ring');
  if (ring) {
    const circumference = 263.9;
    ring.style.strokeDashoffset = circumference - (score / 100) * circumference;
  }
  const scoreEl = document.getElementById('health-score'); if (scoreEl) scoreEl.textContent = score;
  const valEl = document.getElementById('health-value'); if (valEl) valEl.textContent = fmtINR(s.current_value);
  const gainEl = document.getElementById('health-gain');
  if (gainEl && s.total_pnl != null) {
    gainEl.textContent = fmtINR(Math.abs(s.total_pnl)) + ' ' + (s.total_pnl >= 0 ? '▲' : '▼') + Math.abs(s.total_pnl_pct).toFixed(2) + '%';
    gainEl.className = `chip ${s.total_pnl >= 0 ? 'chip-gain' : 'chip-loss'}`;
  }
}

// ─── Genie ────────────────────────────────────────────────────────────────────
async function sendGenie(msg) {
  if (!msg.trim()) return;
  const area = document.getElementById('genie-chat-area');
  const input = document.getElementById('genie-input');
  const sendBtn = document.getElementById('genie-send-btn');
  if (!area) return;
  input.value = ''; input.disabled = true; sendBtn.disabled = true;

  // Append user bubble
  area.innerHTML += `<div class="user-bubble">${msg.replace(/</g,'&lt;')}</div>`;
  // Typing indicator
  const typingId = 'typing-' + Date.now();
  area.innerHTML += `<div id="${typingId}" class="typing-indicator"><span></span><span></span><span></span></div>`;
  area.scrollTop = area.scrollHeight;

  chatHistory.push({ role: 'user', content: msg });

  const data = await apiFetch('/api/genie', {
    method: 'POST',
    body: JSON.stringify({ message: msg, conversation_history: chatHistory.slice(-6) }),
  });

  const typing = document.getElementById(typingId);
  if (typing) typing.remove();

  const response = data.success ? data.data.response : (data.error || 'Something went wrong. Please try again.');
  const bias = data.success && data.data.bias_detected;
  const mctx = data.success && data.data.macro_context_used;
  const ctx = mctx ? `Nifty: ${mctx.nifty?.toFixed(0)} · VIX: ${mctx.vix?.toFixed(2)} · Regime: ${mctx.regime}` : '';

  area.innerHTML += `
    <div class="genie-bubble-wrap">
      <div class="genie-bubble">
        <div class="genie-bubble-header">
          <i data-lucide="sparkles" width="12" height="12" style="color:var(--primary);"></i>
          <span class="genie-bubble-name">FinSor Genie</span>
          ${bias ? `<span class="chip chip-warning" style="font-size:10px;">Bias: ${bias.replace('_',' ')}</span>` : ''}
        </div>
        <p class="genie-bubble-text">${response.replace(/</g,'&lt;').replace(/\n/g,'<br>')}</p>
        ${ctx ? `<p class="genie-context-tag">Context used: ${ctx}</p>` : ''}
      </div>
      <p class="genie-disclaimer">FinSor Genie provides research assistance, not financial advice. Always consult a registered advisor before investing.</p>
    </div>`;

  chatHistory.push({ role: 'assistant', content: response });
  area.scrollTop = area.scrollHeight;
  input.disabled = false; sendBtn.disabled = false;
  lucide.createIcons({ nodes: [area] });
}

// ─── Intent Menu ──────────────────────────────────────────────────────────────
function openIntentMenu(btn, ticker) {
  intentTarget = ticker;
  const dd = document.getElementById('intent-dropdown');
  const rect = btn.getBoundingClientRect();
  dd.style.top = rect.bottom + window.scrollY + 4 + 'px';
  dd.style.left = rect.left + 'px';
  dd.style.display = 'block';
  const hide = () => { dd.style.display = 'none'; document.removeEventListener('click', hide); };
  setTimeout(() => document.addEventListener('click', hide), 0);
}

async function saveIntent(intentLabel) {
  if (!intentTarget) return;
  await apiFetch('/api/research_intentions/set', { method: 'POST', body: JSON.stringify({ ticker: intentTarget, intention: intentLabel, note: '' }) });
  showToast(`Intent saved: ${intentLabel}`, 'success');
}

function exportFundsCSV() { showToast('Fund export launched.', 'info'); }

// ─── Fund Tabs ────────────────────────────────────────────────────────────────
function initFundTabs() {
  document.querySelectorAll('.fund-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.fund-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      activeType = tab.dataset.type;
      const titleObj = { 'SIP': 'SIP Projection', 'MF': 'Mutual Fund Projection', 'ETF': 'ETF Projection' };
      const pt = document.getElementById('projection-title');
      if (pt) pt.textContent = titleObj[activeType] || 'Projection';
      loadFunds(activeType);
    });
  });
}

// ─── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadMacro();
  loadRegime();
  loadPredictions();
  loadNews();
  loadFunds('SIP');
  loadPortfolioHealth();
  initFundTabs();

  // Refresh Macro button
  const refreshBtn = document.getElementById('refresh-macro-btn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', async () => {
      refreshBtn.disabled = true;
      refreshBtn.style.opacity = '0.5';
      await loadMacro(true);
      refreshBtn.disabled = false;
      refreshBtn.style.opacity = '1';
    });
  }

  // Live Updates Toggle
  let liveUpdateInterval = null;
  const REFRESH_INTERVAL = 5000; // 5 seconds

  function refreshStockData() {
    // Reuse loadMacro(true) as our refresh endpoint and ignore errors
    loadMacro(true).catch(e => console.warn("Auto-refresh error (silent):", e));
  }

  function startLiveUpdates() {
    const liveIndicator = document.getElementById('liveIndicator');
    if (liveIndicator) liveIndicator.style.display = 'flex';
    
    // Initial immediate refresh
    refreshStockData();
    
    // Prevent multiple intervals
    if (liveUpdateInterval) clearInterval(liveUpdateInterval);
    
    // Set up interval
    liveUpdateInterval = setInterval(() => {
      refreshStockData();
    }, REFRESH_INTERVAL);
  }

  function stopLiveUpdates() {
    const liveIndicator = document.getElementById('liveIndicator');
    if (liveIndicator) liveIndicator.style.display = 'none';
    
    // Clear interval
    if (liveUpdateInterval) {
      clearInterval(liveUpdateInterval);
      liveUpdateInterval = null;
    }
  }

  const liveUpdateToggle = document.getElementById('liveUpdateToggle');
  if (liveUpdateToggle) {
    liveUpdateToggle.addEventListener('change', function(e) {
      if (e.target.checked) {
        startLiveUpdates();
      } else {
        stopLiveUpdates();
      }
    });

    // Clean up on page unload
    window.addEventListener('beforeunload', () => {
      stopLiveUpdates();
    });

    // Pause updates when tab is not visible
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && liveUpdateToggle.checked) {
        stopLiveUpdates();
      } else if (!document.hidden && liveUpdateToggle.checked) {
        startLiveUpdates();
      }
    });
  }

  // Genie send
  const sendBtn = document.getElementById('genie-send-btn');
  const input = document.getElementById('genie-input');
  if (sendBtn && input) {
    sendBtn.addEventListener('click', () => sendGenie(input.value));
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendGenie(input.value); });
  }
  document.querySelectorAll('.prompt-chip').forEach(chip => {
    chip.addEventListener('click', () => sendGenie(chip.dataset.prompt));
  });

  // Auto-refresh
  setInterval(loadMacro, 60000);
  setInterval(loadRegime, 60000);
  setInterval(loadNews, 120000);
});
