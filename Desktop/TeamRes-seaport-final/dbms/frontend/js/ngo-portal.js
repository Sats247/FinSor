/* ngo-portal.js — NGO assignments feed, status updates, and data visualizations */

let _ngoChartStatus = null;
let _ngoChartForce  = null;
let _ngoChartNat    = null;

async function loadAssignments(filterStatus = '') {
  const container = document.getElementById('assignments-container');
  if (!container) return;
  container.innerHTML = '<p style="color:var(--color-text-muted);padding:16px">Loading assignments...</p>';

  const url = filterStatus ? `/api/ngo/assignments?status=${encodeURIComponent(filterStatus)}` : '/api/ngo/assignments';
  const res = await apiFetch(url);
  if (!res.success) { showToast('Failed to load assignments','error'); return; }

  const items = res.data.items;
  if (!items.length) {
    container.innerHTML = '<div class="empty-state"><p>No assignments found.</p></div>';
    return;
  }

  container.innerHTML = items.map(a => {
    const tags = (a.help_tags || '').split(',').filter(Boolean).map(t => `<span class="tag-pill">${t.trim()}</span>`).join('');
    const statusClass = {
      'Pending':'status-pending','Acknowledged':'status-acknowledged',
      'In Progress':'status-in-progress','Completed':'status-completed'
    }[a.status] || '';
    return `
      <div class="assignment-card ${statusClass}" id="assignment-${a.id}">
        <div class="assignment-card-header">
          <div>
            <div class="assignment-prov">${a.provisional_id || 'N/A'}</div>
            <div class="assignment-force">${a.force || ''} — ${a.entry_point || ''}</div>
          </div>
          ${statusBadge(a.status)}
        </div>
        <div class="assignment-name">${a.name}</div>
        <div class="assignment-nat">${a.nationality} ${a.gender ? '· '+a.gender : ''} ${a.dob ? '· DOB: '+a.dob : ''}</div>
        ${a.medical_needs && a.medical_needs !== 'None' ? `<div class="alert-banner warning" style="margin-top:8px;padding:8px 12px"><div class="alert-body-text">Medical: ${a.medical_needs}</div></div>` : ''}
        <div class="assignment-message">"${a.message || 'No message provided.'}"</div>
        <div class="assignment-meta">
          <span>Assigned Camp: <strong>${a.assigned_camp || '—'}</strong></span>
          <span>Received: ${formatDateTime(a.created_at)}</span>
          ${a.acknowledged_at ? `<span>Acknowledged: ${formatDateTime(a.acknowledged_at)}</span>` : ''}
        </div>
        ${tags ? `<div class="assignment-tags">${tags}</div>` : ''}
        <div class="assignment-actions">
          ${a.status === 'Pending' ? `<button class="btn btn-primary btn-sm" onclick="updateStatus('${a.id}','Acknowledged')">Acknowledge</button>` : ''}
          ${a.status === 'Acknowledged' ? `<button class="btn btn-secondary btn-sm" onclick="updateStatus('${a.id}','In Progress')">Mark In Progress</button>` : ''}
          ${a.status === 'In Progress' ? `<button class="btn btn-success btn-sm" onclick="updateStatus('${a.id}','Completed')">Mark Complete</button>` : ''}
          ${a.status === 'Completed' ? `<span class="text-success fw-600" style="font-size:12px">✓ Case Complete</span>` : ''}
        </div>
      </div>`;
  }).join('');

  // Build charts from full unfiltered data
  if (!filterStatus) {
    renderChartsFromAssignments(items);
  }
}

async function updateStatus(assignmentId, newStatus) {
  const res = await apiFetch(`/api/ngo/assignments/${assignmentId}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status: newStatus })
  });
  if (res.success) {
    showToast(`Status updated to ${newStatus}`, 'success');
    loadAssignments(document.getElementById('filter-status')?.value || '');
    loadCounts();
  } else {
    showToast('Update failed: ' + res.message, 'error');
  }
}

async function loadCounts() {
  const res = await apiFetch('/api/ngo/assignments/counts');
  if (!res.success) return;
  const counts = {};
  res.data.forEach(r => { counts[r.status] = r.count; });
  const el = id => document.getElementById(id);
  if (el('count-pending'))     el('count-pending').textContent     = counts['Pending'] ?? 0;
  if (el('count-acknowledged'))el('count-acknowledged').textContent = counts['Acknowledged'] ?? 0;
  if (el('count-in-progress')) el('count-in-progress').textContent  = counts['In Progress'] ?? 0;
  if (el('count-completed'))   el('count-completed').textContent    = counts['Completed'] ?? 0;
  renderStatusChart(counts);
}

/* ── Chart helpers ─────────────────────────────────────────── */

const CHART_PALETTE = ['#D97706','#3B82F6','#0057B8','#1A7F4B','#DC2626','#9333EA','#0EA5E9','#F59E0B','#10B981','#EF4444'];

function _canvas(id) {
  return document.getElementById(id)?.getContext('2d') || null;
}

function renderStatusChart(counts) {
  const labels = ['Pending', 'Acknowledged', 'In Progress', 'Completed'];
  const values = labels.map(l => counts[l] ?? 0);
  if (values.every(v => v === 0)) return;

  const grid = document.getElementById('ngo-charts-grid');
  if (grid) grid.style.display = '';

  if (_ngoChartStatus) _ngoChartStatus.destroy();
  const ctx = _canvas('ngo-chart-status');
  if (!ctx) return;
  _ngoChartStatus = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{ data: values, backgroundColor: ['#D97706','#3B82F6','#0057B8','#1A7F4B'], borderWidth: 2, borderColor: '#fff' }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom', labels: { font: { family:'Inter', size:11 }, boxWidth:10 } } }
    }
  });
}

function renderChartsFromAssignments(items) {
  // Count by force
  const forceCounts = {};
  const natCounts   = {};
  items.forEach(a => {
    const f = (a.force || 'Unknown').trim();
    forceCounts[f] = (forceCounts[f] || 0) + 1;
    const n = (a.nationality || 'Unknown').trim();
    natCounts[n] = (natCounts[n] || 0) + 1;
  });

  const forceEntries = Object.entries(forceCounts).sort((a,b) => b[1]-a[1]).slice(0,10);
  const natEntries   = Object.entries(natCounts).sort((a,b) => b[1]-a[1]).slice(0,8);

  // Show chart grid
  const grid = document.getElementById('ngo-charts-grid');
  if (grid) grid.style.display = '';

  if (_ngoChartForce) _ngoChartForce.destroy();
  const ctxF = _canvas('ngo-chart-force');
  if (ctxF && forceEntries.length) {
    _ngoChartForce = new Chart(ctxF, {
      type: 'bar',
      data: {
        labels: forceEntries.map(([k]) => k),
        datasets: [{ label: 'Assignments', data: forceEntries.map(([,v]) => v),
          backgroundColor: '#0057B8', borderRadius: 4 }]
      },
      options: {
        indexAxis: 'y', responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { color: '#F0F0F0' }, ticks: { precision: 0 },
               title: { display: true, text: 'Number of Assignments', font: { size: 11 } } },
          y: { grid: { display: false }, ticks: { font: { size: 10 } } }
        }
      }
    });
  }

  if (_ngoChartNat) _ngoChartNat.destroy();
  const ctxN = _canvas('ngo-chart-nationality');
  if (ctxN && natEntries.length) {
    _ngoChartNat = new Chart(ctxN, {
      type: 'doughnut',
      data: {
        labels: natEntries.map(([k]) => k),
        datasets: [{ data: natEntries.map(([,v]) => v),
          backgroundColor: CHART_PALETTE, borderWidth: 2, borderColor: '#fff' }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom', labels: { font: { family:'Inter', size:11 }, boxWidth:10 } } }
      }
    });
  }
}

document.addEventListener('DOMContentLoaded', () => {
  loadAssignments();
  loadCounts();

  document.getElementById('filter-status')?.addEventListener('change', function() {
    loadAssignments(this.value);
  });

  document.getElementById('btn-refresh')?.addEventListener('click', () => {
    loadAssignments(document.getElementById('filter-status')?.value || '');
    loadCounts();
    showToast('Refreshed', 'info');
  });
});
