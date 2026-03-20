/* border-patrol.js — Force page logic, refugee form, NGO assignment, camp mini-map */

const FORCE_NAME = document.querySelector('meta[name="dbms-force"]')?.content || 'BSF';

// ── Watchlist Check ───────────────────────────────────────────
let _watchlistTimeout = null;

function setupWatchlistCheck() {
  const passportInput = document.getElementById('f-passport');
  const nameInput     = document.getElementById('f-name');
  if (!passportInput && !nameInput) return;

  const check = async () => {
    const passport = passportInput?.value.trim();
    const name     = nameInput?.value.trim();
    if (!passport && !name) return;
    const res = await apiFetch('/api/border-patrol/watchlist-check', {
      method: 'POST',
      body: JSON.stringify({ passport_no: passport, name })
    });
    if (!res.success) return;
    const alertEl  = document.getElementById('watchlist-alert');
    const clearEl  = document.getElementById('watchlist-clear');
    if (res.data.is_blacklist) {
      if (alertEl) {
        alertEl.classList.add('visible');
        document.getElementById('wl-name').textContent   = res.data.matched_name;
        document.getElementById('wl-reason').textContent = res.data.blacklist_reason;
      }
      if (clearEl) clearEl.style.display = 'none';
    } else {
      if (alertEl) alertEl.classList.remove('visible');
      if (clearEl) clearEl.style.display = 'flex';
    }
  };

  [passportInput, nameInput].filter(Boolean).forEach(el => {
    el.addEventListener('blur', () => {
      clearTimeout(_watchlistTimeout);
      _watchlistTimeout = setTimeout(check, 300);
    });
  });
}

// ── NGO Cards ─────────────────────────────────────────────────
let _selectedNGO = null;

async function loadNGOCards() {
  const container = document.getElementById('ngo-cards-container');
  if (!container) return;
  try {
    const res = await fetch(`/api/ngo/list-by-force?force=${encodeURIComponent(FORCE_NAME)}`);
    const json = await res.json();
    if (!json.success) throw new Error('NGO load failed');
    const all  = { [FORCE_NAME]: json.data };
    const ngos = all[FORCE_NAME] || [];
    container.innerHTML = ngos.map(n => `
      <div class="ngo-card" id="ngo-${n.id}" data-ngo-id="${n.id}" data-ngo-name="${n.name}" onclick="selectNGO('${n.id}','${n.name.replace(/'/g,"\\'")}')">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
          <span class="ngo-card-title">${n.name}</span>
          <span class="badge badge-${n.type === 'National' ? 'national' : 'regional'}">${n.type}</span>
        </div>
        <p style="font-size:12px;color:var(--color-text-secondary);line-height:1.6;margin-bottom:8px">${n.description}</p>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px">${n.specializations.map(s => `<span class="tag-pill">${s}</span>`).join('')}</div>
        <div style="font-size:11px;color:var(--color-text-muted)">${n.contact} — Load: ${n.current_load} cases</div>
      </div>`).join('');
  } catch {
    if (container) container.innerHTML = '<p class="text-muted">NGO data unavailable</p>';
  }
}

function selectNGO(id, name) {
  document.querySelectorAll('.ngo-card').forEach(c => c.classList.remove('selected'));
  const card = document.getElementById(`ngo-${id}`);
  if (card) card.classList.add('selected');
  _selectedNGO = { id, name };
  document.getElementById('f-ngo-selected').value = name;
  document.getElementById('f-ngo-id').value = id;
}

// ── Character counter ─────────────────────────────────────────
function setupCharCounter() {
  const textarea = document.getElementById('f-ngo-message');
  const counter  = document.getElementById('ngo-msg-count');
  if (!textarea || !counter) return;
  textarea.addEventListener('input', () => {
    const n = textarea.value.length;
    counter.textContent = `${n} / 50 minimum`;
    counter.classList.toggle('min-met', n >= 50);
  });
}

// ── Submit registration ───────────────────────────────────────
async function submitRegistration(e) {
  e.preventDefault();
  const form = document.getElementById('refugee-form');
  if (!validateForm(form)) { showToast('Please fill all required fields','error'); return; }

  const ngoMessage = document.getElementById('f-ngo-message').value;
  if (ngoMessage.trim().length < 50) {
    showToast('NGO message must be at least 50 characters','error');
    document.getElementById('f-ngo-message').classList.add('error');
    return;
  }

  const session = getSession();
  const payload = {
    name:           document.getElementById('f-name').value,
    dob:            document.getElementById('f-dob').value,
    gender:         document.getElementById('f-gender').value,
    nationality:    document.getElementById('f-nationality').value,
    entry_point:    document.getElementById('f-entry-point').value,
    assigned_camp:  document.getElementById('f-camp').value,
    assigned_ngo:   document.getElementById('f-ngo-selected').value,
    ngo_id:         document.getElementById('f-ngo-id').value,
    ngo_message:    ngoMessage,
    passport_no:    document.getElementById('f-passport').value,
    officer_notes:  document.getElementById('f-notes').value,
    needs_medical:  document.getElementById('f-need-medical')?.checked,
    needs_shelter:  document.getElementById('f-need-shelter')?.checked,
    needs_legal:    document.getElementById('f-need-legal')?.checked,
    needs_child:    document.getElementById('f-need-child')?.checked,
    needs_education:document.getElementById('f-need-education')?.checked,
    force:          FORCE_NAME,
    registered_by:  session.user_id || 'Officer'
  };

  const submitBtn = document.getElementById('btn-register');
  if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Registering...'; }

  const res = await apiFetch('/api/border-patrol/register-refugee', {
    method: 'POST', body: JSON.stringify(payload)
  });

  if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Register Refugee & Notify NGO →'; }

  if (!res.success) { showToast('Registration failed: ' + res.message,'error'); return; }

  const provId = res.data.provisional_id;
  showSuccessModal(provId);
  form.reset();
  document.querySelectorAll('.ngo-card').forEach(c => c.classList.remove('selected'));
  _selectedNGO = null;
}

function showSuccessModal(provId) {
  const qrContainer = `<div id="qr-modal-canvas" style="display:flex;justify-content:center;margin-top:12px"></div>`;
  openModal({
    title: '✓ Refugee Registered Successfully',
    size: 'lg',
    body: `
      <div class="success-modal-prov">
        <div class="prov-label">Provisional ID — Print and give to refugee</div>
        <div class="prov-id" onclick="navigator.clipboard.writeText('${provId}');showToast('Copied!','success')" title="Click to copy" style="cursor:pointer">${provId}</div>
        <div style="font-size:11px;color:var(--color-text-muted);margin-top:6px">Click ID to copy to clipboard</div>
      </div>
      ${qrContainer}
      <p style="font-size:12px;color:var(--color-text-muted);text-align:center;margin-top:12px">The NGO has been notified. Print this QR code and give it to the refugee as their reference.</p>
      
      <hr style="margin:20px 0;border:none;border-top:1px solid var(--color-border)">
      <div id="family-declare-section">
        <h4 style="margin:0 0 12px 0;font-size:14px;color:var(--color-text-primary)">Declare Family Members</h4>
        <div id="family-members-container">
          <div class="family-member-row" style="display:flex;gap:8px;margin-bottom:8px">
            <input type="text" class="form-input mem-name" placeholder="Relative Name" style="flex:1">
            <input type="number" class="form-input mem-age" placeholder="Age" style="width:80px">
          </div>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:12px">
          <button class="btn btn-secondary btn-sm" onclick="addFamilyRow()">+ Add Another</button>
          <button class="btn btn-primary btn-sm" onclick="submitFamily('${provId}')" id="btn-family-search">Search Matches</button>
        </div>
      </div>
      <div id="family-matches-section" style="display:none;margin-top:16px;padding:12px;background:var(--color-surface-hover);border-radius:6px;border:1px solid var(--color-border)">
        <!-- Matches injected here -->
      </div>
      `,
    footer: `
      <div style="display:flex;gap:8px;width:100%;justify-content:flex-end">
        <button class="btn btn-secondary" onclick="window.print()">Print QR Sheet</button>
        <button class="btn btn-secondary" onclick="closeModal()">Register Another</button>
        <button class="btn btn-primary" onclick="closeModal();loadRefugeeTable()">Done</button>
      </div>`
  });
  setTimeout(() => {
    if (typeof QRCode !== 'undefined') {
      QRCode.toCanvas(document.createElement('canvas'), provId, { width: 180 }, (err, canvas) => {
        if (!err) { const el = document.getElementById('qr-modal-canvas'); if (el) el.appendChild(canvas); }
      });
    }
  }, 100);
}

// ── Family Declarations ───────────────────────────────────────
window.addFamilyRow = function() {
  const container = document.getElementById('family-members-container');
  if (!container) return;
  const div = document.createElement('div');
  div.className = 'family-member-row';
  div.style.cssText = 'display:flex;gap:8px;margin-bottom:8px';
  div.innerHTML = `
    <input type="text" class="form-input mem-name" placeholder="Relative Name" style="flex:1">
    <input type="number" class="form-input mem-age" placeholder="Age" style="width:80px">
    <button class="btn btn-secondary btn-sm text-danger" onclick="this.parentElement.remove()" style="padding:0 12px">×</button>
  `;
  container.appendChild(div);
};

window.submitFamily = async function(provId) {
  const rows = document.querySelectorAll('#family-members-container .family-member-row');
  const members = Array.from(rows).map(row => {
    return {
      name: row.querySelector('.mem-name').value.trim(),
      age: parseInt(row.querySelector('.mem-age').value) || 0
    };
  }).filter(m => m.name);

  if (!members.length) {
    showToast('Please enter at least one name to search', 'error');
    return;
  }

  const btn = document.getElementById('btn-family-search');
  if (btn) { btn.disabled = true; btn.textContent = 'Searching...'; }

  const res = await apiFetch(`/api/border-patrol/refugee/${provId}/family`, {
    method: 'POST',
    body: { members }
  });

  if (btn) { btn.disabled = false; btn.textContent = 'Search Matches'; }

  if (!res.success) {
    showToast('Failed to save declarations', 'error');
    return;
  }

  const matchesSection = document.getElementById('family-matches-section');
  if (!matchesSection) return;

  if (res.data && res.data.length > 0) {
    const matchIds = res.data.map(m => m.provisional_id);
    matchesSection.style.display = 'block';
    matchesSection.innerHTML = `
      <h5 style="margin:0 0 8px 0;color:var(--color-warning);">Possible Family Matches Found!</h5>
      <ul style="margin:0 0 12px 16px;padding:0;font-size:13px;color:var(--color-text-secondary)">
        ${res.data.map(m => `<li><strong>${m.name}</strong> (${m.provisional_id}) — DOB: ${m.dob}</li>`).join('')}
      </ul>
      <p style="font-size:12px;margin-bottom:12px">Would you like to link these records together under one Family ID?</p>
      <div style="display:flex;gap:8px">
        <button class="btn btn-primary btn-sm" onclick="linkFamily('${provId}', '${matchIds.join(',')}')">Yes, Link as Family</button>
        <button class="btn btn-secondary btn-sm" onclick="document.getElementById('family-matches-section').style.display='none'">Ignore</button>
      </div>
    `;
  } else {
    showToast('Declarations saved. No matches found in the system.', 'info');
    document.getElementById('family-declare-section').style.display = 'none';
  }
};

window.linkFamily = async function(currentProvId, matchIdsStr) {
  const allIds = [currentProvId, ...matchIdsStr.split(',')];
  const res = await apiFetch('/api/border-patrol/family/link', {
    method: 'POST',
    body: { provisional_ids: allIds }
  });

  if (res.success) {
    showToast('Family records linked successfully', 'success');
    const matchesSection = document.getElementById('family-matches-section');
    if (matchesSection) {
      matchesSection.innerHTML = `<div class="text-success" style="font-weight:600;font-size:13px">✓ Family records officially linked.</div>`;
    }
  } else {
    showToast('Failed to link family: ' + res.message, 'error');
  }
};

// ── Refugee table ─────────────────────────────────────────────
async function loadRefugeeTable() {
  const tbody = document.getElementById('refugee-tbody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:20px;color:var(--color-text-muted)">Loading...</td></tr>';
  const res = await apiFetch(`/api/border-patrol/refugees?force=${encodeURIComponent(FORCE_NAME)}&limit=100`);
  if (!res.success || !res.data.items.length) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:24px;color:var(--color-text-muted)">No refugees registered for this force yet.</td></tr>';
    return;
  }
  tbody.innerHTML = res.data.items.map(r => `
    <tr>
      <td class="font-mono">${r.provisional_id}</td>
      <td><strong>${r.name}</strong></td>
      <td>${r.nationality}</td>
      <td>${formatDate(r.registration_date)}</td>
      <td>${r.assigned_camp?.split(',')[0] || '—'}</td>
      <td>${r.assigned_ngo || '—'}</td>
      <td>${statusBadge(r.status)}</td>
      <td>${(r.help_tags||'').split(',').filter(Boolean).map(t=>`<span class="tag-pill" style="font-size:10px">${t.trim()}</span>`).join(' ')}</td>
    </tr>`).join('');
}

// ── Collapsible sections ──────────────────────────────────────
function setupCollapsibles() {
  document.querySelectorAll('.section-header').forEach(header => {
    header.addEventListener('click', () => {
      header.classList.toggle('collapsed');
      const body = header.nextElementSibling;
      if (body) body.classList.toggle('collapsed');
    });
  });
}

document.addEventListener('DOMContentLoaded', () => {
  setupWatchlistCheck();
  setupCharCounter();
  setupCollapsibles();
  loadNGOCards();

  const campsMiniMapEl = document.getElementById('camps-mini-map');
  const forceCamps = FORCE_CAMPS[FORCE_NAME] || [];
  if (campsMiniMapEl && forceCamps.length && typeof initCampMiniMap === 'function') {
    initCampMiniMap('camps-mini-map', forceCamps);
  }

  document.getElementById('refugee-form')?.addEventListener('submit', submitRegistration);
  loadRefugeeTable();

  // Tab switching on refugee records section
  document.querySelectorAll('.tab-item').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab-item,.tab-content').forEach(el => el.classList.remove('active'));
      tab.classList.add('active');
      const content = document.getElementById(tab.dataset.tab);
      if (content) content.classList.add('active');
    });
  });
});
