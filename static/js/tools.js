let tvWidget = null;
let currentTicker = 'NSE:RELIANCE';
let activeCalcType = 'sip';
let sensitivityChart = null;
let allTickers = [];

// Colour palette — hex values so Chart.js can render them correctly
const CHART_COLORS = {
  primary: '#0058be',
  gain:    '#00855b',
  loss:    '#c0392b',
  warning: '#b45309',
  neutral: '#6b7280',
};

async function initToolsSearch() {
  try {
    const r = await fetch('/data/nse_tickers.json'); allTickers = await r.json();
  } catch { allTickers = []; }
  const input = document.getElementById('tools-search');
  const dropdown = document.getElementById('tools-search-dropdown');
  if (!input || !dropdown) return;
  input.addEventListener('input', () => {
    const q = input.value.toLowerCase().trim();
    dropdown.innerHTML = '';
    if (!q) { dropdown.classList.remove('open'); return; }
    const matches = allTickers.filter(t => t.ticker.toLowerCase().includes(q) || t.name.toLowerCase().includes(q)).slice(0, 6);
    if (!matches.length) { dropdown.classList.remove('open'); return; }
    matches.forEach(m => {
      const el = document.createElement('div');
      el.className = 'nav-search-item';
      el.innerHTML = `<strong>${m.ticker.replace('.NS','')}</strong> ${m.name} <span class="chip chip-neutral" style="font-size:10px;">${m.sector}</span>`;
      el.onclick = () => { input.value = m.ticker.replace('.NS',''); dropdown.classList.remove('open'); changeTicker(m.ticker); };
      dropdown.appendChild(el);
    });
    dropdown.classList.add('open');
  });
  document.addEventListener('click', e => { if (!e.target.closest('#tools-search')) dropdown.classList.remove('open'); });
}

function initTradingView() {
  const container = document.getElementById('tv-chart-container');
  if (!container || typeof TradingView === 'undefined') return;
  const interval = document.getElementById('chart-interval') ? document.getElementById('chart-interval').value : 'D';
  // currentTicker is formatted as 'NSE:RELIANCE', which is correct for JS API
  
  new TradingView.widget({
    "autosize": true,
    "symbol": currentTicker,
    "interval": interval,
    "timezone": "Asia/Kolkata",
    "theme": "light",
    "style": "1",
    "locale": "en",
    "enable_publishing": false,
    "hide_top_toolbar": false,
    "hide_legend": false,
    "save_image": false,
    "container_id": "tv-chart-container",
    "hide_side_toolbar": false,
    "allow_symbol_change": true,
    "studies": [
      "RSI@tv-basicstudies"
    ]
  });
}

async function changeTicker(nse_ticker) {
  currentTicker = `NSE:${nse_ticker.replace('.NS', '')}`;
  initTradingView();
  await loadFundamentals(nse_ticker);
}

function updateChart() {
  initTradingView();
}

async function loadFundamentals(ticker) {
  const data = await apiFetch(`/api/tools/stock?ticker=${ticker}`);
  if (!data.success) { showToast('Could not fetch fundamentals', 'error'); return; }
  const f = data.data;
  const set = (id, val, fallback = '—') => { const el = document.getElementById(id); if (el) el.textContent = val != null ? val : fallback; };
  set('f-pe', f.pe_ratio ? f.pe_ratio.toFixed(2) : null);
  set('f-pb', f.pb_ratio ? f.pb_ratio.toFixed(2) : null);
  set('f-eps', f.eps ? '₹' + f.eps.toFixed(2) : null);
  set('f-mcap', f.market_cap_cr ? f.market_cap_cr.toLocaleString('en-IN') : null);
  set('f-52h', f.week_52_high ? '₹' + f.week_52_high.toFixed(2) : null);
  set('f-52l', f.week_52_low ? '₹' + f.week_52_low.toFixed(2) : null);
  set('f-div', f.dividend_yield ? f.dividend_yield + '%' : '—');
  set('f-sector', f.sector);
}

// ─── Calculator ───────────────────────────────────────────────────────────────
function switchCalcTab(type, btn) {
  activeCalcType = type;
  document.querySelectorAll('.calc-panel').forEach(p => p.style.display = 'none');
  document.querySelectorAll('.calc-tab').forEach(t => t.classList.remove('active'));
  const panel = document.getElementById('calc-' + type);
  if (panel) panel.style.display = 'flex';
  if (btn) btn.classList.add('active');
  document.getElementById('calc-result').style.display = 'none';
}

async function runCalculator() {
  const t = activeCalcType;
  let payload = { type: t, inflation: 6.5 };
  if (t === 'sip') {
    payload.pmt = parseFloat(document.getElementById('sip-pmt').value);
    payload.rate = parseFloat(document.getElementById('sip-rate').value);
    payload.years = parseInt(document.getElementById('sip-years').value);
  } else if (t === 'lump') {
    payload.pv = parseFloat(document.getElementById('lump-pv').value);
    payload.rate = parseFloat(document.getElementById('lump-rate').value);
    payload.years = parseInt(document.getElementById('lump-years').value);
  } else if (t === 'cagr') {
    payload.start_value = parseFloat(document.getElementById('cagr-start').value);
    payload.end_value = parseFloat(document.getElementById('cagr-end').value);
    payload.years = parseInt(document.getElementById('cagr-years').value);
  } else if (t === 'goalseek') {
    payload.fv = parseFloat(document.getElementById('goal-fv').value);
    payload.rate = parseFloat(document.getElementById('goal-rate').value);
    payload.years = parseInt(document.getElementById('goal-years').value);
  }

  const data = await apiFetch('/api/tools/calculate', { method: 'POST', body: JSON.stringify(payload) });
  if (!data.success) { showToast(data.error || 'Calculation failed', 'error'); return; }
  const r = data.data;

  const resultDiv = document.getElementById('calc-result');
  const labelEl = document.getElementById('calc-result-label');
  const valEl = document.getElementById('calc-result-value');
  const subEl = document.getElementById('calc-result-sub');
  resultDiv.style.display = 'block';

  if (t === 'sip')      { labelEl.textContent = 'Future Value (SIP)'; valEl.textContent = fmtINR(r.result); subEl.textContent = `Inflation-adjusted: ${fmtINR(r.real_result)}`; renderSensitivity(r.sensitivity); }
  else if (t === 'lump') { labelEl.textContent = 'Future Value (Lump Sum)'; valEl.textContent = fmtINR(r.result); subEl.textContent = `Inflation-adjusted: ${fmtINR(r.real_result)}`; }
  else if (t === 'cagr') { labelEl.textContent = 'CAGR'; valEl.textContent = r.result + '%'; subEl.textContent = `Annualised return over the chosen period.`; }
  else if (t === 'goalseek') { labelEl.textContent = 'Required Monthly SIP'; valEl.textContent = fmtINR(r.result); subEl.textContent = 'Invest this amount monthly to reach your goal.'; }
}

function renderSensitivity(s) {
  if (!s || !window.Chart) return;
  const ctx = document.getElementById('sensitivity-chart');
  if (!ctx) return;
  if (sensitivityChart) sensitivityChart.destroy();
  const labels = ['SIP Amount', 'Time Horizon', 'Return Rate'];
  const values = [s.sip_amount_impact * 100, s.time_horizon_impact * 100, s.return_rate_impact * 100];
  sensitivityChart = new Chart(ctx, {
    type: 'doughnut',
    data: { labels, datasets: [{ data: values, backgroundColor: [CHART_COLORS.primary, CHART_COLORS.gain, CHART_COLORS.warning], borderWidth: 0 }] },
    options: { responsive: true, maintainAspectRatio: false, cutout: '55%',
      plugins: { legend: { position: 'bottom', labels: { font: { family: 'Inter' }, color: '#4a5568',
        generateLabels: (chart) => chart.data.labels.map((l, i) => ({
          text: l, fillStyle: chart.data.datasets[0].backgroundColor[i],
          strokeStyle: 'transparent', lineWidth: 0,
        }))
      }}}
    },
  });
  const noteEl = document.getElementById('sensitivity-note');
  const max = Math.max(...values);
  const maxLabel = labels[values.indexOf(max)];
  if (noteEl) noteEl.textContent = `${maxLabel} has the biggest impact (${max.toFixed(1)}%) on your corpus.`;
}

async function calcRealReturn() {
  const nominal = parseFloat(document.getElementById('real-nominal').value);
  const inflation = parseFloat(document.getElementById('real-inflation').value);
  // Use local formula: ((1+n/100)/(1+i/100)) - 1
  const real = ((1 + nominal / 100) / (1 + inflation / 100) - 1) * 100;
  const resultDiv = document.getElementById('real-result');
  const valEl = document.getElementById('real-result-val');
  const subEl = document.getElementById('real-result-sub');
  resultDiv.style.display = 'block';
  valEl.textContent = real.toFixed(2) + '%';
  subEl.textContent = `After inflation, each rupee invested at ${nominal}% nominal only grows at ${real.toFixed(2)}% in today's money.`;
}

function searchStock() {
  const input = document.getElementById('tools-search');
  if (!input) return;
  // Handled by initToolsSearch
}

document.addEventListener('DOMContentLoaded', () => {
  initToolsSearch();
  // Load TV after a tick to allow script to load
  setTimeout(initTradingView, 500);
  // Pre-load RELIANCE fundamentals
  loadFundamentals('RELIANCE.NS');

  // Check URL params for pre-selected ticker
  const params = new URLSearchParams(window.location.search);
  if (params.get('ticker')) {
    const t = params.get('ticker');
    setTimeout(() => changeTicker(t), 600);
  }
  lucide.createIcons();
});
