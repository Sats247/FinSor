/* dashboard.js — Map init, KPI polling, chart rendering, refugee/NGO management */

let _kpiPollInterval = null;
let _ngoList         = [];  // cached list of NGOs for dropdowns

async function loadKPIs() {
  const res = await apiFetch('/api/dashboard/kpis');
  if (!res.success) return;
  const d = res.data;
  const el = id => document.getElementById(id);
  if (el('kpi-volume'))    el('kpi-volume').textContent    = d.volume?.toLocaleString() ?? '—';
  if (el('kpi-flags'))     el('kpi-flags').textContent     = d.flags?.toLocaleString() ?? '—';
  if (el('kpi-incidents')) el('kpi-incidents').textContent = d.incidents?.toLocaleString() ?? '—';
  // Registered Refugees count from the refugee list endpoint
  apiFetch('/api/dashboard/refugees?limit=1').then(r => {
    if (r.success && el('kpi-refugees')) el('kpi-refugees').textContent = r.data.total?.toLocaleString() ?? '—';
  });
}

async function loadCharts() {
  const [typesRes, epRes] = await Promise.all([
    apiFetch('/api/dashboard/entity-types'),
    apiFetch('/api/dashboard/top-entry-points')
  ]);

  // ── Donut chart: Entity types ──────────────────────────────
  const donutCtx = document.getElementById('chart-types')?.getContext('2d');
  if (donutCtx && typesRes.success) {
    const labels  = typesRes.data.map(r => r.type);
    const values  = typesRes.data.map(r => r.count);
    const colors  = ['#0057B8','#D97706','#1A7F4B'];
    new Chart(donutCtx, {
      type: 'doughnut',
      data: { labels, datasets:[{ data: values, backgroundColor: colors, borderWidth: 2, borderColor: '#fff' }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom', labels: { font: { family:'Inter',size:11 }, boxWidth:10 }}}
      }
    });
  }

  // ── Bar chart: Top entry points ────────────────────────────
  const barCtx = document.getElementById('chart-entry-points')?.getContext('2d');
  if (barCtx && epRes.success) {
    const labs = epRes.data.map(r => r.entry_point.split(',')[0]);
    const vals = epRes.data.map(r => r.count);
    new Chart(barCtx, {
      type: 'bar',
      data: { labels: labs, datasets:[{ data: vals, backgroundColor: '#0057B8', borderRadius: 4 }] },
      options: {
        indexAxis: 'y', responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { x: { grid: { color:'#F0F0F0' }}, y: { grid: { display: false }, ticks:{ font:{ size:10 }}}}
      }
    });
  }

  // ── Line chart: Security flags (simulated 7-day trend) ─────
  const lineCtx = document.getElementById('chart-trend')?.getContext('2d');
  if (lineCtx) {
    const days   = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
    const values = [12,18,14,21,17,24,19];
    new Chart(lineCtx, {
      type: 'line',
      data: {
        labels: days,
        datasets:[{
          data: values, borderColor: '#DC2626', backgroundColor: 'rgba(220,38,38,0.07)',
          fill: true, tension: 0.35, pointRadius: 4, pointBackgroundColor: '#DC2626'
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { x: { grid: { display:false }}, y: { grid: { color:'#F0F0F0' }}}
      }
    });
  }
}

// ── Refugee Management Tabs ───────────────────────────────────

async function loadDashboardRefugees() {
  const tbody = document.getElementById('dash-refugee-tbody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:20px;color:var(--color-text-muted)">Loading...</td></tr>';
  const res = await apiFetch('/api/dashboard/refugees?limit=100');
  if (!res.success) { showToast('Failed to load refugees', 'error'); return; }
  const items = res.data.items;
  if (!items.length) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:24px;color:var(--color-text-muted)">No refugees registered yet</td></tr>';
    return;
  }
  tbody.innerHTML = items.map(r => `
    <tr>
      <td class="font-mono" style="font-size:11px">${r.provisional_id || '—'}</td>
      <td><strong>${r.name}</strong></td>
      <td>${r.nationality}</td>
      <td>${r.force || '—'}</td>
      <td>${formatDateTime(r.registration_date)}</td>
      <td>${r.assigned_camp || '—'}</td>
      <td>${r.assigned_ngo ? `<span style="color:var(--color-success);font-weight:600">${r.assigned_ngo}</span>` : '<span style="color:var(--color-text-muted)">Unassigned</span>'}</td>
      <td>${statusBadge(r.reg_status || r.entity_status || 'Active')}</td>
    </tr>`).join('');
}

async function loadNgoAssignmentsTab() {
  const tbody = document.getElementById('dash-ngo-tbody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:20px;color:var(--color-text-muted)">Loading...</td></tr>';

  // Load refugees + NGO list in parallel
  const [refugeesRes, ngoRes] = await Promise.all([
    apiFetch('/api/dashboard/refugees?limit=100'),
    apiFetch('/api/dashboard/ngo-list')
  ]);
  if (!refugeesRes.success) { showToast('Failed to load data', 'error'); return; }
  _ngoList = ngoRes.success ? ngoRes.data : [];

  const items = refugeesRes.data.items;
  if (!items.length) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--color-text-muted)">No refugees registered yet</td></tr>';
    return;
  }

  const ngoOptions = _ngoList.map(n => `<option value="${n.name}">${n.name}</option>`).join('');

  tbody.innerHTML = items.map(r => `
    <tr id="ngo-row-${r.reg_id}">
      <td class="font-mono" style="font-size:11px">${r.provisional_id || '—'}</td>
      <td><strong>${r.name}</strong></td>
      <td>${r.nationality}</td>
      <td>${r.force || '—'}</td>
      <td id="ngo-current-${r.reg_id}">${r.assigned_ngo ? `<span style="color:var(--color-success);font-weight:600">${r.assigned_ngo}</span>` : '<span style="color:var(--color-text-muted)">Unassigned</span>'}</td>
      <td>
        <select id="ngo-select-${r.reg_id}" style="width:100%;font-size:12px">
          <option value="">— Select NGO —</option>
          ${ngoOptions}
        </select>
      </td>
      <td>
        <button class="btn btn-primary btn-sm" onclick="saveNgoAssignment('${r.reg_id}', '${r.name.replace(/'/g,"\\'")}')">Save</button>
      </td>
    </tr>`).join('');

  // Pre-select the currently assigned NGO in each dropdown
  items.forEach(r => {
    const sel = document.getElementById(`ngo-select-${r.reg_id}`);
    if (sel && r.assigned_ngo) sel.value = r.assigned_ngo;
  });
}

async function saveNgoAssignment(regId, refugeeName) {
  const sel = document.getElementById(`ngo-select-${regId}`);
  const ngoName = sel?.value;
  if (!ngoName) { showToast('Please select an NGO first', 'error'); return; }

  // Find the ngo_id from the cached list
  const ngo    = _ngoList.find(n => n.name === ngoName);
  const ngoId  = ngo?.id || 'NGO-AUTO';

  const res = await apiFetch(`/api/dashboard/ngo-assignments/${regId}`, {
    method: 'PATCH',
    body: JSON.stringify({ ngo_name: ngoName, ngo_id: ngoId })
  });

  if (res.success) {
    showToast(`${refugeeName} assigned to ${ngoName}`, 'success');
    // Update the "Current NGO" cell in place without re-fetching everything
    const currentCell = document.getElementById(`ngo-current-${regId}`);
    if (currentCell) currentCell.innerHTML = `<span style="color:var(--color-success);font-weight:600">${ngoName}</span>`;
  } else {
    showToast('Assignment failed: ' + res.message, 'error');
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  loadKPIs();
  _kpiPollInterval = setInterval(loadKPIs, 30000);
  loadCharts();
  const mapEl = document.getElementById('main-map');
  if (mapEl && typeof initMainMap === 'function') {
    initMainMap('main-map');
  }

  // Refugee management tabs
  document.querySelectorAll('#refugee-tab-bar .tab-item').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('#refugee-tab-bar .tab-item').forEach(t => t.classList.remove('active'));
      ['dash-tab-refugees','dash-tab-ngo'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.remove('active');
      });
      tab.classList.add('active');
      const target = document.getElementById(tab.dataset.tab);
      if (target) target.classList.add('active');
      if (tab.dataset.tab === 'dash-tab-refugees') loadDashboardRefugees();
      if (tab.dataset.tab === 'dash-tab-ngo') loadNgoAssignmentsTab();
    });
  });

  // Default: load refugee list on page open
  loadDashboardRefugees();
});
