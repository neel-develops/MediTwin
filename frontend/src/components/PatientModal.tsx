/* Register / edit a synthetic patient — the design's patientModal(). */
import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { errorMessage, useAction, useMeta, usePatient } from '../lib/queries'
import type { Patient, Priority } from '../lib/types'
import { Icon } from './g/Icon'
import { Modal } from './g/Modal'
import { Checks, PRIORITY_LABEL } from './g/parts'

const blank = {
  display_name: '', patient_code: '', care_category: 'General Medicine', priority: 'ROUTINE' as Priority, required_bed_type: 'General',
  required_equipment_types: [] as string[], required_bed_features: [] as string[], notes: '',
}
const TYPE_FOR_CARE: Record<string, string> = {
  'General Medicine': 'General', 'Surgery Recovery': 'General', 'Critical Care': 'ICU', Paediatrics: 'Pediatric', Maternity: 'Maternity', 'Infectious Disease': 'Isolation',
}

export function PatientModal({ open, patientId, onClose, onSaved }: {
  open: boolean
  patientId?: number
  onClose: () => void
  onSaved?: (p: Patient, created: boolean) => void
}) {
  const meta = useMeta()
  const existing = usePatient(open && patientId ? patientId : null)
  const p = patientId ? existing.data : null
  const locked = !!p && p.status !== 'WAITING'
  const [f, setF] = useState(blank)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setErr(null)
    if (!patientId) setF(blank)
  }, [open, patientId])
  useEffect(() => {
    if (open && p) {
      setF({ display_name: p.display_name, patient_code: p.patient_code, care_category: p.care_category, priority: p.priority, required_bed_type: p.required_bed_type,
        required_equipment_types: p.required_equipment_types, required_bed_features: p.required_bed_features, notes: p.notes })
    }
  }, [open, p])

  const save = useAction(async (d: typeof blank) => {
    if (p) {
      const body: Record<string, unknown> = { display_name: d.display_name, care_category: d.care_category, priority: d.priority, notes: d.notes }
      if (!locked) Object.assign(body, { required_bed_type: d.required_bed_type, required_equipment_types: d.required_equipment_types, required_bed_features: d.required_bed_features })
      return { patient: await api.updatePatient(p.id, body), created: false }
    }
    return { patient: await api.createPatient(d), created: true }
  }, {
    success: (r) => (r.created ? `${r.patient.patient_code} registered. Find a suitable bed next.` : `${r.patient.patient_code} updated.`),
    silentError: true,
    onSuccess: (r) => { onClose(); onSaved?.(r.patient, r.created) },
  })

  const m = meta.data
  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!f.display_name.trim()) { setErr('Display name is required.'); return }
    setErr(null)
    save.mutate(f, { onError: (x) => setErr(errorMessage(x)) })
  }

  return (
    <Modal open={open} onClose={onClose} title={p ? `Edit ${p.patient_code}` : 'Register synthetic patient'}
      footer={<>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn primary" form="patient-form" type="submit" disabled={save.isPending}>{p ? 'Save' : 'Register patient'}</button>
      </>}>
      <form id="patient-form" className="form" onSubmit={submit}>
        <p className="note"><Icon name="info" />Use fictional details only. Never enter real patient information.</p>
        <div className="row2">
          <label>Display name<input required maxLength={60} value={f.display_name} placeholder="e.g. Alex Rivera" onChange={(e) => setF({ ...f, display_name: e.target.value })} /></label>
          <label>Patient code <small>(optional)</small><input maxLength={16} disabled={!!p} value={f.patient_code} placeholder="auto-generated" onChange={(e) => setF({ ...f, patient_code: e.target.value.toUpperCase() })} /></label>
        </div>
        <div className="row2">
          <label>Care category
            <select value={f.care_category} onChange={(e) => setF({ ...f, care_category: e.target.value, ...(!p ? { required_bed_type: TYPE_FOR_CARE[e.target.value] ?? f.required_bed_type } : {}) })}>
              {m?.care_categories.map((c) => <option key={c}>{c}</option>)}
            </select>
          </label>
          <label>Priority <small>(staff-set, not clinical triage)</small>
            <select value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value as Priority })}>
              {(['URGENT', 'HIGH', 'ROUTINE'] as Priority[]).map((x) => <option key={x} value={x}>{PRIORITY_LABEL[x]}</option>)}
            </select>
          </label>
        </div>
        <label>Required bed type
          <select value={f.required_bed_type} disabled={locked} onChange={(e) => setF({ ...f, required_bed_type: e.target.value })}>
            {m?.bed_types.map((c) => <option key={c}>{c}</option>)}
          </select>
        </label>
        <fieldset disabled={locked}><legend>Required equipment (allocated with the bed)</legend>
          <Checks name="required_equipment_types" options={m?.device_types ?? []} value={f.required_equipment_types} onChange={(v) => setF({ ...f, required_equipment_types: v })} />
        </fieldset>
        <fieldset disabled={locked}><legend>Special requirements (bed features)</legend>
          <Checks name="required_bed_features" options={m?.bed_features ?? []} value={f.required_bed_features} onChange={(v) => setF({ ...f, required_bed_features: v })} />
        </fieldset>
        {locked && <p className="muted small">Requirements are locked while the patient is not waiting.</p>}
        <label>Notes<textarea rows={2} maxLength={300} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></label>
        {err && <p className="err" role="alert"><Icon name="alert" />{err}</p>}
      </form>
    </Modal>
  )
}
