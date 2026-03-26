/* status.js */
const SERVICES = ['yfinance', 'amfi', 'polymarket', 'metaculus', 'google_news', 'groq', 'sqlite', 'risk_engine'];
let allPassed = false;

async function runChecks() {
  const icon = document.getElementById('check-icon');
  if (icon) icon.style.animation = 'spin 1s linear infinite';
  document.getElementById('status-loading').style.display = 'flex';
  document.getElementById('all-pass-banner').classList.remove('visible');

  const data = await apiFetch('/api/status/check');
  if (!icon) return;
  icon.style.animation = '';

  if (!data.success) { showToast('Status check failed', 'error'); return; }
  const results = data.data;
  let passed = 0;

  SERVICES.forEach(key => {
    const res = results[key];
    if (!res) return;
    const iconEl = document.getElementById(`si-${key}`);
    const detailEl = document.getElementById(`sd-${key}`);
    const latencyEl = document.getElementById(`sl-${key}`);
    const cardEl = document.getElementById(`sc-${key}`);

    if (iconEl) {
      iconEl.innerHTML = res.ok
        ? `<i data-lucide="circle-check" width="20" height="20" style="color:var(--gain);"></i>`
        : `<i data-lucide="circle-x" width="20" height="20" style="color:var(--loss);"></i>`;
      lucide.createIcons({ nodes: [iconEl] });
    }
    if (detailEl) detailEl.textContent = res.detail || '';
    if (latencyEl) latencyEl.textContent = res.latency_ms != null ? `${res.latency_ms}ms` : '';
    if (cardEl) {
      cardEl.style.background = res.ok ? '' : 'rgba(192,57,43,0.04)';
    }
    if (res.ok) passed++;
  });

  allPassed = passed === SERVICES.length;
  const loadingEl = document.getElementById('status-loading');
  if (loadingEl) {
    loadingEl.innerHTML = `<i data-lucide="${allPassed ? 'circle-check' : 'alert-triangle'}" width="20" height="20" style="color:${allPassed ? 'var(--gain)' : 'var(--warning)'};"></i>
      <span style="font-family:var(--font-display);font-size:var(--text-md);color:var(--on-surface);">
        ${passed}/${SERVICES.length} checks passed${results.checked_at ? ' — checked at ' + results.checked_at : ''}
      </span>`;
    lucide.createIcons({ nodes: [loadingEl] });
  }

  if (allPassed) document.getElementById('all-pass-banner').classList.add('visible');
}

function toggleCheck(el) {
  el.classList.toggle('checked');
  const icon = el.querySelector('.check-icon');
  if (icon) icon.style.display = el.classList.contains('checked') ? 'block' : 'none';
  const all = document.querySelectorAll('.checklist-item');
  const done = document.querySelectorAll('.checklist-item.checked').length;
  if (done === all.length) {
    document.getElementById('all-pass-banner').classList.add('visible');
    showToast('All developer checklist items complete! 🎉', 'success', 5000);
  }
}

document.addEventListener('DOMContentLoaded', () => { lucide.createIcons(); });
