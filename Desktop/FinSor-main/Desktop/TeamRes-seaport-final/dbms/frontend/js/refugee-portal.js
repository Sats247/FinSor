/* refugee-portal.js — Provisional ID lookup, rights display, camp map */

const TIMELINE_STAGES = ['registered', 'assigned_to_ngo', 'aid_received', 'under_medical_review', 'case_resolved'];
const STAGE_LABELS = {
  'registered': 'Registered',
  'assigned_to_ngo': 'NGO Assigned',
  'aid_received': 'Aid Received',
  'under_medical_review': 'Medical Review',
  'case_resolved': 'Case Resolved'
};

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

  // Apply saved language preference
  const prefLang = res.data.language_preference || 'en';
  const langSelect = document.getElementById('lang-pref-selector');
  if (langSelect && langSelect.value !== prefLang) {
    langSelect.value = prefLang;
    if (typeof switchLanguage === 'function') switchLanguage(prefLang);
  }

  renderStatusCard(res.data);
  loadTimeline(id);
  loadAppeals(id);
  
  status.classList.add('visible');
  document.getElementById('refugee-appeals-card').style.display = 'block';
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

async function loadTimeline(provId) {
  const container = document.getElementById('timeline-nodes');
  const widget = document.getElementById('status-timeline');
  if (!container || !widget) return;
  
  const res = await apiFetch(`/api/refugee/${encodeURIComponent(provId)}/timeline`);
  if (!res.success) return;
  
  widget.style.display = 'block';
  const logs = res.data;
  
  let activeIndex = -1;
  TIMELINE_STAGES.forEach((s, idx) => {
    if (logs.find(l => l.stage === s) && idx > activeIndex) activeIndex = idx;
  });

  let pct = 0;
  if (activeIndex >= 0 && TIMELINE_STAGES.length > 1) {
    pct = (activeIndex / (TIMELINE_STAGES.length - 1)) * 100;
  }
  
  let html = `<div style="position:absolute;top:15px;left:10%;right:10%;height:2px;background:var(--color-border);z-index:0"></div>`;
  html += `<div id="timeline-bar-active" style="position:absolute;top:15px;left:10%;height:2px;background:var(--color-primary);z-index:1;transition:width 0.5s;width:${pct}%"></div>`;

  TIMELINE_STAGES.forEach((s, idx) => {
    let log = logs.find(l => l.stage === s);
    let isCompleted = !!log;
    let isCurrent = idx === activeIndex;
    let circleColor = isCompleted ? 'var(--color-primary)' : '#fff';
    let borderColor = isCompleted ? 'var(--color-primary)' : 'var(--color-border)';
    let ring = isCurrent ? `box-shadow: 0 0 0 4px var(--color-primary-tint)` : '';
    let textColor = isCompleted || isCurrent ? 'var(--color-text-primary)' : 'var(--color-text-muted)';
    let timeStr = log ? formatDateTime(log.timestamp) : '';
    
    html += `
      <div style="z-index:2;display:flex;flex-direction:column;align-items:center;width:20%;text-align:center">
        <div style="width:32px;height:32px;border-radius:50%;background:${circleColor};border:2px solid ${borderColor};${ring};margin-bottom:8px;transition:all 0.3s"></div>
        <div style="font-size:11px;font-weight:600;color:${textColor};margin-bottom:4px;line-height:1.2">${STAGE_LABELS[s]}</div>
        ${timeStr ? `<div style="font-size:10px;color:var(--color-text-muted)">${timeStr}</div>` : ''}
      </div>
    `;
  });
  
  container.innerHTML = html;
}

async function updateLanguagePreference() {
  const select = document.getElementById('lang-pref-selector');
  const lang = select.value;
  const provIdEl = document.getElementById('sc-prov-id');
  const provId = provIdEl ? provIdEl.textContent.replace('PROV-ID: ', '').trim() : '';
  
  // If not logged in yet, just do local switch
  if (!provId || provId.startsWith('PROV-')) {
    if (typeof switchLanguage === 'function') switchLanguage(lang);
    return;
  }
  
  if (typeof switchLanguage === 'function') switchLanguage(lang);
  
  const res = await apiFetch(`/api/refugee/${encodeURIComponent(provId)}/language`, {
    method: 'PUT',
    body: { language: lang }
  });
  
  if (res.success) {
    showToast('Language preference saved', 'success');
  } else {
    showToast('Failed to save language preference', 'error');
  }
}

async function submitAppeal(e) {
  e.preventDefault();
  const provIdEl = document.getElementById('sc-prov-id');
  const provId = provIdEl ? provIdEl.textContent.replace('PROV-ID: ', '').trim() : '';
  if (!provId) return;

  const btn = document.getElementById('btn-submit-appeal');
  const type = document.getElementById('appeal-type').value;
  const desc = document.getElementById('appeal-desc').value;

  btn.disabled = true;
  btn.textContent = 'Submitting...';

  const res = await apiFetch(`/api/refugee/${encodeURIComponent(provId)}/appeal`, {
    method: 'POST',
    body: { type, description: desc }
  });

  btn.disabled = false;
  btn.textContent = 'Submit Request';

  if (res.success) {
    showToast('Request submitted successfully', 'success');
    document.getElementById('appeal-form').reset();
    loadAppeals(provId);
  } else {
    showToast(res.message || 'Failed to submit request', 'error');
  }
}

async function loadAppeals(provId) {
  const container = document.getElementById('appeals-list');
  if (!container) return;
  
  const res = await apiFetch(`/api/refugee/${encodeURIComponent(provId)}/appeals`);
  if (!res.success) return;
  
  const appeals = res.data;
  if (!appeals.length) {
    container.innerHTML = '<p style="font-size:13px;color:var(--color-text-muted)">No requests submitted yet.</p>';
    return;
  }
  
  container.innerHTML = appeals.map(a => {
    let statusClass = 'status-pending';
    let statusLabel = 'Open';
    if (a.status === 'in_progress') { statusClass = 'status-in-progress'; statusLabel = 'In Progress'; }
    if (a.status === 'resolved') { statusClass = 'status-completed'; statusLabel = 'Resolved'; }
    if (a.status === 'closed') { statusClass = 'status-acknowledged'; statusLabel = 'Closed'; }
    
    return `
      <div style="border:1px solid var(--color-border);border-radius:8px;padding:12px;margin-bottom:12px">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">
          <div>
            <strong style="font-size:13px">${a.type}</strong>
            <div style="font-size:11px;color:var(--color-text-muted)">${formatDateTime(a.timestamp)}</div>
          </div>
          <span class="badge ${statusClass}">${statusLabel}</span>
        </div>
        <p style="font-size:13px;margin:0;color:var(--color-text-secondary);line-height:1.4">${a.description}</p>
        ${a.response_notes ? `
          <div style="margin-top:12px;padding:8px;background:var(--color-surface);border-left:3px solid var(--color-primary);font-size:12px;color:var(--color-text-primary)">
            <strong>Official Response:</strong><br>${a.response_notes}
          </div>
        ` : ''}
      </div>
    `;
  }).join('');
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('btn-lookup')?.addEventListener('click', lookupID);
  document.getElementById('prov-id-input')?.addEventListener('keypress', e => {
    if (e.key === 'Enter') lookupID();
  });
});

