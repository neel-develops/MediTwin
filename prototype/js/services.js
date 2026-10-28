/*
 * MediTwin service layer.
 *
 * Plays the role of the backend described in TRD.md: it owns resource state and
 * every business rule (eligibility, allocation, release, safe bed-count changes).
 * The UI only calls these functions; it never mutates records itself.
 *
 * Persistence: one JSON document in a key/value storage (localStorage in the app,
 * an in-memory map in tests). Every mutation runs in `tx()`: it re-reads the latest
 * stored state, applies the change to a draft copy, checks integrity constraints,
 * and commits with a single write. If anything throws, nothing is written.
 */
(function (root) {
  'use strict';

  const BED_STATUSES = ['AVAILABLE', 'OCCUPIED', 'RESERVED', 'CLEANING', 'MAINTENANCE'];
  const BED_TYPES = ['General', 'ICU', 'Pediatric', 'Maternity', 'Isolation'];
  const BED_FEATURES = ['Oxygen Outlet', 'Suction', 'Isolation Capable', 'Bariatric'];
  const DEVICE_TYPES = ['Monitor', 'Ventilator', 'Infusion Pump']; // individually tracked, allocatable
  const QUANTITY_TYPES = ['Wheelchair', 'Oxygen Cylinder', 'Stretcher']; // counted stock only
  const EQUIPMENT_STATUSES = ['AVAILABLE', 'IN_USE', 'RESERVED', 'MAINTENANCE'];
  const PATIENT_STATUSES = ['WAITING', 'ALLOCATED', 'ADMITTED', 'DISCHARGED', 'TRANSFERRED'];
  // Flow stages shown on the Patients board. MATCHING = waiting patient whose bed search has been started.
  const FLOW_STAGES = ['WAITING', 'MATCHING', 'ALLOCATED', 'ADMITTED'];
  // Staff-set administrative priority. Not a clinical score.
  const PRIORITIES = ['URGENT', 'HIGH', 'ROUTINE'];
  const ACTIVE_PATIENT = ['ALLOCATED', 'ADMITTED'];
  const CARE_CATEGORIES = ['General Medicine', 'Surgery Recovery', 'Critical Care', 'Paediatrics', 'Maternity', 'Infectious Disease'];
  const WARD_CATEGORIES = ['General Ward', 'Critical Care', 'Paediatrics', 'Maternity', 'Isolation', 'Other'];
  const DEVICE_PREFIX = { Monitor: 'MON', Ventilator: 'VEN', 'Infusion Pump': 'INF' };

  // Manual status changes. OCCUPIED is only entered/left through allocation and release.
  const MANUAL_TRANSITIONS = {
    AVAILABLE: ['RESERVED', 'CLEANING', 'MAINTENANCE'],
    RESERVED: ['AVAILABLE', 'CLEANING', 'MAINTENANCE'],
    CLEANING: ['AVAILABLE', 'MAINTENANCE'],
    MAINTENANCE: ['AVAILABLE', 'CLEANING'],
    OCCUPIED: [],
  };

  class ApiError extends Error {
    constructor(status, code, message, details) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.code = code;
      this.details = details || null;
    }
  }

  const clone = (o) => JSON.parse(JSON.stringify(o));
  const nowIso = () => new Date().toISOString();
  const str = (s) => String(s == null ? '' : s).trim();
  const lc = (s) => str(s).toLowerCase();
  const pad3 = (n) => String(n).padStart(3, '0');
  const bedCode = (prefix, n) => `${prefix}-${pad3(n)}`;

  function defaultSettings() {
    return {
      low_available_pct: 10,
      high_occupancy_pct: 85,
      equipment_min_available: { Monitor: 3, Ventilator: 2, 'Infusion Pump': 3 },
      release_to_cleaning: true,
      group_size: 10,
      bed_type_compat: { General: ['General'], ICU: ['ICU'], Pediatric: ['Pediatric'], Maternity: ['Maternity'], Isolation: ['Isolation'] },
    };
  }

  function emptyDb() {
    return {
      schema: 1,
      seq: { ward: 0, bed: 0, patient: 0, equipment: 0, allocation: 0, activity: 0 },
      wards: [], beds: [], patients: [], equipment: [], allocations: [], activity: [],
      settings: defaultSettings(),
    };
  }

  function memoryStorage() {
    const m = new Map();
    return {
      getItem: (k) => (m.has(k) ? m.get(k) : null),
      setItem: (k, v) => m.set(k, String(v)),
      removeItem: (k) => m.delete(k),
    };
  }

  // Deterministic PRNG so demo seeding is repeatable.
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function derivePrefix(name) {
    const words = str(name).toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
    if (!words.length) return 'BED';
    if (words.length === 1) return words[0].slice(0, 3);
    return words.map((w) => (/^\d+$/.test(w) ? w : w[0])).join('').slice(0, 6);
  }

  // ---------------------------------------------------------------- validation
  function requireText(value, field, max) {
    const v = str(value);
    if (!v) throw new ApiError(422, 'VALIDATION', `${field} is required.`, { field });
    if (v.length > max) throw new ApiError(422, 'VALIDATION', `${field} must be ${max} characters or fewer.`, { field });
    return v;
  }
  function requireOneOf(value, list, field) {
    if (!list.includes(value)) throw new ApiError(422, 'VALIDATION', `${field} must be one of: ${list.join(', ')}.`, { field });
    return value;
  }
  function subsetOf(values, list, field) {
    const arr = Array.isArray(values) ? values : [];
    const bad = arr.filter((v) => !list.includes(v));
    if (bad.length) throw new ApiError(422, 'VALIDATION', `${field} contains unknown values: ${bad.join(', ')}.`, { field });
    return Array.from(new Set(arr));
  }
  function requireInt(value, field, min, max) {
    const n = Number(value);
    if (!Number.isInteger(n) || n < min || n > max) throw new ApiError(422, 'VALIDATION', `${field} must be a whole number from ${min} to ${max}.`, { field });
    return n;
  }
  function requirePrefix(value) {
    const p = str(value).toUpperCase();
    if (!/^[A-Z0-9]{1,6}$/.test(p)) throw new ApiError(422, 'VALIDATION', 'Bed code prefix must be 1–6 letters or digits.', { field: 'bed_code_prefix' });
    return p;
  }

  // ---------------------------------------------------------------- integrity
  function integrityProblems(db) {
    const problems = [];
    const dupes = (items, keyFn, label) => {
      const seen = new Map();
      for (const it of items) {
        const k = keyFn(it);
        if (k == null) continue;
        if (seen.has(k)) problems.push(`Duplicate ${label}: ${k}`);
        seen.set(k, true);
      }
    };
    dupes(db.wards, (w) => lc(w.name), 'ward name');
    dupes(db.wards, (w) => w.bed_code_prefix, 'ward bed-code prefix');
    dupes(db.beds, (b) => b.bed_code, 'bed code');
    dupes(db.patients, (p) => p.patient_code, 'patient code');
    dupes(db.equipment, (e) => e.equipment_code, 'equipment code');

    const bedById = new Map(db.beds.map((b) => [b.id, b]));
    const patById = new Map(db.patients.map((p) => [p.id, p]));
    const activeByBed = new Map();
    const activeByPatient = new Map();
    for (const a of db.allocations) {
      if (a.status !== 'ACTIVE') continue;
      const bed = bedById.get(a.bed_id);
      const pat = patById.get(a.patient_id);
      if (activeByBed.has(a.bed_id)) problems.push(`Bed ${bed ? bed.bed_code : a.bed_id} has more than one active allocation`);
      if (activeByPatient.has(a.patient_id)) problems.push(`Patient ${pat ? pat.patient_code : a.patient_id} has more than one active allocation`);
      activeByBed.set(a.bed_id, a);
      activeByPatient.set(a.patient_id, a);
      if (!bed || !pat) { problems.push(`Allocation ${a.id} references a missing record`); continue; }
      if (bed.status !== 'OCCUPIED' || bed.current_patient_id !== pat.id) problems.push(`Bed ${bed.bed_code} is not marked occupied by ${pat.patient_code}`);
      if (!ACTIVE_PATIENT.includes(pat.status)) problems.push(`Patient ${pat.patient_code} has an active allocation but status ${pat.status}`);
    }
    for (const b of db.beds) {
      if (b.status === 'OCCUPIED' && !activeByBed.has(b.id)) problems.push(`Bed ${b.bed_code} is occupied without an active allocation`);
      if (b.status !== 'OCCUPIED' && b.current_patient_id != null) problems.push(`Bed ${b.bed_code} has a patient but status ${b.status}`);
    }
    for (const p of db.patients) {
      if (ACTIVE_PATIENT.includes(p.status) && !activeByPatient.has(p.id)) problems.push(`Patient ${p.patient_code} is ${p.status.toLowerCase()} without an active allocation`);
      const a = activeByPatient.get(p.id);
      if (a && p.status === 'ADMITTED' && !a.admitted_at) problems.push(`Patient ${p.patient_code} is admitted but the allocation has no admission time`);
      if (a && p.status === 'ALLOCATED' && a.admitted_at) problems.push(`Patient ${p.patient_code} has an admission time but is not marked admitted`);
    }
    for (const e of db.equipment) {
      if (e.tracking_mode !== 'INDIVIDUAL') continue;
      if (e.status === 'IN_USE') {
        if (!activeByBed.has(e.assigned_bed_id)) problems.push(`Equipment ${e.equipment_code} is in use without an active bed allocation`);
      } else if (e.assigned_bed_id != null) problems.push(`Equipment ${e.equipment_code} is assigned to a bed but status ${e.status}`);
    }
    return problems;
  }

  // ---------------------------------------------------------------- rules (pure)
  function compatibleTypes(db, requested) {
    const list = (db.settings.bed_type_compat || {})[requested];
    return Array.isArray(list) && list.length ? list : [requested];
  }

  function activeAllocationForBed(db, bedId) {
    return db.allocations.find((a) => a.bed_id === bedId && a.status === 'ACTIVE') || null;
  }
  function activeAllocationForPatient(db, patientId) {
    return db.allocations.find((a) => a.patient_id === patientId && a.status === 'ACTIVE') || null;
  }

  function pickDevice(db, type, wardId, excludeIds) {
    const candidates = db.equipment.filter((e) => e.tracking_mode === 'INDIVIDUAL' && e.equipment_type === type &&
      e.status === 'AVAILABLE' && e.assigned_bed_id == null && (e.ward_id === wardId || e.ward_id == null) && !excludeIds.has(e.id));
    candidates.sort((a, b) => (a.ward_id === wardId ? 0 : 1) - (b.ward_id === wardId ? 0 : 1) || a.equipment_code.localeCompare(b.equipment_code));
    return candidates[0] || null;
  }

  /** Explains whether one bed fits one patient. Resource compatibility only — not a clinical assessment. */
  function evaluateBed(db, bed, patient) {
    const ward = db.wards.find((w) => w.id === bed.ward_id);
    const matches = [];
    const unmet = [];
    let points = 0;

    if (!ward || !ward.is_active) unmet.push({ key: 'ward', text: 'Ward is inactive' });
    if (bed.status !== 'AVAILABLE') unmet.push({ key: 'status', text: `Bed is ${bed.status.toLowerCase()}` });
    else if (activeAllocationForBed(db, bed.id)) unmet.push({ key: 'status', text: 'Bed already has an active allocation' });
    else matches.push('Bed is available');

    const req = patient.required_bed_type;
    if (bed.bed_type === req) { matches.push(`Bed type matches (${req})`); points += 3; }
    else if (compatibleTypes(db, req).includes(bed.bed_type)) { matches.push(`${bed.bed_type} bed is configured as compatible with ${req}`); points += 1; }
    else unmet.push({ key: `type:${req}`, text: `Bed type ${bed.bed_type} is not compatible with required ${req}` });

    for (const f of patient.required_bed_features || []) {
      if ((bed.features || []).includes(f)) matches.push(`Has ${f}`);
      else unmet.push({ key: `feature:${f}`, text: `Missing bed feature: ${f}` });
    }
    // Prefer beds that don't tie up features the patient doesn't need.
    const spare = (bed.features || []).filter((f) => !(patient.required_bed_features || []).includes(f));
    points -= spare.length * 0.5;

    const devices = [];
    const taken = new Set();
    for (const type of patient.required_equipment_types || []) {
      const d = pickDevice(db, type, bed.ward_id, taken);
      if (d) {
        taken.add(d.id);
        devices.push({ id: d.id, equipment_code: d.equipment_code, equipment_type: d.equipment_type, ward_id: d.ward_id });
        const where = d.ward_id === bed.ward_id ? (ward ? ward.name : 'this ward') : 'shared pool';
        matches.push(`${type} ${d.equipment_code} available (${where})`);
        if (d.ward_id === bed.ward_id) points += 1;
      } else {
        unmet.push({ key: `device:${type}`, text: `No available ${type} in ${ward ? ward.name : 'this ward'} or the shared pool` });
      }
    }
    return { eligible: unmet.length === 0, matches, unmet, devices, points };
  }

  function bedCounts(beds) {
    const c = { total: beds.length };
    for (const s of BED_STATUSES) c[s] = 0;
    for (const b of beds) c[b.status]++;
    return c;
  }

  function recommendFor(db, patient, limit) {
    const activeWardIds = new Set(db.wards.filter((w) => w.is_active).map((w) => w.id));
    const beds = db.beds.filter((b) => activeWardIds.has(b.ward_id));
    const eligible = [];
    const reasonCounts = new Map();
    let notAvailable = 0;
    for (const bed of beds) {
      const ev = evaluateBed(db, bed, patient);
      if (ev.eligible) { eligible.push({ bed, ev }); continue; }
      if (ev.unmet.some((u) => u.key === 'status')) { notAvailable++; continue; }
      for (const u of ev.unmet) {
        const label = u.key.startsWith('type:') ? `Bed type not compatible with ${patient.required_bed_type}`
          : u.key.startsWith('device:') ? `No available ${u.key.slice(7)} for the bed's ward or the shared pool`
          : u.text;
        reasonCounts.set(label, (reasonCounts.get(label) || 0) + 1);
      }
    }
    eligible.sort((a, b) => b.ev.points - a.ev.points || a.bed.bed_code.localeCompare(b.bed.bed_code));
    const wardName = (id) => (db.wards.find((w) => w.id === id) || {}).name;
    const rejected = [];
    if (notAvailable) rejected.push({ reason: 'Not available (occupied, reserved, cleaning or maintenance)', count: notAvailable });
    for (const [reason, count] of reasonCounts) rejected.push({ reason, count });
    rejected.sort((a, b) => b.count - a.count);
    return {
      eligible_count: eligible.length,
      recommendations: eligible.slice(0, limit).map(({ bed, ev }, i) => ({
        rank: i + 1,
        bed_id: bed.id, bed_code: bed.bed_code, bed_type: bed.bed_type, features: bed.features,
        ward_id: bed.ward_id, ward_name: wardName(bed.ward_id),
        matches: ev.matches, devices: ev.devices,
      })),
      rejected_summary: rejected,
    };
  }

  /** Where a patient sits on the flow board. CLOSED = discharged or transferred. */
  function patientStage(p) {
    if (p.status === 'WAITING') return p.match_started_at ? 'MATCHING' : 'WAITING';
    if (ACTIVE_PATIENT.includes(p.status)) return p.status;
    return 'CLOSED';
  }

  /** Brings records saved by earlier versions up to the current shape. */
  function migrate(db) {
    for (const p of db.patients) {
      if (!p.priority) p.priority = 'ROUTINE';
      if (p.match_started_at === undefined) p.match_started_at = null;
    }
    for (const a of db.allocations) {
      if (a.status !== 'ACTIVE' || a.admitted_at !== undefined) continue;
      // Allocations made before admission tracking existed are treated as already admitted.
      a.admitted_at = a.assigned_at;
      const p = db.patients.find((x) => x.id === a.patient_id);
      if (p && p.status === 'ALLOCATED') p.status = 'ADMITTED';
    }
    return db;
  }

  // ---------------------------------------------------------------- service
  function createService(storage, options) {
    const KEY = (options && options.key) || 'meditwin.db.v1';
    const listeners = new Set();

    function load() {
      let raw = null;
      try { raw = storage.getItem(KEY); } catch (e) { raw = null; }
      if (!raw) return null;
      try {
        const db = JSON.parse(raw);
        if (db && db.schema === 1) { db.settings = Object.assign(defaultSettings(), db.settings || {}); return migrate(db); }
      } catch (e) { /* corrupted: treated as empty */ }
      return null;
    }
    const read = () => load() || emptyDb();
    const emit = () => listeners.forEach((fn) => { try { fn(); } catch (e) { console.error(e); } });

    function tx(fn) {
      const draft = read(); // fresh copy of the latest committed state (catches changes from other tabs)
      const result = fn(draft);
      const problems = integrityProblems(draft);
      if (problems.length) throw new ApiError(500, 'INTEGRITY', `Change rejected to protect data consistency: ${problems[0]}`, { problems });
      storage.setItem(KEY, JSON.stringify(draft)); // single write = atomic commit
      emit();
      return result === undefined ? undefined : clone(result);
    }

    const nextId = (db, kind) => ++db.seq[kind];

    function log(db, action, resource_type, resource_id, resource_code, message, details, at) {
      db.activity.push({ id: nextId(db, 'activity'), actor_label: 'Demo staff', action, resource_type, resource_id, resource_code, message, details: details || null, created_at: at || nowIso() });
      if (db.activity.length > 500) db.activity.splice(0, db.activity.length - 500);
    }

    const get = (list, id, label) => {
      const n = Number(id);
      const it = list.find((x) => x.id === n);
      if (!it) throw new ApiError(404, 'NOT_FOUND', `${label} not found.`);
      return it;
    };

    // ---- wards & beds
    function wardBeds(db, wardId) {
      return db.beds.filter((b) => b.ward_id === wardId).sort((a, b) => a.seq_no - b.seq_no);
    }

    function resizeWard(db, ward, count, bedType, features) {
      const beds = wardBeds(db, ward.id);
      const added = [];
      const removed = [];
      if (count > beds.length) {
        let n = beds.length ? beds[beds.length - 1].seq_no : 0;
        const ts = nowIso();
        for (let i = beds.length; i < count; i++) {
          n++;
          const bed = { id: nextId(db, 'bed'), bed_code: bedCode(ward.bed_code_prefix, n), seq_no: n, ward_id: ward.id, bed_type: bedType,
            status: 'AVAILABLE', current_patient_id: null, features: features.slice(), notes: '', created_at: ts, updated_at: ts };
          db.beds.push(bed);
          added.push(bed.bed_code);
        }
      } else if (count < beds.length) {
        const toRemove = beds.slice(count);
        const blocked = toRemove.filter((b) => b.status === 'OCCUPIED' || activeAllocationForBed(db, b.id));
        if (blocked.length) {
          throw new ApiError(409, 'UNSAFE_REDUCTION',
            `Cannot reduce ${ward.name} to ${count} beds: ${blocked.length} of the beds that would be removed have patients (${blocked.slice(0, 8).map((b) => b.bed_code).join(', ')}${blocked.length > 8 ? '…' : ''}). Release or move those patients first.`,
            { blocked: blocked.map((b) => b.bed_code) });
        }
        const ids = new Set(toRemove.map((b) => b.id));
        db.beds = db.beds.filter((b) => !ids.has(b.id));
        removed.push(...toRemove.map((b) => b.bed_code));
      }
      return { added, removed };
    }

    function wardView(db, w) {
      const beds = db.beds.filter((b) => b.ward_id === w.id);
      const counts = bedCounts(beds);
      return Object.assign({}, w, { bed_count: beds.length, counts, occupancy_pct: beds.length ? Math.round((counts.OCCUPIED / beds.length) * 100) : 0 });
    }

    const api = {
      // ---- wards
      listWards({ include_inactive = true } = {}) {
        const db = read();
        return clone(db.wards.filter((w) => include_inactive || w.is_active).map((w) => wardView(db, w)));
      },
      getWard(id) { const db = read(); return clone(wardView(db, get(db.wards, id, 'Ward'))); },

      createWard(input) {
        return tx((db) => {
          const name = requireText(input.name, 'Ward name', 60);
          if (db.wards.some((w) => lc(w.name) === lc(name))) throw new ApiError(409, 'DUPLICATE', `A ward named "${name}" already exists.`);
          const prefix = requirePrefix(str(input.bed_code_prefix) || derivePrefix(name));
          if (db.wards.some((w) => w.bed_code_prefix === prefix)) throw new ApiError(409, 'DUPLICATE', `Bed code prefix "${prefix}" is already used by another ward.`);
          const count = requireInt(input.bed_count == null ? 0 : input.bed_count, 'Bed count', 0, 500);
          const bedType = requireOneOf(input.bed_type || 'General', BED_TYPES, 'Bed type');
          const features = subsetOf(input.features, BED_FEATURES, 'Bed features');
          const ts = nowIso();
          const ward = { id: nextId(db, 'ward'), name, category: input.category ? requireOneOf(input.category, WARD_CATEGORIES, 'Category') : 'Other',
            bed_code_prefix: prefix, is_active: true, created_at: ts, updated_at: ts };
          db.wards.push(ward);
          const r = resizeWard(db, ward, count, bedType, features);
          log(db, 'WARD_CREATED', 'ward', ward.id, ward.name, `${ward.name} created with ${count} beds (${prefix}-001${count > 1 ? ` to ${bedCode(prefix, count)}` : ''})`, { added: r.added.length });
          return wardView(db, ward);
        });
      },

      updateWard(id, patch) {
        return tx((db) => {
          const ward = get(db.wards, id, 'Ward');
          const changes = [];
          if (patch.name !== undefined) {
            const name = requireText(patch.name, 'Ward name', 60);
            if (db.wards.some((w) => w.id !== ward.id && lc(w.name) === lc(name))) throw new ApiError(409, 'DUPLICATE', `A ward named "${name}" already exists.`);
            if (name !== ward.name) { changes.push(`renamed to ${name}`); ward.name = name; }
          }
          if (patch.category !== undefined) ward.category = requireOneOf(patch.category, WARD_CATEGORIES, 'Category');
          if (patch.bed_code_prefix !== undefined) {
            const prefix = requirePrefix(patch.bed_code_prefix);
            if (prefix !== ward.bed_code_prefix) {
              if (db.wards.some((w) => w.id !== ward.id && w.bed_code_prefix === prefix)) throw new ApiError(409, 'DUPLICATE', `Bed code prefix "${prefix}" is already used by another ward.`);
              ward.bed_code_prefix = prefix;
              for (const b of db.beds) if (b.ward_id === ward.id) { b.bed_code = bedCode(prefix, b.seq_no); b.updated_at = nowIso(); }
              changes.push(`bed codes now use prefix ${prefix}`);
            }
          }
          if (patch.is_active !== undefined && !!patch.is_active !== ward.is_active) {
            if (!patch.is_active) {
              const busy = db.beds.filter((b) => b.ward_id === ward.id && activeAllocationForBed(db, b.id));
              if (busy.length) throw new ApiError(409, 'WARD_IN_USE', `Cannot deactivate ${ward.name}: ${busy.length} bed(s) have active allocations. Release those patients first.`);
            }
            ward.is_active = !!patch.is_active;
            changes.push(ward.is_active ? 'reactivated' : 'deactivated');
          }
          ward.updated_at = nowIso();
          if (changes.length) log(db, 'WARD_UPDATED', 'ward', ward.id, ward.name, `${ward.name}: ${changes.join(', ')}`);
          return wardView(db, ward);
        });
      },

      /** Set the ward's bed count. Adds beds at the end; only removes the highest-numbered beds and never ones with patients. */
      generateBeds(id, input) {
        return tx((db) => {
          const ward = get(db.wards, id, 'Ward');
          const count = requireInt(input.count, 'Bed count', 0, 500);
          const bedType = requireOneOf(input.bed_type || 'General', BED_TYPES, 'Bed type');
          const features = subsetOf(input.features, BED_FEATURES, 'Bed features');
          const before = db.beds.filter((b) => b.ward_id === ward.id).length;
          const r = resizeWard(db, ward, count, bedType, features);
          ward.updated_at = nowIso();
          if (r.added.length || r.removed.length) {
            log(db, 'BEDS_GENERATED', 'ward', ward.id, ward.name,
              `${ward.name} bed count ${before} → ${count}` + (r.added.length ? ` (added ${r.added[0]}–${r.added[r.added.length - 1]})` : '') + (r.removed.length ? ` (removed ${r.removed[0]}–${r.removed[r.removed.length - 1]})` : ''),
              { added: r.added, removed: r.removed });
          }
          return Object.assign(wardView(db, ward), { added: r.added, removed: r.removed });
        });
      },

      /** Beds that a reduction to `count` would remove — lets the UI explain before confirming. */
      previewReduction(id, count) {
        const db = read();
        const ward = get(db.wards, id, 'Ward');
        const toRemove = wardBeds(db, ward.id).slice(count);
        return clone({ remove: toRemove.map((b) => ({ bed_code: b.bed_code, status: b.status })), blocked: toRemove.filter((b) => b.status === 'OCCUPIED').map((b) => b.bed_code) });
      },

      // ---- beds
      listBeds({ ward_id, status, bed_type, search } = {}) {
        const db = read();
        const activeWard = new Set(db.wards.filter((w) => w.is_active).map((w) => w.id));
        const q = lc(search);
        const wardName = new Map(db.wards.map((w) => [w.id, w.name]));
        const patCode = new Map(db.patients.map((p) => [p.id, p]));
        const wardOrder = new Map(db.wards.map((w, i) => [w.id, i]));
        return clone(db.beds
          .filter((b) => (ward_id != null && ward_id !== '' ? b.ward_id === Number(ward_id) : activeWard.has(b.ward_id)))
          .filter((b) => !status || b.status === status)
          .filter((b) => !bed_type || b.bed_type === bed_type)
          .filter((b) => !q || lc(b.bed_code).includes(q))
          .sort((a, b) => wardOrder.get(a.ward_id) - wardOrder.get(b.ward_id) || a.seq_no - b.seq_no)
          .map((b) => {
            const p = b.current_patient_id != null ? patCode.get(b.current_patient_id) : null;
            return Object.assign({}, b, { ward_name: wardName.get(b.ward_id), patient_code: p ? p.patient_code : null });
          }));
      },

      getBed(id) {
        const db = read();
        const bed = get(db.beds, id, 'Bed');
        const ward = db.wards.find((w) => w.id === bed.ward_id);
        const alloc = activeAllocationForBed(db, bed.id);
        const patient = bed.current_patient_id != null ? db.patients.find((p) => p.id === bed.current_patient_id) : null;
        const devices = db.equipment.filter((e) => e.assigned_bed_id === bed.id);
        const index = wardBeds(db, bed.ward_id).findIndex((b) => b.id === bed.id);
        return clone(Object.assign({}, bed, {
          ward_name: ward ? ward.name : '', ward_active: ward ? ward.is_active : false,
          index_in_ward: index, allocation: alloc, patient: patient || null, devices,
          allowed_transitions: MANUAL_TRANSITIONS[bed.status] || [],
        }));
      },

      updateBedStatus(id, input) {
        return tx((db) => {
          const bed = get(db.beds, id, 'Bed');
          const to = requireOneOf(input.status, BED_STATUSES, 'Status');
          if (to === bed.status) throw new ApiError(409, 'NO_CHANGE', `${bed.bed_code} is already ${to.toLowerCase()}.`);
          if (bed.status === 'OCCUPIED') throw new ApiError(409, 'INVALID_TRANSITION', `${bed.bed_code} is occupied. Release the patient through the allocation workflow first.`);
          if (to === 'OCCUPIED') throw new ApiError(409, 'INVALID_TRANSITION', 'Beds become occupied only by confirming a patient allocation.');
          if (!MANUAL_TRANSITIONS[bed.status].includes(to)) throw new ApiError(409, 'INVALID_TRANSITION', `Cannot change ${bed.bed_code} from ${bed.status.toLowerCase()} to ${to.toLowerCase()}.`);
          const from = bed.status;
          bed.status = to;
          bed.updated_at = nowIso();
          log(db, 'BED_STATUS', 'bed', bed.id, bed.bed_code, `${bed.bed_code} ${from.toLowerCase()} → ${to.toLowerCase()}`, { from, to });
          return bed;
        });
      },

      updateBed(id, patch) {
        return tx((db) => {
          const bed = get(db.beds, id, 'Bed');
          const changingSpec = patch.bed_type !== undefined || patch.features !== undefined;
          if (changingSpec && bed.status === 'OCCUPIED') throw new ApiError(409, 'BED_OCCUPIED', `Cannot change the type or features of ${bed.bed_code} while it is occupied.`);
          if (patch.bed_type !== undefined) bed.bed_type = requireOneOf(patch.bed_type, BED_TYPES, 'Bed type');
          if (patch.features !== undefined) bed.features = subsetOf(patch.features, BED_FEATURES, 'Bed features');
          if (patch.notes !== undefined) bed.notes = str(patch.notes).slice(0, 300);
          bed.updated_at = nowIso();
          log(db, 'BED_UPDATED', 'bed', bed.id, bed.bed_code, `${bed.bed_code} details updated (${bed.bed_type}${bed.features.length ? ', ' + bed.features.join(', ') : ''})`);
          return bed;
        });
      },

      // ---- patients
      listPatients({ search, status } = {}) {
        const db = read();
        const q = lc(search);
        const bedById = new Map(db.beds.map((b) => [b.id, b]));
        return clone(db.patients
          .filter((p) => !status || p.status === status)
          .filter((p) => !q || lc(p.patient_code).includes(q) || lc(p.display_name).includes(q))
          .sort((a, b) => (a.status === 'WAITING' ? 0 : 1) - (b.status === 'WAITING' ? 0 : 1) || b.id - a.id)
          .map((p) => {
            const a = activeAllocationForPatient(db, p.id);
            const bed = a ? bedById.get(a.bed_id) : null;
            return Object.assign({}, p, { allocation_id: a ? a.id : null, bed_id: bed ? bed.id : null, bed_code: bed ? bed.bed_code : null, bed_ward_id: bed ? bed.ward_id : null });
          }));
      },

      getPatient(id) {
        const db = read();
        const p = get(db.patients, id, 'Patient');
        const a = activeAllocationForPatient(db, p.id);
        const bed = a ? db.beds.find((b) => b.id === a.bed_id) : null;
        const ward = bed ? db.wards.find((w) => w.id === bed.ward_id) : null;
        const devices = a ? db.equipment.filter((e) => (a.equipment_ids || []).includes(e.id)) : [];
        const history = db.allocations.filter((x) => x.patient_id === p.id).map((x) => Object.assign({}, x, { bed_code: (db.beds.find((b) => b.id === x.bed_id) || {}).bed_code || '(removed)' }));
        const stage = patientStage(p);
        const fit = stage === 'WAITING' || stage === 'MATCHING' ? recommendFor(db, p, 0).eligible_count : null;
        return clone(Object.assign({}, p, { stage, fit_count: fit, allocation: a, bed, ward_name: ward ? ward.name : null, devices, history }));
      },

      /**
       * Patient flow board. Returns stage totals, stats and either the first few cards of every
       * stage (board view) or one page of a single stage. Bed-fit counts are only computed for
       * waiting/matching patients.
       */
      patientFlow({ search, care_category, bed_type, priority, ward_id, stage, page = 1, page_size = 24, per_column = 5 } = {}) {
        const db = read();
        const now = Date.now();
        const q = lc(search);
        const allocByPatient = new Map(db.allocations.filter((a) => a.status === 'ACTIVE').map((a) => [a.patient_id, a]));
        const bedById = new Map(db.beds.map((b) => [b.id, b]));
        const wardById = new Map(db.wards.map((w) => [w.id, w]));
        const fitCache = new Map();
        const fitOf = (p) => { if (!fitCache.has(p.id)) fitCache.set(p.id, recommendFor(db, p, 0).eligible_count); return fitCache.get(p.id); };
        const mins = (iso) => Math.max(0, Math.round((now - Date.parse(iso)) / 60000));
        const PR = { URGENT: 0, HIGH: 1, ROUTINE: 2 };

        const rows = db.patients.map((p) => {
          const a = allocByPatient.get(p.id) || null;
          const bed = a ? bedById.get(a.bed_id) : null;
          const st = patientStage(p);
          const since = st === 'WAITING' ? p.created_at : st === 'MATCHING' ? p.match_started_at
            : st === 'ALLOCATED' ? a.assigned_at : st === 'ADMITTED' ? (a.admitted_at || a.assigned_at) : p.updated_at;
          return { p, a, bed, stage: st, since };
        });
        const onBoard = rows.filter((r) => r.stage !== 'CLOSED');
        const totals = {};
        const longest = {};
        for (const s of FLOW_STAGES) { totals[s] = 0; longest[s] = 0; }
        for (const r of onBoard) { totals[r.stage]++; longest[r.stage] = Math.max(longest[r.stage], mins(r.since)); }
        const searching = onBoard.filter((r) => r.stage === 'WAITING' || r.stage === 'MATCHING');
        const today = new Date().toDateString();
        const stats = {
          longest_minutes: longest,
          no_fit: {
            WAITING: searching.filter((r) => r.stage === 'WAITING' && fitOf(r.p) === 0).length,
            MATCHING: searching.filter((r) => r.stage === 'MATCHING' && fitOf(r.p) === 0).length,
          },
          urgent_waiting: searching.filter((r) => r.p.priority === 'URGENT').length,
          released_today: rows.filter((r) => r.stage === 'CLOSED' && new Date(r.p.updated_at).toDateString() === today).length,
          total_patients: db.patients.length,
        };

        const filtered = onBoard
          .filter((r) => !q || lc(r.p.patient_code).includes(q) || lc(r.p.display_name).includes(q) || (r.bed && lc(r.bed.bed_code).includes(q)))
          .filter((r) => !care_category || r.p.care_category === care_category)
          .filter((r) => !bed_type || r.p.required_bed_type === bed_type)
          .filter((r) => !priority || r.p.priority === priority)
          .filter((r) => !ward_id || (r.bed && r.bed.ward_id === Number(ward_id)));
        const filteredCounts = {};
        for (const s of FLOW_STAGES) filteredCounts[s] = 0;
        for (const r of filtered) filteredCounts[r.stage]++;

        const sortRows = (list, s) => list.sort((a, b) => (s === 'WAITING' || s === 'MATCHING'
          ? (PR[a.p.priority] - PR[b.p.priority]) || a.since.localeCompare(b.since)
          : a.since.localeCompare(b.since)) || a.p.id - b.p.id);
        const card = (r) => {
          const ward = r.bed ? wardById.get(r.bed.ward_id) : null;
          return {
            id: r.p.id, patient_code: r.p.patient_code, display_name: r.p.display_name, care_category: r.p.care_category, priority: r.p.priority,
            required_bed_type: r.p.required_bed_type, required_equipment_types: r.p.required_equipment_types, required_bed_features: r.p.required_bed_features,
            status: r.p.status, stage: r.stage, since: r.since, minutes: mins(r.since), is_demo: r.p.is_demo,
            bed_id: r.bed ? r.bed.id : null, bed_code: r.bed ? r.bed.bed_code : null, ward_id: ward ? ward.id : null, ward_name: ward ? ward.name : null,
            allocation_id: r.a ? r.a.id : null,
            fit_count: r.stage === 'WAITING' || r.stage === 'MATCHING' ? fitOf(r.p) : null,
          };
        };

        const out = { totals, filtered_counts: filteredCounts, stats };
        if (stage) {
          requireOneOf(stage, FLOW_STAGES, 'Stage');
          const size = requireInt(page_size, 'Page size', 1, 200);
          const list = sortRows(filtered.filter((r) => r.stage === stage), stage);
          const pages = Math.max(1, Math.ceil(list.length / size));
          const pg = Math.min(Math.max(1, Number(page) || 1), pages);
          Object.assign(out, { stage, page: pg, pages, total: list.length, items: list.slice((pg - 1) * size, pg * size).map(card) });
        } else {
          out.columns = {};
          for (const s of FLOW_STAGES) out.columns[s] = sortRows(filtered.filter((r) => r.stage === s), s).slice(0, per_column).map(card);
        }
        return clone(out);
      },

      createPatient(input) {
        return tx((db) => {
          const display_name = requireText(input.display_name, 'Display name', 60);
          let code = str(input.patient_code).toUpperCase();
          if (code) {
            if (!/^[A-Z0-9-]{2,16}$/.test(code)) throw new ApiError(422, 'VALIDATION', 'Patient code must be 2–16 letters, digits or dashes.', { field: 'patient_code' });
            if (db.patients.some((p) => p.patient_code === code)) throw new ApiError(409, 'DUPLICATE', `Patient code ${code} already exists.`);
          } else {
            let n = 6000 + db.seq.patient + 1;
            while (db.patients.some((p) => p.patient_code === `P-${n}`)) n++;
            code = `P-${n}`;
          }
          const ts = nowIso();
          const p = {
            id: nextId(db, 'patient'), patient_code: code, display_name,
            care_category: requireOneOf(input.care_category || 'General Medicine', CARE_CATEGORIES, 'Care category'),
            required_bed_type: requireOneOf(input.required_bed_type || 'General', BED_TYPES, 'Required bed type'),
            required_equipment_types: subsetOf(input.required_equipment_types, DEVICE_TYPES, 'Required equipment'),
            required_bed_features: subsetOf(input.required_bed_features, BED_FEATURES, 'Special requirements'),
            priority: requireOneOf(input.priority || 'ROUTINE', PRIORITIES, 'Priority'), match_started_at: null,
            notes: str(input.notes).slice(0, 300), status: 'WAITING', is_demo: true, created_at: ts, updated_at: ts,
          };
          db.patients.push(p);
          log(db, 'PATIENT_REGISTERED', 'patient', p.id, p.patient_code, `${p.patient_code} registered (needs ${p.required_bed_type} bed)`);
          return p;
        });
      },

      updatePatient(id, patch) {
        return tx((db) => {
          const p = get(db.patients, id, 'Patient');
          if (patch.display_name !== undefined) p.display_name = requireText(patch.display_name, 'Display name', 60);
          if (patch.care_category !== undefined) p.care_category = requireOneOf(patch.care_category, CARE_CATEGORIES, 'Care category');
          if (patch.notes !== undefined) p.notes = str(patch.notes).slice(0, 300);
          if (patch.priority !== undefined) p.priority = requireOneOf(patch.priority, PRIORITIES, 'Priority');
          const reqChange = ['required_bed_type', 'required_equipment_types', 'required_bed_features'].some((k) => patch[k] !== undefined);
          if (reqChange) {
            if (p.status !== 'WAITING') throw new ApiError(409, 'PATIENT_NOT_WAITING', `Requirements can only be changed while ${p.patient_code} is waiting for a bed.`);
            if (patch.required_bed_type !== undefined) p.required_bed_type = requireOneOf(patch.required_bed_type, BED_TYPES, 'Required bed type');
            if (patch.required_equipment_types !== undefined) p.required_equipment_types = subsetOf(patch.required_equipment_types, DEVICE_TYPES, 'Required equipment');
            if (patch.required_bed_features !== undefined) p.required_bed_features = subsetOf(patch.required_bed_features, BED_FEATURES, 'Special requirements');
          }
          if (patch.status !== undefined && patch.status !== p.status) {
            requireOneOf(patch.status, PATIENT_STATUSES, 'Status');
            if (ACTIVE_PATIENT.includes(p.status) || ACTIVE_PATIENT.includes(patch.status)) throw new ApiError(409, 'INVALID_TRANSITION', 'Use allocation, admission and release to change a patient with a bed.');
            p.status = patch.status;
            p.match_started_at = null;
          }
          p.updated_at = nowIso();
          log(db, 'PATIENT_UPDATED', 'patient', p.id, p.patient_code, `${p.patient_code} updated`);
          return p;
        });
      },

      // ---- allocation
      recommendations(patientId, { limit = 12 } = {}) {
        const db = read();
        const p = get(db.patients, patientId, 'Patient');
        if (p.status !== 'WAITING') throw new ApiError(409, 'PATIENT_NOT_WAITING', `${p.patient_code} is ${p.status.toLowerCase()}, not waiting for a bed.`);
        return clone(Object.assign({ patient_id: p.id, patient_code: p.patient_code }, recommendFor(db, p, limit)));
      },

      /** Move a waiting patient into Matching (staff started a bed search). Idempotent. */
      startMatching(patientId) {
        return tx((db) => {
          const p = get(db.patients, patientId, 'Patient');
          if (p.status !== 'WAITING') throw new ApiError(409, 'PATIENT_NOT_WAITING', `${p.patient_code} is ${p.status.toLowerCase()}, not waiting for a bed.`);
          if (!p.match_started_at) {
            p.match_started_at = nowIso(); p.updated_at = p.match_started_at;
            log(db, 'MATCHING_STARTED', 'patient', p.id, p.patient_code, `Bed search started for ${p.patient_code}`);
          }
          return p;
        });
      },

      /** Move a matching patient back to Waiting. */
      stopMatching(patientId) {
        return tx((db) => {
          const p = get(db.patients, patientId, 'Patient');
          if (p.status !== 'WAITING') throw new ApiError(409, 'PATIENT_NOT_WAITING', `${p.patient_code} is ${p.status.toLowerCase()}, not waiting for a bed.`);
          if (p.match_started_at) {
            p.match_started_at = null; p.updated_at = nowIso();
            log(db, 'MATCHING_STOPPED', 'patient', p.id, p.patient_code, `Bed search paused for ${p.patient_code}`);
          }
          return p;
        });
      },

      /** The allocated patient has arrived at the bed. */
      admitPatient(allocationId) {
        return tx((db) => {
          const a = get(db.allocations, allocationId, 'Allocation');
          if (a.status !== 'ACTIVE') throw new ApiError(409, 'NOT_ACTIVE', 'This allocation is no longer active.');
          const p = db.patients.find((x) => x.id === a.patient_id);
          if (p.status !== 'ALLOCATED' || a.admitted_at) throw new ApiError(409, 'ALREADY_ADMITTED', `${p.patient_code} is already admitted.`);
          const bed = db.beds.find((b) => b.id === a.bed_id);
          const ts = nowIso();
          a.admitted_at = ts;
          p.status = 'ADMITTED'; p.updated_at = ts;
          log(db, 'ADMITTED', 'patient', p.id, p.patient_code, `${p.patient_code} admitted to ${bed.bed_code}`, { allocation_id: a.id });
          return { allocation_id: a.id, patient_code: p.patient_code, bed_code: bed.bed_code };
        });
      },

      /** Undo an allocation before the patient arrives: bed back to Available, patient back to Waiting. */
      cancelAllocation(allocationId) {
        return tx((db) => {
          const a = get(db.allocations, allocationId, 'Allocation');
          if (a.status !== 'ACTIVE') throw new ApiError(409, 'NOT_ACTIVE', 'This allocation is no longer active.');
          const p = db.patients.find((x) => x.id === a.patient_id);
          if (a.admitted_at || p.status === 'ADMITTED') throw new ApiError(409, 'ALREADY_ADMITTED', `${p.patient_code} has already been admitted. Use discharge or transfer instead.`);
          const bed = db.beds.find((b) => b.id === a.bed_id);
          const ts = nowIso();
          a.status = 'CANCELLED'; a.released_at = ts; a.outcome = 'CANCELLED';
          bed.status = 'AVAILABLE'; bed.current_patient_id = null; bed.updated_at = ts;
          p.status = 'WAITING'; p.match_started_at = null; p.updated_at = ts;
          for (const e of db.equipment) {
            if (e.assigned_bed_id === bed.id) { e.status = 'AVAILABLE'; e.assigned_bed_id = null; e.updated_at = ts; }
          }
          log(db, 'ALLOCATION_CANCELLED', 'bed', bed.id, bed.bed_code, `Allocation of ${bed.bed_code} to ${p.patient_code} cancelled; bed available again`, { patient_id: p.id, allocation_id: a.id });
          return { allocation_id: a.id, patient_code: p.patient_code, bed_code: bed.bed_code };
        });
      },

      /** Waiting patients evaluated against one bed (used when staff start from a bed). */
      bedCandidates(bedId) {
        const db = read();
        const bed = get(db.beds, bedId, 'Bed');
        return clone(db.patients.filter((p) => p.status === 'WAITING').map((p) => {
          const ev = evaluateBed(db, bed, p);
          return { patient_id: p.id, patient_code: p.patient_code, display_name: p.display_name, required_bed_type: p.required_bed_type,
            eligible: ev.eligible, matches: ev.matches, unmet: ev.unmet.map((u) => u.text), devices: ev.devices };
        }).sort((a, b) => Number(b.eligible) - Number(a.eligible) || a.patient_code.localeCompare(b.patient_code)));
      },

      /** Confirm an allocation. Rechecks every rule against the latest stored state; all-or-nothing. */
      allocate({ patient_id, bed_id, confirmed_by }) {
        return tx((db) => {
          const p = get(db.patients, patient_id, 'Patient');
          const bed = get(db.beds, bed_id, 'Bed');
          if (p.status !== 'WAITING' || activeAllocationForPatient(db, p.id)) throw new ApiError(409, 'PATIENT_NOT_WAITING', `${p.patient_code} is no longer waiting for a bed (status: ${p.status.toLowerCase()}). Refresh and review.`);
          const ev = evaluateBed(db, bed, p);
          const statusIssue = ev.unmet.find((u) => u.key === 'status' || u.key === 'ward');
          if (statusIssue) throw new ApiError(409, 'BED_UNAVAILABLE', `${bed.bed_code} can't be allocated: ${statusIssue.text.toLowerCase()}. Refresh and choose another bed.`);
          const mismatch = ev.unmet.filter((u) => u.key.startsWith('type:') || u.key.startsWith('feature:'));
          if (mismatch.length) throw new ApiError(422, 'REQUIREMENT_MISMATCH', `${bed.bed_code} does not meet ${p.patient_code}'s requirements: ${mismatch.map((u) => u.text).join('; ')}.`, { unmet: mismatch });
          const missingDevice = ev.unmet.filter((u) => u.key.startsWith('device:'));
          if (missingDevice.length) throw new ApiError(409, 'EQUIPMENT_UNAVAILABLE', `${missingDevice.map((u) => u.text).join('; ')}.`, { unmet: missingDevice });

          const ts = nowIso();
          const alloc = { id: nextId(db, 'allocation'), patient_id: p.id, bed_id: bed.id, status: 'ACTIVE', assigned_at: ts, admitted_at: null, released_at: null,
            confirmed_by: str(confirmed_by) || 'Demo staff', equipment_ids: ev.devices.map((d) => d.id), outcome: null };
          db.allocations.push(alloc);
          bed.status = 'OCCUPIED'; bed.current_patient_id = p.id; bed.updated_at = ts;
          p.status = 'ALLOCATED'; p.match_started_at = null; p.updated_at = ts;
          for (const d of ev.devices) {
            const e = db.equipment.find((x) => x.id === d.id);
            e.status = 'IN_USE'; e.assigned_bed_id = bed.id; e.updated_at = ts;
          }
          const ward = db.wards.find((w) => w.id === bed.ward_id);
          log(db, 'ALLOCATED', 'bed', bed.id, bed.bed_code, `${bed.bed_code} (${ward.name}) allocated to ${p.patient_code}` + (ev.devices.length ? ` with ${ev.devices.map((d) => d.equipment_code).join(', ')}` : ''), { patient_id: p.id, allocation_id: alloc.id });
          return Object.assign({}, alloc, { bed_code: bed.bed_code, patient_code: p.patient_code, devices: ev.devices });
        });
      },

      releaseAllocation(allocationId, { outcome = 'DISCHARGED' } = {}) {
        return tx((db) => {
          const alloc = get(db.allocations, allocationId, 'Allocation');
          if (alloc.status !== 'ACTIVE') throw new ApiError(409, 'NOT_ACTIVE', 'This allocation has already been released.');
          requireOneOf(outcome, ['DISCHARGED', 'TRANSFERRED'], 'Outcome');
          const bed = db.beds.find((b) => b.id === alloc.bed_id);
          const p = db.patients.find((x) => x.id === alloc.patient_id);
          const ts = nowIso();
          const next = db.settings.release_to_cleaning ? 'CLEANING' : 'AVAILABLE';
          alloc.status = 'RELEASED'; alloc.released_at = ts; alloc.outcome = outcome;
          bed.status = next; bed.current_patient_id = null; bed.updated_at = ts;
          p.status = outcome; p.updated_at = ts;
          for (const e of db.equipment) {
            if (e.assigned_bed_id === bed.id) { e.status = 'AVAILABLE'; e.assigned_bed_id = null; e.updated_at = ts; }
          }
          log(db, 'RELEASED', 'bed', bed.id, bed.bed_code, `${bed.bed_code} released (${p.patient_code} ${outcome.toLowerCase()}); bed → ${next.toLowerCase()}`, { patient_id: p.id, allocation_id: alloc.id });
          return { allocation_id: alloc.id, bed_code: bed.bed_code, bed_status: next, patient_code: p.patient_code, outcome };
        });
      },

      listAllocations({ status, limit = 50 } = {}) {
        const db = read();
        const bed = new Map(db.beds.map((b) => [b.id, b]));
        const pat = new Map(db.patients.map((p) => [p.id, p]));
        const ward = new Map(db.wards.map((w) => [w.id, w]));
        return clone(db.allocations.filter((a) => !status || a.status === status)
          .sort((a, b) => (b.released_at || b.assigned_at).localeCompare(a.released_at || a.assigned_at))
          .slice(0, limit)
          .map((a) => {
            const b = bed.get(a.bed_id);
            return Object.assign({}, a, { bed_code: b ? b.bed_code : '(removed)', ward_name: b ? (ward.get(b.ward_id) || {}).name : '', patient_code: (pat.get(a.patient_id) || {}).patient_code });
          }));
      },

      // ---- equipment
      listEquipment({ ward_id, status, type, search, tracking_mode } = {}) {
        const db = read();
        const q = lc(search);
        const wardName = new Map(db.wards.map((w) => [w.id, w.name]));
        const bedById = new Map(db.beds.map((b) => [b.id, b]));
        return clone(db.equipment
          .filter((e) => ward_id === undefined || ward_id === '' ? true : ward_id === 'pool' ? e.ward_id == null : e.ward_id === Number(ward_id))
          .filter((e) => !status || e.status === status)
          .filter((e) => !type || e.equipment_type === type)
          .filter((e) => !tracking_mode || e.tracking_mode === tracking_mode)
          .filter((e) => !q || lc(e.equipment_code).includes(q) || lc(e.equipment_type).includes(q))
          .sort((a, b) => a.equipment_code.localeCompare(b.equipment_code))
          .map((e) => {
            const bed = e.assigned_bed_id != null ? bedById.get(e.assigned_bed_id) : null;
            return Object.assign({}, e, { ward_name: e.ward_id == null ? 'Shared pool' : wardName.get(e.ward_id), bed_code: bed ? bed.bed_code : null, bed_ward_id: bed ? bed.ward_id : null });
          }));
      },

      getEquipment(id) {
        const db = read();
        const e = get(db.equipment, id, 'Equipment');
        const ward = db.wards.find((w) => w.id === e.ward_id);
        const bed = db.beds.find((b) => b.id === e.assigned_bed_id);
        return clone(Object.assign({}, e, { ward_name: ward ? ward.name : 'Shared pool', bed_code: bed ? bed.bed_code : null, bed_ward_id: bed ? bed.ward_id : null }));
      },

      createEquipment(input) {
        return tx((db) => {
          const mode = requireOneOf(input.tracking_mode || 'INDIVIDUAL', ['INDIVIDUAL', 'QUANTITY'], 'Tracking mode');
          const wardId = input.ward_id === '' || input.ward_id == null || input.ward_id === 'pool' ? null : get(db.wards, input.ward_id, 'Ward').id;
          const ts = nowIso();
          let e;
          if (mode === 'INDIVIDUAL') {
            const type = requireOneOf(input.equipment_type, DEVICE_TYPES, 'Equipment type');
            let code = str(input.equipment_code).toUpperCase();
            if (code) {
              if (!/^[A-Z0-9-]{2,16}$/.test(code)) throw new ApiError(422, 'VALIDATION', 'Equipment code must be 2–16 letters, digits or dashes.', { field: 'equipment_code' });
              if (db.equipment.some((x) => x.equipment_code === code)) throw new ApiError(409, 'DUPLICATE', `Equipment code ${code} already exists.`);
            } else {
              let n = db.equipment.filter((x) => x.equipment_type === type).length + 1;
              while (db.equipment.some((x) => x.equipment_code === `${DEVICE_PREFIX[type]}-${pad3(n)}`)) n++;
              code = `${DEVICE_PREFIX[type]}-${pad3(n)}`;
            }
            e = { id: nextId(db, 'equipment'), equipment_code: code, equipment_type: type, tracking_mode: mode, status: 'AVAILABLE',
              ward_id: wardId, assigned_bed_id: null, quantity_total: null, quantity_available: null, notes: str(input.notes).slice(0, 300), created_at: ts, updated_at: ts };
          } else {
            const type = requireOneOf(input.equipment_type, QUANTITY_TYPES, 'Equipment type');
            if (db.equipment.some((x) => x.tracking_mode === 'QUANTITY' && x.equipment_type === type && x.ward_id === wardId)) {
              throw new ApiError(409, 'DUPLICATE', `${type} stock already exists for this location — edit its quantity instead.`);
            }
            const total = requireInt(input.quantity_total, 'Quantity', 0, 10000);
            const wardPart = wardId == null ? 'POOL' : db.wards.find((w) => w.id === wardId).bed_code_prefix;
            e = { id: nextId(db, 'equipment'), equipment_code: `QTY-${type.replace(/[^A-Z]/gi, '').slice(0, 3).toUpperCase()}-${wardPart}`, equipment_type: type, tracking_mode: mode,
              status: 'AVAILABLE', ward_id: wardId, assigned_bed_id: null, quantity_total: total, quantity_available: total, notes: str(input.notes).slice(0, 300), created_at: ts, updated_at: ts };
          }
          db.equipment.push(e);
          log(db, 'EQUIPMENT_ADDED', 'equipment', e.id, e.equipment_code, mode === 'INDIVIDUAL' ? `${e.equipment_type} ${e.equipment_code} added to inventory` : `${e.equipment_type} stock added (${e.quantity_total})`);
          return e;
        });
      },

      updateEquipment(id, patch) {
        return tx((db) => {
          const e = get(db.equipment, id, 'Equipment');
          const changes = [];
          if (e.tracking_mode === 'INDIVIDUAL') {
            if ((patch.status !== undefined && patch.status !== e.status) || (patch.ward_id !== undefined)) {
              if (e.status === 'IN_USE') {
                const bed = db.beds.find((b) => b.id === e.assigned_bed_id);
                throw new ApiError(409, 'EQUIPMENT_IN_USE', `${e.equipment_code} is in use at bed ${bed ? bed.bed_code : '?'}. Release that allocation first.`);
              }
            }
            if (patch.status !== undefined && patch.status !== e.status) {
              const to = requireOneOf(patch.status, ['AVAILABLE', 'RESERVED', 'MAINTENANCE'], 'Status');
              changes.push(`${e.status.toLowerCase()} → ${to.toLowerCase()}`);
              e.status = to;
            }
            if (patch.ward_id !== undefined) {
              const wardId = patch.ward_id === '' || patch.ward_id == null || patch.ward_id === 'pool' ? null : get(db.wards, patch.ward_id, 'Ward').id;
              if (wardId !== e.ward_id) { e.ward_id = wardId; changes.push(`moved to ${wardId == null ? 'shared pool' : db.wards.find((w) => w.id === wardId).name}`); }
            }
          } else {
            const total = patch.quantity_total !== undefined ? requireInt(patch.quantity_total, 'Total quantity', 0, 10000) : e.quantity_total;
            const avail = patch.quantity_available !== undefined ? requireInt(patch.quantity_available, 'Available quantity', 0, 10000) : e.quantity_available;
            if (avail > total) throw new ApiError(422, 'VALIDATION', 'Available quantity cannot exceed total quantity.', { field: 'quantity_available' });
            if (total !== e.quantity_total || avail !== e.quantity_available) changes.push(`${avail}/${total} available`);
            e.quantity_total = total; e.quantity_available = avail;
          }
          if (patch.notes !== undefined) e.notes = str(patch.notes).slice(0, 300);
          e.updated_at = nowIso();
          log(db, 'EQUIPMENT_UPDATED', 'equipment', e.id, e.equipment_code, `${e.equipment_type} ${e.equipment_code}${changes.length ? ': ' + changes.join(', ') : ' updated'}`);
          return e;
        });
      },

      // ---- dashboard, alerts, activity
      summary() {
        const db = read();
        const activeWards = db.wards.filter((w) => w.is_active);
        const ids = new Set(activeWards.map((w) => w.id));
        const beds = db.beds.filter((b) => ids.has(b.ward_id));
        const devices = db.equipment.filter((e) => e.tracking_mode === 'INDIVIDUAL');
        const byType = {};
        for (const t of DEVICE_TYPES) {
          byType[t] = { total: 0 };
          for (const s of EQUIPMENT_STATUSES) byType[t][s] = 0;
        }
        const devTotals = { total: devices.length };
        for (const s of EQUIPMENT_STATUSES) devTotals[s] = 0;
        for (const d of devices) { byType[d.equipment_type].total++; byType[d.equipment_type][d.status]++; devTotals[d.status]++; }
        const patients = {};
        for (const s of PATIENT_STATUSES) patients[s] = db.patients.filter((p) => p.status === s).length;
        return clone({
          beds: bedCounts(beds),
          wards: activeWards.map((w) => wardView(db, w)),
          equipment: { devices: devTotals, by_type: byType, stock: db.equipment.filter((e) => e.tracking_mode === 'QUANTITY') },
          patients,
          generated_at: nowIso(),
        });
      },

      alerts() {
        const db = read();
        const s = db.settings;
        const out = [];
        for (const w of db.wards.filter((x) => x.is_active)) {
          const v = wardView(db, w);
          if (!v.bed_count) continue;
          const availPct = Math.round((v.counts.AVAILABLE / v.bed_count) * 100);
          if (v.counts.AVAILABLE === 0) out.push({ id: `noavail-${w.id}`, severity: 'critical', kind: 'LOW_AVAILABILITY', title: `No available beds in ${w.name}`, detail: `0 of ${v.bed_count} beds available`, ward_id: w.id });
          else if (availPct <= s.low_available_pct) out.push({ id: `lowavail-${w.id}`, severity: 'warning', kind: 'LOW_AVAILABILITY', title: `Low availability in ${w.name}`, detail: `${v.counts.AVAILABLE} of ${v.bed_count} beds available (${availPct}% ≤ ${s.low_available_pct}% threshold)`, ward_id: w.id });
          if (v.occupancy_pct >= s.high_occupancy_pct) out.push({ id: `highocc-${w.id}`, severity: 'warning', kind: 'HIGH_OCCUPANCY', title: `High occupancy in ${w.name}`, detail: `${v.occupancy_pct}% occupied (threshold ${s.high_occupancy_pct}%)`, ward_id: w.id });
        }
        for (const t of DEVICE_TYPES) {
          const avail = db.equipment.filter((e) => e.tracking_mode === 'INDIVIDUAL' && e.equipment_type === t && e.status === 'AVAILABLE').length;
          const min = (s.equipment_min_available || {})[t] || 0;
          if (avail < min) out.push({ id: `short-${t}`, severity: avail === 0 ? 'critical' : 'warning', kind: 'EQUIPMENT_SHORTAGE', title: `Equipment shortage: ${t}`, detail: `${avail} available (minimum ${min})`, equipment_type: t });
        }
        for (const st of db.equipment.filter((e) => e.tracking_mode === 'QUANTITY' && e.quantity_total > 0 && e.quantity_available === 0)) {
          out.push({ id: `stock-${st.id}`, severity: 'warning', kind: 'EQUIPMENT_SHORTAGE', title: `${st.equipment_type} stock exhausted`, detail: `0 of ${st.quantity_total} available`, equipment_type: st.equipment_type });
        }
        const maint = db.beds.filter((b) => b.status === 'MAINTENANCE' && db.wards.some((w) => w.id === b.ward_id && w.is_active));
        if (maint.length) {
          const per = new Map();
          for (const b of maint) { const n = db.wards.find((w) => w.id === b.ward_id).name; per.set(n, (per.get(n) || 0) + 1); }
          out.push({ id: 'maint-beds', severity: 'info', kind: 'MAINTENANCE', title: `${maint.length} bed${maint.length > 1 ? 's' : ''} under maintenance`, detail: Array.from(per).map(([n, c]) => `${n}: ${c}`).join(' · ') });
        }
        const maintDev = db.equipment.filter((e) => e.tracking_mode === 'INDIVIDUAL' && e.status === 'MAINTENANCE');
        if (maintDev.length) out.push({ id: 'maint-dev', severity: 'info', kind: 'MAINTENANCE', title: `${maintDev.length} device${maintDev.length > 1 ? 's' : ''} under maintenance`, detail: maintDev.slice(0, 6).map((e) => e.equipment_code).join(', ') + (maintDev.length > 6 ? '…' : '') });
        for (const p of db.patients.filter((x) => x.status === 'WAITING')) {
          const r = recommendFor(db, p, 1);
          if (!r.eligible_count) out.push({ id: `nobed-${p.id}`, severity: 'warning', kind: 'NO_SUITABLE_BED', title: `No suitable bed for ${p.patient_code}`, detail: `Needs ${p.required_bed_type} bed${p.required_equipment_types.length ? ' + ' + p.required_equipment_types.join(', ') : ''}${p.required_bed_features.length ? ' + ' + p.required_bed_features.join(', ') : ''}`, patient_id: p.id });
        }
        for (const prob of integrityProblems(db)) out.push({ id: `conflict-${prob}`, severity: 'critical', kind: 'ALLOCATION_CONFLICT', title: 'Allocation conflict', detail: prob });
        const order = { critical: 0, warning: 1, info: 2 };
        return clone(out.sort((a, b) => order[a.severity] - order[b.severity]));
      },

      activity({ limit = 30, resource_type } = {}) {
        const db = read();
        return clone(db.activity.filter((a) => !resource_type || a.resource_type === resource_type).sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id).slice(0, limit));
      },

      // ---- settings
      getSettings() { return clone(read().settings); },
      updateSettings(patch) {
        return tx((db) => {
          const s = db.settings;
          if (patch.low_available_pct !== undefined) s.low_available_pct = requireInt(patch.low_available_pct, 'Low availability threshold', 0, 100);
          if (patch.high_occupancy_pct !== undefined) s.high_occupancy_pct = requireInt(patch.high_occupancy_pct, 'High occupancy threshold', 1, 100);
          if (patch.group_size !== undefined) s.group_size = requireInt(patch.group_size, 'Visual group size', 4, 30);
          if (patch.release_to_cleaning !== undefined) s.release_to_cleaning = !!patch.release_to_cleaning;
          if (patch.equipment_min_available) {
            for (const t of DEVICE_TYPES) if (patch.equipment_min_available[t] !== undefined) s.equipment_min_available[t] = requireInt(patch.equipment_min_available[t], `${t} minimum`, 0, 1000);
          }
          if (patch.bed_type_compat) {
            for (const t of BED_TYPES) {
              if (patch.bed_type_compat[t] === undefined) continue;
              const list = subsetOf(patch.bed_type_compat[t], BED_TYPES, `Compatible types for ${t}`);
              if (!list.includes(t)) list.unshift(t);
              s.bed_type_compat[t] = list;
            }
          }
          log(db, 'SETTINGS_UPDATED', 'settings', 0, 'settings', 'Thresholds and allocation rules updated');
          return s;
        });
      },

      // ---- simulation (read-only: never writes)
      simulateSurge({ count = 20, seed = 7 } = {}) {
        const n = requireInt(count, 'Simulated arrivals', 1, 300);
        const db = read();
        const rnd = mulberry32(Number(seed) || 7);
        const mix = [['General', 0.55], ['ICU', 0.15], ['Pediatric', 0.15], ['Maternity', 0.1], ['Isolation', 0.05]];
        const byType = new Map(BED_TYPES.map((t) => [t, { type: t, requested: 0, placed: 0 }]));
        const unplacedReasons = new Map();
        let placed = 0;
        for (let i = 0; i < n; i++) {
          let r = rnd(); let type = 'General';
          for (const [t, w] of mix) { if (r < w) { type = t; break; } r -= w; }
          const devs = type === 'ICU' ? (rnd() < 0.5 ? ['Monitor', 'Ventilator'] : ['Monitor']) : rnd() < 0.2 ? ['Monitor'] : [];
          const feats = type === 'ICU' || rnd() < 0.25 ? ['Oxygen Outlet'] : [];
          const sim = { id: -1 - i, patient_code: `SIM-${i + 1}`, required_bed_type: type, required_equipment_types: devs, required_bed_features: feats };
          byType.get(type).requested++;
          const rec = recommendFor(db, sim, 1);
          if (rec.recommendations.length) {
            const best = rec.recommendations[0];
            const bed = db.beds.find((b) => b.id === best.bed_id);
            bed.status = 'OCCUPIED'; bed.current_patient_id = sim.id;
            db.allocations.push({ id: -1 - i, bed_id: bed.id, patient_id: sim.id, status: 'ACTIVE' });
            for (const d of best.devices) { const e = db.equipment.find((x) => x.id === d.id); e.status = 'IN_USE'; e.assigned_bed_id = bed.id; }
            byType.get(type).placed++; placed++;
          } else {
            const reason = rec.rejected_summary.find((x) => !x.reason.startsWith('Not available'));
            const label = reason ? reason.reason : `No available ${type} beds`;
            unplacedReasons.set(label, (unplacedReasons.get(label) || 0) + 1);
          }
        }
        const activeWards = db.wards.filter((w) => w.is_active);
        return clone({
          simulated: true, arrivals: n, placed, unplaced: n - placed,
          by_type: Array.from(byType.values()).filter((x) => x.requested),
          unplaced_reasons: Array.from(unplacedReasons, ([reason, c]) => ({ reason, count: c })).sort((a, b) => b.count - a.count),
          wards_after: activeWards.map((w) => { const v = wardView(db, w); return { name: w.name, bed_count: v.bed_count, available: v.counts.AVAILABLE, occupancy_pct: v.occupancy_pct }; }),
        });
      },

      // ---- global search
      search(q) {
        const db = read();
        const s = lc(q);
        if (!s) return { wards: [], beds: [], equipment: [], patients: [] };
        const wardName = new Map(db.wards.map((w) => [w.id, w.name]));
        return clone({
          wards: db.wards.filter((w) => lc(w.name).includes(s) || lc(w.bed_code_prefix) === s).slice(0, 5),
          beds: db.beds.filter((b) => lc(b.bed_code).includes(s)).slice(0, 8).map((b) => ({ id: b.id, bed_code: b.bed_code, status: b.status, ward_id: b.ward_id, ward_name: wardName.get(b.ward_id) })),
          equipment: db.equipment.filter((e) => lc(e.equipment_code).includes(s)).slice(0, 5).map((e) => ({ id: e.id, equipment_code: e.equipment_code, equipment_type: e.equipment_type, status: e.status })),
          patients: db.patients.filter((p) => lc(p.patient_code).includes(s) || lc(p.display_name).includes(s)).slice(0, 5).map((p) => ({ id: p.id, patient_code: p.patient_code, display_name: p.display_name, status: p.status })),
        });
      },

      // ---- seed / reset
      isEmpty() { const db = load(); return !db || db.wards.length === 0; },
      seedDemo() { return tx((db) => seedInto(db, nextId, log)); },
      resetDemo() {
        storage.setItem(KEY, JSON.stringify(emptyDb()));
        return api.seedDemo();
      },
      clearAll() { storage.setItem(KEY, JSON.stringify(emptyDb())); emit(); },

      integrityProblems() { return integrityProblems(read()); },
      subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
      /** Called when another tab changed storage. */
      notifyExternalChange() { emit(); },
      storageKey: KEY,
    };
    return api;
  }

  // ---------------------------------------------------------------- seed data (fictional)
  const FIRST = ['Asha', 'Ben', 'Chloe', 'Dev', 'Elena', 'Farid', 'Grace', 'Hiro', 'Isla', 'Jonah', 'Kavya', 'Liam', 'Maya', 'Noah', 'Olu', 'Priya', 'Quinn', 'Rosa', 'Sami', 'Tara', 'Uma', 'Vik', 'Wren', 'Yara', 'Zane', 'Leela', 'Omar', 'Nina', 'Ravi', 'Ines'];
  const LAST = ['Arden', 'Bell', 'Castillo', 'Desai', 'Ellis', 'Fontaine', 'Gupta', 'Hale', 'Ito', 'Jensen', 'Khan', 'Lowe', 'Mehta', 'Novak', 'Okafor', 'Pereira', 'Quill', 'Rao', 'Silva', 'Thorne', 'Usman', 'Varga', 'Walsh', 'Yilmaz', 'Zhou'];

  const SEED_WARDS = [
    { name: 'Ward 1', category: 'General Ward', prefix: 'W1', count: 100, type: 'General', occ: 0.3,
      features: (n) => [...(n % 2 ? ['Oxygen Outlet'] : []), ...(n % 10 === 0 ? ['Suction'] : []), ...(n > 90 ? ['Isolation Capable'] : []), ...(n === 45 || n === 46 ? ['Bariatric'] : [])] },
    { name: 'Ward 2', category: 'General Ward', prefix: 'W2', count: 40, type: 'General', occ: 0.4, features: (n) => (n % 3 === 0 ? ['Oxygen Outlet'] : []) },
    { name: 'ICU', category: 'Critical Care', prefix: 'ICU', count: 20, type: 'ICU', occ: 0.7, features: (n) => ['Oxygen Outlet', 'Suction', ...(n <= 4 ? ['Isolation Capable'] : [])] },
    { name: 'Pediatrics', category: 'Paediatrics', prefix: 'PED', count: 30, type: 'Pediatric', occ: 0.3, features: (n) => (n % 2 === 0 ? ['Oxygen Outlet'] : []) },
    { name: 'Maternity', category: 'Maternity', prefix: 'MAT', count: 15, type: 'Maternity', occ: 0.35, features: () => ['Oxygen Outlet'] },
  ];
  const CARE_FOR_TYPE = { General: 'General Medicine', ICU: 'Critical Care', Pediatric: 'Paediatrics', Maternity: 'Maternity', Isolation: 'Infectious Disease' };
  const WAITING = [
    { code: 'P-9001', type: 'General', devs: ['Monitor'], feats: ['Oxygen Outlet'], care: 'General Medicine', priority: 'HIGH', matchAgo: 9 },
    { code: 'P-9002', type: 'General', devs: [], feats: [], care: 'Surgery Recovery', priority: 'ROUTINE' },
    { code: 'P-9003', type: 'ICU', devs: ['Monitor', 'Ventilator'], feats: [], care: 'Critical Care', priority: 'URGENT', matchAgo: 4 },
    { code: 'P-9004', type: 'Pediatric', devs: ['Infusion Pump'], feats: ['Oxygen Outlet'], care: 'Paediatrics', priority: 'HIGH' },
    { code: 'P-9005', type: 'Maternity', devs: ['Monitor'], feats: [], care: 'Maternity', priority: 'ROUTINE' },
    { code: 'P-9006', type: 'General', devs: [], feats: ['Isolation Capable'], care: 'Infectious Disease', priority: 'HIGH' },
    { code: 'P-9007', type: 'Isolation', devs: ['Monitor'], feats: [], care: 'Infectious Disease', priority: 'URGENT' },
    { code: 'P-9008', type: 'General', devs: ['Infusion Pump'], feats: ['Bariatric'], care: 'Surgery Recovery', priority: 'ROUTINE' },
  ];

  function seedInto(db, nextId, log) {
    const base = Date.now();
    const at = (minAgo) => new Date(base - minAgo * 60000).toISOString();
    const created = { wards: 0, beds: 0, patients: 0, equipment: 0 };
    const newWards = [];

    SEED_WARDS.forEach((sw) => {
      if (db.wards.some((w) => lc(w.name) === lc(sw.name) || w.bed_code_prefix === sw.prefix)) return;
      const ts = at(60 * 24 * 3);
      const ward = { id: nextId(db, 'ward'), name: sw.name, category: sw.category, bed_code_prefix: sw.prefix, is_active: true, created_at: ts, updated_at: ts };
      db.wards.push(ward);
      created.wards++;
      for (let n = 1; n <= sw.count; n++) {
        db.beds.push({ id: nextId(db, 'bed'), bed_code: bedCode(sw.prefix, n), seq_no: n, ward_id: ward.id, bed_type: sw.type, status: 'AVAILABLE',
          current_patient_id: null, features: sw.features(n), notes: '', created_at: ts, updated_at: ts });
        created.beds++;
      }
      newWards.push({ ward, sw });
    });

    // Equipment: individually tracked devices + counted stock.
    const wardIdByName = (name) => { const w = db.wards.find((x) => x.name === name); return w ? w.id : null; };
    const deviceSpec = [
      ['Monitor', 60, ['Ward 1', 'Ward 1', 'Ward 1', 'Ward 2', 'ICU', 'ICU', 'Pediatrics', 'Maternity', null]],
      ['Ventilator', 14, ['ICU', 'ICU', 'ICU', null]],
      ['Infusion Pump', 40, ['Ward 1', 'Ward 2', 'ICU', 'Pediatrics', 'Maternity', null]],
    ];
    const maintenanceCodes = new Set(['MON-007', 'MON-031', 'VEN-013', 'INF-022']);
    for (const [type, total, rota] of deviceSpec) {
      for (let i = 1; i <= total; i++) {
        const code = `${DEVICE_PREFIX[type]}-${pad3(i)}`;
        if (db.equipment.some((e) => e.equipment_code === code)) continue;
        const wn = rota[(i - 1) % rota.length];
        const ts = at(60 * 24 * 3);
        db.equipment.push({ id: nextId(db, 'equipment'), equipment_code: code, equipment_type: type, tracking_mode: 'INDIVIDUAL',
          status: maintenanceCodes.has(code) ? 'MAINTENANCE' : 'AVAILABLE', ward_id: wn ? wardIdByName(wn) : null, assigned_bed_id: null,
          quantity_total: null, quantity_available: null, notes: maintenanceCodes.has(code) ? 'Scheduled service (demo)' : '', created_at: ts, updated_at: ts });
        created.equipment++;
      }
    }
    for (const [type, total, avail] of [['Wheelchair', 25, 18], ['Oxygen Cylinder', 40, 31], ['Stretcher', 10, 7]]) {
      const code = `QTY-${type.replace(/[^A-Z]/gi, '').slice(0, 3).toUpperCase()}-POOL`;
      if (db.equipment.some((e) => e.equipment_code === code)) continue;
      const ts = at(60 * 24 * 3);
      db.equipment.push({ id: nextId(db, 'equipment'), equipment_code: code, equipment_type: type, tracking_mode: 'QUANTITY', status: 'AVAILABLE',
        ward_id: null, assigned_bed_id: null, quantity_total: total, quantity_available: avail, notes: '', created_at: ts, updated_at: ts });
      created.equipment++;
    }

    // Statuses and current (fictional) patients, only for wards created in this run.
    const takeDevice = (type, wardId, bedId, ts) => {
      const d = pickDevice(db, type, wardId, new Set());
      if (!d) return null;
      d.status = 'IN_USE'; d.assigned_bed_id = bedId; d.updated_at = ts;
      return d.id;
    };
    newWards.forEach(({ ward, sw }) => {
      const wardIdx = SEED_WARDS.indexOf(sw) + 1;
      const rnd = mulberry32(1000 + wardIdx);
      for (const bed of db.beds.filter((b) => b.ward_id === ward.id)) {
        const r = rnd();
        const pick = r < sw.occ ? 'OCCUPIED' : r < sw.occ + 0.06 ? 'RESERVED' : r < sw.occ + 0.11 ? 'CLEANING' : r < sw.occ + 0.14 ? 'MAINTENANCE' : 'AVAILABLE';
        const minsAgo = Math.floor(rnd() * 60 * 20) + 15;
        const ts = at(minsAgo);
        bed.updated_at = ts;
        if (pick !== 'OCCUPIED') { bed.status = pick; continue; }
        const code = `P-${wardIdx}${pad3(bed.seq_no)}`;
        if (db.patients.some((p) => p.patient_code === code)) { continue; }
        const devs = [];
        if (sw.type === 'ICU') { devs.push('Monitor'); if (rnd() < 0.5) devs.push('Ventilator'); }
        else if (rnd() < 0.2) devs.push(rnd() < 0.5 ? 'Monitor' : 'Infusion Pump');
        const p = { id: nextId(db, 'patient'), patient_code: code, display_name: `${FIRST[Math.floor(rnd() * FIRST.length)]} ${LAST[Math.floor(rnd() * LAST.length)]}`,
          care_category: CARE_FOR_TYPE[sw.type], required_bed_type: sw.type, required_equipment_types: [],
          required_bed_features: bed.features.includes('Oxygen Outlet') && rnd() < 0.4 ? ['Oxygen Outlet'] : [],
          priority: sw.type === 'ICU' ? 'HIGH' : 'ROUTINE', match_started_at: null,
          notes: '', status: 'ADMITTED', is_demo: true, created_at: ts, updated_at: ts };
        // Recent allocations are still awaiting the patient's arrival.
        const arrived = minsAgo >= 120;
        if (!arrived) p.status = 'ALLOCATED';
        const equipment_ids = [];
        for (const t of devs) { const id = takeDevice(t, ward.id, bed.id, ts); if (id) { equipment_ids.push(id); p.required_equipment_types.push(t); } }
        db.patients.push(p);
        created.patients++;
        db.allocations.push({ id: nextId(db, 'allocation'), patient_id: p.id, bed_id: bed.id, status: 'ACTIVE', assigned_at: ts, admitted_at: arrived ? at(minsAgo - 10) : null,
          released_at: null, confirmed_by: 'Demo seed', equipment_ids, outcome: null });
        bed.status = 'OCCUPIED'; bed.current_patient_id = p.id;
      }
    });

    WAITING.forEach((w, i) => {
      if (db.patients.some((p) => p.patient_code === w.code)) return;
      const ts = at(40 - i * 4);
      db.patients.push({ id: nextId(db, 'patient'), patient_code: w.code, display_name: `${FIRST[(i * 7 + 3) % FIRST.length]} ${LAST[(i * 5 + 2) % LAST.length]}`,
        care_category: w.care, required_bed_type: w.type, required_equipment_types: w.devs.slice(), required_bed_features: w.feats.slice(),
        priority: w.priority, match_started_at: w.matchAgo != null ? at(w.matchAgo) : null,
        notes: '', status: 'WAITING', is_demo: true, created_at: ts, updated_at: ts });
      created.patients++;
    });

    if (!db.activity.length && created.wards) {
      const beds = db.beds;
      const pickBed = (status) => beds.find((b) => b.status === status);
      const events = [
        [5, 'DEMO_SEEDED', 'settings', 0, 'demo', 'Demo data loaded (fictional wards, beds, equipment and patients)'],
      ];
      const occ = beds.filter((b) => b.status === 'OCCUPIED').slice(-3);
      occ.forEach((b, i) => {
        const p = db.patients.find((x) => x.id === b.current_patient_id);
        events.push([20 + i * 35, 'ALLOCATED', 'bed', b.id, b.bed_code, `${b.bed_code} allocated to ${p.patient_code}`]);
      });
      const cl = pickBed('CLEANING'); if (cl) events.push([50, 'BED_STATUS', 'bed', cl.id, cl.bed_code, `${cl.bed_code} occupied → cleaning (demo history)`]);
      const rs = pickBed('RESERVED'); if (rs) events.push([95, 'BED_STATUS', 'bed', rs.id, rs.bed_code, `${rs.bed_code} available → reserved`]);
      const mt = pickBed('MAINTENANCE'); if (mt) events.push([130, 'BED_STATUS', 'bed', mt.id, mt.bed_code, `${mt.bed_code} available → maintenance`]);
      events.sort((a, b) => b[0] - a[0]).forEach(([m, action, rt, rid, code, msg]) => log(db, action, rt, rid, code, msg, null, at(m)));
    }
    return created;
  }

  root.MediTwin = {
    createService, memoryStorage, ApiError, evaluateBed, integrityProblems, derivePrefix,
    BED_STATUSES, BED_TYPES, BED_FEATURES, DEVICE_TYPES, QUANTITY_TYPES, EQUIPMENT_STATUSES, PATIENT_STATUSES, CARE_CATEGORIES, WARD_CATEGORIES, MANUAL_TRANSITIONS,
    FLOW_STAGES, PRIORITIES, patientStage,
  };
})(typeof window !== 'undefined' ? window : globalThis);
