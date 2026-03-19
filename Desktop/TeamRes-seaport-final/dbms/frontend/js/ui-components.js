/* ui-components.js — Shared UI primitives */

// ── Toast ─────────────────────────────────────────────────────
function showToast(message, type = 'info', duration = 4000) {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  const icons = { success:'✓', error:'✕', warning:'⚠', info:'ℹ' };
  toast.innerHTML = `<span>${icons[type] || '•'}</span><span>${message}</span>`;
  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => {
    toast.classList.remove('show');
    toast.addEventListener('transitionend', () => toast.remove(), { once: true });
  }, duration);
}

// ── Modal ─────────────────────────────────────────────────────
let _activeModal = null;

function openModal(config) {
  closeModal();
  const overlay = document.createElement('div');
  overlay.className = `modal-overlay ${config.size === 'lg' ? '' : ''}`;
  overlay.innerHTML = `
    <div class="modal ${config.size === 'lg' ? 'modal-lg' : ''}">
      <div class="modal-header">
        <span class="modal-title">${config.title || ''}</span>
        <button class="modal-close" onclick="closeModal()">✕</button>
      </div>
      <div class="modal-body">${config.body || ''}</div>
      ${config.footer ? `<div class="modal-footer">${config.footer}</div>` : ''}
    </div>`;
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('open'));
  overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });
  _activeModal = overlay;
  return overlay;
}

function closeModal() {
  if (!_activeModal) return;
  const el = _activeModal;
  _activeModal = null;
  el.classList.remove('open');
  const cleanup = () => { el.remove(); };
  el.addEventListener('transitionend', cleanup, { once: true });
  setTimeout(cleanup, 280);
}

// ── Drawer ────────────────────────────────────────────────────
let _activeDrawer = null;

function openDrawer(contentHTML, title = '') {
  closeDrawer();
  const overlay = document.createElement('div');
  overlay.className = 'drawer-overlay';
  overlay.innerHTML = `
    <div class="drawer-backdrop" onclick="closeDrawer()"></div>
    <div class="drawer">
      <div class="drawer-header">
        <span class="drawer-title">${title}</span>
        <button class="modal-close" onclick="closeDrawer()">✕</button>
      </div>
      <div class="drawer-body">${contentHTML}</div>
    </div>`;
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('open'));
  _activeDrawer = overlay;
}

function closeDrawer() {
  if (!_activeDrawer) return;
  const el = _activeDrawer;
  _activeDrawer = null;
  el.classList.remove('open');
  // Fallback: if transitionend never fires (e.g. element already detached), clean up after duration
  const cleanup = () => { el.remove(); };
  el.addEventListener('transitionend', cleanup, { once: true });
  setTimeout(cleanup, 280); // match CSS transition duration + buffer
}

// ── Status Badge ──────────────────────────────────────────────
function statusBadge(status) {
  const map = {
    'Verified':           ['verified','✓ Verified'],
    'Flagged':            ['flagged','⚠ Flagged'],
    'Pending':            ['pending','● Pending'],
    'Under Verification': ['pending','◔ Under Verification'],
    'Blacklisted':        ['flagged','⚑ Blacklisted'],
    'Provisional':        ['provisional','◔ Provisional'],
    'Denied':             ['denied','✕ Denied'],
    'CLEARED':            ['verified','✓ Cleared'],
    'UNVERIFIED':         ['pending','⏳ Unverified'],
    'INTERCEPTED':        ['flagged','⚑ Intercepted'],
    'FLAGGED_ILLEGAL':    ['flagged','🚨 Illegal'],
    'Acknowledged':       ['provisional','✓ Acknowledged'],
    'In Progress':        ['regional','↗ In Progress'],
    'Completed':          ['verified','✓ Completed'],
    'Open':               ['pending','↻ Open'],
    'Under Review':       ['provisional','◔ Under Review'],
    'Resolved':           ['verified','✓ Resolved'],
    'Escalated':          ['flagged','↑ Escalated'],
    'Active':             ['verified','● Active'],
  };
  const [cls, label] = map[status] || ['denied', status];
  return `<span class="badge badge-${cls}">${label}</span>`;
}

// ── Build Table ───────────────────────────────────────────────
function buildTable(columns, rows, options = {}) {
  if (!rows || rows.length === 0) {
    return `<div class="empty-state"><p>${options.emptyText || 'No records found.'}</p></div>`;
  }
  const thead = columns.map(c => `<th>${c.label}</th>`).join('');
  const tbody = rows.map(row => {
    const tds = columns.map(c => {
      let val = row[c.key];
      if (c.render) val = c.render(val, row);
      return `<td>${val ?? '—'}</td>`;
    }).join('');
    const cls = options.rowClass ? options.rowClass(row) : '';
    return `<tr class="${cls}" ${options.onRowClick ? `onclick="(${options.onRowClick})(this, ${JSON.stringify(row).replace(/"/g,"'")})"` : ''}>${tds}</tr>`;
  }).join('');
  return `<div class="table-wrapper"><table><thead><tr>${thead}</tr></thead><tbody>${tbody}</tbody></table></div>`;
}

// ── Confirm Dialog ────────────────────────────────────────────
function confirmDialog(config) {
  return new Promise(resolve => {
    openModal({
      title: config.title || 'Confirm',
      body: `<p style="font-size:14px;line-height:1.6">${config.message || 'Are you sure?'}</p>`,
      footer: `
        <button class="btn btn-secondary" onclick="closeModal(); window._confirmResolve(false)">Cancel</button>
        <button class="btn btn-danger"    onclick="closeModal(); window._confirmResolve(true)">${config.confirmText || 'Confirm'}</button>
      `
    });
    window._confirmResolve = resolve;
  });
}

// ── Field validation ──────────────────────────────────────────
function validateForm(formEl) {
  let valid = true;
  formEl.querySelectorAll('[required]').forEach(el => {
    el.classList.remove('error');
    const errEl = el.parentElement.querySelector('.form-error');
    if (errEl) errEl.remove();
    if (!el.value.trim()) {
      valid = false;
      el.classList.add('error');
      const err = document.createElement('span');
      err.className = 'form-error';
      err.textContent = 'This field is required';
      el.parentElement.appendChild(err);
    }
  });
  return valid;
}
