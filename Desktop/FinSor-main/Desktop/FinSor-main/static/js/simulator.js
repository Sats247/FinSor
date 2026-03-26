/* simulator.js */
let simChart = null;
let chartMode = 'nominal';
let lastData = null;

function getSliders() {
  return {
    monthly_sip: parseInt(document.getElementById('sip-slider').value),
    years: parseInt(document.getElementById('years-slider').value),
    nifty_rate: parseFloat(document.getElementById('rate-slider').value),
    job_loss_months: parseInt(document.getElementById('job-loss-slider').value),
    crash_pct: parseFloat(document.getElementById('crash-slider').value),
    inflation: parseFloat(document.getElementById('inflation-slider').value),
    fd_rate: 7.0,
    crash_at_year: Math.ceil(parseInt(document.getElementById('years-slider').value) / 2),
  };
}

function updateDisplays() {
  const sip = parseInt(document.getElementById('sip-slider').value);
  const years = parseInt(document.getElementById('years-slider').value);
  const rate = parseFloat(document.getElementById('rate-slider').value);
  const jl = parseInt(document.getElementById('job-loss-slider').value);
  const cr = parseFloat(document.getElementById('crash-slider').value);
  const inf = parseFloat(document.getElementById('inflation-slider').value);

  document.getElementById('sip-display').textContent = '₹' + sip.toLocaleString('en-IN');
  document.getElementById('years-display').textContent = years + ' Year' + (years > 1 ? 's' : '');
  document.getElementById('rate-display').textContent = rate.toFixed(1) + '%';
  document.getElementById('job-loss-val').textContent = jl + ' mo';
  document.getElementById('crash-val').textContent = cr + '%';
  document.getElementById('inflation-val').textContent = inf.toFixed(1) + '%';
}

async function onSliderChange() {
  updateDisplays();
  const params = getSliders();
  const data = await apiFetch('/api/simulator/calculate', {
    method: 'POST',
    body: JSON.stringify(params),
  });
  if (!data.success) return;
  lastData = data.data;
  renderSimulatorOutput(data.data, params);
}

function renderSimulatorOutput(d, params) {
  const years = d.scenario_base.length;
  const labels = Array.from({ length: years }, (_, i) => (i + 1) + 'Y');

  const nominal = (arr) => arr.map(s => s.nominal);
  const real = (arr) => arr.map(s => s.real);
  const pickMode = (arr) => chartMode === 'real' ? real(arr) : nominal(arr);

  const final = (key) => d[key][d[key].length - 1];
  document.getElementById('worst-corpus').textContent = fmtINR(final('scenario_worst').nominal);
  document.getElementById('base-corpus').textContent = fmtINR(final('scenario_base').nominal);
  document.getElementById('best-corpus').textContent = fmtINR(final('scenario_best').nominal);
  document.getElementById('impact-job-loss').textContent = d.impact_job_loss ? fmtINR(d.impact_job_loss) : '₹0';
  document.getElementById('impact-crash').textContent = d.impact_crash ? fmtINR(d.impact_crash) : '₹0';
  document.getElementById('real-value').textContent = fmtINR(final('scenario_base').real);

  // Explanations
  const sip = params.monthly_sip;
  const yr = params.years;
  document.getElementById('sip-explanation').textContent = `At ${fmtINR(sip)}/month for ${yr} years at 12%, you could build ${fmtINR(final('scenario_base').nominal)} in nominal value.`;
  document.getElementById('years-explanation').textContent = yr <= 10 ? 'Compounding needs time. Extending by 5 more years can nearly double your corpus.' : 'Great horizon! Time is your biggest ally in equity investing.';
  document.getElementById('rate-explanation').textContent = `A 1% improvement in returns on your SIP adds ${fmtINR(Math.round((final('scenario_best').nominal - final('scenario_base').nominal) / 3))} over ${yr} years.`;

  // Peer comparison
  const peerAges = [
    { label: 'Your Peer (25y)', corpus: final('scenario_base').nominal * 0.7 },
    { label: 'National Average', corpus: final('scenario_base').nominal * 0.45 },
    { label: 'You (Projected)',  corpus: final('scenario_base').nominal },
  ];
  const maxPeer = peerAges[peerAges.length - 1].corpus;
  const peerContainer = document.getElementById('peer-rows');
  if (peerContainer) {
    peerContainer.innerHTML = peerAges.map(p => {
      const pct = Math.round((p.corpus / maxPeer) * 100);
      return `<div class="peer-row">
        <div class="peer-row-header"><span class="peer-age-label">${p.label}</span><span style="font-family:var(--font-display);font-size:var(--text-sm);color:var(--on-surface);">${fmtINR(p.corpus)}</span></div>
        <div class="peer-bar-stack"><div class="peer-bar-segment" style="width:${pct}%;background:var(--primary);opacity:${0.5 + pct/200};"></div></div>
      </div>`;
    }).join('');
  }

  // Chart
  const ctx = document.getElementById('sim-chart');
  if (!ctx || !window.Chart) return;
  if (simChart) simChart.destroy();
  const datasets = [
    { label: 'Worst', data: pickMode(d.scenario_worst), borderColor: 'var(--loss)', borderWidth: 2, fill: false, tension: 0.4, pointRadius: 0 },
    { label: 'Base',  data: pickMode(d.scenario_base),  borderColor: 'var(--primary)', borderWidth: 2.5, fill: false, tension: 0.4, pointRadius: 0 },
    { label: 'Best',  data: pickMode(d.scenario_best),  borderColor: 'var(--gain)',  borderWidth: 2, fill: false, tension: 0.4, pointRadius: 0 },
  ];
  if (chartMode === 'comparison') {
    datasets.push({ label: 'FD (7%)', data: nominal(d.fd_corpus), borderColor: 'var(--warning)', borderWidth: 2, borderDash: [4,4], fill: false, tension: 0.4, pointRadius: 0 });
    document.getElementById('fd-legend').style.display = 'flex';
  } else { document.getElementById('fd-legend').style.display = 'none'; }

  simChart = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true, maintainAspectRatio: false, animation: { duration: 400 },
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => c.dataset.label + ': ' + fmtINR(c.raw) } } },
      scales: {
        x: { grid: { display: false }, ticks: { font: { family: 'Inter' } } },
        y: { grid: { color: 'rgba(194,198,214,0.15)' }, ticks: { callback: v => v >= 1e7 ? (v/1e7).toFixed(1)+'Cr' : v >= 1e5 ? (v/1e5).toFixed(0)+'L' : v, font: { family: 'Inter' } } },
      },
    },
  });
}

function toggleChartMode(mode) {
  chartMode = mode;
  ['nominal', 'real', 'comparison'].forEach(m => {
    const btn = document.getElementById('btn-' + m);
    if (btn) btn.style.borderColor = m === mode ? 'var(--primary)' : '';
  });
  if (lastData) renderSimulatorOutput(lastData, getSliders());
}

function resetSliders() {
  document.getElementById('sip-slider').value = 10000;
  document.getElementById('years-slider').value = 20;
  document.getElementById('rate-slider').value = 12;
  document.getElementById('job-loss-slider').value = 0;
  document.getElementById('crash-slider').value = 0;
  document.getElementById('inflation-slider').value = 6.5;
  onSliderChange();
}

document.addEventListener('DOMContentLoaded', () => { onSliderChange(); lucide.createIcons(); });
