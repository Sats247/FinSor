/* refugee-portal.js — Provisional ID lookup, rights display, camp map */

let _campMap = null;

async function lookupID() {
  const input  = document.getElementById('prov-id-input');
  const status = document.getElementById('refugee-status-card');
  if (!input || !status) return;

  const id = input.value.trim().toUpperCase();
  if (!id) { showToast('Please enter your Provisional ID','error'); return; }
  if (!id.startsWith('PROV-')) {
    showToast('Invalid format. Expected: PROV-FORCE-YEAR-NUMBER','error');
    return;
  }

  const btn = document.getElementById('btn-lookup');
  if (btn) { btn.disabled = true; btn.textContent = 'Searching...'; }

  const res = await apiFetch(`/api/refugee/lookup/${encodeURIComponent(id)}`);
  if (btn) { btn.disabled = false; btn.textContent = window.i18n?.t('refugee.find_button') || 'Find My Record'; }

  if (!res.success || !res.data) {
    showToast(res.message || 'Record not found. Please contact the officer who registered you.', 'error');
    status.classList.remove('visible');
    return;
  }

  renderStatusCard(res.data);
  status.classList.add('visible');
  status.scrollIntoView({ behavior:'smooth', block:'start' });
}

function renderStatusCard(data) {
  const el = id => document.getElementById(id);
  if (el('sc-prov-id'))    el('sc-prov-id').textContent    = data.provisional_id;
  if (el('sc-name'))       el('sc-name').textContent       = data.name;
  if (el('sc-nationality'))el('sc-nationality').textContent = data.nationality;
  if (el('sc-camp'))       el('sc-camp').textContent       = data.assigned_camp || data.entity_camp || '—';
  if (el('sc-ngo'))        el('sc-ngo').textContent        = data.ngo_name || data.assigned_ngo || '—';
  if (el('sc-ngo-status')) el('sc-ngo-status').innerHTML   = statusBadge(data.ngo_status || 'Pending');
  if (el('sc-status'))     el('sc-status').innerHTML       = statusBadge(data.reg_status || 'Active');
  if (el('sc-force'))      el('sc-force').textContent      = data.force;
  if (el('sc-registered')) el('sc-registered').textContent = formatDateTime(data.registration_date);

  // Help tags
  const tagsEl = el('sc-tags');
  if (tagsEl && data.help_tags) {
    tagsEl.innerHTML = data.help_tags.split(',').map(t =>
      `<span class="tag-pill">${t.trim()}</span>`
    ).join(' ');
  }

  // Rights
  const rightsEl = el('sc-rights');
  if (rightsEl && data.rights) {
    rightsEl.innerHTML = data.rights.map(r =>
      `<div class="rights-item">${r}</div>`
    ).join('');
  }

  // Emergency contacts
  const emEl = el('sc-emergency');
  if (emEl && data.emergency_contacts) {
    emEl.innerHTML = data.emergency_contacts.map(c =>
      `<div class="emergency-item"><div class="emergency-label">${c.label}</div><div class="emergency-number">${c.number}</div></div>`
    ).join('');
  }

  // Camp map — show all 7 camps, highlight the assigned one
  if (!_campMap) {
    _campMap = L.map('refugee-camp-map', {
      center: [22, 82], zoom: 4.5, zoomControl: false, attributionControl: false
    });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom:18 }).addTo(_campMap);
    Object.entries(CAMP_COORDS).forEach(([name, coords]) => {
      const isAssigned = name.includes((data.assigned_camp || '').split(',')[0]);
      const marker = L.marker(coords, {
        icon: L.divIcon({
          className: '',
          html: `<div style="background:${isAssigned ? '#D97706' : '#8A95A3'};color:#fff;width:${isAssigned?28:22}px;height:${isAssigned?28:22}px;border-radius:50%;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.2);display:flex;align-items:center;justify-content:center;font-size:12px;">⛺</div>`,
          iconSize: isAssigned ? [28,28] : [22,22], iconAnchor: isAssigned ? [14,14] : [11,11]
        })
      }).addTo(_campMap);
      marker.bindPopup(`<strong>${name}</strong><br>Capacity: ~${(CAMP_CAPACITY[name]||0).toLocaleString()}${isAssigned?'<br><span style="color:#D97706;font-weight:700">← Your assigned camp</span>':''}`);
      if (isAssigned) marker.openPopup();
    });
  }
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('btn-lookup')?.addEventListener('click', lookupID);
  document.getElementById('prov-id-input')?.addEventListener('keypress', e => {
    if (e.key === 'Enter') lookupID();
  });
});
