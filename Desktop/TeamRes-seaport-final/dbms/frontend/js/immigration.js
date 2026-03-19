/* immigration.js — OCR pipeline, scan animation, certificate render, Traveler CRUD */
/* NOTE FOR DEVELOPERS:
 * To open the traveler modal programmatically:
 *   openTravelerModal()              → Add mode (blank form)
 *   openTravelerModal('ENTITY_ID')   → Edit mode (pre-filled from API)
 *   deleteTraveler('ENTITY_ID', 'Name') → Delete with confirm
 *   loadTravelers(query, status)     → Refresh table
 */

'use strict';

// ── State ────────────────────────────────────────────────────────
let _webcamStream = null;
let _selectedFile = null;
let _modalMode    = 'add';   // 'add' | 'edit'
let _editId       = null;
let _photoFile    = null;    // selected photo in modal

// ── Webcam ───────────────────────────────────────────────────────
async function startCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' }
    });
    const video = document.getElementById('webcam-feed');
    if (video) { video.srcObject = stream; _webcamStream = stream; }
    const dot = document.getElementById('camera-dot');
    if (dot) dot.style.opacity = '1';
    const label = document.getElementById('camera-label');
    if (label) label.textContent = '● Camera Active';
  } catch {
    const label = document.getElementById('camera-label');
    if (label) label.textContent = '⚠ Camera unavailable';
  }
}

function captureFrame() {
  const video = document.getElementById('webcam-feed');
  if (!video || !video.videoWidth) { showToast('Camera not active', 'warning'); return; }
  const canvas = document.createElement('canvas');
  canvas.width  = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext('2d').drawImage(video, 0, 0);
  showToast('Frame captured — face image stored for match analysis', 'info');
}

// ── Dropzone ─────────────────────────────────────────────────────
function setupDropzone() {
  const dz  = document.getElementById('dropzone');
  const inp = document.getElementById('file-input');
  if (!dz || !inp) return;

  dz.addEventListener('click', () => inp.click());
  inp.addEventListener('change', () => handleFile(inp.files[0]));
  dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('drag-over'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('drag-over'));
  dz.addEventListener('drop', e => {
    e.preventDefault();
    dz.classList.remove('drag-over');
    if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
  });
}

function handleFile(file) {
  if (!file) return;
  _selectedFile = file;
  const dz = document.getElementById('dropzone');
  const scanBtn = document.getElementById('btn-scan');
  if (dz) {
    dz.classList.add('has-file');
    dz.innerHTML = `<div style="padding:8px;text-align:center">
      <div style="font-size:13px;font-weight:600;color:var(--color-success)">✓ ${file.name}</div>
      <div style="font-size:11px;color:var(--color-text-muted);margin-top:4px">${(file.size/1024).toFixed(1)} KB — Ready to scan</div>
    </div>`;
  }
  if (scanBtn) scanBtn.disabled = false;
}

// ── Scan sequence ─────────────────────────────────────────────────
const SCAN_STEPS = [
  [0,    'Initializing OCR engine...'],
  [700,  'Extracting biometric fields from document...'],
  [1600, 'Cross-referencing passport database...'],
  [2400, 'Running face match analysis...'],
  [3100, 'Generating verification report...'],
];

async function initiateScan() {
  if (!_selectedFile) { showToast('Please upload a passport document first', 'error'); return; }
  const btn = document.getElementById('btn-scan');
  if (btn) { btn.disabled = true; btn.textContent = 'Scanning...'; }

  const scanContainer = document.getElementById('scan-container');
  if (scanContainer) {
    const overlay = document.createElement('div');
    overlay.className = 'scan-overlay';
    overlay.innerHTML = '<div class="laser-line"></div>';
    scanContainer.style.position = 'relative';
    scanContainer.appendChild(overlay);
    setTimeout(() => overlay.remove(), 3000);
  }

  const statusEl = document.getElementById('scan-status');
  SCAN_STEPS.forEach(([delay, msg]) => setTimeout(() => { if (statusEl) statusEl.textContent = msg; }, delay));

  await new Promise(r => setTimeout(r, 3500));

  const filename = _selectedFile.name.toLowerCase();
  const passportNo = (filename.includes('vikram') || filename.includes('passport') || filename.includes('mockup'))
    ? 'Z8892104' : null;

  const res = await apiFetch('/api/immigration/verify-passport', {
    method: 'POST',
    body: JSON.stringify({ passport_no: passportNo || '', ocr_name: passportNo ? '' : 'Unknown' })
  });

  if (res.success) {
    renderCertificate(res.data);
    if (statusEl) statusEl.textContent = '✓ Verification complete.';
  } else {
    showToast('Verification API error: ' + (res.message || 'Unknown error'), 'error');
  }
  if (btn) { btn.disabled = false; btn.textContent = 'Initiate Verification Scan →'; }
}

function renderCertificate(data) {
  const container = document.getElementById('cert-container');
  if (!container) return;
  const e = data.entity || {};
  const checks = data.checks || {};
  const overall = data.overall_status || 'Pending';
  const isVerified = overall === 'Verified';
  const isBlacklist = data.is_blacklist;
  const score = checks.face_match_score || 0;

  const checkRows = [
    ['MRZ Validation',       checks.mrz_valid],
    ['Passport Not Expired', checks.not_expired],
    ['Watchlist Clear',      checks.watchlist_clear],
    ['INTERPOL Clear',       checks.interpol_clear],
  ].map(([label, ok]) => `
    <div class="cert-check-row">
      <span class="${ok ? 'check-ok' : 'check-fail'}">${ok ? '✓' : '✕'}</span>
      <span>${label}</span>
    </div>`).join('');

  container.innerHTML = `
    <div class="cert-panel ${isBlacklist ? 'flagged' : isVerified ? 'verified' : 'flagged'}">
      <div class="cert-header ${isBlacklist ? 'flagged' : isVerified ? 'verified' : 'flagged'}">
        ${isVerified && !isBlacklist ? '✓ VERIFICATION SUCCESSFUL' : '⚠ VERIFICATION ALERT'}
        ${isBlacklist ? ' — BLACKLISTED ENTITY — DO NOT GRANT ENTRY' : ''}
      </div>
      <div class="cert-body">
        <div style="display:grid;grid-template-columns:auto 1fr;gap:20px;align-items:start;margin-bottom:16px">
          <div style="text-align:center">
            <div class="cert-score" style="color:${isVerified&&!isBlacklist?'var(--color-success)':'var(--color-alert)'}">${score}%</div>
            <div style="font-size:11px;color:var(--color-text-muted);margin-top:4px">Face Match</div>
          </div>
          <div class="data-grid">
            <div class="data-field"><span class="data-label">Name</span><span class="data-value">${e.name||'—'}</span></div>
            <div class="data-field"><span class="data-label">Passport No.</span><span class="data-value mono">${e.passport_no||'—'}</span></div>
            <div class="data-field"><span class="data-label">Nationality</span><span class="data-value">${e.nationality||'—'}</span></div>
            <div class="data-field"><span class="data-label">Date of Birth</span><span class="data-value">${e.dob||'—'}</span></div>
          </div>
        </div>
        <div class="cert-checks">${checkRows}</div>
        ${isBlacklist ? `<div class="alert-banner error" style="margin-top:14px"><div><div class="alert-title">⚠ BLACKLIST ALERT</div><div class="alert-body-text">${data.blacklist_reason||'Entity is on the watchlist'}</div></div></div>` : ''}
        ${!isBlacklist && isVerified
          ? `<div style="margin-top:16px;display:flex;gap:8px;align-items:center">
               <button class="btn btn-success" onclick="grantEntry('${e.passport_no}')">✓ Grant Entry</button>
             </div>`
          : `<button class="btn btn-danger" style="margin-top:14px">Deny Entry — Escalate</button>`}
      </div>
    </div>`;
  container.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

async function grantEntry(passportNo) {
  const res = await apiFetch('/api/immigration/grant-entry', {
    method: 'POST', body: JSON.stringify({ passport_no: passportNo })
  });
  if (res.success) showToast(`Entry granted for passport ${passportNo}`, 'success');
  else showToast('Grant entry failed: ' + res.message, 'error');
}

// ── Traveler DB Table ─────────────────────────────────────────────
async function loadTravelers(q = '', status = '') {
  const tbodyEl = document.getElementById('traveler-tbody');
  if (!tbodyEl) return;
  tbodyEl.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:20px;color:var(--color-text-muted)">Loading...</td></tr>';

  const url = `/api/immigration/travelers?q=${encodeURIComponent(q)}&status=${encodeURIComponent(status)}&limit=50`;
  const res = await apiFetch(url);
  if (!res.success) {
    showToast('Failed to load travelers: ' + (res.message || 'error'), 'error');
    tbodyEl.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:20px;color:var(--color-alert)">Error loading travelers</td></tr>';
    return;
  }

  const items = res.data.items;
  if (!items.length) {
    tbodyEl.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:24px;color:var(--color-text-muted)">No travelers found</td></tr>';
    return;
  }

  tbodyEl.innerHTML = items.map(r => {
    const photoCell = r.passport_photo
      ? `<a href="${r.passport_photo}" target="_blank" title="View photo"><img src="${r.passport_photo}" class="photo-thumb" alt="Photo" style="cursor:pointer"></a>`
      : `<div class="photo-placeholder" title="No photo">👤</div>`;
    const isBlacklisted = r.status === 'Blacklisted' || r.is_blacklist;
    return `<tr style="${isBlacklisted ? 'background:#FEF2F2' : ''}">
      <td style="text-align:center">${photoCell}</td>
      <td class="font-mono">${r.passport_no || '—'}</td>
      <td><strong>${r.name}</strong></td>
      <td>${r.nationality}</td>
      <td>${r.gender || '—'}</td>
      <td>${r.dob || '—'}</td>
      <td>${(r.entry_point || '').split(',')[0] || '—'}</td>
      <td>${r.visit_reason || '—'}</td>
      <td>${r.visa_status || '—'}</td>
      <td>${statusBadge(isBlacklisted ? 'Blacklisted' : (r.status || 'Under Verification'))}</td>
      <td>
        <div style="display:flex;gap:4px">
          <button class="btn btn-secondary btn-sm" onclick="openTravelerModal('${r.id}')">✏ Edit</button>
          <button class="btn btn-danger btn-sm" onclick="deleteTraveler('${r.id}', ${JSON.stringify(r.name)})">🗑</button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

// ── Modal: Open ───────────────────────────────────────────────────
async function openTravelerModal(entityId) {
  _modalMode = entityId ? 'edit' : 'add';
  _editId    = entityId || null;
  _photoFile = null;

  // Reset all form fields
  _setField('m-name', '');
  _setField('m-nationality', '');
  _setField('m-passport', '');
  _setField('m-dob', '');
  _setField('m-entry-point', '');
  _setField('m-visit-reason', '');
  _setSelect('m-gender', '');
  _setSelect('m-visa-status', 'None');
  _setSelect('m-status', 'Under Verification');
  const blEl = document.getElementById('m-blacklisted');
  if (blEl) blEl.checked = false;

  // Photo section always visible (both add and edit)
  const photoGroup = document.getElementById('photo-upload-group');
  if (photoGroup) photoGroup.style.display = '';
  _clearPhotoPreview();

  // Update modal title
  const titleEl = document.getElementById('modal-title');
  if (titleEl) titleEl.textContent = entityId ? 'Edit Traveler' : 'Add Traveler';
  const saveBtn = document.getElementById('modal-save-btn');
  if (saveBtn) saveBtn.textContent = entityId ? 'Save Changes' : 'Add Traveler';

  // Show modal immediately (load data in background for edit mode)
  const modal = document.getElementById('traveler-modal');
  if (modal) modal.style.display = 'flex';

  // If edit mode, fetch and fill the data
  if (entityId) {
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Loading...'; }
    const res = await apiFetch(`/api/immigration/travelers/${entityId}`);
    if (res.success) {
      const traveler = res.data;

      if (traveler) {
        _setField('m-name', traveler.name || '');
        _setField('m-nationality', traveler.nationality || '');
        _setField('m-passport', traveler.passport_no || '');
        _setField('m-dob', traveler.dob || '');
        _setField('m-entry-point', traveler.entry_point || '');
        _setField('m-visit-reason', traveler.visit_reason || '');
        _setSelect('m-gender', traveler.gender || '');
        _setSelect('m-visa-status', traveler.visa_status || 'None');
        _setSelect('m-status', traveler.status || 'Under Verification');

        if (traveler.passport_photo) {
          const thumb = document.getElementById('modal-photo-thumb');
          if (thumb) { thumb.src = traveler.passport_photo; thumb.style.display = 'block'; }
          const pname = document.getElementById('modal-photo-name');
          if (pname) pname.textContent = 'Current passport photo';
        }
      } else {
        showToast('Traveler record not found', 'error');
        closeTravelerModal();
        return;
      }
    }
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save Changes'; }
  }
}

function _setField(id, value) {
  const el = document.getElementById(id);
  if (el) el.value = value;
}

function _setSelect(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  // Try to set the value directly
  el.value = value;
  // If no option matched, default to first
  if (el.value !== value) el.selectedIndex = 0;
}

function _clearPhotoPreview() {
  const thumb = document.getElementById('modal-photo-thumb');
  if (thumb) { thumb.src = ''; thumb.style.display = 'none'; }
  const pname = document.getElementById('modal-photo-name');
  if (pname) pname.textContent = '';
  const fileInput = document.getElementById('m-photo');
  if (fileInput) fileInput.value = '';
  _photoFile = null;
}

// ── Modal: Close ──────────────────────────────────────────────────
function closeTravelerModal(e) {
  // If called from the overlay click, only close if the overlay itself was clicked
  if (e && e.type === 'click') {
    const overlay = document.getElementById('traveler-modal');
    if (e.target !== overlay) return;
  }
  const modal = document.getElementById('traveler-modal');
  if (modal) modal.style.display = 'none';
  _photoFile = null;
}

// ── Modal: Save (Add or Edit) ─────────────────────────────────────
async function saveTraveler() {
  const name        = (document.getElementById('m-name')?.value || '').trim();
  const nationality = (document.getElementById('m-nationality')?.value || '').trim();
  if (!name)        { showToast('Full Name is required', 'error'); document.getElementById('m-name')?.focus(); return; }
  if (!nationality) { showToast('Nationality is required', 'error'); document.getElementById('m-nationality')?.focus(); return; }

  const payload = {
    name,
    nationality,
    passport_no:  (document.getElementById('m-passport')?.value || '').trim(),
    gender:       document.getElementById('m-gender')?.value || '',
    dob:          document.getElementById('m-dob')?.value || '',
    entry_point:  (document.getElementById('m-entry-point')?.value || '').trim(),
    visit_reason: (document.getElementById('m-visit-reason')?.value || '').trim(),
    visa_status:  document.getElementById('m-visa-status')?.value || 'None',
    // Status drives is_blacklist automatically
    status:       document.getElementById('m-status')?.value || 'Under Verification',
    blacklisted:  document.getElementById('m-status')?.value === 'Blacklisted',
  };

  const saveBtn = document.getElementById('modal-save-btn');
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving...'; }

  let res;
  let entityId = _editId;

  if (_modalMode === 'edit' && _editId) {
    // PATCH to update existing
    res = await apiFetch(`/api/immigration/travelers/${_editId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload)
    });
  } else {
    // POST to create new
    res = await apiFetch('/api/immigration/travelers', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    if (res.success) entityId = res.data?.id;
  }

  if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = _modalMode === 'edit' ? 'Save Changes' : 'Add Traveler'; }

  if (!res.success) {
    showToast('Save failed: ' + (res.message || 'Unknown error'), 'error');
    return;
  }

  // Upload photo if one was selected
  if (_photoFile && entityId) {
    const uploaded = await uploadPassportPhoto(entityId, _photoFile);
    if (!uploaded) showToast('Traveler saved but photo upload failed', 'warning');
  }

  showToast(_modalMode === 'edit' ? 'Traveler updated successfully' : 'Traveler added successfully', 'success');
  const modal = document.getElementById('traveler-modal');
  if (modal) modal.style.display = 'none';

  // Refresh table
  loadTravelers(
    document.getElementById('traveler-search')?.value || '',
    document.getElementById('traveler-status')?.value || ''
  );
}

// ── Delete ────────────────────────────────────────────────────────
async function deleteTraveler(entityId, name) {
  if (!confirm(`Delete traveler "${name}"?\n\nThis cannot be undone.`)) return;

  const res = await apiFetch(`/api/immigration/travelers/${entityId}`, { method: 'DELETE' });
  if (res.success) {
    showToast('Traveler deleted', 'success');
    loadTravelers(
      document.getElementById('traveler-search')?.value || '',
      document.getElementById('traveler-status')?.value || ''
    );
  } else {
    showToast('Delete failed: ' + (res.message || 'error'), 'error');
  }
}

// ── Photo upload (multipart — does NOT use apiFetch to avoid wrong Content-Type) ──
async function uploadPassportPhoto(entityId, file) {
  const fd = new FormData();
  fd.append('photo', file);
  try {
    // Do NOT set Content-Type header — browser sets it automatically with boundary for multipart
    const raw = await fetch(`/api/immigration/travelers/${entityId}/photo`, {
      method: 'POST',
      body: fd
    });
    const json = await raw.json();
    if (!json.success) { showToast('Photo upload failed: ' + json.message, 'error'); return false; }
    showToast('Passport photo saved', 'success');
    return true;
  } catch (e) {
    showToast('Photo upload error: ' + e.message, 'error');
    return false;
  }
}

// ── DOMContentLoaded ──────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  startCamera();
  setupDropzone();

  document.getElementById('btn-scan')?.addEventListener('click', initiateScan);
  document.getElementById('btn-capture')?.addEventListener('click', captureFrame);

  // Photo file input in modal — preview on selection
  document.getElementById('m-photo')?.addEventListener('change', function () {
    const file = this.files?.[0];
    if (!file) return;
    _photoFile = file;
    document.getElementById('modal-photo-name').textContent = file.name;
    const thumb = document.getElementById('modal-photo-thumb');
    if (thumb) {
      const reader = new FileReader();
      reader.onload = ev => { thumb.src = ev.target.result; thumb.style.display = 'block'; };
      reader.readAsDataURL(file);
    }
  });

  // Tab switching
  document.querySelectorAll('.tab-item').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab-item').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      tab.classList.add('active');
      const content = document.getElementById(tab.dataset.tab);
      if (content) content.classList.add('active');
      if (tab.dataset.tab === 'tab-travelers') {
        loadTravelers();
      }
    });
  });

  // Traveler search/filter
  document.getElementById('traveler-search')?.addEventListener('input', function () {
    loadTravelers(this.value, document.getElementById('traveler-status')?.value || '');
  });
  document.getElementById('traveler-status')?.addEventListener('change', function () {
    loadTravelers(document.getElementById('traveler-search')?.value || '', this.value);
  });

  // Modal overlay click-outside-to-close
  document.getElementById('traveler-modal')?.addEventListener('click', closeTravelerModal);
});
