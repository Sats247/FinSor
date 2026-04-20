/* simulator.js — Interactive Financial Decision Simulator */

// ─── State ────────────────────────────────────────────────────────────────────
let simChart = null;
let chartMode = 'nominal';   // 'nominal' | 'real' | 'comparison' | 'crash'
let lastData = null;
let activeCrashTiming = 'none';

// ─── Semantic color palette ───────────────────────────────────────────────────
const SIM_COLORS = {
  base: '#2563EB',   // Expected  → solid blue
  worst: '#DC2626',   // Conservative → solid red
  best: '#16A34A',   // Optimistic → solid green
  crashEarly: '#DC2626',   // Dashed red
  crashMid: '#EA580C',   // Dashed orange
  crashLate: '#16A34A',   // Dashed olive-green (less impact)
  crashNone: '#2563EB',   // Solid blue (base without crash)
  fd: '#B45309',   // Amber
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function getSliders() {
  return {
    monthly_sip: parseInt(document.getElementById('sip-slider').value),
    years: parseInt(document.getElementById('years-slider').value),
    nifty_rate: parseFloat(document.getElementById('rate-slider').value),
    job_loss_months: parseInt(document.getElementById('job-loss-slider').value),
    crash_pct: parseFloat(document.getElementById('crash-slider').value),
    inflation: parseFloat(document.getElementById('inflation-slider').value),
    fd_rate: parseFloat(document.getElementById('fd-slider')?.value) || 7.0,
    crash_timing: activeCrashTiming,
  };
}

function updateDisplays() {
  const sip = parseInt(document.getElementById('sip-slider').value);
  const yr = parseInt(document.getElementById('years-slider').value);
  const rate = parseFloat(document.getElementById('rate-slider').value);
  const jl = parseInt(document.getElementById('job-loss-slider').value);
  const cr = parseFloat(document.getElementById('crash-slider').value);
  const inf = parseFloat(document.getElementById('inflation-slider').value);
  const fd = parseFloat(document.getElementById('fd-slider')?.value || 7.0);

  document.getElementById('sip-display').textContent = '₹' + sip.toLocaleString('en-IN');
  document.getElementById('years-display').textContent = yr + ' Year' + (yr > 1 ? 's' : '');
  document.getElementById('rate-display').textContent = rate.toFixed(1) + '%';
  document.getElementById('job-loss-val').textContent = jl + ' mo';
  document.getElementById('crash-val').textContent = cr + '%';
  document.getElementById('inflation-val').textContent = inf.toFixed(1) + '%';
  const fdVal = document.getElementById('fd-val');
  if (fdVal) fdVal.textContent = fd.toFixed(2) + '%';

  updateRateHint(rate);
}

/** Behavioral nudge: guide users on return expectations */
function updateRateHint(rate) {
  const el = document.getElementById('rate-hint');
  if (!el) return;
  if (rate > 12) {
    el.innerHTML = '<i data-lucide="alert-triangle" width="13" height="13" style="display:inline;vertical-align:-2px;margin-right:4px;"></i>Sustaining this return long-term is uncommon for most investors.';
    el.classList.add('warn');
    lucide.createIcons();
  } else if (rate < 8) {
    el.innerHTML = '<i data-lucide="info" width="13" height="13" style="display:inline;vertical-align:-2px;margin-right:4px;"></i>This is closer to debt-like returns. Consider equity SIPs for higher growth.';
    el.classList.remove('warn');
    lucide.createIcons();
  } else {
    el.innerHTML = '';
    el.classList.remove('warn');
  }
}

// ─── Crash timing ─────────────────────────────────────────────────────────────
function setCrashTiming(timing) {
  activeCrashTiming = timing;
  // Toggle button states
  ['none', 'early', 'mid', 'late'].forEach(t => {
    const btn = document.getElementById('crash-btn-' + t);
    if (btn) {
      btn.classList.toggle('active', t === timing);
    }
  });

  const expEl = document.getElementById('crash-timing-explanation');
  const explanations = {
    none: '',
    early: '<i data-lucide="trending-down" width="14" height="14" style="display:inline;vertical-align:-2px;margin-right:4px;"></i>Early crash (Year 3–5): Loss is amplified because the compounding base shrinks early. Your corpus has less time to recover — the most damaging scenario.',
    mid: '<i data-lucide="trending-down" width="14" height="14" style="display:inline;vertical-align:-2px;margin-right:4px;"></i>Mid crash (Year 8–12): Substantial but partially recoverable. You still have years for compounding to rebuild after the drawdown.',
    late: '<i data-lucide="check-circle" width="14" height="14" style="display:inline;vertical-align:-2px;margin-right:4px;"></i>Late crash (Year 15–18): Compounding has already done its work. The terminal corpus drops, but the relative impact is smallest. Timing mattered.',
  };

  if (timing === 'none' || !explanations[timing]) {
    expEl.style.display = 'none';
    expEl.innerHTML = '';
  } else {
    expEl.style.display = 'block';
    expEl.innerHTML = explanations[timing];
    // Match border color to crash color
    const borderColors = { early: '#DC2626', mid: '#EA580C', late: '#16A34A' };
    expEl.style.borderLeftColor = borderColors[timing] || 'var(--primary)';
    lucide.createIcons();
  }

  onSliderChange();
}

// ─── Main update cycle ────────────────────────────────────────────────────────
let _debounceTimer = null;
async function onSliderChange() {
  updateDisplays();
  clearTimeout(_debounceTimer);
  _debounceTimer = setTimeout(async () => {
    const params = getSliders();
    const data = await apiFetch('/api/simulator/calculate', {
      method: 'POST',
      body: JSON.stringify(params),
    });
    if (!data.success) return;
    lastData = data.data;
    renderSimulatorOutput(data.data, params);
  }, 250);
}

// ─── Rendering ────────────────────────────────────────────────────────────────
function renderSimulatorOutput(d, params) {
  const years = d.scenario_base.length;
  const labels = Array.from({ length: years }, (_, i) => 'Y' + (i + 1));

  const nom = arr => arr.map(s => s.nominal);
  const real = arr => arr.map(s => s.real);
  const pick = arr => chartMode === 'real' ? real(arr) : nom(arr);

  const final = key => d[key][d[key].length - 1];

  // ── Scenario card values ──
  document.getElementById('worst-corpus').textContent = fmtINR(final('scenario_worst').nominal);
  document.getElementById('worst-real').textContent = 'Real: ' + fmtINR(final('scenario_worst').real);
  document.getElementById('base-corpus').textContent = fmtINR(final('scenario_base').nominal);
  document.getElementById('base-real').textContent = 'Real: ' + fmtINR(final('scenario_base').real);
  document.getElementById('best-corpus').textContent = fmtINR(final('scenario_best').nominal);
  document.getElementById('best-real').textContent = 'Real: ' + fmtINR(final('scenario_best').real);

  // Purchasing power loss on Expected card
  const ppLossEl = document.getElementById('base-pp-loss');
  if (ppLossEl && d.inflation_breakdown) {
    const loss = d.inflation_breakdown.pp_loss;
    ppLossEl.textContent = 'Purchasing power loss: ' + fmtINR(loss);
  }

  // ── Inflation panel ──
  if (d.inflation_breakdown) {
    const ib = d.inflation_breakdown;
    setText('inf-nominal', fmtINR(ib.nominal));
    setText('inf-real', fmtINR(ib.real));
    setText('inf-loss', '−' + fmtINR(Math.abs(ib.pp_loss)));
  }

  // ── Impact row ──
  document.getElementById('impact-job-loss').textContent = d.impact_job_loss ? fmtINR(d.impact_job_loss) : '₹0';
  document.getElementById('impact-crash').textContent = d.impact_crash ? fmtINR(d.impact_crash) : '₹0';

  const jl = params.job_loss_months;
  const cr = params.crash_pct;

  setText('insight-job-loss',
    jl > 0
      ? `The ${fmtINR(jl * params.monthly_sip)} you didn't invest directly cost ${fmtINR(Math.abs(d.impact_job_loss))} due to compounding penalty.`
      : 'Simulate the hidden compounding penalty of missing SIPs.'
  );
  setText('insight-crash',
    cr > 0
      ? `A ${cr}% crash costs ${fmtINR(Math.abs(d.impact_crash))} at maturity due to compounding on a reduced base.`
      : 'Explore the terminal damage of a sudden market drop.'
  );

  // ── Slider explanations ──
  const sip = params.monthly_sip;
  const yr = params.years;
  const fdRate = params.fd_rate || 7.0;

  setText('sip-explanation', `₹${sip.toLocaleString('en-IN')}/mo × ${yr}yr = ${fmtINR(sip * yr * 12)} invested, ${fmtINR(final('scenario_base').nominal)} projected.`);
  const extraPerYear = Math.max(0, (final('scenario_base').nominal - sip * yr * 12) / Math.max(1, yr - 10));
  setText('years-explanation', yr <= 10 ? 'Compounding needs time. Extending by 5 more years can nearly double your corpus.' : `Each extra year beyond 10 adds ~${fmtINR(extraPerYear)} to your corpus due to compounding.`);
  setText('rate-explanation', `1% higher return on this SIP = +${fmtINR(Math.round((final('scenario_best').nominal - final('scenario_base').nominal) / 3))} over ${yr} years.`);
  setText('fd-explanation', `FD at ${fdRate.toFixed(2)}% gives ${fmtINR(d.final_fd)} vs equity ${fmtINR(final('scenario_base').nominal)} over ${yr} years.`);

  // ── Scenario Controls Slider explanations ──
  setText('jl-slider-explanation', jl > 0 ? `${jl} months missed = ${fmtINR(jl * params.monthly_sip)} not invested, costing ${fmtINR(Math.abs(d.impact_job_loss))} at maturity.` : 'Simulate the hidden penalty of skipping SIPs.');
  setText('cr-slider-explanation', cr > 0 ? `A ${cr}% drop reduces your final corpus by ${fmtINR(Math.abs(d.impact_crash))}.` : 'Explore the terminal damage of a sudden market drop.');
  if (d.inflation_breakdown) {
    setText('inf-slider-explanation', `At ${params.inflation}%, your ${fmtINR(d.inflation_breakdown.nominal)} buys only ${fmtINR(d.inflation_breakdown.real)} in today's money.`);
  }

  // ── Actionable suggestions ──
  const sugEl = document.getElementById('actionable-suggestions');
  if (sugEl && d.suggestions && d.suggestions.length) {
    sugEl.innerHTML = d.suggestions.map(s =>
      `<div class="suggestion-item">
        <i data-lucide="arrow-right" width="13" height="13" class="sug-icon"></i>
        <span>${s}</span>
      </div>`
    ).join('');
    lucide.createIcons();
  }

  // ── Chart ──
  renderChart(d, labels, params);
}

// ─── Chart rendering ──────────────────────────────────────────────────────────
function renderChart(d, labels, params) {
  const ctx = document.getElementById('sim-chart');
  if (!ctx || !window.Chart) return;
  if (simChart) simChart.destroy();

  const nom = arr => arr.map(s => s.nominal);
  const real = arr => arr.map(s => s.real);
  const pick = (arr, solid = true) => chartMode === 'real' ? real(arr) : nom(arr);

  let datasets = [];
  let legendItems = [];

  if (chartMode === 'crash') {
    // Show three crash curves to illustrate sequence risk
    datasets = [
      {
        label: 'No Crash',
        data: nom(d.crash_none),
        borderColor: SIM_COLORS.crashNone,
        borderWidth: 3,
        borderDash: [],
        fill: false, tension: 0.4, pointRadius: 0,
      },
      {
        label: 'Early Crash (Yr 3–5)',
        data: nom(d.crash_early),
        borderColor: SIM_COLORS.crashEarly,
        borderWidth: 1.8,
        borderDash: [6, 4],
        fill: false, tension: 0.4, pointRadius: 0,
      },
      {
        label: 'Mid Crash (Yr 8–12)',
        data: nom(d.crash_mid),
        borderColor: SIM_COLORS.crashMid,
        borderWidth: 1.8,
        borderDash: [6, 4],
        fill: false, tension: 0.4, pointRadius: 0,
      },
      {
        label: 'Late Crash (Yr 15–18)',
        data: nom(d.crash_late),
        borderColor: SIM_COLORS.crashLate,
        borderWidth: 1.8,
        borderDash: [4, 4],
        fill: false, tension: 0.4, pointRadius: 0,
      },
    ];
    legendItems = [
      { label: 'No Crash', color: SIM_COLORS.crashNone, dashed: false },
      { label: 'Early Crash (Yr 3)', color: SIM_COLORS.crashEarly, dashed: true },
      { label: 'Mid Crash (Yr 8)', color: SIM_COLORS.crashMid, dashed: true },
      { label: 'Late Crash (Yr 15)', color: SIM_COLORS.crashLate, dashed: true },
    ];
  } else {
    // Nominal / Real / Comparison modes — show Conservative / Expected / Optimistic
    const isDotted = chartMode === 'real';
    datasets = [
      {
        label: 'Conservative (8%)',
        data: pick(d.scenario_worst),
        borderColor: SIM_COLORS.worst,
        borderWidth: 1.8,
        borderDash: isDotted ? [3, 3] : [],
        fill: false, tension: 0.4, pointRadius: 0,
      },
      {
        label: 'Expected (12%)',
        data: pick(d.scenario_base),
        borderColor: SIM_COLORS.base,
        borderWidth: 3,
        borderDash: isDotted ? [3, 3] : [],
        fill: false, tension: 0.4, pointRadius: 0,
      },
      {
        label: 'Optimistic (15%)',
        data: pick(d.scenario_best),
        borderColor: SIM_COLORS.best,
        borderWidth: 1.8,
        borderDash: isDotted ? [3, 3] : [],
        fill: false, tension: 0.4, pointRadius: 0,
      },
    ];
    legendItems = [
      { label: 'Conservative (8%)', color: SIM_COLORS.worst, dashed: isDotted },
      { label: 'Expected (12%)', color: SIM_COLORS.base, dashed: isDotted },
      { label: 'Optimistic (15%)', color: SIM_COLORS.best, dashed: isDotted },
    ];
    if (chartMode === 'comparison') {
      datasets.push({
        label: 'Fixed Deposit (7%)',
        data: nom(d.fd_corpus),
        borderColor: SIM_COLORS.fd,
        borderWidth: 1.8,
        borderDash: [4, 4],
        fill: false, tension: 0.4, pointRadius: 0,
      });
      legendItems.push({ label: 'Fixed Deposit (7%)', color: SIM_COLORS.fd, dashed: true });
    }
  }

  simChart = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 350 },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(15,23,42,0.92)',
          titleColor: '#94a3b8',
          bodyColor: '#f1f5f9',
          padding: 12,
          callbacks: {
            title: items => 'Year ' + items[0].label.replace('Y', ''),
            label: ctx => {
              const color = ctx.dataset.borderColor;
              return ` ${ctx.dataset.label} → ${fmtINR(ctx.raw)}`;
            },
            labelColor: ctx => ({
              borderColor: ctx.dataset.borderColor,
              backgroundColor: ctx.dataset.borderColor,
              borderRadius: 3,
            }),
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { font: { family: 'Inter', size: 11 }, color: '#94a3b8' },
        },
        y: {
          grid: { color: 'rgba(148,163,184,0.1)' },
          ticks: {
            callback: v => v >= 1e7 ? (v / 1e7).toFixed(1) + 'Cr' : v >= 1e5 ? (v / 1e5).toFixed(0) + 'L' : v,
            font: { family: 'Inter', size: 11 },
            color: '#94a3b8',
          },
        },
      },
    },
  });

  // Render legend
  renderLegend(legendItems);
}

function renderLegend(items) {
  const el = document.getElementById('sim-legend');
  if (!el) return;
  el.innerHTML = items.map(item => {
    const dash = item.dashed
      ? `background:repeating-linear-gradient(90deg,${item.color} 0,${item.color} 5px,transparent 5px,transparent 9px);`
      : `background:${item.color};`;
    return `<div class="chart-legend-item">
      <div class="legend-line" style="width:24px;height:3px;border-radius:2px;${dash}"></div>
      <span>${item.label}</span>
    </div>`;
  }).join('');
}

// ─── Chart mode toggle ────────────────────────────────────────────────────────
function toggleChartMode(mode) {
  chartMode = mode;
  ['nominal', 'real', 'comparison', 'crash'].forEach(m => {
    const btn = document.getElementById('btn-' + m);
    if (!btn) return;
    btn.classList.toggle('btn-mode-active', m === mode);
    btn.classList.toggle('btn-ghost', true);
  });
  const fdContainer = document.getElementById('fd-slider-container');
  if (fdContainer) {
    fdContainer.style.display = (mode === 'comparison') ? 'block' : 'none';
  }
  if (lastData) renderChart(lastData, buildLabels(lastData.scenario_base.length), getSliders());
}

function buildLabels(n) {
  return Array.from({ length: n }, (_, i) => 'Y' + (i + 1));
}

// ─── Reset ────────────────────────────────────────────────────────────────────
function resetSliders() {
  document.getElementById('sip-slider').value = 10000;
  document.getElementById('years-slider').value = 20;
  document.getElementById('rate-slider').value = 12;
  document.getElementById('job-loss-slider').value = 0;
  document.getElementById('crash-slider').value = 30;
  document.getElementById('inflation-slider').value = 6.5;
  setCrashTiming('none');
  activeCrashTiming = 'none';
  onSliderChange();
}

// ─── DOM helpers ──────────────────────────────────────────────────────────────
function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}
function setTextSafe(id, text) {
  try { setText(id, text); } catch (_) { }
}

// ─── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Ensure "No Crash" button starts active
  const noneBtn = document.getElementById('crash-btn-none');
  if (noneBtn) noneBtn.classList.add('active');

  // Initial chart mode button styling
  const nomBtn = document.getElementById('btn-nominal');
  if (nomBtn) nomBtn.classList.add('btn-mode-active');

  onSliderChange();
  lucide.createIcons();
});
