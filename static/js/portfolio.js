/* portfolio.js */
let allHoldings = [];
let allocationChart = null;

async function loadHoldings() {
  const data = await apiFetch('/api/portfolio/holdings');
  if (!data.success) { showToast(data.error || 'Failed to load holdings', 'error'); return; }
  const { holdings, summary, tlh_opportunities } = data.data;
  if (!holdings.length) { document.getElementById('upload-zone').style.display = 'block'; document.getElementById('holdings-section').style.display = 'none'; return; }
  allHoldings = holdings;
  document.getElementById('upload-zone').style.display = 'none';
  document.getElementById('holdings-section').style.display = 'block';

  // Summary footer
  document.getElementById('total-invested').textContent = fmtINR(summary.total_invested);
  document.getElementById('total-current').textContent = fmtINR(summary.current_value);
  const pnlChip = document.getElementById('total-pnl-chip');
  if (pnlChip) {
    const sign = summary.total_pnl >= 0 ? '+' : '';
    pnlChip.textContent = `${sign}${fmtINR(summary.total_pnl)} (${sign}${summary.total_pnl_pct.toFixed(2)}%)`;
    pnlChip.className = `chip ${summary.total_pnl >= 0 ? 'chip-gain' : 'chip-loss'}`;
  }
  document.getElementById('days-march31').textContent = summary.days_to_march31 + ' days';

  renderHoldings();
  renderAllocation(holdings);
  renderSectorBars(holdings);
  renderTLH(tlh_opportunities, summary);

  // Market closed banner
  const now = new Date();
  const ist = new Date(now.getTime() + 5.5 * 3600000);
  const h = ist.getUTCHours(), m = ist.getUTCMinutes(), d = ist.getUTCDay();
  const mins = h * 60 + m;
  const open = d >= 1 && d <= 5 && mins >= 555 && mins <= 930;
  const banner = document.getElementById('market-closed-banner');
  if (banner && !open) banner.classList.add('visible');
}

function renderHoldings() {
  const tbody = document.getElementById('holdings-tbody');
  if (!tbody) return;
  const filterType = document.getElementById('filter-type').value;
  const sortBy = document.getElementById('sort-by').value;
  let rows = allHoldings.filter(h => !filterType || h.type === filterType);
  if (sortBy === 'pnl_pct') rows.sort((a, b) => (b.pnl_pct || 0) - (a.pnl_pct || 0));
  else if (sortBy === 'current_value') rows.sort((a, b) => ((b.current_price || 0) * b.quantity) - ((a.current_price || 0) * a.quantity));
  else rows.sort((a, b) => a.name.localeCompare(b.name));

  tbody.innerHTML = rows.map(h => {
    const pnlClass = (h.pnl_abs || 0) >= 0 ? 'text-gain' : 'text-loss';
    const pnlSign = (h.pnl_abs || 0) >= 0 ? '+' : '';
    const cmpDisp = h.current_price ? fmtINR(h.current_price) : '—';
    const chgDisp = h.change != null ? `<span style="font-size:10px;display:block;color:${h.change >= 0 ? 'var(--gain)' : 'var(--loss)'};">${h.change >= 0 ? '▲' : '▼'}${Math.abs(h.change).toFixed(2)}%</span>` : '';
    return `<tr>
      <td><div class="ticker-cell-main">${h.ticker.replace('.NS','')}</div><div class="ticker-cell-sub">${h.name}</div></td>
      <td><span class="chip chip-neutral" style="font-size:11px;text-transform:uppercase;">${h.type}</span></td>
      <td class="right">${h.quantity}</td>
      <td class="right">${h.purchase_price ? fmtINR(h.purchase_price) : '—'}</td>
      <td class="right">${cmpDisp}${chgDisp}</td>
      <td class="right">
        <div class="pnl-abs ${pnlClass}">${h.pnl_abs != null ? pnlSign + fmtINR(h.pnl_abs) : '—'}</div>
        ${h.pnl_pct != null ? `<div class="pnl-pct ${pnlClass}">${pnlSign}${h.pnl_pct.toFixed(2)}%</div>` : ''}
      </td>
      <td><span class="chip ${h.tax_label === 'LTCG' ? 'chip-gain' : 'chip-warning'}">${h.tax_label}</span></td>
      <td class="right">${h.days_held ? h.days_held + 'd' : '—'}</td>
    </tr>`;
  }).join('');
}

function renderAllocation(holdings) {
  const types = {};
  holdings.forEach(h => {
    const type = h.type || 'stock';
    const val = (h.current_price || h.purchase_price || 0) * h.quantity;
    types[type] = (types[type] || 0) + val;
  });
  const ctx = document.getElementById('allocation-chart');
  if (!ctx || !window.Chart) return;
  if (allocationChart) allocationChart.destroy();
  const colors = { stock: '#f44336', etf: '#4caf50', mf: '#ffeb3b' };
  allocationChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: Object.keys(types).map(t => t.toUpperCase()),
      datasets: [{ data: Object.values(types), backgroundColor: Object.keys(types).map(t => colors[t] || '#ccc'), borderWidth: 0 }],
    },
    options: { responsive: true, maintainAspectRatio: false, cutout: '65%', plugins: { legend: { position: 'bottom', labels: { font: { family: 'Inter' }, color: '#4a5568' } } } },
  });
}

function renderSectorBars(holdings) {
  const sectors = {};
  const total = holdings.reduce((sum, h) => sum + (h.current_price || h.purchase_price || 0) * h.quantity, 0);
  holdings.forEach(h => {
    const sector = h.sector || h.type || 'Other';
    const val = (h.current_price || h.purchase_price || 0) * h.quantity;
    sectors[sector] = (sectors[sector] || 0) + val;
  });
  const container = document.getElementById('sector-bars');
  if (!container) return;
  const sorted = Object.entries(sectors).sort((a, b) => b[1] - a[1]).slice(0, 6);
  container.innerHTML = sorted.map(([name, val]) => {
    const pct = total > 0 ? (val / total * 100).toFixed(1) : 0;
    return `<div class="sector-row">
      <span class="sector-name">${name}</span>
      <div class="sector-bar-track"><div class="sector-bar-fill" style="width:${pct}%"></div></div>
      <span class="sector-pct">${pct}%</span>
    </div>`;
  }).join('');
}

function renderTLH(opportunities, summary) {
  const list = document.getElementById('tlh-list');
  const banner = document.getElementById('tlh-banner');
  if (!opportunities.length) { if (list) list.innerHTML = '<p style="color:var(--on-surface-muted);font-size:var(--text-sm);">No unrealised losses detected. Great portfolio health!</p>'; return; }
  const total = opportunities.reduce((s, o) => s + o.estimated_tax_saving, 0);
  if (banner) {
    banner.style.display = 'block';
    const savings = document.getElementById('tlh-savings');
    const body = document.getElementById('tlh-body');
    if (savings) savings.textContent = fmtINR(total) + ' in estimated tax savings';
    if (body) body.textContent = `${opportunities.length} holding${opportunities.length > 1 ? 's' : ''} eligible for tax-loss harvesting before ${summary.days_to_march31} days to March 31. Consider booking these losses to offset STCG gains.`;
  }
  if (list) {
    list.innerHTML = opportunities.map(o => `
      <div style="padding:8px 0;border-bottom:1px solid rgba(194,198,214,0.15);">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <div>
            <span style="font-family:var(--font-display);font-weight:500;color:var(--on-surface);">${o.ticker.replace('.NS','')}</span>
            <span class="chip chip-warning" style="margin-left:8px;">${o.tax_label}</span>
            ${o.approaching_ltcg ? '<span class="chip chip-primary" style="margin-left:4px;font-size:10px;">→LTCG in '+ o.days_to_ltcg +'d</span>' : ''}
          </div>
          <div style="text-align:right;">
            <div style="color:var(--loss);font-family:var(--font-display);font-size:var(--text-base);">${fmtINR(o.unrealised_loss)}</div>
            <div style="font-size:11px;color:var(--on-surface-muted);">Save ~${fmtINR(o.estimated_tax_saving)}</div>
          </div>
        </div>
      </div>`).join('');
  }
}

// ─── CSV Upload ───────────────────────────────────────────────────────────────
async function uploadCSV(input) {
  if (!input.files.length) return;
  const formData = new FormData();
  formData.append('file', input.files[0]);
  const btn = document.querySelector('button[onclick*="csv-file-input"]');
  if (btn) btn.textContent = 'Importing...';
  try {
    const res = await fetch('/api/portfolio/upload', { method: 'POST', body: formData });
    const data = await res.json();
    if (data.success) {
      showToast(`Imported ${data.data.imported_count} holdings${data.data.skipped_count ? ` (${data.data.skipped_count} skipped)` : ''}`, 'success');
      await loadHoldings();
    } else { showToast(data.error || 'Import failed', 'error'); }
  } catch { showToast('Upload failed. Please try again.', 'error'); } finally {
    if (btn) btn.innerHTML = '<i data-lucide="upload" width="14" height="14"></i> Import CSV';
    input.value = '';
    lucide.createIcons();
  }
}

function handleDrop(e) {
  e.preventDefault();
  document.getElementById('csv-drop-zone').classList.remove('drag-active');
  const file = e.dataTransfer.files[0];
  if (file && file.name.endsWith('.csv')) {
    const fake = { files: [file] };
    uploadCSV(fake);
  } else showToast('Please drop a .csv file', 'error');
}

function exportHoldingsCSV() {
  if (!allHoldings.length) { showToast('No holdings to export', 'error'); return; }
  const header = 'Ticker,Name,Type,Quantity,Buy Price,Purchase Date,CMP,P&L,P&L %,Tax Label,Days Held';
  const rows = allHoldings.map(h =>
    [h.ticker, h.name, h.type, h.quantity, h.purchase_price || '', h.purchase_date || '', h.current_price || '', h.pnl_abs || '', h.pnl_pct || '', h.tax_label, h.days_held].join(','));
  const blob = new Blob([[header, ...rows].join('\n')], { type: 'text/csv' });
  const a = document.createElement('a'); 
  a.href = URL.createObjectURL(blob); 
  a.download = 'finsor_portfolio.csv'; 
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

document.addEventListener('DOMContentLoaded', loadHoldings);
setInterval(() => { if (document.getElementById('holdings-section').style.display !== 'none') loadHoldings(); }, 300000);
