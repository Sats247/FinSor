/**
 * sips.js — ETF SIP Recommendation Engine
 * Handles: slider ↔ display sync, debounced API fetch, DOM updates.
 */

(function () {
  'use strict';

  // ── DOM refs ────────────────────────────────────────────────────────────────
  const ageSlider    = document.getElementById('sips-age-slider');
  const riskSlider   = document.getElementById('sips-risk-slider');
  const ageVal       = document.getElementById('sips-age-val');
  const riskVal      = document.getElementById('sips-risk-val');
  const sipInput     = document.getElementById('sips-sip-amount');
  const dashTitle    = document.getElementById('sips-dash-title');
  const profileBadge = document.getElementById('sips-profile-badge');
  const profileLabel = document.getElementById('sips-profile-label');
  const profileDesc  = document.getElementById('sips-profile-desc');
  const profileIcon  = document.getElementById('sips-profile-icon');

  // Per-ETF DOM refs keyed by ETF code
  const ETF_KEYS = ['NIFTY', 'BANK', 'GOLD', 'SILVER'];

  function getEtfEls(key) {
    return {
      pct:   document.getElementById(`sips-${key}-pct`),
      rupee: document.getElementById(`sips-${key}-rupee`),
      bar:   document.getElementById(`sips-${key}-bar`),
    };
  }

  // ── Profile map ─────────────────────────────────────────────────────────────
  const PROFILES = {
    conservative: {
      label:  'Conservative Investor',
      desc:   'Capital protection with steady growth. Gold-heavy allocation.',
      icon:   'shield',
      cls:    'conservative',
      title:  'Defensive SIP Strategy — Capital Protection First',
    },
    moderate: {
      label:  'Moderate Investor',
      desc:   'Balanced growth with diversified exposure across ETFs.',
      icon:   'scale',
      cls:    'moderate',
      title:  'Balanced SIP Strategy — Growth with Stability',
    },
    aggressive: {
      label:  'Aggressive Investor',
      desc:   'High-growth focus: Nifty & Bank ETFs dominate allocation.',
      icon:   'zap',
      cls:    'aggressive',
      title:  'Growth SIP Strategy — Maximising Long-Run Returns',
    },
  };

  function getProfile(risk) {
    if (risk >= 8) return 'aggressive';
    if (risk >= 5) return 'moderate';
    return 'conservative';
  }

  // ── Formatting helpers ───────────────────────────────────────────────────────
  function fmtRupee(n) {
    if (n >= 1e7)  return '₹' + (n / 1e7).toFixed(2) + 'Cr';
    if (n >= 1e5)  return '₹' + (n / 1e5).toFixed(1) + 'L';
    if (n >= 1000) return '₹' + (n / 1000).toFixed(1) + 'K';
    return '₹' + Math.round(n).toLocaleString('en-IN');
  }

  function fmtPct(f) {
    return Math.round(f * 100) + '%';
  }

  // ── UI state update ─────────────────────────────────────────────────────────
  function updateSliderDisplays() {
    ageVal.textContent  = ageSlider.value  + ' yrs';
    riskVal.textContent = riskSlider.value + '/10';
  }

  function updateProfileBadge(risk) {
    const key  = getProfile(risk);
    const prof = PROFILES[key];

    profileBadge.className       = 'sips-profile-badge ' + prof.cls;
    profileLabel.textContent     = prof.label;
    profileDesc.textContent      = prof.desc;
    dashTitle.textContent        = prof.title;

    // Swap Lucide icon by updating the data-lucide attribute
    const iconEl = document.getElementById('sips-profile-lucide');
    if (iconEl && typeof lucide !== 'undefined') {
      iconEl.setAttribute('data-lucide', prof.icon);
      lucide.createIcons({ nodes: [iconEl] });
    }
  }

  // ── ETF card update ─────────────────────────────────────────────────────────
  function updateCards(data) {
    ETF_KEYS.forEach(key => {
      const els = getEtfEls(key);
      if (!els.pct) return;

      const pct   = data[key + '_pct']   || '—';
      const rupee = data[key + '_rupee'] || '—';
      const frac  = data[key + '_frac']  || 0;

      // Animate number swap
      els.pct.textContent   = pct;
      els.rupee.textContent = rupee;
      els.bar.style.width   = (frac * 100).toFixed(1) + '%';

      // Pop animation
      els.pct.classList.remove('sips-pop');
      void els.pct.offsetWidth;               // reflow to restart animation
      els.pct.classList.add('sips-pop');
    });
  }

  // ── API fetch (debounced) ───────────────────────────────────────────────────
  let _debounceTimer = null;

  function schedulePredict() {
    clearTimeout(_debounceTimer);
    _debounceTimer = setTimeout(fetchPrediction, 320);
  }

  async function fetchPrediction() {
    const age  = parseInt(ageSlider.value,  10);
    const risk = parseInt(riskSlider.value, 10);
    const sip  = parseFloat(sipInput.value) || 5000;

    updateProfileBadge(risk);

    try {
      const resp = await fetch('/api/predict-sip', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ age, risk, sip_amount: sip }),
      });

      if (!resp.ok) throw new Error('HTTP ' + resp.status);

      const json = await resp.json();
      if (json.success) {
        updateCards(json.data);
      } else {
        console.warn('predict-sip API error:', json.error);
      }
    } catch (err) {
      console.error('SIP fetch failed:', err);
    }
  }

  // ── Model status badge ───────────────────────────────────────────────────────
  async function fetchModelStatus() {
    try {
      const r    = await fetch('/api/sips/model-status');
      const json = await r.json();
      if (!json.success) return;

      const badge  = document.getElementById('sips-source-badge');
      const source = json.data.source || 'synthetic';
      const isCsv  = source.startsWith('csv');

      badge.style.display  = 'inline-flex';
      badge.className      = 'sips-source-badge ' + (isCsv ? 'csv' : 'synthetic');
      badge.textContent    = isCsv
        ? `📂 CSV — ${json.data.n_samples} rows`
        : `🔮 Synthetic — ${json.data.n_samples} rows`;
    } catch (_) { /* silently skip */ }
  }

  // ── Event listeners ─────────────────────────────────────────────────────────
  ageSlider.addEventListener('input',  () => { updateSliderDisplays(); schedulePredict(); });
  riskSlider.addEventListener('input', () => { updateSliderDisplays(); schedulePredict(); });
  sipInput.addEventListener('input',   schedulePredict);

  // ── Initial render ───────────────────────────────────────────────────────────
  updateSliderDisplays();
  fetchPrediction();
  fetchModelStatus();

})();


// ═══════════════════════════════════════════════════════════════════════════════
// CSV UPLOAD — global functions (called from inline onchange / ondrop)
// ═══════════════════════════════════════════════════════════════════════════════

function _sipSetStatus(type, html) {
  const el = document.getElementById('sips-upload-status');
  el.style.display = 'block';
  el.innerHTML = `<div class="sips-upload-msg ${type}">${html}</div>`;
}

async function sipUploadFile(file) {
  if (!file) return;
  if (!file.name.endsWith('.csv')) {
    _sipSetStatus('error', '❌ Please select a <strong>.csv</strong> file.');
    return;
  }

  // Reset the drop zone
  document.getElementById('sips-upload-zone').classList.remove('drag');
  _sipSetStatus('loading', '⏳ Uploading and training model on your data…');

  const form = new FormData();
  form.append('file', file);

  try {
    const resp = await fetch('/api/sips/upload-csv', { method: 'POST', body: form });
    const json = await resp.json();

    if (json.success) {
      const d = json.data;
      let extra = '';
      if (d.stats && d.stats.cagr) {
        const c = d.stats.cagr;
        extra = `<br><small>NIFTY ${c.NIFTY}% · BANK ${c.BANK}% · GOLD ${c.GOLD}% · SILVER ${c.SILVER}% CAGR</small>`;
      }
      _sipSetStatus('success',
        `✅ <strong>${d.message}</strong>${extra}`);

      // Update header badge
      const badge = document.getElementById('sips-source-badge');
      badge.style.display = 'inline-flex';
      badge.className     = 'sips-source-badge csv';
      badge.textContent   = `📂 CSV — ${d.n_samples} rows`;

      // Hide the synthetic-data disclaimer now that real data is loaded
      const disc = document.getElementById('sips-disclaimer-banner');
      if (disc) disc.style.display = 'none';

      // Refresh allocations with new model
      document.getElementById('sips-csv-input').value = '';
      const age  = parseInt(document.getElementById('sips-age-slider').value, 10);
      const risk = parseInt(document.getElementById('sips-risk-slider').value, 10);
      const sip  = parseFloat(document.getElementById('sips-sip-amount').value) || 5000;

      const p = await fetch('/api/predict-sip', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ age, risk, sip_amount: sip }),
      });
      const pj = await p.json();
      if (pj.success) {
        // Trigger card update (cards are in the IIFE scope, use DOM events)
        document.getElementById('sips-age-slider').dispatchEvent(new Event('input'));
      }
    } else {
      _sipSetStatus('error', `❌ ${json.error || 'Upload failed.'}`);
    }
  } catch (err) {
    _sipSetStatus('error', `❌ Network error: ${err.message}`);
  }
}

function sipHandleDrop(event) {
  event.preventDefault();
  document.getElementById('sips-upload-zone').classList.remove('drag');
  const file = event.dataTransfer.files[0];
  if (file) sipUploadFile(file);
}
