/* Service-layer tests (TRD §12). Each test gets a fresh in-memory store, so app data is never touched. */
(function () {
  'use strict';
  const MT = window.MediTwin;
  const results = [];

  function fresh(seed) {
    const svc = MT.createService(MT.memoryStorage(), { key: 'test' });
    if (seed) svc.seedDemo();
    return svc;
  }
  function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
  function eq(a, b, msg) { if (a !== b) throw new Error(`${msg || 'expected equal'}: got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`); }
  function throwsApi(fn, status, code) {
    try { fn(); } catch (e) {
      assert(e.name === 'ApiError', `expected ApiError, got ${e}`);
      if (status) eq(e.status, status, `status for ${e.code}`);
      if (code) eq(e.code, code, 'error code');
      return e;
    }
    throw new Error(`expected ApiError ${status || ''} ${code || ''}, but call succeeded`);
  }
  function test(name, fn) {
    try { fn(); results.push({ name, ok: true }); } catch (e) { results.push({ name, ok: false, err: e.message }); }
  }
  const bedByCode = (svc, code) => svc.listBeds({}).concat(...svc.listWards().filter((w) => !w.is_active).map((w) => svc.listBeds({ ward_id: w.id }))).find((b) => b.bed_code === code);

  // ---------------------------------------------------------------- wards & generation
  test('Bed generation creates the requested number of beds with sequential codes', () => {
    const s = fresh();
    const w = s.createWard({ name: 'Ward 1', bed_count: 100 });
    eq(w.bed_count, 100, 'bed count');
    const beds = s.listBeds({ ward_id: w.id });
    eq(beds.length, 100);
    eq(beds[0].bed_code, 'W1-001'); eq(beds[99].bed_code, 'W1-100');
    assert(beds.every((b) => b.status === 'AVAILABLE'), 'all available');
  });

  test('Increasing bed count appends new beds after the last one', () => {
    const s = fresh();
    const w = s.createWard({ name: 'Ward 2', bed_count: 40 });
    const r = s.generateBeds(w.id, { count: 45 });
    eq(r.added.length, 5); eq(r.added[0], 'W2-041'); eq(r.added[4], 'W2-045');
  });

  test('Unique ward names, prefixes, bed, patient and equipment codes are enforced', () => {
    const s = fresh();
    s.createWard({ name: 'ICU', bed_count: 2 });
    throwsApi(() => s.createWard({ name: 'icu', bed_count: 1 }), 409, 'DUPLICATE');
    throwsApi(() => s.createWard({ name: 'Intensive', bed_code_prefix: 'ICU', bed_count: 1 }), 409, 'DUPLICATE');
    s.createPatient({ display_name: 'A', patient_code: 'P-1' });
    throwsApi(() => s.createPatient({ display_name: 'B', patient_code: 'p-1' }), 409, 'DUPLICATE');
    s.createEquipment({ tracking_mode: 'INDIVIDUAL', equipment_type: 'Monitor', equipment_code: 'MON-X' });
    throwsApi(() => s.createEquipment({ tracking_mode: 'INDIVIDUAL', equipment_type: 'Monitor', equipment_code: 'MON-X' }), 409, 'DUPLICATE');
    const codes = s.listBeds({}).map((b) => b.bed_code);
    eq(new Set(codes).size, codes.length, 'bed codes unique');
  });

  test('Unsafe bed-count reduction is rejected when removed beds have patients', () => {
    const s = fresh();
    const w = s.createWard({ name: 'Ward 9', bed_code_prefix: 'W9', bed_count: 10 });
    const p = s.createPatient({ display_name: 'Demo' });
    const last = bedByCode(s, 'W9-010');
    s.allocate({ patient_id: p.id, bed_id: last.id });
    const e = throwsApi(() => s.generateBeds(w.id, { count: 5 }), 409, 'UNSAFE_REDUCTION');
    assert(e.details.blocked.includes('W9-010'), 'names the blocked bed');
    eq(s.getWard(w.id).bed_count, 10, 'nothing removed');
    const ok = s.generateBeds(w.id, { count: 10 });
    eq(ok.bed_count, 10);
  });

  test('Safe reduction removes only the highest-numbered beds', () => {
    const s = fresh();
    const w = s.createWard({ name: 'Ward 8', bed_count: 10 });
    const p = s.createPatient({ display_name: 'Demo' });
    s.allocate({ patient_id: p.id, bed_id: bedByCode(s, 'W8-002').id });
    const r = s.generateBeds(w.id, { count: 6 });
    eq(r.removed.join(','), 'W8-007,W8-008,W8-009,W8-010');
    eq(s.listBeds({ ward_id: w.id }).length, 6);
  });

  test('Deactivating a ward with active allocations is rejected', () => {
    const s = fresh();
    const w = s.createWard({ name: 'Ward 7', bed_count: 3 });
    const p = s.createPatient({ display_name: 'Demo' });
    s.allocate({ patient_id: p.id, bed_id: s.listBeds({ ward_id: w.id })[0].id });
    throwsApi(() => s.updateWard(w.id, { is_active: false }), 409, 'WARD_IN_USE');
  });

  // ---------------------------------------------------------------- allocation rules
  for (const status of ['RESERVED', 'CLEANING', 'MAINTENANCE']) {
    test(`A ${status.toLowerCase()} bed cannot be allocated`, () => {
      const s = fresh();
      const w = s.createWard({ name: 'W', bed_count: 2 });
      const bed = s.listBeds({ ward_id: w.id })[0];
      s.updateBedStatus(bed.id, { status });
      const p = s.createPatient({ display_name: 'Demo' });
      throwsApi(() => s.allocate({ patient_id: p.id, bed_id: bed.id }), 409, 'BED_UNAVAILABLE');
      eq(s.getPatient(p.id).status, 'WAITING', 'patient unchanged');
      eq(s.getBed(bed.id).status, status, 'bed unchanged');
    });
  }

  test('An occupied bed cannot be allocated again (duplicate bed allocation impossible)', () => {
    const s = fresh();
    const w = s.createWard({ name: 'W', bed_count: 1 });
    const bed = s.listBeds({ ward_id: w.id })[0];
    const a = s.createPatient({ display_name: 'A' });
    const b = s.createPatient({ display_name: 'B' });
    s.allocate({ patient_id: a.id, bed_id: bed.id });
    throwsApi(() => s.allocate({ patient_id: b.id, bed_id: bed.id }), 409, 'BED_UNAVAILABLE');
    eq(s.listAllocations({ status: 'ACTIVE' }).length, 1);
  });

  test('A patient cannot hold two active allocations', () => {
    const s = fresh();
    const w = s.createWard({ name: 'W', bed_count: 2 });
    const [b1, b2] = s.listBeds({ ward_id: w.id });
    const p = s.createPatient({ display_name: 'A' });
    s.allocate({ patient_id: p.id, bed_id: b1.id });
    throwsApi(() => s.allocate({ patient_id: p.id, bed_id: b2.id }), 409, 'PATIENT_NOT_WAITING');
    eq(s.getBed(b2.id).status, 'AVAILABLE');
  });

  test('Bed-type mismatch is rejected by the service', () => {
    const s = fresh();
    const w = s.createWard({ name: 'W', bed_count: 1, bed_type: 'General' });
    const p = s.createPatient({ display_name: 'A', required_bed_type: 'ICU' });
    throwsApi(() => s.allocate({ patient_id: p.id, bed_id: s.listBeds({ ward_id: w.id })[0].id }), 422, 'REQUIREMENT_MISMATCH');
  });

  test('Configured compatible bed type is accepted', () => {
    const s = fresh();
    const w = s.createWard({ name: 'W', bed_count: 1, bed_type: 'ICU' });
    s.updateSettings({ bed_type_compat: { General: ['General', 'ICU'] } });
    const p = s.createPatient({ display_name: 'A', required_bed_type: 'General' });
    const r = s.recommendations(p.id);
    eq(r.eligible_count, 1);
    assert(r.recommendations[0].matches.some((m) => m.includes('compatible')), 'explains compatibility');
    s.allocate({ patient_id: p.id, bed_id: s.listBeds({ ward_id: w.id })[0].id });
  });

  test('Missing bed feature (special requirement) is rejected', () => {
    const s = fresh();
    const w = s.createWard({ name: 'W', bed_count: 1 });
    const p = s.createPatient({ display_name: 'A', required_bed_features: ['Suction'] });
    throwsApi(() => s.allocate({ patient_id: p.id, bed_id: s.listBeds({ ward_id: w.id })[0].id }), 422, 'REQUIREMENT_MISMATCH');
  });

  test('Equipment mismatch is rejected and devices cannot be double-allocated', () => {
    const s = fresh();
    const w = s.createWard({ name: 'W', bed_count: 3 });
    const [b1, b2] = s.listBeds({ ward_id: w.id });
    s.createEquipment({ tracking_mode: 'INDIVIDUAL', equipment_type: 'Ventilator', ward_id: w.id });
    const a = s.createPatient({ display_name: 'A', required_equipment_types: ['Ventilator'] });
    const b = s.createPatient({ display_name: 'B', required_equipment_types: ['Ventilator'] });
    const r = s.allocate({ patient_id: a.id, bed_id: b1.id });
    eq(r.devices.length, 1);
    throwsApi(() => s.allocate({ patient_id: b.id, bed_id: b2.id }), 409, 'EQUIPMENT_UNAVAILABLE');
    eq(s.getBed(b2.id).status, 'AVAILABLE', 'no partial change to bed');
    eq(s.getPatient(b.id).status, 'WAITING', 'no partial change to patient');
    eq(s.recommendations(b.id).eligible_count, 0, 'not recommended while device is in use');
  });

  test('Competing allocation for the same bed returns 409 and leaves data consistent', () => {
    // Two "tabs" sharing one storage: both load recommendations, then both confirm.
    const store = MT.memoryStorage();
    const tab1 = MT.createService(store, { key: 'shared' });
    const tab2 = MT.createService(store, { key: 'shared' });
    const w = tab1.createWard({ name: 'W', bed_count: 1 });
    const a = tab1.createPatient({ display_name: 'A' });
    const b = tab1.createPatient({ display_name: 'B' });
    const bedId = tab1.recommendations(a.id).recommendations[0].bed_id;
    eq(tab2.recommendations(b.id).recommendations[0].bed_id, bedId, 'both saw the same free bed');
    tab1.allocate({ patient_id: a.id, bed_id: bedId });
    throwsApi(() => tab2.allocate({ patient_id: b.id, bed_id: bedId }), 409, 'BED_UNAVAILABLE');
    eq(tab2.listAllocations({ status: 'ACTIVE' }).length, 1);
    eq(tab2.getPatient(b.id).status, 'WAITING');
    eq(tab2.integrityProblems().length, 0, 'integrity');
    assert(w, 'ward');
  });

  test('Releasing updates allocation, patient, bed and devices consistently', () => {
    const s = fresh();
    const w = s.createWard({ name: 'W', bed_count: 1 });
    const bed = s.listBeds({ ward_id: w.id })[0];
    const dev = s.createEquipment({ tracking_mode: 'INDIVIDUAL', equipment_type: 'Monitor', ward_id: w.id });
    const p = s.createPatient({ display_name: 'A', required_equipment_types: ['Monitor'] });
    const a = s.allocate({ patient_id: p.id, bed_id: bed.id });
    eq(s.getEquipment(dev.id).status, 'IN_USE');
    throwsApi(() => s.updateBedStatus(bed.id, { status: 'AVAILABLE' }), 409, 'INVALID_TRANSITION');
    const r = s.releaseAllocation(a.id, { outcome: 'DISCHARGED' });
    eq(r.bed_status, 'CLEANING', 'goes to cleaning by default');
    const bed2 = s.getBed(bed.id);
    eq(bed2.status, 'CLEANING'); eq(bed2.current_patient_id, null);
    eq(s.getPatient(p.id).status, 'DISCHARGED');
    eq(s.listAllocations({})[0].status, 'RELEASED');
    eq(s.getEquipment(dev.id).status, 'AVAILABLE');
    throwsApi(() => s.releaseAllocation(a.id, {}), 409, 'NOT_ACTIVE');
    eq(s.integrityProblems().length, 0);
  });

  test('Release goes straight to Available when cleaning workflow is turned off', () => {
    const s = fresh();
    s.updateSettings({ release_to_cleaning: false });
    const w = s.createWard({ name: 'W', bed_count: 1 });
    const p = s.createPatient({ display_name: 'A' });
    const a = s.allocate({ patient_id: p.id, bed_id: s.listBeds({ ward_id: w.id })[0].id });
    eq(s.releaseAllocation(a.id, { outcome: 'TRANSFERRED' }).bed_status, 'AVAILABLE');
  });

  test('Manual status changes follow allowed transitions only', () => {
    const s = fresh();
    const w = s.createWard({ name: 'W', bed_count: 1 });
    const bed = s.listBeds({ ward_id: w.id })[0];
    throwsApi(() => s.updateBedStatus(bed.id, { status: 'OCCUPIED' }), 409, 'INVALID_TRANSITION');
    s.updateBedStatus(bed.id, { status: 'CLEANING' });
    throwsApi(() => s.updateBedStatus(bed.id, { status: 'RESERVED' }), 409, 'INVALID_TRANSITION');
    eq(s.updateBedStatus(bed.id, { status: 'AVAILABLE' }).status, 'AVAILABLE');
  });

  test('In-use equipment cannot be manually changed', () => {
    const s = fresh();
    const w = s.createWard({ name: 'W', bed_count: 1 });
    const dev = s.createEquipment({ tracking_mode: 'INDIVIDUAL', equipment_type: 'Monitor', ward_id: w.id });
    const p = s.createPatient({ display_name: 'A', required_equipment_types: ['Monitor'] });
    s.allocate({ patient_id: p.id, bed_id: s.listBeds({ ward_id: w.id })[0].id });
    throwsApi(() => s.updateEquipment(dev.id, { status: 'MAINTENANCE' }), 409, 'EQUIPMENT_IN_USE');
  });

  test('No suitable bed returns an empty list with reasons', () => {
    const s = fresh();
    s.createWard({ name: 'W', bed_count: 3, bed_type: 'General' });
    const p = s.createPatient({ display_name: 'A', required_bed_type: 'Isolation' });
    const r = s.recommendations(p.id);
    eq(r.eligible_count, 0);
    assert(r.rejected_summary.some((x) => x.reason.includes('Isolation')), 'explains type mismatch');
  });

  // ---------------------------------------------------------------- seed, totals, persistence
  test('Seeding is repeatable without duplicates and produces consistent data', () => {
    const s = fresh(true);
    const counts = () => ({ w: s.listWards().length, b: s.listBeds({}).length, p: s.listPatients({}).length, e: s.listEquipment({}).length });
    const first = counts();
    eq(first.w, 5); eq(first.b, 205);
    const again = s.seedDemo();
    eq(again.wards + again.beds + again.patients + again.equipment, 0, 'nothing added on re-run');
    eq(JSON.stringify(counts()), JSON.stringify(first));
    eq(s.integrityProblems().length, 0, 'seed integrity');
    const sum = s.summary().beds;
    for (const st of MT.BED_STATUSES) assert(sum[st] > 0, `seed has ${st} beds`);
  });

  test('Dashboard totals match stored records after changes', () => {
    const s = fresh(true);
    const tally = () => {
      const beds = s.listBeds({});
      const t = { total: beds.length };
      for (const st of MT.BED_STATUSES) t[st] = beds.filter((b) => b.status === st).length;
      return t;
    };
    const check = () => { const sum = s.summary().beds; const t = tally(); for (const k of Object.keys(t)) eq(sum[k], t[k], `summary ${k}`); };
    check();
    const p = s.listPatients({ status: 'WAITING' })[0];
    const rec = s.recommendations(p.id).recommendations[0];
    s.allocate({ patient_id: p.id, bed_id: rec.bed_id });
    check();
    const wardTotals = s.listWards().reduce((n, w) => n + w.bed_count, 0);
    eq(wardTotals, s.summary().beds.total, 'ward totals add up');
  });

  test('Data persists across service instances (page reload)', () => {
    const store = MT.memoryStorage();
    const s1 = MT.createService(store, { key: 'persist' });
    s1.createWard({ name: 'Persist', bed_count: 4 });
    const s2 = MT.createService(store, { key: 'persist' });
    eq(s2.listWards()[0].bed_count, 4);
  });

  test('A failed change writes nothing (transaction rollback)', () => {
    const store = MT.memoryStorage();
    const s = MT.createService(store, { key: 'tx' });
    s.createWard({ name: 'W', bed_count: 2 });
    const before = store.getItem('tx');
    throwsApi(() => s.createWard({ name: 'X', bed_count: 9999 }), 422, 'VALIDATION');
    eq(store.getItem('tx'), before, 'storage unchanged');
  });

  test('Simulation does not modify stored data', () => {
    const store = MT.memoryStorage();
    const s = MT.createService(store, { key: 'sim' });
    s.seedDemo();
    const before = store.getItem('sim');
    const r = s.simulateSurge({ count: 40 });
    eq(r.simulated, true); eq(r.arrivals, 40); eq(r.placed + r.unplaced, 40);
    eq(store.getItem('sim'), before);
  });

  test('Grid layout: 100 beds in groups of 10 without overlap', () => {
    const L = window.MTScene.computeLayout(100, 10, 1.6);
    eq(L.groups.length, 10); eq(L.positions.length, 100);
    for (let i = 0; i < L.positions.length; i++) {
      for (let j = i + 1; j < L.positions.length; j++) {
        const a = L.positions[i], b = L.positions[j];
        assert(Math.abs(a.x - b.x) >= 1.0 || Math.abs(a.z - b.z) >= 2.0, `beds ${i} and ${j} overlap`);
      }
    }
    eq(window.MTScene.groupName(0), 'Section A'); eq(window.MTScene.groupName(26), 'Section AA');
  });

  // ---------------------------------------------------------------- patient flow
  test('Flow: Waiting → Matching → Allocated → Admitted → Discharged keeps records consistent', () => {
    const s = fresh();
    const w = s.createWard({ name: 'W', bed_count: 2 });
    const p = s.createPatient({ display_name: 'A', priority: 'URGENT' });
    eq(s.getPatient(p.id).stage, 'WAITING');
    s.startMatching(p.id);
    eq(s.getPatient(p.id).stage, 'MATCHING');
    s.startMatching(p.id); // idempotent
    const a = s.allocate({ patient_id: p.id, bed_id: s.listBeds({ ward_id: w.id })[0].id });
    let got = s.getPatient(p.id);
    eq(got.stage, 'ALLOCATED'); eq(got.status, 'ALLOCATED'); eq(got.match_started_at, null);
    eq(got.allocation.admitted_at, null);
    s.admitPatient(a.id);
    got = s.getPatient(p.id);
    eq(got.stage, 'ADMITTED'); assert(got.allocation.admitted_at, 'admission time stored');
    throwsApi(() => s.admitPatient(a.id), 409, 'ALREADY_ADMITTED');
    throwsApi(() => s.cancelAllocation(a.id), 409, 'ALREADY_ADMITTED');
    s.releaseAllocation(a.id, { outcome: 'DISCHARGED' });
    eq(s.getPatient(p.id).stage, 'CLOSED');
    eq(s.integrityProblems().length, 0);
  });

  test('Cancelling an allocation before arrival frees the bed and devices and returns the patient to Waiting', () => {
    const s = fresh();
    const w = s.createWard({ name: 'W', bed_count: 1 });
    const dev = s.createEquipment({ tracking_mode: 'INDIVIDUAL', equipment_type: 'Monitor', ward_id: w.id });
    const p = s.createPatient({ display_name: 'A', required_equipment_types: ['Monitor'] });
    const bed = s.listBeds({ ward_id: w.id })[0];
    const a = s.allocate({ patient_id: p.id, bed_id: bed.id });
    s.cancelAllocation(a.id);
    eq(s.getBed(bed.id).status, 'AVAILABLE'); eq(s.getBed(bed.id).current_patient_id, null);
    eq(s.getPatient(p.id).status, 'WAITING');
    eq(s.getEquipment(dev.id).status, 'AVAILABLE');
    eq(s.listAllocations({})[0].status, 'CANCELLED');
    eq(s.integrityProblems().length, 0);
  });

  test('Matching is only for waiting patients', () => {
    const s = fresh();
    const w = s.createWard({ name: 'W', bed_count: 1 });
    const p = s.createPatient({ display_name: 'A' });
    s.allocate({ patient_id: p.id, bed_id: s.listBeds({ ward_id: w.id })[0].id });
    throwsApi(() => s.startMatching(p.id), 409, 'PATIENT_NOT_WAITING');
  });

  test('Patient flow totals match stored patients and paging covers everyone', () => {
    const s = fresh(true);
    for (let i = 0; i < 30; i++) s.createPatient({ display_name: `Bulk ${i}` });
    const f = s.patientFlow({});
    const active = s.listPatients({}).filter((p) => ['WAITING', 'ALLOCATED', 'ADMITTED'].includes(p.status)).length;
    eq(MT.FLOW_STAGES.reduce((n, st) => n + f.totals[st], 0), active, 'stage totals add up');
    const seen = new Set();
    let page = 1, pages = 1;
    do {
      const r = s.patientFlow({ stage: 'WAITING', page, page_size: 7 });
      pages = r.pages;
      r.items.forEach((c) => { assert(!seen.has(c.id), 'no duplicates across pages'); seen.add(c.id); });
      page++;
    } while (page <= pages);
    eq(seen.size, f.totals.WAITING, 'paging returns every waiting patient once');
    const urgent = s.patientFlow({ stage: 'WAITING', priority: 'URGENT' });
    assert(urgent.items.every((c) => c.priority === 'URGENT'), 'priority filter');
    assert(f.columns.WAITING.length <= 5, 'board shows at most 5 cards per column');
  });

  test('Older saved data is migrated: active allocations count as admitted', () => {
    const store = MT.memoryStorage();
    const s1 = MT.createService(store, { key: 'mig' });
    const w = s1.createWard({ name: 'W', bed_count: 1 });
    const p = s1.createPatient({ display_name: 'A' });
    s1.allocate({ patient_id: p.id, bed_id: s1.listBeds({ ward_id: w.id })[0].id });
    const raw = JSON.parse(store.getItem('mig'));
    delete raw.allocations[0].admitted_at; delete raw.patients[0].priority; delete raw.patients[0].match_started_at;
    store.setItem('mig', JSON.stringify(raw));
    const s2 = MT.createService(store, { key: 'mig' });
    const got = s2.getPatient(p.id);
    eq(got.status, 'ADMITTED'); eq(got.priority, 'ROUTINE');
    eq(s2.integrityProblems().length, 0);
  });

  // ---------------------------------------------------------------- render
  const passed = results.filter((r) => r.ok).length;
  const out = document.getElementById('out');
  out.innerHTML = `<h1>${passed}/${results.length} tests passed</h1><ul>${results.map((r) => `<li class="${r.ok ? 'ok' : 'fail'}">${r.ok ? '✔' : '✘'} ${r.name}${r.ok ? '' : `<br><code>${r.err.replace(/</g, '&lt;')}</code>`}</li>`).join('')}</ul>`;
  document.title = `${passed}/${results.length} passed — MediTwin tests`;
  window.TEST_RESULTS = { passed, total: results.length, failed: results.filter((r) => !r.ok) };
})();
