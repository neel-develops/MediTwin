/*
 * MediTwin UI. Renders pages from service-layer data and sends every change through it.
 * No counts or statuses are hardcoded here: everything is read back from stored records.
 */
(function () {
  'use strict';

  const MT = window.MediTwin;
  const api = MT.createService(window.localStorage);
  if (api.isEmpty()) api.seedDemo();
  window.addEventListener('storage', (e) => { if (e.key === api.storageKey) api.notifyExternalChange(); });

  // ------------------------------------------------------------------ helpers
  const $ = (sel, el) => (el || document).querySelector(sel);
  const $$ = (sel, el) => Array.from((el || document).querySelectorAll(sel));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const STATUS_LABEL = { AVAILABLE: 'Available', OCCUPIED: 'Occupied', RESERVED: 'Reserved', CLEANING: 'Cleaning', MAINTENANCE: 'Maintenance',
    IN_USE: 'In use', WAITING: 'Waiting', MATCHING: 'Matching', ALLOCATED: 'Allocated', ADMITTED: 'Admitted', DISCHARGED: 'Discharged', TRANSFERRED: 'Transferred',
    ACTIVE: 'Active', RELEASED: 'Released', CANCELLED: 'Cancelled' };
  const TRANSITION_LABEL = { AVAILABLE: 'Mark available', RESERVED: 'Reserve bed', CLEANING: 'Mark for cleaning', MAINTENANCE: 'Send to maintenance' };
  const chip = (status) => `<span class="chip st-${esc(status)}"><i aria-hidden="true"></i>${esc(STATUS_LABEL[status] || status)}</span>`;
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
  const groupName = (i) => (window.MTScene ? window.MTScene.groupName(i) : `Group ${i + 1}`);

  function ago(iso) {
    if (!iso) return '—';
    const s = (Date.now() - new Date(iso).getTime()) / 1000;
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s / 60)} min ago`;
    if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
    return `${Math.floor(s / 86400)} d ago`;
  }
  const fmtTime = (iso) => (iso ? new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
  const timeTag = (iso) => `<time datetime="${esc(iso)}" title="${esc(fmtTime(iso))}">${esc(ago(iso))}</time>`;

  const ICONS = {
    home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/>',
    cube: '<path d="M12 2 3 7v10l9 5 9-5V7z"/><path d="m3 7 9 5 9-5"/><path d="M12 12v10"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>',
    bed: '<path d="M3 6v13"/><path d="M3 15h18v4"/><path d="M21 15v-3a3 3 0 0 0-3-3h-8v6"/><circle cx="6.5" cy="11.5" r="1.8"/>',
    monitor: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/><path d="M6 10h3l1.5-3 3 6 1.5-3h3"/>',
    bell: '<path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
    chart: '<path d="M3 3v18h18"/><path d="m7 15 4-4 3 3 5-6"/>',
    settings: '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    rotl: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
    rotr: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
    target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
    orbit: '<circle cx="12" cy="12" r="3"/><ellipse cx="12" cy="12" rx="10" ry="4.5"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    chev: '<path d="m9 18 6-6-6-6"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
    activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
    refresh: '<path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5M3 21v-5h5"/>',
    layers: '<path d="m12 2 10 5-10 5L2 7z"/><path d="m2 17 10 5 10-5M2 12l10 5 10-5"/>',
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
    out: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/>',
    flask: '<path d="M9 3h6M10 3v6L4 20a1 1 0 0 0 .9 1.5h14.2A1 1 0 0 0 20 20L14 9V3"/><path d="M7 15h10"/>',
    db: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
    hospital: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M12 7v6M9 10h6M9 21v-4h6v4"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    steth: '<path d="M5 3v6a5 5 0 0 0 10 0V3"/><path d="M10 14v2a5 5 0 0 0 10 0v-2"/><circle cx="20" cy="12" r="2"/>',
    scissors: '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4 8.1 15.9M14.5 14.5 20 20M8.1 8.1 12 12"/>',
    heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8z"/>',
    smile: '<circle cx="12" cy="12" r="9"/><path d="M9 10h.01M15 10h.01M9.5 15a3.5 3.5 0 0 0 5 0"/>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
    wind: '<path d="M3 8h11a3 3 0 1 0-3-3M3 12h15a3 3 0 1 1-3 3M3 16h7"/>',
    droplet: '<path d="M12 2.7s6 6.3 6 11.3a6 6 0 0 1-12 0c0-5 6-11.3 6-11.3z"/>',
    login: '<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><path d="m10 17 5-5-5-5M15 12H3"/>',
    undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-4"/>',
    pause: '<path d="M8 5v14M16 5v14"/>',
    arrow: '<path d="M5 12h14M13 5l7 7-7 7"/>',
  };
  const icon = (name, cls) => `<svg class="ico ${cls || ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
  const hydrateIcons = (root) => $$('[data-icon]', root).forEach((el) => { el.outerHTML = icon(el.dataset.icon); });

  // ------------------------------------------------------------------ toasts, modals
  function toast(message, kind) {
    const el = document.createElement('div');
    el.className = `toast ${kind || 'ok'}`;
    el.innerHTML = `${icon(kind === 'err' ? 'alert' : kind === 'info' ? 'info' : 'check')}<span>${esc(message)}</span>`;
    $('#toasts').appendChild(el);
    setTimeout(() => el.classList.add('out'), kind === 'err' ? 6500 : 3500);
    setTimeout(() => el.remove(), kind === 'err' ? 7000 : 4000);
  }
  function apiError(err) {
    if (!err || err.name !== 'ApiError') { console.error(err); toast('Something went wrong. Your data was not changed.', 'err'); return; }
    toast(err.message, 'err');
    if (err.status === 409) refresh(); // another change got there first: show current data
  }
  /** Run a service call; returns the result, or undefined after showing an error toast. */
  function attempt(fn) {
    try { return fn(); } catch (e) { apiError(e); return undefined; }
  }

  let modalReturnFocus = null;
  function openModal({ title, body, wide, actions, onMount }) {
    closeModal();
    modalReturnFocus = document.activeElement;
    const root = $('#modal-root');
    root.innerHTML = `<div class="modal-backdrop" data-act="modal-close"></div>
      <div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <header><h2 id="modal-title">${esc(title)}</h2><button class="icon-btn" data-act="modal-close" aria-label="Close">${icon('x')}</button></header>
        <div class="modal-body">${body}</div>
        ${actions ? `<footer>${actions}</footer>` : ''}
      </div>`;
    const m = $('.modal', root);
    if (onMount) onMount(m);
    const first = $('input:not([type=hidden]),select,textarea,button.btn', m);
    (first || m).focus();
  }
  function closeModal() {
    const root = $('#modal-root');
    if (!root.innerHTML) return;
    root.innerHTML = '';
    if (modalReturnFocus && document.contains(modalReturnFocus)) modalReturnFocus.focus();
  }
  function confirmDialog({ title, message, confirmLabel, danger }) {
    return new Promise((resolve) => {
      openModal({
        title,
        body: `<p class="confirm-msg">${message}</p>`,
        actions: `<button class="btn ghost" data-confirm="no">Cancel</button><button class="btn ${danger ? 'danger' : 'primary'}" data-confirm="yes">${esc(confirmLabel || 'Confirm')}</button>`,
        onMount(m) {
          m.addEventListener('click', (e) => {
            const b = e.target.closest('[data-confirm]');
            if (!b) return;
            closeModal();
            resolve(b.dataset.confirm === 'yes');
          });
          const obs = new MutationObserver(() => { if (!document.contains(m)) { obs.disconnect(); resolve(false); } });
          obs.observe($('#modal-root'), { childList: true });
          setTimeout(() => $('[data-confirm="yes"]', m).focus(), 0);
        },
      });
    });
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && $('#modal-root').innerHTML) { e.preventDefault(); closeModal(); }
    if (e.key === 'Tab' && $('#modal-root').innerHTML) {
      const f = $$('.modal button, .modal input, .modal select, .modal textarea, .modal a[href]').filter((x) => !x.disabled && x.offsetParent);
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    }
  });

  const checkboxes = (name, options, selected) => `<div class="checks">${options.map((o) => `<label class="check"><input type="checkbox" name="${name}" value="${esc(o)}" ${selected.includes(o) ? 'checked' : ''}><span>${esc(o)}</span></label>`).join('')}</div>`;
  const options = (list, selected, labels) => list.map((v) => `<option value="${esc(v)}" ${String(v) === String(selected) ? 'selected' : ''}>${esc(labels ? labels[v] || v : v)}</option>`).join('');
  const formData = (form) => {
    const fd = new FormData(form);
    const out = {};
    for (const [k, v] of fd.entries()) {
      if (form.querySelector(`input[type=checkbox][name="${k}"]`)) (out[k] = out[k] || []).push(v);
      else out[k] = v;
    }
    $$('input[type=checkbox]', form).forEach((c) => { if (!(c.name in out)) out[c.name] = []; });
    return out;
  };

  // ------------------------------------------------------------------ routing
  const S = {
    route: 'dashboard', params: {},
    wardId: null, bedId: null, group: 0, panelTab: 'details', view: '3d',
    exFilters: { status: '', bed_type: '', search: '' }, wardSearch: '',
    patientId: null, pSearch: '', pStatus: '', recs: null,
    bedsFilters: { ward_id: '', status: '', bed_type: '', search: '' },
    eqFilters: { ward_id: '', status: '', type: '', search: '', tracking_mode: '' },
    actFilter: '', sim: null,
  };

  function parseHash() {
    const h = location.hash.replace(/^#\/?/, '');
    const [path, query] = h.split('?');
    const params = {};
    new URLSearchParams(query || '').forEach((v, k) => { params[k] = v; });
    return { route: PAGES[path] ? path : 'dashboard', params };
  }
  function go(route, params) {
    const q = new URLSearchParams(params || {}).toString();
    const target = `#/${route}${q ? '?' + q : ''}`;
    if (location.hash === target) onRoute(); else location.hash = target;
  }
  function replaceHash(route, params) {
    const q = new URLSearchParams(Object.fromEntries(Object.entries(params || {}).filter(([, v]) => v != null && v !== ''))).toString();
    history.replaceState(null, '', `#/${route}${q ? '?' + q : ''}`);
  }

  let currentPage = null;
  function onRoute() {
    const { route, params } = parseHash();
    const sameRoute = currentPage && S.route === route;
    S.route = route; S.params = params;
    $$('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === route));
    $$('[data-nav]').forEach((a) => (a.dataset.nav === route ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
    closeNav();
    if (!sameRoute) {
      if (currentPage && currentPage.unmount) currentPage.unmount();
      currentPage = PAGES[route];
      const main = $('#main');
      main.innerHTML = '';
      currentPage.mount(main, params);
      main.scrollTop = 0;
    } else if (currentPage.onParams) currentPage.onParams(params);
    refresh();
  }
  function refresh() {
    if (currentPage) currentPage.update();
    updateChrome();
  }
  api.subscribe(() => refresh());
  window.addEventListener('hashchange', onRoute);

  function updateChrome() {
    const alerts = api.alerts();
    const n = alerts.filter((a) => a.severity !== 'info').length;
    for (const id of ['#alerts-badge', '#nav-alerts-badge']) {
      const b = $(id); b.hidden = !n; b.textContent = n;
    }
    $('#alerts-btn').setAttribute('aria-label', `Alerts (${n} need attention)`);
    const last = api.activity({ limit: 1 })[0];
    $('#last-updated').textContent = last ? `Last change ${ago(last.created_at)}` : '';
    const crumbs = [`<a href="#/dashboard">${icon('hospital')}Hospital (demo)</a>`];
    const titles = { dashboard: 'Dashboard', explorer: '3D Explorer', patients: 'Patients', beds: 'Beds & Resources', equipment: 'Equipment', alerts: 'Alerts', reports: 'Reports', setup: 'Setup & Settings' };
    crumbs.push(`<a href="#/${S.route}">${esc(titles[S.route])}</a>`);
    if (S.route === 'explorer' && S.wardId) {
      const w = attempt(() => api.getWard(S.wardId));
      if (w) crumbs.push(`<span aria-current="page">${icon('layers')}${esc(w.name)}</span>`);
    }
    $('#crumbs').innerHTML = crumbs.join(`<span class="sep" aria-hidden="true">›</span>`);
  }

  // ------------------------------------------------------------------ global search
  (function initSearch() {
    const input = $('#global-search');
    const box = $('#search-results');
    let items = [];
    let idx = -1;
    function close() { box.hidden = true; input.setAttribute('aria-expanded', 'false'); idx = -1; }
    function render() {
      const q = input.value.trim();
      if (!q) { close(); return; }
      const r = api.search(q);
      items = [
        ...r.beds.map((b) => ({ label: b.bed_code, sub: `Bed · ${b.ward_name}`, status: b.status, go: () => go('explorer', { ward: b.ward_id, bed: b.id }) })),
        ...r.wards.map((w) => ({ label: w.name, sub: `Ward · prefix ${w.bed_code_prefix}${w.is_active ? '' : ' · inactive'}`, go: () => go('explorer', { ward: w.id }) })),
        ...r.equipment.map((e) => ({ label: e.equipment_code, sub: `Equipment · ${e.equipment_type}`, status: e.status, go: () => go('equipment', { item: e.id }) })),
        ...r.patients.map((p) => ({ label: `${p.patient_code} · ${p.display_name}`, sub: 'Patient (demo)', status: p.status, go: () => go('patients', { patient: p.id }) })),
      ];
      box.innerHTML = items.length
        ? items.map((it, i) => `<button type="button" role="option" class="sr-item ${i === idx ? 'on' : ''}" data-i="${i}"><span><strong>${esc(it.label)}</strong><small>${esc(it.sub)}</small></span>${it.status ? chip(it.status) : ''}</button>`).join('')
        : `<div class="sr-empty">No beds, wards, equipment or patients match “${esc(q)}”.</div>`;
      box.hidden = false;
      input.setAttribute('aria-expanded', 'true');
    }
    function choose(i) { const it = items[i]; if (!it) return; input.value = ''; close(); input.blur(); it.go(); }
    input.addEventListener('input', () => { idx = -1; render(); });
    input.addEventListener('focus', render);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); idx = Math.min(items.length - 1, idx + 1); render(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); idx = Math.max(0, idx - 1); render(); }
      else if (e.key === 'Enter') { e.preventDefault(); choose(idx >= 0 ? idx : 0); }
      else if (e.key === 'Escape') { close(); }
    });
    box.addEventListener('mousedown', (e) => e.preventDefault());
    box.addEventListener('click', (e) => { const b = e.target.closest('[data-i]'); if (b) choose(Number(b.dataset.i)); });
    input.addEventListener('blur', () => setTimeout(close, 120));
  })();

  // mobile nav
  function closeNav() { document.body.classList.remove('nav-open'); $('#menu-btn').setAttribute('aria-expanded', 'false'); }
  $('#menu-btn').addEventListener('click', () => {
    const open = document.body.classList.toggle('nav-open');
    $('#menu-btn').setAttribute('aria-expanded', String(open));
  });

  // ------------------------------------------------------------------ shared actions
  const actions = {
    'modal-close': () => closeModal(),
    go: (el) => go(el.dataset.route, el.dataset.params ? JSON.parse(el.dataset.params) : {}),
    'open-bed': (el) => go('explorer', { ward: el.dataset.ward, bed: el.dataset.bed }),
    'bed-status': (el) => {
      const r = attempt(() => api.updateBedStatus(Number(el.dataset.bed), { status: el.dataset.status }));
      if (r) toast(`${r.bed_code} is now ${STATUS_LABEL[r.status].toLowerCase()}.`);
    },
    'edit-bed': (el) => editBedModal(Number(el.dataset.bed)),
    'assign-to-bed': (el) => assignToBedModal(Number(el.dataset.bed)),
    release: (el) => releaseFlow(Number(el.dataset.alloc), el.dataset.outcome, el.dataset.label),
    admit: (el) => {
      const r = attempt(() => api.admitPatient(Number(el.dataset.alloc)));
      if (r) toast(`${r.patient_code} admitted to ${r.bed_code}.`);
    },
    'cancel-alloc': async (el) => {
      const ok = await confirmDialog({ title: 'Cancel this allocation?', message: `${esc(el.dataset.label || 'This allocation')} will be cancelled. The bed returns to <strong>Available</strong>, any held devices are freed, and the patient goes back to <strong>Waiting</strong>.`, confirmLabel: 'Cancel allocation', danger: true });
      if (!ok) return;
      const r = attempt(() => api.cancelAllocation(Number(el.dataset.alloc)));
      if (r) toast(`Allocation cancelled. ${r.bed_code} is available and ${r.patient_code} is waiting again.`);
    },
    'register-patient': () => patientModal(),
    'edit-patient': (el) => patientModal(Number(el.dataset.patient)),
    'add-ward': () => wardModal(),
    'edit-ward': (el) => wardModal(Number(el.dataset.ward)),
    'resize-ward': (el) => resizeWardModal(Number(el.dataset.ward)),
    'toggle-ward': (el) => toggleWard(Number(el.dataset.ward)),
    'add-equipment': () => equipmentModal(),
    'edit-equipment': (el) => equipmentModal(Number(el.dataset.item)),
    'seed-demo': () => {
      const r = attempt(() => api.seedDemo());
      if (r) toast(r.wards + r.beds + r.patients + r.equipment ? `Added missing demo records (${r.wards} wards, ${r.beds} beds, ${r.patients} patients, ${r.equipment} equipment).` : 'Demo data already complete — nothing duplicated.', 'info');
    },
    'reset-demo': async () => {
      if (!(await confirmDialog({ title: 'Reset demo data?', message: 'This replaces <strong>all</strong> wards, beds, patients, equipment, allocations and activity in this browser with fresh fictional demo data.', confirmLabel: 'Reset demo data', danger: true }))) return;
      attempt(() => api.resetDemo());
      S.wardId = null; S.bedId = null; S.group = 0; S.patientId = null; S.recs = null; S.sim = null;
      toast('Demo data reset.');
    },
  };
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el || el.disabled) return;
    const fn = actions[el.dataset.act] || (currentPage && currentPage.actions && currentPage.actions[el.dataset.act]);
    if (fn) { e.preventDefault(); fn(el, e); }
  });

  // ------------------------------------------------------------------ shared flows
  async function releaseFlow(allocId, outcome, label) {
    const s = api.getSettings();
    const ok = await confirmDialog({
      title: outcome === 'TRANSFERRED' ? 'Release for transfer?' : 'Discharge and release bed?',
      message: `${esc(label || 'This allocation')} will be closed. The bed will move to <strong>${s.release_to_cleaning ? 'Cleaning' : 'Available'}</strong> and any allocated devices return to Available.`,
      confirmLabel: outcome === 'TRANSFERRED' ? 'Release for transfer' : 'Discharge & release',
    });
    if (!ok) return;
    const r = attempt(() => api.releaseAllocation(allocId, { outcome }));
    if (r) toast(`${r.patient_code} ${r.outcome.toLowerCase()}. ${r.bed_code} → ${STATUS_LABEL[r.bed_status].toLowerCase()}.`);
  }

  async function confirmAllocation(patientId, bedId, summary) {
    const ok = await confirmDialog({
      title: 'Confirm allocation',
      message: `${summary}<br><br><span class="muted small">This is a rule-based resource match, not a clinical assessment. The system re-checks bed status, type, features and equipment when you confirm.</span>`,
      confirmLabel: 'Confirm allocation',
    });
    if (!ok) return null;
    const r = attempt(() => api.allocate({ patient_id: patientId, bed_id: bedId, confirmed_by: 'Demo Staff' }));
    if (r) toast(`${r.patient_code} allocated to ${r.bed_code}${r.devices.length ? ` with ${r.devices.map((d) => d.equipment_code).join(', ')}` : ''}.`);
    return r;
  }

  function assignToBedModal(bedId) {
    const bed = attempt(() => api.getBed(bedId));
    if (!bed) return;
    const cands = api.bedCandidates(bedId);
    const body = cands.length ? `<p class="muted">Waiting patients checked against <strong>${esc(bed.bed_code)}</strong> (${esc(bed.bed_type)}${bed.features.length ? ', ' + esc(bed.features.join(', ')) : ''}).</p>
      <div class="cand-list">${cands.map((c) => `<div class="cand ${c.eligible ? 'ok' : 'no'}">
        <div class="cand-head"><strong>${esc(c.patient_code)}</strong> · ${esc(c.display_name)} <span class="tag">demo</span><span class="spacer"></span>
          ${c.eligible ? `<button class="btn primary sm" data-pick="${c.patient_id}">Allocate</button>` : '<span class="chip st-MAINTENANCE"><i></i>Not suitable</span>'}</div>
        <ul class="reasons">${c.matches.map((m) => `<li class="ok">${icon('check')}${esc(m)}</li>`).join('')}${c.unmet.map((m) => `<li class="no">${icon('x')}${esc(m)}</li>`).join('')}</ul>
      </div>`).join('')}</div>` : '<div class="empty">No patients are waiting for a bed. Register a patient first.</div>';
    openModal({
      title: `Assign patient to ${bed.bed_code}`, wide: true, body,
      actions: `<button class="btn ghost" data-act="modal-close">Close</button><button class="btn" data-act="register-patient">${icon('plus')}Register patient</button>`,
      onMount(m) {
        m.addEventListener('click', async (e) => {
          const b = e.target.closest('[data-pick]');
          if (!b) return;
          const c = cands.find((x) => x.patient_id === Number(b.dataset.pick));
          await confirmAllocation(c.patient_id, bedId, `Allocate <strong>${esc(c.patient_code)}</strong> to <strong>${esc(bed.bed_code)}</strong> (${esc(bed.ward_name)})${c.devices.length ? ` with ${esc(c.devices.map((d) => d.equipment_code).join(', '))}` : ''}?`);
        });
      },
    });
  }

  function editBedModal(bedId) {
    const bed = attempt(() => api.getBed(bedId));
    if (!bed) return;
    openModal({
      title: `Edit ${bed.bed_code}`,
      body: `<form id="bed-form" class="form">
        <label>Bed type<select name="bed_type">${options(MT.BED_TYPES, bed.bed_type)}</select></label>
        <fieldset><legend>Bed features (fixed fittings)</legend>${checkboxes('features', MT.BED_FEATURES, bed.features)}</fieldset>
        <label>Notes<textarea name="notes" rows="2" maxlength="300">${esc(bed.notes)}</textarea></label>
      </form>`,
      actions: `<button class="btn ghost" data-act="modal-close">Cancel</button><button class="btn primary" form="bed-form" type="submit">Save</button>`,
      onMount(m) {
        $('#bed-form', m).addEventListener('submit', (e) => {
          e.preventDefault();
          const d = formData(e.target);
          const r = attempt(() => api.updateBed(bedId, d));
          if (r) { closeModal(); toast(`${r.bed_code} updated.`); }
        });
      },
    });
  }

  function patientModal(id) {
    const p = id ? attempt(() => api.getPatient(id)) : null;
    if (id && !p) return;
    const locked = p && p.status !== 'WAITING';
    openModal({
      title: p ? `Edit ${p.patient_code}` : 'Register synthetic patient',
      body: `<form id="patient-form" class="form">
        <p class="note">${icon('info')}Use fictional details only. MediTwin is a demo and must not hold real patient information.</p>
        <div class="row2">
          <label>Display name<input name="display_name" required maxlength="60" value="${esc(p ? p.display_name : '')}" placeholder="e.g. Demo Patient"></label>
          <label>Patient code <small>(optional)</small><input name="patient_code" maxlength="16" ${p ? 'disabled' : ''} value="${esc(p ? p.patient_code : '')}" placeholder="auto-generated"></label>
        </div>
        <div class="row2">
          <label>Care category<select name="care_category">${options(MT.CARE_CATEGORIES, p ? p.care_category : 'General Medicine')}</select></label>
          <label>Priority <small>(staff-set, not clinical triage)</small><select name="priority">${options(MT.PRIORITIES, p ? p.priority : 'ROUTINE', { URGENT: 'Urgent', HIGH: 'High', ROUTINE: 'Routine' })}</select></label>
        </div>
        <label>Required bed type<select name="required_bed_type" ${locked ? 'disabled' : ''}>${options(MT.BED_TYPES, p ? p.required_bed_type : 'General')}</select></label>
        <fieldset ${locked ? 'disabled' : ''}><legend>Required equipment (allocated with the bed)</legend>${checkboxes('required_equipment_types', MT.DEVICE_TYPES, p ? p.required_equipment_types : [])}</fieldset>
        <fieldset ${locked ? 'disabled' : ''}><legend>Special requirements (bed features)</legend>${checkboxes('required_bed_features', MT.BED_FEATURES, p ? p.required_bed_features : [])}</fieldset>
        ${locked ? '<p class="muted small">Requirements are locked while the patient is not waiting.</p>' : ''}
        <label>Notes<textarea name="notes" rows="2" maxlength="300">${esc(p ? p.notes : '')}</textarea></label>
      </form>`,
      actions: `<button class="btn ghost" data-act="modal-close">Cancel</button><button class="btn primary" form="patient-form" type="submit">${p ? 'Save' : 'Register patient'}</button>`,
      onMount(m) {
        $('#patient-form', m).addEventListener('submit', (e) => {
          e.preventDefault();
          const d = formData(e.target);
          if (locked) { delete d.required_equipment_types; delete d.required_bed_features; delete d.required_bed_type; }
          const r = attempt(() => (p ? api.updatePatient(p.id, d) : api.createPatient(d)));
          if (!r) return;
          closeModal();
          toast(p ? `${r.patient_code} updated.` : `${r.patient_code} registered. Find a suitable bed next.`);
          if (!p) { S.recs = null; go('patients', { patient: r.id }); }
        });
      },
    });
  }

  function wardModal(id) {
    const w = id ? attempt(() => api.getWard(id)) : null;
    openModal({
      title: w ? `Edit ${w.name}` : 'Add ward',
      body: `<form id="ward-form" class="form">
        <div class="row2">
          <label>Ward name<input name="name" required maxlength="60" value="${esc(w ? w.name : '')}" placeholder="e.g. Ward 3"></label>
          <label>Category<select name="category">${options(MT.WARD_CATEGORIES, w ? w.category : 'General Ward')}</select></label>
        </div>
        <label>Bed code prefix <small>(beds are named PREFIX-001, PREFIX-002 …)</small><input name="bed_code_prefix" maxlength="6" value="${esc(w ? w.bed_code_prefix : '')}" placeholder="auto from name"></label>
        ${w ? `<p class="muted small">Changing the prefix renames all ${w.bed_count} bed codes in this ward. Use “Set bed count” to add or remove beds.</p>` : `
        <div class="row2">
          <label>Number of beds<input name="bed_count" type="number" min="0" max="500" value="20" required></label>
          <label>Bed type for generated beds<select name="bed_type">${options(MT.BED_TYPES, 'General')}</select></label>
        </div>
        <fieldset><legend>Features for generated beds</legend>${checkboxes('features', MT.BED_FEATURES, [])}</fieldset>`}
      </form>`,
      actions: `<button class="btn ghost" data-act="modal-close">Cancel</button><button class="btn primary" form="ward-form" type="submit">${w ? 'Save' : 'Create ward & generate beds'}</button>`,
      onMount(m) {
        const f = $('#ward-form', m);
        const prefix = f.elements.bed_code_prefix;
        if (!w) f.elements.name.addEventListener('input', () => { prefix.placeholder = MT.derivePrefix(f.elements.name.value) || 'auto from name'; });
        f.addEventListener('submit', (e) => {
          e.preventDefault();
          const d = formData(f);
          if (!d.bed_code_prefix) delete d.bed_code_prefix;
          const r = attempt(() => (w ? api.updateWard(w.id, d) : api.createWard(d)));
          if (r) { closeModal(); toast(w ? `${r.name} saved.` : `${r.name} created with ${r.bed_count} beds.`); }
        });
      },
    });
  }

  function resizeWardModal(id) {
    const w = attempt(() => api.getWard(id));
    if (!w) return;
    openModal({
      title: `Set bed count — ${w.name}`,
      body: `<form id="resize-form" class="form">
        <p class="muted">Currently <strong>${w.bed_count}</strong> beds (${esc(w.bed_code_prefix)}-001 … ${esc(w.bed_code_prefix)}-${String(Math.max(w.bed_count, 1)).padStart(3, '0')}). New beds are added at the end. Reducing removes the highest-numbered beds and is blocked if any of them has a patient.</p>
        <label>Bed count<input name="count" type="number" min="0" max="500" value="${w.bed_count}" required></label>
        <div class="row2">
          <label>Type for new beds<select name="bed_type">${options(MT.BED_TYPES, w.category === 'Critical Care' ? 'ICU' : w.category === 'Paediatrics' ? 'Pediatric' : w.category === 'Maternity' ? 'Maternity' : 'General')}</select></label>
        </div>
        <fieldset><legend>Features for new beds</legend>${checkboxes('features', MT.BED_FEATURES, [])}</fieldset>
        <div id="resize-preview" class="preview" aria-live="polite"></div>
      </form>`,
      actions: `<button class="btn ghost" data-act="modal-close">Cancel</button><button class="btn primary" form="resize-form" type="submit">Apply</button>`,
      onMount(m) {
        const f = $('#resize-form', m);
        const prev = $('#resize-preview', m);
        const show = () => {
          const n = Number(f.elements.count.value);
          if (!Number.isInteger(n) || n < 0) { prev.innerHTML = ''; return; }
          if (n > w.bed_count) prev.innerHTML = `${icon('plus')} Adds ${n - w.bed_count} bed(s).`;
          else if (n < w.bed_count) {
            const p = api.previewReduction(w.id, n);
            const nonAvail = p.remove.filter((b) => b.status !== 'AVAILABLE');
            prev.innerHTML = p.blocked.length
              ? `<span class="err">${icon('alert')} Blocked: ${p.blocked.length} of the beds that would be removed are occupied (${esc(p.blocked.slice(0, 10).join(', '))}${p.blocked.length > 10 ? '…' : ''}). Release those patients first.</span>`
              : `${icon('minus')} Removes ${p.remove.length} bed(s): ${esc(p.remove[0].bed_code)} … ${esc(p.remove[p.remove.length - 1].bed_code)}${nonAvail.length ? ` — includes ${nonAvail.length} reserved/cleaning/maintenance bed(s).` : '.'}`;
          } else prev.innerHTML = 'No change.';
        };
        f.elements.count.addEventListener('input', show);
        show();
        f.addEventListener('submit', async (e) => {
          e.preventDefault();
          const d = formData(f);
          const n = Number(d.count);
          if (n < w.bed_count) {
            const p = api.previewReduction(w.id, n);
            if (!p.blocked.length) {
              const ok = await confirmDialog({ title: 'Remove beds?', message: `Remove ${p.remove.length} bed(s) from ${esc(w.name)}? This cannot be undone.`, confirmLabel: 'Remove beds', danger: true });
              if (!ok) return;
            }
          }
          const r = attempt(() => api.generateBeds(w.id, { count: n, bed_type: d.bed_type, features: d.features }));
          if (r) { closeModal(); toast(`${r.name} now has ${r.bed_count} beds.`); }
        });
      },
    });
  }

  async function toggleWard(id) {
    const w = attempt(() => api.getWard(id));
    if (!w) return;
    if (w.is_active) {
      const ok = await confirmDialog({ title: `Deactivate ${w.name}?`, message: 'Inactive wards are hidden from the explorer, totals and recommendations. Their beds are kept.', confirmLabel: 'Deactivate', danger: true });
      if (!ok) return;
    }
    const r = attempt(() => api.updateWard(id, { is_active: !w.is_active }));
    if (r) toast(`${r.name} ${r.is_active ? 'reactivated' : 'deactivated'}.`);
  }

  function equipmentModal(id) {
    const e = id ? attempt(() => api.getEquipment(id)) : null;
    if (id && !e) return;
    const wards = api.listWards();
    const wardOpts = `<option value="pool">Shared pool</option>` + wards.map((w) => `<option value="${w.id}" ${e && e.ward_id === w.id ? 'selected' : ''}>${esc(w.name)}</option>`).join('');
    let body;
    if (!e) {
      body = `<form id="eq-form" class="form">
        <fieldset><legend>Tracking</legend><div class="checks">
          <label class="check"><input type="radio" name="tracking_mode" value="INDIVIDUAL" checked><span>Individual device (has its own ID, allocatable to a bed)</span></label>
          <label class="check"><input type="radio" name="tracking_mode" value="QUANTITY"><span>Counted stock (e.g. 25 wheelchairs)</span></label></div></fieldset>
        <label>Type<select name="equipment_type" id="eq-type">${options(MT.DEVICE_TYPES, 'Monitor')}</select></label>
        <div class="row2">
          <label id="eq-code-l">Equipment code <small>(optional)</small><input name="equipment_code" maxlength="16" placeholder="auto-generated"></label>
          <label id="eq-qty-l" hidden>Quantity<input name="quantity_total" type="number" min="0" max="10000" value="10"></label>
          <label>Location<select name="ward_id">${wardOpts}</select></label>
        </div>
        <label>Notes<textarea name="notes" rows="2" maxlength="300"></textarea></label></form>`;
    } else if (e.tracking_mode === 'INDIVIDUAL') {
      const inUse = e.status === 'IN_USE';
      body = `<form id="eq-form" class="form">
        <p><strong>${esc(e.equipment_code)}</strong> · ${esc(e.equipment_type)} · ${chip(e.status)}</p>
        ${inUse ? `<p class="note">${icon('info')}In use at bed <a href="#/explorer?ward=${e.bed_ward_id}&bed=${e.assigned_bed_id}">${esc(e.bed_code)}</a>. It returns to Available when that patient is released.</p>` : ''}
        <div class="row2">
          <label>Status<select name="status" ${inUse ? 'disabled' : ''}>${inUse ? options(['IN_USE'], 'IN_USE', STATUS_LABEL) : options(['AVAILABLE', 'RESERVED', 'MAINTENANCE'], e.status, STATUS_LABEL)}</select></label>
          <label>Location<select name="ward_id" ${inUse ? 'disabled' : ''}>${wardOpts}</select></label>
        </div>
        <label>Notes<textarea name="notes" rows="2" maxlength="300">${esc(e.notes)}</textarea></label></form>`;
    } else {
      body = `<form id="eq-form" class="form">
        <p><strong>${esc(e.equipment_type)}</strong> stock · ${esc(e.ward_name)}</p>
        <div class="row2">
          <label>Total quantity<input name="quantity_total" type="number" min="0" max="10000" value="${e.quantity_total}"></label>
          <label>Available now<input name="quantity_available" type="number" min="0" max="10000" value="${e.quantity_available}"></label>
        </div>
        <label>Notes<textarea name="notes" rows="2" maxlength="300">${esc(e.notes)}</textarea></label></form>`;
    }
    openModal({
      title: e ? `Edit ${e.equipment_code}` : 'Add equipment', body,
      actions: `<button class="btn ghost" data-act="modal-close">Cancel</button><button class="btn primary" form="eq-form" type="submit">${e ? 'Save' : 'Add equipment'}</button>`,
      onMount(m) {
        const f = $('#eq-form', m);
        if (!e) {
          f.addEventListener('change', (ev) => {
            if (ev.target.name !== 'tracking_mode') return;
            const q = ev.target.value === 'QUANTITY';
            $('#eq-type', m).innerHTML = options(q ? MT.QUANTITY_TYPES : MT.DEVICE_TYPES, '');
            $('#eq-code-l', m).hidden = q;
            $('#eq-qty-l', m).hidden = !q;
          });
        }
        f.addEventListener('submit', (ev) => {
          ev.preventDefault();
          const d = formData(f);
          if (e && e.status === 'IN_USE') { delete d.status; delete d.ward_id; }
          const r = attempt(() => (e ? api.updateEquipment(e.id, d) : api.createEquipment(d)));
          if (r) { closeModal(); toast(`${r.equipment_code} ${e ? 'saved' : 'added'}.`); }
        });
      },
    });
  }

  // ------------------------------------------------------------------ shared fragments
  const statCard = (label, value, status, sub) => `<div class="stat ${status ? 'st-' + status : ''}"><span class="stat-label">${status ? '<i aria-hidden="true"></i>' : ''}${esc(label)}</span><strong>${value}</strong>${sub ? `<small>${sub}</small>` : ''}</div>`;
  const stackBar = (counts, total) => `<div class="stack" role="img" aria-label="${MT.BED_STATUSES.map((s) => `${counts[s]} ${STATUS_LABEL[s].toLowerCase()}`).join(', ')}">${MT.BED_STATUSES.map((s) => (counts[s] ? `<span class="seg st-${s}" style="width:${(counts[s] / total) * 100}%"></span>` : '')).join('')}</div>`;
  function donut(counts, total) {
    const r = 52, c = 2 * Math.PI * r;
    let off = 0;
    const segs = MT.BED_STATUSES.map((s) => {
      const len = total ? (counts[s] / total) * c : 0;
      const seg = len ? `<circle r="${r}" cx="70" cy="70" fill="none" class="dseg st-${s}" stroke-width="18" stroke-dasharray="${len} ${c - len}" stroke-dashoffset="${-off}"/>` : '';
      off += len;
      return seg;
    }).join('');
    return `<svg viewBox="0 0 140 140" class="donut" role="img" aria-label="Bed status breakdown"><g transform="rotate(-90 70 70)"><circle r="${r}" cx="70" cy="70" fill="none" stroke="#edf2f9" stroke-width="18"/>${segs}</g>
      <text x="70" y="68" text-anchor="middle" class="d-num">${total}</text><text x="70" y="88" text-anchor="middle" class="d-lbl">Total beds</text></svg>`;
  }
  const activityList = (items) => (items.length ? `<ul class="activity">${items.map((a) => `<li><span class="act-dot a-${esc(a.action)}" aria-hidden="true"></span><span class="act-msg">${esc(a.message)}</span>${timeTag(a.created_at)}</li>`).join('')}</ul>` : '<div class="empty">No activity yet.</div>');
  const alertIcon = (sev) => icon(sev === 'info' ? 'info' : 'alert', `sev-${sev}`);
  function alertLink(a) {
    if (a.ward_id) return `<button class="link" data-act="go" data-route="explorer" data-params='${JSON.stringify({ ward: a.ward_id })}'>Open ward</button>`;
    if (a.patient_id) return `<button class="link" data-act="go" data-route="patients" data-params='${JSON.stringify({ patient: a.patient_id })}'>Review patient</button>`;
    if (a.equipment_type) return `<button class="link" data-act="go" data-route="equipment" data-params='${JSON.stringify({ type: a.equipment_type })}'>View equipment</button>`;
    if (a.kind === 'MAINTENANCE') return `<button class="link" data-act="go" data-route="beds" data-params='${JSON.stringify({ status: 'MAINTENANCE' })}'>View beds</button>`;
    return '';
  }
  const alertList = (items) => (items.length ? `<ul class="alerts">${items.map((a) => `<li class="sev-${a.severity}">${alertIcon(a.severity)}<div><strong>${esc(a.title)}</strong><small>${esc(a.detail)}</small></div>${alertLink(a)}</li>`).join('')}</ul>` : `<div class="empty ok">${icon('check')} No alerts at current thresholds.</div>`);

  // ------------------------------------------------------------------ pages
  const PAGES = {};

  // ---------------- Dashboard
  PAGES.dashboard = {
    mount(main) {
      main.innerHTML = `<div class="page">
        <div class="page-head"><div><h1>Dashboard</h1><p class="muted">Live totals from stored records · fictional demo data</p></div>
          <div class="head-actions"><button class="btn" data-act="go" data-route="explorer">${icon('cube')}Open 3D Explorer</button><button class="btn primary" data-act="register-patient">${icon('plus')}Register patient</button></div></div>
        <section class="stats" id="d-stats" aria-label="Bed and equipment totals"></section>
        <div class="grid-dash">
          <section class="card" id="d-overview"></section>
          <section class="card" id="d-wards"></section>
          <section class="card" id="d-activity"></section>
          <section class="card" id="d-quick"></section>
          <section class="card" id="d-alerts"></section>
        </div></div>`;
    },
    update() {
      const s = api.summary();
      const b = s.beds;
      const dev = s.equipment.devices;
      $('#d-stats').innerHTML = statCard('Total beds', b.total, null, `${s.wards.length} active wards`) +
        MT.BED_STATUSES.map((st) => statCard(STATUS_LABEL[st], b[st], st, `${pct(b[st], b.total)}% of beds`)).join('') +
        `<div class="stat equip"><span class="stat-label">${icon('monitor')}Devices</span><strong>${dev.AVAILABLE}<small> available</small></strong><small>${dev.IN_USE} in use · ${dev.MAINTENANCE} maintenance · ${dev.RESERVED} reserved</small></div>` +
        `<div class="stat"><span class="stat-label">${icon('user')}Waiting patients</span><strong>${s.patients.WAITING}</strong><small>${s.patients.ALLOCATED} arriving · ${s.patients.ADMITTED} admitted</small></div>`;
      $('#d-overview').innerHTML = `<h2>Bed overview</h2><div class="overview">${donut(b, b.total)}<ul class="legend">${MT.BED_STATUSES.map((st) => `<li><button class="link" data-act="go" data-route="beds" data-params='${JSON.stringify({ status: st })}'><i class="sw st-${st}"></i>${STATUS_LABEL[st]}</button><strong>${b[st]}</strong></li>`).join('')}</ul></div>`;
      $('#d-wards').innerHTML = `<h2>Wards</h2>${s.wards.length ? `<ul class="ward-sum">${s.wards.map((w) => `<li><button class="ward-row" data-act="go" data-route="explorer" data-params='${JSON.stringify({ ward: w.id })}'>
        <span class="wr-name"><strong>${esc(w.name)}</strong><small>${w.bed_count} beds · ${w.counts.AVAILABLE} available · ${w.occupancy_pct}% occupied</small></span>${w.bed_count ? stackBar(w.counts, w.bed_count) : '<span class="muted small">No beds</span>'}${icon('chev')}</button></li>`).join('')}</ul>` : '<div class="empty">No active wards. <a href="#/setup">Add a ward</a>.</div>'}`;
      $('#d-activity').innerHTML = `<div class="card-head"><h2>Recent activity</h2><a class="link" href="#/alerts">View all</a></div>${activityList(api.activity({ limit: 6 }))}`;
      $('#d-quick').innerHTML = `<h2>Quick actions</h2><div class="quick">
        <button class="qa" data-act="register-patient">${icon('user')}Register patient</button>
        <button class="qa" data-act="go" data-route="patients" data-params='{"status":"WAITING"}'>${icon('bed')}Find suitable bed</button>
        <button class="qa" data-act="go" data-route="beds">${icon('list')}View all beds</button>
        <button class="qa" data-act="go" data-route="alerts">${icon('bell')}Check alerts</button></div>`;
      const alerts = api.alerts();
      $('#d-alerts').innerHTML = `<div class="card-head"><h2>Current alerts</h2><a class="link" href="#/alerts">View all (${alerts.length})</a></div>${alertList(alerts.slice(0, 4))}`;
    },
  };

  // ---------------- 3D Explorer
  let stage = null;
  let stagePromise = null;
  let stageFailed = false;
  let lastStageWard = null;
  let thumbs = null; // status -> rendered bed image (data URL)

  const bedThumb = (status, cls) => (thumbs && thumbs[status]
    ? `<img class="${cls || 'thumb'}" src="${thumbs[status]}" alt="">`
    : `<span class="${cls || 'thumb'} thumb-fallback st-${status}" aria-hidden="true">${icon('bed')}</span>`);
  const shortCode = (code) => code.split('-').pop();

  PAGES.explorer = {
    mount(main, params) {
      this.applyParams(params);
      main.innerHTML = `<div class="page explorer">
        <section class="card ward-head">
          <div class="wh-icon" aria-hidden="true">${icon('hospital')}</div>
          <div class="wh-title"><h1 id="ex-title">—</h1><p id="ex-sub"></p></div>
          <div class="wh-chips" id="ex-chips" role="group" aria-label="Filter by status"></div>
        </section>
        <div class="ex-body">
          <aside class="card ward-list" aria-label="Wards">
            <label class="search-field sm"><span class="sr-only">Filter wards</span>${icon('search')}<input id="ex-ward-search" type="search" placeholder="Search ward…" value="${esc(S.wardSearch)}"></label>
            <ul id="ex-wards"></ul>
          </aside>
          <section class="stage-card">
            <div class="stage-wrap">
              <div class="stage" id="stage" tabindex="0" role="application" aria-label="3D bed grid. Drag to rotate, right-drag or shift-drag to pan, scroll to zoom. Arrow keys rotate, plus and minus zoom. Use the List view for a non-3D alternative."></div>
              <div class="stage-tools">
                <label class="sel ward-select"><span class="sr-only">Ward</span><select id="ex-ward-select"></select></label>
                <label class="sel"><span class="sr-only">Status</span><select id="ex-status"><option value="">All statuses</option>${options(MT.BED_STATUSES, S.exFilters.status, STATUS_LABEL)}</select></label>
                <label class="sel"><span class="sr-only">Bed type</span><select id="ex-type"><option value="">All bed types</option>${options(MT.BED_TYPES, S.exFilters.bed_type)}</select></label>
                <div class="seg-toggle" role="group" aria-label="View">
                  <button data-act="view" data-view="3d" aria-pressed="${S.view === '3d'}">${icon('cube')}3D</button>
                  <button data-act="view" data-view="list" aria-pressed="${S.view === 'list'}">${icon('list')}List</button>
                </div>
              </div>
              <div class="place-banner" id="ex-place" hidden></div>
              <div class="stage-msg" id="stage-msg" hidden></div>
              <div class="stage-controls" role="toolbar" aria-label="Camera">
                <button class="icon-btn" data-act="cam" data-cam="in" aria-label="Zoom in">${icon('plus')}</button>
                <button class="icon-btn" data-act="cam" data-cam="out" aria-label="Zoom out">${icon('minus')}</button>
                <button class="icon-btn" data-act="cam" data-cam="right" aria-label="Rotate">${icon('rotr')}</button>
                <button class="icon-btn" data-act="cam" data-cam="reset" aria-label="Reset view">${icon('target')}</button>
                <button class="icon-btn" data-act="cam" data-cam="auto" aria-label="Auto-rotate" aria-pressed="false">${icon('orbit')}</button>
              </div>
              <div class="stage-note">Display grid only — not physical bed locations</div>
              <div class="bed-list" id="ex-list" hidden></div>
            </div>
          </section>
          <aside class="card detail-panel" aria-live="polite">
            <div id="ex-section"></div>
            <label class="search-field sm panel-search"><span class="sr-only">Find bed by ID</span>${icon('search')}<input id="ex-search" type="search" placeholder="Search bed… (Enter to select)" value="${esc(S.exFilters.search)}"></label>
            <div id="ex-bed"></div>
          </aside>
        </div>
        <div class="ex-bottom">
          <section class="card" id="ex-overview"></section>
          <section class="card" id="ex-activity"></section>
          <section class="card" id="ex-quick"></section>
          <section class="card" id="ex-alerts"></section>
        </div></div>`;
      $('#ex-search').addEventListener('input', (e) => { S.exFilters.search = e.target.value; this.update(); });
      $('#ex-search').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); this.findBed(e.target.value); } });
      $('#ex-status').addEventListener('change', (e) => { S.exFilters.status = e.target.value; this.update(); });
      $('#ex-type').addEventListener('change', (e) => { S.exFilters.bed_type = e.target.value; this.update(); });
      $('#ex-ward-search').addEventListener('input', (e) => { S.wardSearch = e.target.value; this.update(); });
      $('#ex-ward-select').addEventListener('change', (e) => this.selectWard(Number(e.target.value)));
      lastStageWard = null;
      if (!thumbs && window.MTScene) window.MTScene.thumbnails().then((t) => { thumbs = t; if (currentPage === this) this.renderPanel(); }).catch(() => {});
      this.ensureStage();
    },
    unmount() {
      if (stage) stage.dispose();
      stage = null; stagePromise = null; lastStageWard = null;
    },
    applyParams(params) {
      if (params.ward && Number(params.ward) !== S.wardId) { S.wardId = Number(params.ward); S.bedId = null; S.group = 0; }
      if (params.bed) { S.bedId = Number(params.bed); S.panelTab = 'details'; this.pendingFocus = true; }
      if (params.status !== undefined) S.exFilters.status = params.status;
      S.placing = params.for ? Number(params.for) : null; // patient being placed from the Patients page
    },
    onParams(params) { this.applyParams(params); },
    ensureStage() {
      if (stage || stagePromise || stageFailed || !window.MTScene) { if (stageFailed || !window.MTScene) this.stageUnavailable(); return; }
      const el = $('#stage');
      $('#stage-msg').hidden = false;
      $('#stage-msg').textContent = 'Loading 3D view…';
      stagePromise = window.MTScene.create(el, {
        onBedClick: (id) => this.selectBed(id, false),
        onGroupClick: (i) => this.selectGroup(i, true),
      }).then((ctrl) => {
        if (!document.contains(el)) { ctrl.dispose(); return; }
        stage = ctrl;
        $('#stage-msg').hidden = true;
        lastStageWard = null;
        this.update();
      }).catch((err) => {
        console.error(err);
        stageFailed = true;
        this.stageUnavailable();
      });
    },
    stageUnavailable() {
      const m = $('#stage-msg');
      if (!m) return;
      m.hidden = false;
      m.innerHTML = `${icon('alert')} The 3D view couldn't load (WebGL unavailable or offline). The list view shows the same beds.`;
      if (S.view !== 'list') { S.view = 'list'; this.syncView(); }
    },
    syncView() {
      $$('[data-act="view"]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === S.view)));
      $('#ex-list').hidden = S.view !== 'list';
      $('.stage-wrap').classList.toggle('list-mode', S.view === 'list');
    },
    selectWard(id) {
      if (id === S.wardId) return;
      S.wardId = id; S.bedId = null; S.group = 0;
      replaceHash('explorer', { for: S.placing, ward: id });
      refresh();
    },
    selectBed(id, focus) {
      const bed = attempt(() => api.getBed(id));
      if (!bed) return;
      S.bedId = id; S.panelTab = 'details';
      S.group = Math.floor(bed.index_in_ward / api.getSettings().group_size);
      replaceHash('explorer', { for: S.placing, ward: S.wardId, bed: id });
      this.pendingFocus = focus;
      this.update();
    },
    selectGroup(i, focus) {
      S.group = i;
      if (S.bedId != null) {
        const idx = this.beds.findIndex((b) => b.id === S.bedId);
        if (Math.floor(idx / this.groupSize) !== i) { S.bedId = null; replaceHash('explorer', { for: S.placing, ward: S.wardId }); }
      }
      if (stage) stage.setActiveGroup(i, { focus });
      this.update();
    },
    findBed(q) {
      const term = q.trim().toLowerCase();
      if (!term) return;
      const beds = api.listBeds({ ward_id: S.wardId });
      const exact = beds.find((b) => b.bed_code.toLowerCase() === term || shortCode(b.bed_code) === term.padStart(3, '0'));
      const hits = beds.filter((b) => b.bed_code.toLowerCase().includes(term));
      const pick = exact || (hits.length === 1 ? hits[0] : null);
      if (pick) { this.selectBed(pick.id, true); toast(`Selected ${pick.bed_code}.`, 'info'); return; }
      const elsewhere = api.search(q).beds.find((b) => b.bed_code.toLowerCase() === term);
      if (elsewhere) { go('explorer', { ward: elsewhere.ward_id, bed: elsewhere.id }); return; }
      toast(hits.length ? `${hits.length} beds match “${q}” — keep typing to narrow it down.` : `No bed with ID “${q}”.`, hits.length ? 'info' : 'err');
    },
    actions: {
      view(el) { S.view = el.dataset.view; PAGES.explorer.syncView(); PAGES.explorer.update(); },
      cam(el) {
        if (!stage) return;
        const c = el.dataset.cam;
        if (c === 'in') stage.zoom(0.8);
        else if (c === 'out') stage.zoom(1.25);
        else if (c === 'right') stage.rotate(-Math.PI / 4);
        else if (c === 'reset') stage.resetView();
        else if (c === 'auto') { stage.setAutoRotate(!stage.autoRotate); el.setAttribute('aria-pressed', String(stage.autoRotate)); }
      },
      'ward-pick': (el) => PAGES.explorer.selectWard(Number(el.dataset.ward)),
      'chip-filter': (el) => { S.exFilters.status = S.exFilters.status === el.dataset.status ? '' : el.dataset.status; $('#ex-status').value = S.exFilters.status; PAGES.explorer.update(); },
      'pick-bed': (el) => PAGES.explorer.selectBed(Number(el.dataset.bed), true),
      'pick-group': (el) => PAGES.explorer.selectGroup(Number(el.dataset.group), true),
      'close-section': () => { S.group = null; S.bedId = null; replaceHash('explorer', { for: S.placing, ward: S.wardId }); if (stage) { stage.setActiveGroup(null); stage.resetView(); } PAGES.explorer.update(); },
      'close-bed': () => { S.bedId = null; replaceHash('explorer', { for: S.placing, ward: S.wardId }); PAGES.explorer.update(); },
      'panel-tab': (el) => { S.panelTab = el.dataset.tab; PAGES.explorer.renderPanel(); },
      'clear-filters': () => { S.exFilters = { status: '', bed_type: '', search: '' }; $('#ex-status').value = ''; $('#ex-type').value = ''; $('#ex-search').value = ''; PAGES.explorer.update(); },
      'place-cancel': () => { S.placing = null; replaceHash('explorer', { for: null, ward: S.wardId, bed: S.bedId }); PAGES.explorer.update(); },
      'place-back': () => go('patients', { patient: S.placing }),
      'place-confirm': async (el) => {
        const pid = S.placing;
        const p = api.getPatient(pid);
        const bed = api.getBed(Number(el.dataset.bed));
        const cand = api.bedCandidates(bed.id).find((c) => c.patient_id === pid);
        const r = await confirmAllocation(pid, bed.id, `Allocate <strong>${esc(p.patient_code)}</strong> (${esc(p.display_name)}) to <strong>${esc(bed.bed_code)}</strong> in ${esc(bed.ward_name)}${cand && cand.devices.length ? ` with ${esc(cand.devices.map((d) => d.equipment_code).join(', '))}` : ''}?`);
        if (r) { S.placing = null; go('patients', { patient: pid }); }
      },
    },
    update() {
      const wards = api.listWards({ include_inactive: false });
      if (!wards.length) {
        $('#ex-title').textContent = 'No active wards';
        $('#ex-sub').innerHTML = 'Add a ward in <a href="#/setup">Setup</a> to generate beds.';
        $('#ex-wards').innerHTML = ''; $('#ex-chips').innerHTML = ''; $('#ex-section').innerHTML = ''; $('#ex-bed').innerHTML = '';
        if (stage) stage.setBeds([], {});
        return;
      }
      if (!wards.some((w) => w.id === S.wardId)) { S.wardId = wards[0].id; S.bedId = null; S.group = 0; }
      const ward = wards.find((w) => w.id === S.wardId);
      const settings = api.getSettings();
      const beds = api.listBeds({ ward_id: ward.id });
      if (S.bedId != null && !beds.some((b) => b.id === S.bedId)) S.bedId = null;
      if (S.group != null && S.group * settings.group_size >= beds.length) S.group = beds.length ? 0 : null;
      this.beds = beds; this.ward = ward; this.groupSize = settings.group_size;

      // Placement mode: highlight every bed that suits the patient being placed.
      let placing = null;
      if (S.placing != null) {
        const p = attempt(() => api.getPatient(S.placing));
        if (p && p.status === 'WAITING') {
          const r = api.recommendations(p.id, { limit: 5000 });
          const byWard = {};
          for (const x of r.recommendations) byWard[x.ward_id] = (byWard[x.ward_id] || 0) + 1;
          placing = { p, eligible: new Set(r.recommendations.map((x) => x.bed_id)), byWard, total: r.eligible_count };
        } else S.placing = null;
      }
      this.placing = placing;

      $('#ex-title').textContent = ward.name;
      const groups = Math.ceil(beds.length / settings.group_size);
      $('#ex-sub').innerHTML = `${ward.bed_count} beds <span class="dot-sep">•</span> ${esc(ward.category)}` + (groups > 1 ? ` <span class="dot-sep">•</span> ${groups} sections` : '');
      $('#ex-chips').innerHTML = MT.BED_STATUSES.map((s) => `<button class="status-chip st-${s} ${S.exFilters.status === s ? 'on' : ''}" data-act="chip-filter" data-status="${s}" aria-pressed="${S.exFilters.status === s}"><span><i aria-hidden="true"></i>${STATUS_LABEL[s]}</span><strong>${ward.counts[s]}</strong></button>`).join('');

      const q = S.wardSearch.trim().toLowerCase();
      $('#ex-wards').innerHTML = wards.filter((w) => !q || w.name.toLowerCase().includes(q)).map((w) => `<li><button class="ward-item ${w.id === ward.id ? 'active' : ''}" data-act="ward-pick" data-ward="${w.id}" ${w.id === ward.id ? 'aria-current="true"' : ''}>
        <span class="wi-icon" aria-hidden="true">${icon('bed')}</span><span class="wi-text"><strong>${esc(w.name)}</strong><small>${w.bed_count} beds${placing ? ` · <b class="${placing.byWard[w.id] ? 'fit-ok' : 'fit-none'}">${placing.byWard[w.id] || 0} suitable</b>` : ''}</small></span>${icon('chev')}</button></li>`).join('') || '<li class="empty sm">No ward matches.</li>';
      $('#ex-ward-select').innerHTML = wards.map((w) => `<option value="${w.id}" ${w.id === ward.id ? 'selected' : ''}>${esc(w.name)} (${w.bed_count})</option>`).join('');

      const f = S.exFilters;
      const filtering = f.status || f.bed_type || f.search.trim();
      const term = f.search.trim().toLowerCase();
      const passes = (b) => (!f.status || b.status === f.status) && (!f.bed_type || b.bed_type === f.bed_type) && (!term || b.bed_code.toLowerCase().includes(term));
      const match = placing ? new Set(beds.filter((b) => placing.eligible.has(b.id) && passes(b)).map((b) => b.id))
        : filtering ? new Set(beds.filter(passes).map((b) => b.id)) : null;
      this.match = match;

      const banner = $('#ex-place');
      if (placing) {
        const p = placing.p;
        const here = placing.byWard[ward.id] || 0;
        const needs = [p.required_bed_type, ...p.required_equipment_types, ...p.required_bed_features].join(' · ');
        banner.hidden = false;
        banner.innerHTML = `<span class="pb-icon" aria-hidden="true">${icon('user')}</span>
          <div><strong>Placing ${esc(p.patient_code)}</strong> <span class="prio p-${p.priority}">${esc({ URGENT: 'Urgent', HIGH: 'High', ROUTINE: 'Routine' }[p.priority])}</span>
          <small>Needs ${esc(needs)} · <b>${here}</b> suitable bed${here === 1 ? '' : 's'} here, ${placing.total} in all wards — highlighted beds fit</small></div>
          <button class="btn sm" data-act="place-back">${icon('user')}Patient</button><button class="icon-btn plain" data-act="place-cancel" aria-label="Stop placing this patient">${icon('x')}</button>`;
      } else banner.hidden = true;

      if (stage) {
        const wardChanged = lastStageWard !== ward.id;
        stage.setBeds(beds, { groupSize: settings.group_size, resetView: wardChanged });
        lastStageWard = ward.id;
        stage.setMatch(match);
        stage.setActiveGroup(S.group);
        stage.select(S.bedId, { focus: !!this.pendingFocus });
        this.pendingFocus = false;
      }
      this.syncView();
      if (S.view === 'list') this.renderList();
      this.renderPanel();
      this.renderBottom();
      if (filtering) {
        $('#stage-msg').hidden = false;
        $('#stage-msg').innerHTML = `${match.size} of ${beds.length} beds match. <button class="link" data-act="clear-filters">Clear filters</button>`;
      } else if (stage) $('#stage-msg').hidden = true;
      $('.stage-wrap').classList.toggle('placing', !!placing);
    },
    renderList() {
      const { beds, groupSize, match } = this;
      if (!beds.length) { $('#ex-list').innerHTML = '<div class="empty">This ward has no beds. Use Setup → Set bed count.</div>'; return; }
      let html = '';
      for (let g = 0; g * groupSize < beds.length; g++) {
        const members = beds.slice(g * groupSize, (g + 1) * groupSize).filter((b) => !match || match.has(b.id));
        if (!members.length) continue;
        html += `<section class="bl-group"><h3><button class="link" data-act="pick-group" data-group="${g}">${esc(groupName(g))}</button><small>visual section</small></h3><div class="tiles">${members.map((b) => `
          <button class="tile st-${b.status} ${b.id === S.bedId ? 'on' : ''}" data-act="pick-bed" data-bed="${b.id}" aria-label="${esc(b.bed_code)}, ${STATUS_LABEL[b.status]}, ${esc(b.bed_type)} bed">
            ${bedThumb(b.status, 'tile-img')}<strong>${esc(b.bed_code)}</strong>${chip(b.status)}</button>`).join('')}</div></section>`;
      }
      $('#ex-list').innerHTML = html || '<div class="empty">No beds match the current filters.</div>';
    },
    renderPanel() {
      const { beds, groupSize, ward } = this;
      if (!ward) return;
      const sec = $('#ex-section');
      if (S.group != null && S.group * groupSize < beds.length) {
        const members = beds.slice(S.group * groupSize, (S.group + 1) * groupSize);
        const c = {}; MT.BED_STATUSES.forEach((s) => (c[s] = members.filter((b) => b.status === s).length));
        sec.innerHTML = `<div class="panel-head"><div><h2>${esc(ward.name)} – ${esc(groupName(S.group))}</h2><p class="muted small">${members.length} beds</p></div><button class="icon-btn plain" data-act="close-section" aria-label="Close section">${icon('x')}</button></div>
          <div class="mini-stats">${MT.BED_STATUSES.map((s) => `<div class="ms st-${s}"><strong>${c[s]}</strong><small>${STATUS_LABEL[s]}</small></div>`).join('')}</div>
          <div class="mini-grid">${members.map((b) => `<button class="mini st-${b.status} ${b.id === S.bedId ? 'on' : ''} ${this.match && !this.match.has(b.id) ? 'dim' : ''}" data-act="pick-bed" data-bed="${b.id}" aria-label="${esc(b.bed_code)}, ${STATUS_LABEL[b.status]}">${bedThumb(b.status, 'mini-img')}<strong>${esc(shortCode(b.bed_code))}</strong><span class="pill st-${b.status}">${STATUS_LABEL[b.status]}</span></button>`).join('')}</div>`;
      } else {
        const groups = Math.ceil(beds.length / groupSize);
        sec.innerHTML = `<div class="panel-head"><div><h2>${esc(ward.name)}</h2><p class="muted small">${beds.length} beds · ${groups} visual sections</p></div></div>
          ${beds.length ? `<ul class="group-list">${Array.from({ length: groups }, (_, g) => {
            const m = beds.slice(g * groupSize, (g + 1) * groupSize);
            const c = {}; MT.BED_STATUSES.forEach((s) => (c[s] = m.filter((b) => b.status === s).length));
            return `<li><button class="group-row" data-act="pick-group" data-group="${g}"><span><strong>${esc(groupName(g))}</strong><small>${esc(m[0].bed_code)}–${esc(shortCode(m[m.length - 1].bed_code))} · ${c.AVAILABLE} available</small></span>${stackBar(c, m.length)}</button></li>`;
          }).join('')}</ul>` : '<div class="empty">No beds in this ward.</div>'}`;
      }
      $('#ex-bed').innerHTML = S.bedId != null ? this.bedCard() : `<div class="bed-empty">${icon('info')}<span>Select a bed in the 3D view or the section above to see details.</span></div>`;
    },
    bedCard() {
      const bed = attempt(() => api.getBed(S.bedId));
      if (!bed) { S.bedId = null; return ''; }
      const gi = Math.floor(bed.index_in_ward / this.groupSize);
      const tabs = ['details', 'equipment', 'patient'];
      const tab = tabs.includes(S.panelTab) ? S.panelTab : 'details';
      let content = '';
      if (tab === 'details') {
        content = `<dl class="kv">
          <dt>Ward</dt><dd>${esc(bed.ward_name)}</dd>
          <dt>Section</dt><dd>${esc(groupName(gi))}</dd>
          <dt>Bed type</dt><dd>${esc(bed.bed_type)} Bed</dd>
          <dt>Features</dt><dd>${bed.features.length ? esc(bed.features.join(', ')) : '<span class="muted">None</span>'}</dd>
          <dt>Patient</dt><dd>${bed.patient ? esc(bed.patient.patient_code) : '<span class="muted">No patient assigned</span>'}</dd>
          <dt>Last updated</dt><dd>${esc(fmtTime(bed.updated_at))}</dd>
          ${bed.notes ? `<dt>Notes</dt><dd>${esc(bed.notes)}</dd>` : ''}</dl>`;
      } else if (tab === 'equipment') {
        content = `<h3 class="sub">Bed features</h3>${bed.features.length ? `<ul class="tags">${bed.features.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>` : '<p class="muted small">No fixed fittings recorded.</p>'}
          <h3 class="sub">Devices assigned</h3>${bed.devices.length ? `<ul class="dev-list">${bed.devices.map((d) => `<li><button class="link" data-act="edit-equipment" data-item="${d.id}">${esc(d.equipment_code)}</button> ${esc(d.equipment_type)} ${chip(d.status)}</li>`).join('')}</ul>` : '<p class="muted small">No devices assigned. Devices are assigned when a patient who needs them is allocated.</p>'}`;
      } else {
        const p = bed.patient;
        content = p ? `<dl class="kv">
            <dt>Patient</dt><dd><button class="link" data-act="go" data-route="patients" data-params='${JSON.stringify({ patient: p.id })}'>${esc(p.patient_code)}</button> · ${esc(p.display_name)} <span class="tag">demo</span></dd>
            <dt>Care category</dt><dd>${esc(p.care_category)}</dd>
            <dt>Needs</dt><dd>${esc(p.required_bed_type)} bed${p.required_equipment_types.length ? ' · ' + esc(p.required_equipment_types.join(', ')) : ''}${p.required_bed_features.length ? ' · ' + esc(p.required_bed_features.join(', ')) : ''}</dd>
            <dt>Allocated</dt><dd>${esc(fmtTime(bed.allocation.assigned_at))}</dd>
            <dt>Admitted</dt><dd>${bed.allocation.admitted_at ? esc(fmtTime(bed.allocation.admitted_at)) : '<span class="muted">Awaiting arrival</span>'}</dd></dl>
          <div class="btn-row">${p.status === 'ALLOCATED'
            ? `<button class="btn sm" data-act="admit" data-alloc="${bed.allocation.id}">${icon('login')}Mark admitted</button>
               <button class="btn sm" data-act="cancel-alloc" data-alloc="${bed.allocation.id}" data-label="${esc(p.patient_code)} → ${esc(bed.bed_code)}">${icon('undo')}Cancel allocation</button>`
            : `<button class="btn sm" data-act="release" data-alloc="${bed.allocation.id}" data-outcome="DISCHARGED" data-label="${esc(p.patient_code)} in ${esc(bed.bed_code)}">${icon('out')}Discharge</button>
               <button class="btn sm" data-act="release" data-alloc="${bed.allocation.id}" data-outcome="TRANSFERRED" data-label="${esc(p.patient_code)} in ${esc(bed.bed_code)}">${icon('out')}Transfer out</button>`}</div>`
          : `<p class="muted small" style="padding:8px 0">No patient assigned.${bed.status === 'AVAILABLE' ? '' : ` This bed is ${STATUS_LABEL[bed.status].toLowerCase()} and can't take a patient until it is marked available.`}</p>`;
      }
      const transitions = bed.allowed_transitions.map((s) => `<button class="btn sm" data-act="bed-status" data-bed="${bed.id}" data-status="${s}"><i class="sw st-${s}"></i>${esc(TRANSITION_LABEL[s])}</button>`).join('');
      const pl = this.placing;
      let placeBox = '';
      if (pl) {
        if (pl.eligible.has(bed.id)) {
          placeBox = `<button class="btn primary block" data-act="place-confirm" data-bed="${bed.id}">${icon('check')}Confirm allocation · ${esc(pl.p.patient_code)}</button>`;
        } else {
          const cand = api.bedCandidates(bed.id).find((c) => c.patient_id === pl.p.id);
          placeBox = `<div class="place-no">${icon('alert')}<div><strong>Not suitable for ${esc(pl.p.patient_code)}</strong><ul>${(cand ? cand.unmet : ['Bed is not available']).map((u) => `<li>${esc(u)}</li>`).join('')}</ul><small>Pick a highlighted bed instead.</small></div></div>`;
        }
      }
      const primary = pl ? placeBox : bed.status === 'AVAILABLE'
        ? `<button class="btn primary block" data-act="assign-to-bed" data-bed="${bed.id}">${icon('user')}Assign Patient</button>`
        : bed.status === 'OCCUPIED' && bed.patient
          ? `<button class="btn primary block" data-act="go" data-route="patients" data-params='${JSON.stringify({ patient: bed.patient.id })}'>${icon('user')}View patient ${esc(bed.patient.patient_code)}</button>`
          : '';
      return `<div class="bed-card">
          <div class="bed-top">
            <div class="bed-art st-${bed.status}">${bedThumb(bed.status, 'art-img')}</div>
            <div class="bed-id"><h2>${esc(bed.bed_code)}</h2><span class="pill solid st-${bed.status}">${icon(bed.status === 'AVAILABLE' ? 'check' : 'info')}${STATUS_LABEL[bed.status]}</span><p>${esc(bed.bed_type)} Bed</p></div>
            <button class="icon-btn plain" data-act="close-bed" aria-label="Close bed details">${icon('x')}</button>
          </div>
          <div class="tabs" role="tablist">${tabs.map((t) => `<button role="tab" aria-selected="${t === tab}" class="${t === tab ? 'on' : ''}" data-act="panel-tab" data-tab="${t}">${t[0].toUpperCase() + t.slice(1)}</button>`).join('')}</div>
          <div class="tab-body" role="tabpanel">${content}</div>
          ${transitions ? `<div class="transitions"><div class="btn-row wrap">${transitions}${bed.status !== 'OCCUPIED' ? `<button class="btn sm ghost" data-act="edit-bed" data-bed="${bed.id}">${icon('edit')}Edit</button>` : ''}</div></div>` : ''}
        </div>
        ${primary ? `<div class="panel-foot">${primary}</div>` : ''}`;
    },
    renderBottom() {
      const w = this.ward;
      $('#ex-overview').innerHTML = `<h2>Ward Overview</h2><div class="overview">${donut(w.counts, w.bed_count)}<ul class="legend">${MT.BED_STATUSES.map((st) => `<li><button class="link" data-act="chip-filter" data-status="${st}"><i class="dotc st-${st}"></i>${STATUS_LABEL[st]}</button><strong>${w.counts[st]}</strong></li>`).join('')}</ul></div>`;
      $('#ex-activity').innerHTML = `<div class="card-head"><h2>Recent Activity</h2><a class="link small" href="#/alerts">View all</a></div>${activityList(api.activity({ limit: 5 }))}`;
      $('#ex-quick').innerHTML = `<h2>Quick Actions</h2><div class="quick">
        <button class="qa" data-act="register-patient">${icon('user')}Register Patient</button>
        <button class="qa" data-act="go" data-route="patients" data-params='{"status":"WAITING"}'>${icon('bed')}Find Suitable Bed</button>
        <button class="qa" data-act="view" data-view="list">${icon('list')}View All Beds</button>
        <button class="qa" data-act="go" data-route="alerts">${icon('bell')}Check Alerts</button></div>`;
      const alerts = api.alerts();
      $('#ex-alerts').innerHTML = `<div class="card-head"><h2>Current Alerts</h2><a class="link small" href="#/alerts">View All</a></div>${alertList(alerts.slice(0, 4))}`;
    },
  };

  // ---------------- Patients (flow command center)
  const STAGE_META = {
    WAITING: { label: 'Waiting', icon: 'clock', note: 'No bed search yet' },
    MATCHING: { label: 'Matching', icon: 'search', note: 'Bed search in progress' },
    ALLOCATED: { label: 'Allocated', icon: 'bed', note: 'Bed held · awaiting arrival' },
    ADMITTED: { label: 'Admitted', icon: 'login', note: 'In bed now' },
  };
  const PRIORITY_LABEL = { URGENT: 'Urgent', HIGH: 'High', ROUTINE: 'Routine' };
  const CARE_ICON = { 'General Medicine': 'steth', 'Surgery Recovery': 'scissors', 'Critical Care': 'heart', Paediatrics: 'smile', Maternity: 'smile', 'Infectious Disease': 'shield' };
  const DEVICE_ICON = { Monitor: 'monitor', Ventilator: 'wind', 'Infusion Pump': 'droplet' };
  const FEATURE_SHORT = { 'Oxygen Outlet': 'O₂', Suction: 'Suction', 'Isolation Capable': 'Isolation', Bariatric: 'Bariatric' };
  const PAGE_SIZE = 24;

  function fmtDur(m) {
    if (m < 60) return `${m}m`;
    if (m < 1440) return `${Math.floor(m / 60)}h ${m % 60}m`;
    return `${Math.floor(m / 1440)}d ${Math.floor((m % 1440) / 60)}h`;
  }
  const needChips = (p, compact) => `<span class="need type">${icon('bed')}${esc(p.required_bed_type)}</span>` +
    p.required_equipment_types.map((d) => `<span class="need dev" title="${esc(d)}">${icon(DEVICE_ICON[d] || 'monitor')}${compact ? '' : esc(d)}</span>`).join('') +
    p.required_bed_features.map((f) => `<span class="need feat" title="${esc(f)}">${esc(compact ? FEATURE_SHORT[f] || f : f)}</span>`).join('');
  const fitLabel = (n) => (n === 0 ? 'No bed fits' : `${n} bed${n === 1 ? '' : 's'} fit`);
  const fitClass = (n) => (n === 0 ? 'none' : n <= 3 ? 'few' : 'ok');

  function patientCard(c, i) {
    const foot = c.bed_code
      ? `<span class="pc-bed" title="${esc(c.bed_code)} · ${esc(c.ward_name || '')}">${icon('bed')}<b>${esc(c.bed_code)}</b></span>`
      : `<span class="pc-fit ${fitClass(c.fit_count)}">${c.fit_count === 0 ? icon('alert') : ''}${fitLabel(c.fit_count)}</span>`;
    return `<button class="pcard pr-${c.priority} ${c.id === S.patientId ? 'on' : ''}" style="--i:${i}" data-act="pick-patient" data-patient="${c.id}"
        aria-label="${esc(c.patient_code)}, ${esc(PRIORITY_LABEL[c.priority])} priority, ${esc(STAGE_META[c.stage].label)}">
      <span class="pc-top"><strong>${esc(c.patient_code)}</strong><span class="prio p-${c.priority}">${PRIORITY_LABEL[c.priority]}</span></span>
      <span class="pc-name">${esc(c.display_name)}</span>
      <span class="pc-cat">${icon(CARE_ICON[c.care_category] || 'user')}${esc(c.care_category)}</span>
      <span class="pc-needs">${needChips(c, true)}</span>
      <span class="pc-foot"><span class="pc-time" title="${esc(fmtTime(c.since))}">${icon('clock')}${fmtDur(c.minutes)}</span>${foot}</span>
    </button>`;
  }

  PAGES.patients = {
    mount(main, params) {
      S.pf = S.pf || { search: '', care: '', bed_type: '', priority: '', ward_id: '', stage: '', page: 1 };
      this.applyParams(params);
      const wards = api.listWards({ include_inactive: false });
      const f = S.pf;
      main.innerHTML = `<div class="page pflow">
        <div class="page-head"><div><h1>Patient Flow</h1><p class="muted">Live from stored records · fictional demo patients · priority is staff-set, not clinical triage</p></div>
          <div class="head-actions"><button class="btn primary" data-act="register-patient">${icon('plus')}Register patient</button></div></div>
        <section class="flow-strip" id="pf-strip" aria-label="Patient flow stages"></section>
        <section class="card pf-toolbar">
          <div class="pf-tabs" id="pf-tabs" role="tablist" aria-label="Stage"></div>
          <div class="pf-filters">
            <label class="search-field sm grow"><span class="sr-only">Search patients</span>${icon('search')}<input id="pf-search" type="search" placeholder="Search patient code, name or bed…" value="${esc(f.search)}"></label>
            <label class="sel"><span class="sr-only">Priority</span><select id="pf-priority"><option value="">Any priority</option>${options(MT.PRIORITIES, f.priority, PRIORITY_LABEL)}</select></label>
            <label class="sel"><span class="sr-only">Care category</span><select id="pf-care"><option value="">All care categories</option>${options(MT.CARE_CATEGORIES, f.care)}</select></label>
            <label class="sel"><span class="sr-only">Bed type needed</span><select id="pf-type"><option value="">Any bed type</option>${options(MT.BED_TYPES, f.bed_type)}</select></label>
            <label class="sel"><span class="sr-only">Ward of assigned bed</span><select id="pf-ward"><option value="">Any ward (bed)</option>${wards.map((w) => `<option value="${w.id}" ${String(w.id) === String(f.ward_id) ? 'selected' : ''}>${esc(w.name)}</option>`).join('')}</select></label>
          </div>
        </section>
        <div class="pf-main">
          <section id="pf-board" aria-live="polite"></section>
          <aside class="card pf-detail" id="pf-detail" aria-live="polite"></aside>
        </div></div>`;
      const set = (k) => (e) => { S.pf[k] = e.target.value; S.pf.page = 1; this.update(); };
      $('#pf-search').addEventListener('input', set('search'));
      $('#pf-priority').addEventListener('change', set('priority'));
      $('#pf-care').addEventListener('change', set('care'));
      $('#pf-type').addEventListener('change', set('bed_type'));
      $('#pf-ward').addEventListener('change', set('ward_id'));
      if (!thumbs && window.MTScene) window.MTScene.thumbnails().then((t) => { thumbs = t; if (currentPage === this) this.renderDetail(); }).catch(() => {});
      if (params.register) setTimeout(() => patientModal(), 0);
    },
    applyParams(params) {
      if (params.patient && Number(params.patient) !== S.patientId) S.patientId = Number(params.patient);
      const st = params.stage || (params.status === 'WAITING' ? 'WAITING' : params.status === 'ALLOCATED' ? 'ALLOCATED' : undefined);
      if (st !== undefined && S.pf) { S.pf.stage = MT.FLOW_STAGES.includes(st) ? st : ''; S.pf.page = 1; }
    },
    onParams(params) { this.applyParams(params); },
    hash() { replaceHash('patients', { patient: S.patientId, stage: S.pf.stage }); },
    actions: {
      'pick-patient': (el) => { S.patientId = Number(el.dataset.patient); PAGES.patients.hash(); PAGES.patients.update(); },
      'close-patient': () => { S.patientId = null; PAGES.patients.hash(); PAGES.patients.update(); },
      'pf-stage': (el) => { const s = el.dataset.stage || ''; S.pf.stage = S.pf.stage === s ? '' : s; S.pf.page = 1; PAGES.patients.hash(); PAGES.patients.update(); },
      'pf-page': (el) => { S.pf.page = Number(el.dataset.page); PAGES.patients.renderBoard(); $('#pf-board').scrollIntoView({ block: 'nearest' }); },
      'pf-clear': () => {
        Object.assign(S.pf, { search: '', care: '', bed_type: '', priority: '', ward_id: '', page: 1 });
        ['#pf-search', '#pf-priority', '#pf-care', '#pf-type', '#pf-ward'].forEach((s) => { $(s).value = ''; });
        PAGES.patients.update();
      },
      'start-match': (el) => {
        const r = attempt(() => api.startMatching(Number(el.dataset.patient)));
        if (r) toast(`Bed search started for ${r.patient_code}.`, 'info');
      },
      'stop-match': (el) => {
        const r = attempt(() => api.stopMatching(Number(el.dataset.patient)));
        if (r) toast(`${r.patient_code} moved back to Waiting.`, 'info');
      },
      'place-3d': (el) => go('explorer', { ward: el.dataset.ward, bed: el.dataset.bed || '', for: el.dataset.patient }),
      'choose-bed': async (el) => {
        const p = api.getPatient(Number(el.dataset.patient));
        const rec = api.recommendations(p.id, { limit: 500 }).recommendations.find((x) => x.bed_id === Number(el.dataset.bed));
        if (!rec) { toast('That bed is no longer suitable. The list has been refreshed.', 'err'); refresh(); return; }
        await confirmAllocation(p.id, rec.bed_id, `Allocate <strong>${esc(p.patient_code)}</strong> (${esc(p.display_name)}) to <strong>${esc(rec.bed_code)}</strong> in ${esc(rec.ward_name)}${rec.devices.length ? ` with ${esc(rec.devices.map((d) => d.equipment_code).join(', '))}` : ''}?`);
      },
    },
    update() { this.renderStrip(); this.renderBoard(); this.renderDetail(); },
    query(extra) {
      const f = S.pf;
      return Object.assign({ search: f.search, care_category: f.care, bed_type: f.bed_type, priority: f.priority, ward_id: f.ward_id }, extra || {});
    },
    renderStrip() {
      const flow = api.patientFlow(this.query({ per_column: 0 }));
      this.flow = flow;
      const { totals, stats, filtered_counts: fc } = flow;
      const sub = {
        WAITING: totals.WAITING ? `Longest wait ${fmtDur(stats.longest_minutes.WAITING)}` : 'Nobody waiting',
        MATCHING: totals.MATCHING ? `Longest search ${fmtDur(stats.longest_minutes.MATCHING)}` : 'No active searches',
        ALLOCATED: totals.ALLOCATED ? `Oldest hold ${fmtDur(stats.longest_minutes.ALLOCATED)}` : 'No beds on hold',
        ADMITTED: `${stats.released_today} discharged or transferred today`,
      };
      $('#pf-strip').innerHTML = MT.FLOW_STAGES.map((s, i) => `${i ? '<span class="flow-arrow" aria-hidden="true"><i></i></span>' : ''}
        <button class="stage-tile sg-${s} ${S.pf.stage === s ? 'on' : ''}" data-act="pf-stage" data-stage="${s}" aria-pressed="${S.pf.stage === s}">
          <span class="sg-icon" aria-hidden="true">${icon(STAGE_META[s].icon)}</span>
          <span class="sg-body"><small>${STAGE_META[s].label}</small><strong>${totals[s]}</strong><em>${esc(sub[s])}</em></span>
          ${stats.no_fit[s] ? `<span class="sg-flag none">${icon('alert')}${stats.no_fit[s]} no bed fits</span>`
            : s === 'WAITING' && stats.urgent_waiting ? `<span class="sg-flag urgent">${stats.urgent_waiting} urgent</span>` : ''}
        </button>`).join('');
      const filtering = ['search', 'care', 'bed_type', 'priority', 'ward_id'].some((k) => S.pf[k]);
      $('#pf-tabs').innerHTML = `<button role="tab" class="pf-tab ${!S.pf.stage ? 'on' : ''}" aria-selected="${!S.pf.stage}" data-act="pf-stage" data-stage="">Board<span>${MT.FLOW_STAGES.reduce((n, s) => n + fc[s], 0)}</span></button>` +
        MT.FLOW_STAGES.map((s) => `<button role="tab" class="pf-tab sg-${s} ${S.pf.stage === s ? 'on' : ''}" aria-selected="${S.pf.stage === s}" data-act="pf-stage" data-stage="${s}"><i aria-hidden="true"></i>${STAGE_META[s].label}<span>${fc[s]}</span></button>`).join('') +
        (filtering ? `<button class="link pf-clear" data-act="pf-clear">${icon('x')}Clear filters</button>` : '');
    },
    renderBoard() {
      const board = $('#pf-board');
      const st = S.pf.stage;
      if (!st) {
        const flow = api.patientFlow(this.query({ per_column: 5 }));
        board.className = 'pf-board';
        board.innerHTML = MT.FLOW_STAGES.map((s) => {
          const cards = flow.columns[s];
          const n = flow.filtered_counts[s];
          return `<section class="pf-col sg-${s}" aria-label="${STAGE_META[s].label}">
            <header><span class="sg-dot" aria-hidden="true">${icon(STAGE_META[s].icon)}</span><div><h2>${STAGE_META[s].label}</h2><small>${STAGE_META[s].note}</small></div><span class="pf-count">${n}</span></header>
            <div class="pf-cards">${cards.length ? cards.map(patientCard).join('') : `<div class="pf-empty">${icon('check')}<span>No patients here${n === 0 && flow.totals[s] ? ' match the filters' : ''}.</span></div>`}</div>
            ${n > cards.length ? `<button class="pf-more" data-act="pf-stage" data-stage="${s}">View all ${n} ${icon('arrow')}</button>` : ''}
          </section>`;
        }).join('');
        return;
      }
      const res = api.patientFlow(this.query({ stage: st, page: S.pf.page, page_size: PAGE_SIZE }));
      S.pf.page = res.page;
      const first = (res.page - 1) * PAGE_SIZE + 1;
      board.className = 'pf-focus';
      board.innerHTML = `<div class="pf-focus-head sg-${st}">
          <span class="sg-dot" aria-hidden="true">${icon(STAGE_META[st].icon)}</span>
          <div><h2>${STAGE_META[st].label}</h2><small>${res.total ? `Showing ${first}–${first + res.items.length - 1} of ${res.total}` : 'No patients'} · ${esc(STAGE_META[st].note)}</small></div>
          <button class="btn sm ghost" data-act="pf-stage" data-stage="">${icon('layers')}Back to board</button>
        </div>
        ${res.items.length ? `<div class="pf-grid">${res.items.map(patientCard).join('')}</div>` : `<div class="pf-empty big">${icon('check')}<span>No ${STAGE_META[st].label.toLowerCase()} patients match these filters.</span></div>`}
        ${res.pages > 1 ? `<nav class="pager" aria-label="Pages">
          <button class="btn sm" data-act="pf-page" data-page="${res.page - 1}" ${res.page <= 1 ? 'disabled' : ''}>‹ Prev</button>
          ${pageNumbers(res.page, res.pages).map((n) => (n === '…' ? '<span class="gap">…</span>' : `<button class="pg ${n === res.page ? 'on' : ''}" data-act="pf-page" data-page="${n}" ${n === res.page ? 'aria-current="page"' : ''}>${n}</button>`)).join('')}
          <button class="btn sm" data-act="pf-page" data-page="${res.page + 1}" ${res.page >= res.pages ? 'disabled' : ''}>Next ›</button></nav>` : ''}`;
    },
    renderDetail() {
      const panel = $('#pf-detail');
      if (!panel) return;
      if (S.patientId == null) { panel.innerHTML = this.overviewPanel(); return; }
      const p = attempt(() => api.getPatient(S.patientId));
      if (!p) { S.patientId = null; panel.innerHTML = this.overviewPanel(); return; }
      const stage = p.stage;
      const steps = [
        ['Registered', p.created_at, true],
        ['Matching', p.match_started_at || (p.allocation ? p.allocation.assigned_at : null), stage !== 'WAITING'],
        ['Allocated', p.allocation ? p.allocation.assigned_at : null, stage === 'ALLOCATED' || stage === 'ADMITTED'],
        ['Admitted', p.allocation ? p.allocation.admitted_at : null, stage === 'ADMITTED'],
      ];
      const curIdx = { WAITING: 0, MATCHING: 1, ALLOCATED: 2, ADMITTED: 3 }[stage];
      const sinceIso = stage === 'WAITING' ? p.created_at : stage === 'MATCHING' ? p.match_started_at : stage === 'ALLOCATED' ? p.allocation.assigned_at : stage === 'ADMITTED' ? p.allocation.admitted_at : p.updated_at;
      const mins = Math.max(0, Math.round((Date.now() - Date.parse(sinceIso)) / 60000));
      const clockLabel = { WAITING: 'Waiting for', MATCHING: 'Searching for', ALLOCATED: 'Bed held for', ADMITTED: 'In bed for' }[stage];

      let html = `<div class="pd-head">
          <div class="pd-id"><div class="pd-badge sg-${stage === 'CLOSED' ? 'CLOSED' : stage}" aria-hidden="true">${icon(stage === 'CLOSED' ? 'out' : STAGE_META[stage].icon)}</div>
            <div><h2>${esc(p.patient_code)} <span class="tag">demo</span></h2><p>${esc(p.display_name)}</p></div></div>
          <button class="icon-btn plain" data-act="close-patient" aria-label="Close patient details">${icon('x')}</button>
        </div>
        <div class="pd-pills"><span class="stage-pill sg-${stage}">${stage === 'CLOSED' ? esc(STATUS_LABEL[p.status]) : STAGE_META[stage].label}</span><span class="prio p-${p.priority}">${PRIORITY_LABEL[p.priority]} priority</span><span class="pd-care">${icon(CARE_ICON[p.care_category] || 'user')}${esc(p.care_category)}</span></div>`;
      if (stage !== 'CLOSED') {
        html += `<div class="pd-clock"><div><small>${clockLabel}</small><strong>${fmtDur(mins)}</strong></div>
          <ol class="stepper">${steps.map(([label, t, done], i) => `<li class="${done ? 'done' : ''} ${i === curIdx ? 'cur' : ''}"><i aria-hidden="true"></i><span>${label}</span><small>${t && done ? esc(fmtTime(t)) : '—'}</small></li>`).join('')}</ol></div>`;
      }
      html += `<h3 class="sub">Care requirements</h3><div class="req-grid">
          <div class="req">${icon('bed')}<small>Bed type</small><strong>${esc(p.required_bed_type)}</strong></div>
          <div class="req">${icon('monitor')}<small>Devices</small><strong>${p.required_equipment_types.length ? esc(p.required_equipment_types.join(', ')) : 'None'}</strong></div>
          <div class="req">${icon('shield')}<small>Bed features</small><strong>${p.required_bed_features.length ? esc(p.required_bed_features.join(', ')) : 'None'}</strong></div>
        </div>${p.notes ? `<p class="pd-notes">${esc(p.notes)}</p>` : ''}`;

      if (stage === 'WAITING') {
        html += `<div class="pd-callout ${fitClass(p.fit_count)}">${icon(p.fit_count ? 'check' : 'alert')}<div><strong>${fitLabel(p.fit_count)} right now</strong><small>${p.fit_count ? 'Start a bed search to review the best matches and place this patient.' : 'No active, available bed meets every requirement. Start a search to see what is missing.'}</small></div></div>
          <div class="pd-actions"><button class="btn primary" data-act="start-match" data-patient="${p.id}">${icon('search')}Find suitable beds</button><button class="btn ghost" data-act="edit-patient" data-patient="${p.id}">${icon('edit')}Edit</button></div>`;
      } else if (stage === 'MATCHING') {
        html += this.matchHtml(p);
      } else if (stage === 'ALLOCATED' || stage === 'ADMITTED') {
        const bed = p.bed;
        html += `<h3 class="sub">${stage === 'ALLOCATED' ? 'Bed held for this patient' : 'Current bed'}</h3>
          <div class="pd-bed"><div class="bed-art st-OCCUPIED">${bedThumb('OCCUPIED', 'art-img')}</div>
            <div><strong>${esc(bed.bed_code)}</strong><small>${esc(p.ward_name)} · ${esc(bed.bed_type)} bed</small>
            ${p.devices.length ? `<small>${icon('monitor')}${esc(p.devices.map((d) => d.equipment_code).join(', '))}</small>` : ''}</div>
            <button class="btn sm ghost" data-act="open-bed" data-bed="${bed.id}" data-ward="${bed.ward_id}">${icon('cube')}Open in 3D</button></div>
          <div class="pd-actions">${stage === 'ALLOCATED'
            ? `<button class="btn primary" data-act="admit" data-alloc="${p.allocation.id}" data-label="${esc(p.patient_code)}">${icon('login')}Mark admitted</button>
               <button class="btn" data-act="cancel-alloc" data-alloc="${p.allocation.id}" data-label="${esc(p.patient_code)} → ${esc(bed.bed_code)}">${icon('undo')}Cancel allocation</button>`
            : `<button class="btn" data-act="release" data-alloc="${p.allocation.id}" data-outcome="DISCHARGED" data-label="${esc(p.patient_code)} in ${esc(bed.bed_code)}">${icon('out')}Discharge</button>
               <button class="btn" data-act="release" data-alloc="${p.allocation.id}" data-outcome="TRANSFERRED" data-label="${esc(p.patient_code)} in ${esc(bed.bed_code)}">${icon('out')}Transfer out</button>`}
            <button class="btn ghost" data-act="edit-patient" data-patient="${p.id}">${icon('edit')}Edit</button></div>`;
      } else {
        html += `<div class="pd-callout">${icon('info')}<div><strong>${esc(STATUS_LABEL[p.status])}</strong><small>This patient has left the flow. Their history is kept below.</small></div></div>`;
      }
      if (p.history.length) {
        html += `<h3 class="sub">Allocation history</h3><ul class="history">${p.history.slice().reverse().map((a) => `<li>${chip(a.status)} <strong>${esc(a.bed_code)}</strong> · ${esc(fmtTime(a.assigned_at))}${a.released_at ? ` → ${esc(fmtTime(a.released_at))} (${esc((a.outcome || '').toLowerCase())})` : ''}</li>`).join('')}</ul>`;
      }
      panel.innerHTML = html;
    },
    matchHtml(p) {
      const r = attempt(() => api.recommendations(p.id, { limit: 6 }));
      if (!r) return '';
      const rejected = r.rejected_summary.length ? `<details class="rejected" ${r.eligible_count ? '' : 'open'}><summary>Why other beds were excluded</summary><ul>${r.rejected_summary.map((x) => `<li><strong>${x.count}</strong> ${esc(x.reason)}</li>`).join('')}</ul></details>` : '';
      const head = `<div class="pd-match-head"><h3 class="sub">Suitable beds</h3><span class="muted small">${r.eligible_count} found · ranked by resource fit, not clinical score</span></div>`;
      const actions = `<div class="pd-actions">
          ${r.recommendations.length ? `<button class="btn" data-act="place-3d" data-patient="${p.id}" data-ward="${r.recommendations[0].ward_id}">${icon('cube')}See all in 3D</button>` : ''}
          <button class="btn ghost" data-act="stop-match" data-patient="${p.id}">${icon('pause')}Pause search</button>
          <button class="btn ghost" data-act="edit-patient" data-patient="${p.id}">${icon('edit')}Edit</button></div>`;
      if (!r.eligible_count) {
        return `${head}<div class="pd-callout none">${icon('alert')}<div><strong>No suitable bed found</strong><small>Change a requirement, free a bed, or add capacity in Setup.</small></div></div>${rejected}${actions}`;
      }
      return `${head}<ol class="rec-cards">${r.recommendations.map((x, i) => `<li class="rec-card" style="--i:${i}">
          <div class="rc-top"><span class="rank">#${x.rank}</span><div class="rc-id"><strong>${esc(x.bed_code)}</strong><small>${esc(x.ward_name)} · ${esc(x.bed_type)}</small></div>
            <button class="btn sm ghost" data-act="place-3d" data-patient="${p.id}" data-ward="${x.ward_id}" data-bed="${x.bed_id}" title="Show ${esc(x.bed_code)} in the 3D explorer">${icon('cube')}3D</button>
            <button class="btn sm primary" data-act="choose-bed" data-patient="${p.id}" data-bed="${x.bed_id}">Allocate</button></div>
          <ul class="rc-why">${x.matches.map((m) => `<li>${icon('check')}${esc(m)}</li>`).join('')}</ul></li>`).join('')}</ol>
        ${r.eligible_count > r.recommendations.length ? `<p class="muted small">Top ${r.recommendations.length} of ${r.eligible_count}. Use “See all in 3D” to browse every suitable bed.</p>` : ''}${rejected}${actions}`;
    },
    overviewPanel() {
      const flow = this.flow || api.patientFlow({ per_column: 0 });
      const urgent = api.patientFlow({ stage: 'WAITING', priority: 'URGENT', page_size: 3 }).items
        .concat(api.patientFlow({ stage: 'MATCHING', priority: 'URGENT', page_size: 3 }).items);
      const stuck = api.patientFlow({ stage: 'MATCHING', page_size: 200 }).items.concat(api.patientFlow({ stage: 'WAITING', page_size: 200 }).items).filter((c) => c.fit_count === 0).slice(0, 4);
      const mini = (c) => `<button class="pd-mini" data-act="pick-patient" data-patient="${c.id}"><strong>${esc(c.patient_code)}</strong><span>${esc(STAGE_META[c.stage].label)} · ${fmtDur(c.minutes)}</span><span class="prio p-${c.priority}">${PRIORITY_LABEL[c.priority]}</span></button>`;
      return `<div class="pd-head"><div class="pd-id"><div class="pd-badge sg-MATCHING" aria-hidden="true">${icon('activity')}</div><div><h2>Command summary</h2><p>Select a patient card for details and actions</p></div></div></div>
        <div class="pd-sum">
          <div><strong>${flow.totals.WAITING + flow.totals.MATCHING}</strong><small>need a bed</small></div>
          <div><strong>${flow.totals.ALLOCATED}</strong><small>arriving</small></div>
          <div><strong>${flow.totals.ADMITTED}</strong><small>in beds</small></div>
        </div>
        <h3 class="sub">Urgent and waiting</h3>${urgent.length ? `<div class="pd-minis">${urgent.map(mini).join('')}</div>` : '<p class="muted small">No urgent patients are waiting.</p>'}
        <h3 class="sub">No bed fits right now</h3>${stuck.length ? `<div class="pd-minis">${stuck.map(mini).join('')}</div>` : '<p class="muted small">Every waiting patient has at least one suitable bed.</p>'}
        <p class="pd-foot-note">${icon('info')}Patients are shown as cards, never as figures. Board columns show the first 5 per stage — open a stage to page through everyone.</p>`;
    },
  };

  function pageNumbers(cur, total) {
    const out = [];
    for (let n = 1; n <= total; n++) {
      if (n === 1 || n === total || Math.abs(n - cur) <= 1) out.push(n);
      else if (out[out.length - 1] !== '…') out.push('…');
    }
    return out;
  }

  // ---------------- Beds & Resources (2D list)
  PAGES.beds = {
    mount(main, params) {
      if (params.status !== undefined) S.bedsFilters.status = params.status;
      const wards = api.listWards({ include_inactive: false });
      const f = S.bedsFilters;
      main.innerHTML = `<div class="page">
        <div class="page-head"><div><h1>Beds &amp; Resources</h1><p class="muted">List view of every bed — a fast, non-3D alternative to the explorer</p></div></div>
        <section class="card">
          <div class="filters">
            <label class="search-field sm grow"><span class="sr-only">Search bed ID</span>${icon('search')}<input id="b-search" type="search" placeholder="Search bed ID…" value="${esc(f.search)}"></label>
            <label class="sel"><span class="sr-only">Ward</span><select id="b-ward"><option value="">All wards</option>${wards.map((w) => `<option value="${w.id}" ${String(w.id) === String(f.ward_id) ? 'selected' : ''}>${esc(w.name)}</option>`).join('')}</select></label>
            <label class="sel"><span class="sr-only">Status</span><select id="b-status"><option value="">All statuses</option>${options(MT.BED_STATUSES, f.status, STATUS_LABEL)}</select></label>
            <label class="sel"><span class="sr-only">Bed type</span><select id="b-type"><option value="">All bed types</option>${options(MT.BED_TYPES, f.bed_type)}</select></label>
          </div>
          <div id="b-summary" class="filter-summary"></div>
          <div class="table-wrap" id="b-table"></div>
        </section></div>`;
      const bind = (id, key, ev) => $(id).addEventListener(ev || 'change', (e) => { S.bedsFilters[key] = e.target.value; this.update(); });
      bind('#b-search', 'search', 'input'); bind('#b-ward', 'ward_id'); bind('#b-status', 'status'); bind('#b-type', 'bed_type');
    },
    update() {
      const beds = api.listBeds(S.bedsFilters);
      const c = {}; MT.BED_STATUSES.forEach((s) => (c[s] = beds.filter((b) => b.status === s).length));
      $('#b-summary').innerHTML = `<strong>${beds.length}</strong> beds · ${MT.BED_STATUSES.map((s) => `${chip(s)} ${c[s]}`).join(' ')}`;
      const shown = beds.slice(0, 400);
      $('#b-table').innerHTML = beds.length ? `<table class="table"><thead><tr><th>Bed ID</th><th>Ward</th><th>Type</th><th>Features</th><th>Status</th><th>Patient</th><th>Updated</th><th><span class="sr-only">Actions</span></th></tr></thead><tbody>
        ${shown.map((b) => `<tr><td><strong>${esc(b.bed_code)}</strong></td><td>${esc(b.ward_name)}</td><td>${esc(b.bed_type)}</td><td class="small">${esc(b.features.join(', ')) || '—'}</td><td>${chip(b.status)}</td><td>${esc(b.patient_code || '—')}</td><td class="small">${timeTag(b.updated_at)}</td>
          <td><button class="btn sm ghost" data-act="open-bed" data-bed="${b.id}" data-ward="${b.ward_id}">${icon('cube')}View</button></td></tr>`).join('')}</tbody></table>
        ${beds.length > shown.length ? `<p class="muted small table-foot">Showing first ${shown.length} of ${beds.length}. Narrow with filters.</p>` : ''}` : '<div class="empty">No beds match these filters.</div>';
    },
  };

  // ---------------- Equipment
  PAGES.equipment = {
    mount(main, params) {
      if (params.type !== undefined) S.eqFilters.type = params.type;
      const wards = api.listWards();
      const f = S.eqFilters;
      main.innerHTML = `<div class="page">
        <div class="page-head"><div><h1>Equipment</h1><p class="muted">Individually tracked devices are allocated with beds; counted stock is tracked by quantity</p></div>
          <div class="head-actions"><button class="btn primary" data-act="add-equipment">${icon('plus')}Add equipment</button></div></div>
        <section class="stats" id="e-stats"></section>
        <section class="card">
          <div class="filters">
            <label class="search-field sm grow"><span class="sr-only">Search equipment</span>${icon('search')}<input id="e-search" type="search" placeholder="Search equipment ID or type…" value="${esc(f.search)}"></label>
            <label class="sel"><span class="sr-only">Location</span><select id="e-ward"><option value="">All locations</option><option value="pool" ${f.ward_id === 'pool' ? 'selected' : ''}>Shared pool</option>${wards.map((w) => `<option value="${w.id}" ${String(w.id) === String(f.ward_id) ? 'selected' : ''}>${esc(w.name)}</option>`).join('')}</select></label>
            <label class="sel"><span class="sr-only">Type</span><select id="e-type"><option value="">All types</option>${options([...MT.DEVICE_TYPES, ...MT.QUANTITY_TYPES], f.type)}</select></label>
            <label class="sel"><span class="sr-only">Status</span><select id="e-status"><option value="">All statuses</option>${options(MT.EQUIPMENT_STATUSES, f.status, STATUS_LABEL)}</select></label>
          </div>
          <div class="table-wrap" id="e-table"></div>
        </section></div>`;
      const bind = (id, key, ev) => $(id).addEventListener(ev || 'change', (e) => { S.eqFilters[key] = e.target.value; this.update(); });
      bind('#e-search', 'search', 'input'); bind('#e-ward', 'ward_id'); bind('#e-type', 'type'); bind('#e-status', 'status');
      if (params.item) setTimeout(() => equipmentModal(Number(params.item)), 0);
    },
    update() {
      const s = api.summary();
      const min = api.getSettings().equipment_min_available;
      $('#e-stats').innerHTML = MT.DEVICE_TYPES.map((t) => {
        const x = s.equipment.by_type[t];
        const low = x.AVAILABLE < (min[t] || 0);
        return `<div class="stat ${low ? 'warn' : ''}"><span class="stat-label">${icon('monitor')}${esc(t)}s</span><strong>${x.AVAILABLE}<small> / ${x.total} available</small></strong><small>${x.IN_USE} in use · ${x.MAINTENANCE} maintenance${x.RESERVED ? ` · ${x.RESERVED} reserved` : ''}${low ? ` · below minimum ${min[t]}` : ''}</small></div>`;
      }).join('') + s.equipment.stock.map((q) => `<div class="stat"><span class="stat-label">${icon('layers')}${esc(q.equipment_type)} stock</span><strong>${q.quantity_available}<small> / ${q.quantity_total}</small></strong><small>counted, not individually tracked</small></div>`).join('');
      const list = api.listEquipment(S.eqFilters);
      $('#e-table').innerHTML = list.length ? `<table class="table"><thead><tr><th>ID</th><th>Type</th><th>Tracking</th><th>Location</th><th>Status</th><th>Assigned bed</th><th>Notes</th><th><span class="sr-only">Actions</span></th></tr></thead><tbody>
        ${list.map((e) => `<tr><td><strong>${esc(e.equipment_code)}</strong></td><td>${esc(e.equipment_type)}</td><td class="small">${e.tracking_mode === 'INDIVIDUAL' ? 'Individual' : `Quantity · ${e.quantity_available}/${e.quantity_total}`}</td>
          <td>${esc(e.ward_name || '—')}</td><td>${e.tracking_mode === 'INDIVIDUAL' ? chip(e.status) : `<span class="small">${e.quantity_available} available</span>`}</td>
          <td>${e.bed_code ? `<button class="link" data-act="open-bed" data-bed="${e.assigned_bed_id}" data-ward="${e.bed_ward_id}">${esc(e.bed_code)}</button>` : '—'}</td>
          <td class="small">${esc(e.notes || '')}</td><td><button class="btn sm ghost" data-act="edit-equipment" data-item="${e.id}">${icon('edit')}Edit</button></td></tr>`).join('')}</tbody></table>
        <p class="muted small table-foot">${list.length} item${list.length === 1 ? '' : 's'}</p>` : '<div class="empty">No equipment matches these filters.</div>';
    },
  };

  // ---------------- Alerts & activity
  PAGES.alerts = {
    mount(main) {
      main.innerHTML = `<div class="page">
        <div class="page-head"><div><h1>Alerts &amp; activity</h1><p class="muted">Alerts are computed from stored data using the thresholds in <a href="#/setup">Settings</a></p></div></div>
        <div class="split even">
          <section class="card" id="a-alerts"></section>
          <section class="card"><div class="card-head"><h2>Activity history</h2>
            <label class="sel"><span class="sr-only">Resource</span><select id="a-filter"><option value="">All activity</option>${options(['bed', 'patient', 'equipment', 'ward', 'settings'], S.actFilter, { bed: 'Beds & allocations', patient: 'Patients', equipment: 'Equipment', ward: 'Wards', settings: 'Settings' })}</select></label></div>
            <div id="a-activity"></div></section>
        </div></div>`;
      $('#a-filter').addEventListener('change', (e) => { S.actFilter = e.target.value; this.update(); });
    },
    update() {
      const alerts = api.alerts();
      const s = api.getSettings();
      $('#a-alerts').innerHTML = `<div class="card-head"><h2>Current alerts (${alerts.length})</h2></div>
        <p class="muted small">Low availability ≤ ${s.low_available_pct}% · high occupancy ≥ ${s.high_occupancy_pct}% · device minimums: ${MT.DEVICE_TYPES.map((t) => `${t} ${s.equipment_min_available[t]}`).join(', ')}</p>${alertList(alerts)}`;
      $('#a-activity').innerHTML = activityList(api.activity({ limit: 80, resource_type: S.actFilter || undefined }));
    },
  };

  // ---------------- Reports
  PAGES.reports = {
    mount(main) {
      main.innerHTML = `<div class="page">
        <div class="page-head"><div><h1>Reports</h1><p class="muted">Summaries computed from stored records</p></div></div>
        <div class="grid-2">
          <section class="card" id="r-occ"></section>
          <section class="card" id="r-eq"></section>
          <section class="card span2 sim" id="r-sim"></section>
          <section class="card span2" id="r-hist"></section>
        </div></div>`;
    },
    actions: {
      'run-sim': () => {
        const count = $('#sim-count').value;
        const r = attempt(() => api.simulateSurge({ count: Number(count), seed: Number($('#sim-seed').value) || 7 }));
        if (r) { S.sim = r; PAGES.reports.renderSim(); }
      },
      'clear-sim': () => { S.sim = null; PAGES.reports.renderSim(); },
    },
    update() {
      const s = api.summary();
      $('#r-occ').innerHTML = `<h2>Occupancy by ward</h2>${s.wards.length ? `<ul class="bars">${s.wards.map((w) => `<li><span class="bar-label">${esc(w.name)}<small>${w.counts.OCCUPIED}/${w.bed_count} · ${w.occupancy_pct}%</small></span>${w.bed_count ? stackBar(w.counts, w.bed_count) : ''}</li>`).join('')}</ul>
        <div class="legend-inline">${MT.BED_STATUSES.map((st) => `<span><i class="sw st-${st}"></i>${STATUS_LABEL[st]}</span>`).join('')}</div>` : '<div class="empty">No wards.</div>'}`;
      $('#r-eq').innerHTML = `<h2>Equipment utilization</h2><ul class="bars">${MT.DEVICE_TYPES.map((t) => {
        const x = s.equipment.by_type[t];
        const u = pct(x.IN_USE, x.total);
        return `<li><span class="bar-label">${esc(t)}<small>${x.IN_USE}/${x.total} in use · ${u}%</small></span><div class="stack">${['IN_USE', 'RESERVED', 'MAINTENANCE', 'AVAILABLE'].map((st) => (x[st] ? `<span class="seg eq-${st}" style="width:${(x[st] / x.total) * 100}%"></span>` : '')).join('')}</div></li>`;
      }).join('')}${s.equipment.stock.map((q) => `<li><span class="bar-label">${esc(q.equipment_type)}<small>${q.quantity_total - q.quantity_available}/${q.quantity_total} out · counted stock</small></span><div class="stack"><span class="seg eq-IN_USE" style="width:${pct(q.quantity_total - q.quantity_available, q.quantity_total)}%"></span><span class="seg eq-AVAILABLE" style="width:${pct(q.quantity_available, q.quantity_total)}%"></span></div></li>`).join('')}</ul>
        <div class="legend-inline"><span><i class="sw eq-IN_USE"></i>In use</span><span><i class="sw eq-RESERVED"></i>Reserved</span><span><i class="sw eq-MAINTENANCE"></i>Maintenance</span><span><i class="sw eq-AVAILABLE"></i>Available</span></div>`;
      const hist = api.listAllocations({ limit: 25 });
      $('#r-hist').innerHTML = `<h2>Recent allocation history</h2>${hist.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Patient</th><th>Bed</th><th>Ward</th><th>Status</th><th>Assigned</th><th>Released</th><th>Confirmed by</th></tr></thead><tbody>
        ${hist.map((a) => `<tr><td>${esc(a.patient_code)}</td><td>${esc(a.bed_code)}</td><td>${esc(a.ward_name)}</td><td>${chip(a.status)}</td><td class="small">${esc(fmtTime(a.assigned_at))}</td><td class="small">${a.released_at ? esc(fmtTime(a.released_at)) + ` (${esc((a.outcome || '').toLowerCase())})` : '—'}</td><td class="small">${esc(a.confirmed_by)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">No allocations yet.</div>'}`;
      this.renderSim();
    },
    renderSim() {
      const r = S.sim;
      $('#r-sim').innerHTML = `<div class="card-head"><h2>${icon('flask')} Demand surge simulation</h2><span class="sim-badge">SIMULATED · not live data · nothing is saved</span></div>
        <p class="muted small">Generates synthetic arrivals (55% General, 15% ICU, 15% Pediatric, 10% Maternity, 5% Isolation) and places each on the best compatible bed using the same allocation rules, on a temporary copy of the current data.</p>
        <div class="filters"><label>Arrivals<input id="sim-count" type="number" min="1" max="300" value="${r ? r.arrivals : 30}"></label><label>Random seed<input id="sim-seed" type="number" min="1" max="9999" value="7"></label>
          <button class="btn primary" data-act="run-sim">${icon('flask')}Run simulation</button>${r ? '<button class="btn ghost" data-act="clear-sim">Clear</button>' : ''}</div>
        ${r ? `<div class="sim-out">
          <div class="stats compact">${statCard('Simulated arrivals', r.arrivals)}${statCard('Placed', r.placed, 'AVAILABLE')}${statCard('No suitable bed', r.unplaced, 'OCCUPIED')}</div>
          <div class="grid-2">
            <div><h3 class="sub">By requested bed type</h3><table class="table"><thead><tr><th>Type</th><th>Requested</th><th>Placed</th></tr></thead><tbody>${r.by_type.map((x) => `<tr><td>${esc(x.type)}</td><td>${x.requested}</td><td>${x.placed}</td></tr>`).join('')}</tbody></table>
              ${r.unplaced_reasons.length ? `<h3 class="sub">Main reasons arrivals could not be placed</h3><ul class="plain">${r.unplaced_reasons.map((x) => `<li><strong>${x.count}</strong> ${esc(x.reason)}</li>`).join('')}</ul>` : ''}</div>
            <div><h3 class="sub">Wards after simulated surge</h3><ul class="bars">${r.wards_after.map((w) => `<li><span class="bar-label">${esc(w.name)}<small>${w.available} available · ${w.occupancy_pct}% occupied</small></span><div class="stack"><span class="seg st-OCCUPIED" style="width:${w.occupancy_pct}%"></span></div></li>`).join('')}</ul></div>
          </div></div>` : ''}`;
    },
  };

  // ---------------- Setup & settings
  PAGES.setup = {
    mount(main) {
      main.innerHTML = `<div class="page">
        <div class="page-head"><div><h1>Setup &amp; Settings</h1><p class="muted">Configure wards and bed counts. The explorer lays beds out automatically — no floor plans or physical positions.</p></div>
          <div class="head-actions"><button class="btn primary" data-act="add-ward">${icon('plus')}Add ward</button></div></div>
        <section class="card" id="s-wards"></section>
        <div class="grid-2">
          <section class="card" id="s-settings"></section>
          <section class="card" id="s-demo"></section>
        </div></div>`;
    },
    update() {
      const wards = api.listWards();
      $('#s-wards').innerHTML = `<h2>Wards</h2>${wards.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Ward</th><th>Category</th><th>Prefix</th><th>Beds</th><th>Bed IDs</th><th>Occupancy</th><th>State</th><th><span class="sr-only">Actions</span></th></tr></thead><tbody>
        ${wards.map((w) => `<tr class="${w.is_active ? '' : 'inactive'}"><td><strong>${esc(w.name)}</strong></td><td>${esc(w.category)}</td><td>${esc(w.bed_code_prefix)}</td><td>${w.bed_count}</td>
          <td class="small">${w.bed_count ? `${esc(w.bed_code_prefix)}-001 … ${esc(w.bed_code_prefix)}-${String(w.bed_count).padStart(3, '0')}` : '—'}</td><td>${w.occupancy_pct}%</td>
          <td>${w.is_active ? '<span class="chip st-AVAILABLE"><i></i>Active</span>' : '<span class="chip st-CLEANING"><i></i>Inactive</span>'}</td>
          <td class="actions"><button class="btn sm ghost" data-act="edit-ward" data-ward="${w.id}">${icon('edit')}Edit</button><button class="btn sm ghost" data-act="resize-ward" data-ward="${w.id}">${icon('bed')}Set bed count</button>
          <button class="btn sm ghost" data-act="toggle-ward" data-ward="${w.id}">${w.is_active ? 'Deactivate' : 'Activate'}</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">No wards yet. Add one to generate beds.</div>'}`;
      if (!$('#settings-form')) this.renderSettings();
      $('#s-demo').innerHTML = `<h2>${icon('db')} Demo data</h2>
        <p class="muted">All records are fictional and stored in this browser's local storage. They persist across reloads until reset.</p>
        <div class="btn-row wrap"><button class="btn" data-act="seed-demo">${icon('refresh')}Add missing demo data</button><button class="btn danger" data-act="reset-demo">Reset demo data</button></div>
        <p class="muted small">“Add missing demo data” is repeatable — it never duplicates wards, beds, patients or equipment.</p>
        <div class="integrity">${(() => { const p = api.integrityProblems(); return p.length ? `<span class="err">${icon('alert')} ${p.length} consistency problem(s): ${esc(p[0])}</span>` : `${icon('check')} Data consistency check passed (allocations, bed states, patient states, device assignments).`; })()}</div>`;
    },
    renderSettings() {
      const s = api.getSettings();
      $('#s-settings').innerHTML = `<h2>${icon('settings')} Thresholds &amp; allocation rules</h2>
        <form id="settings-form" class="form">
          <div class="row2">
            <label>Low-availability alert at ≤ (%)<input name="low_available_pct" type="number" min="0" max="100" value="${s.low_available_pct}"></label>
            <label>High-occupancy alert at ≥ (%)<input name="high_occupancy_pct" type="number" min="1" max="100" value="${s.high_occupancy_pct}"></label>
          </div>
          <fieldset><legend>Minimum available devices (shortage alert below)</legend><div class="row3">${MT.DEVICE_TYPES.map((t) => `<label>${esc(t)}<input name="min_${esc(t)}" type="number" min="0" max="1000" value="${s.equipment_min_available[t]}"></label>`).join('')}</div></fieldset>
          <div class="row2">
            <label>Beds per visual group in explorer<input name="group_size" type="number" min="4" max="30" value="${s.group_size}"></label>
            <label class="check inline"><input type="checkbox" name="release_to_cleaning" value="1" ${s.release_to_cleaning ? 'checked' : ''}><span>Released beds go to <strong>Cleaning</strong> (otherwise straight to Available)</span></label>
          </div>
          <fieldset><legend>Bed-type compatibility — which bed types may be recommended for each requested type</legend>
            <table class="table compat"><thead><tr><th>Requested</th>${MT.BED_TYPES.map((t) => `<th>${esc(t)}</th>`).join('')}</tr></thead><tbody>
            ${MT.BED_TYPES.map((req) => `<tr><th scope="row">${esc(req)}</th>${MT.BED_TYPES.map((t) => `<td><input type="checkbox" name="compat_${esc(req)}" value="${esc(t)}" ${(s.bed_type_compat[req] || [req]).includes(t) ? 'checked' : ''} ${t === req ? 'disabled' : ''} aria-label="Allow ${esc(t)} bed for ${esc(req)} request"></td>`).join('')}</tr>`).join('')}</tbody></table></fieldset>
          <div class="btn-row"><button class="btn primary" type="submit">Save settings</button></div>
        </form>`;
      $('#settings-form').addEventListener('submit', (e) => {
        e.preventDefault();
        const f = e.target;
        const patch = {
          low_available_pct: f.elements.low_available_pct.value,
          high_occupancy_pct: f.elements.high_occupancy_pct.value,
          group_size: f.elements.group_size.value,
          release_to_cleaning: f.elements.release_to_cleaning.checked,
          equipment_min_available: Object.fromEntries(MT.DEVICE_TYPES.map((t) => [t, f.elements[`min_${t}`].value])),
          bed_type_compat: Object.fromEntries(MT.BED_TYPES.map((req) => [req, $$(`input[name="compat_${req}"]:checked`, f).map((c) => c.value)])),
        };
        if (attempt(() => api.updateSettings(patch))) { toast('Settings saved.'); this.renderSettings(); }
      });
    },
  };

  // ------------------------------------------------------------------ boot
  hydrateIcons(document);
  onRoute();
  setInterval(() => { if (!document.hidden) updateChrome(); }, 60000);
})();
