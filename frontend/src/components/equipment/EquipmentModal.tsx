/* The design's equipmentModal(): add equipment, edit an individual device, or edit counted stock totals.
   Render it keyed by item id (or 'add') so the form starts from the item's current values. */
import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../../lib/api'
import { useAction, useMeta, useWards } from '../../lib/queries'
import type { Equipment, EquipmentStatus } from '../../lib/types'
import { Icon } from '../g/Icon'
import { Modal } from '../g/Modal'
import { Chip, STATUS_LABEL } from '../g/parts'

type Mode = 'INDIVIDUAL' | 'QUANTITY'
const EDITABLE: EquipmentStatus[] = ['AVAILABLE', 'RESERVED', 'MAINTENANCE']

export function EquipmentModal({ item, onClose }: { item: Equipment | null; onClose: () => void }) {
  const meta = useMeta()
  const wards = useWards()
  const deviceTypes = meta.data?.device_types ?? ['Monitor', 'Ventilator', 'Infusion pump']
  const quantityTypes = meta.data?.quantity_types ?? []

  // add form
  const [mode, setMode] = useState<Mode>('INDIVIDUAL')
  const [eqType, setEqType] = useState(deviceTypes.includes('Monitor') ? 'Monitor' : deviceTypes[0] ?? '')
  const [code, setCode] = useState('')
  const [qty, setQty] = useState('10')
  // shared / edit
  const [ward, setWard] = useState(item?.ward_id != null ? String(item.ward_id) : 'pool')
  const [notes, setNotes] = useState(item?.notes ?? '')
  const [status, setStatus] = useState<EquipmentStatus>(item && EDITABLE.includes(item.status) ? item.status : 'AVAILABLE')
  const [total, setTotal] = useState(String(item?.quantity_total ?? 0))
  const [avail, setAvail] = useState(String(item?.quantity_available ?? 0))

  const create = useAction((b: Record<string, unknown>) => api.createEquipment(b), { success: (r) => `${r.equipment_code} added.`, onSuccess: onClose })
  const save = useAction((b: Record<string, unknown>) => api.updateEquipment(item!.id, b), { success: (r) => `${r.equipment_code} saved.`, onSuccess: onClose })
  const pending = create.isPending || save.isPending

  const inUse = item?.tracking_mode === 'INDIVIDUAL' && item.status === 'IN_USE'
  const types = mode === 'QUANTITY' ? quantityTypes : deviceTypes
  const typeValue = types.includes(eqType) ? eqType : types[0] ?? ''

  const wardOptions = (
    <>
      <option value="pool">Shared pool</option>
      {(wards.data ?? []).map((w) => <option key={w.id} value={String(w.id)}>{w.name}</option>)}
    </>
  )

  const submit = (ev: FormEvent) => {
    ev.preventDefault()
    if (pending) return
    if (!item) {
      const body: Record<string, unknown> = { tracking_mode: mode, equipment_type: typeValue, ward_id: ward, notes: notes.trim() }
      if (mode === 'INDIVIDUAL') { if (code.trim()) body.equipment_code = code.trim().toUpperCase() }
      else body.quantity_total = Number(qty)
      create.mutate(body)
    } else if (item.tracking_mode === 'INDIVIDUAL') {
      save.mutate(inUse ? { notes } : { status, ward_id: ward, notes })
    } else {
      save.mutate({ quantity_total: Number(total), quantity_available: Number(avail), notes })
    }
  }

  let body
  if (!item) {
    body = (
      <form id="eq-form" className="form" onSubmit={submit}>
        <fieldset>
          <legend>Tracking</legend>
          <div className="checks">
            <label className="check">
              <input type="radio" name="tracking_mode" value="INDIVIDUAL" checked={mode === 'INDIVIDUAL'} onChange={() => setMode('INDIVIDUAL')} />
              <span>Individual device (has its own ID, allocatable to a bed)</span>
            </label>
            <label className="check">
              <input type="radio" name="tracking_mode" value="QUANTITY" checked={mode === 'QUANTITY'} onChange={() => setMode('QUANTITY')} />
              <span>Counted stock (e.g. 25 wheelchairs)</span>
            </label>
          </div>
        </fieldset>
        <label>Type
          <select name="equipment_type" id="eq-type" value={typeValue} onChange={(e) => setEqType(e.target.value)} required>
            {types.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <div className="row2">
          {mode === 'INDIVIDUAL' ? (
            <label id="eq-code-l">Equipment code <small>(optional)</small>
              <input name="equipment_code" maxLength={16} placeholder="auto-generated" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())}
                title="2–16 letters, digits or dashes; leave blank to auto-number" />
            </label>
          ) : (
            <label id="eq-qty-l">Quantity
              <input name="quantity_total" type="number" min={0} max={10000} value={qty} onChange={(e) => setQty(e.target.value)} required />
            </label>
          )}
          <label>Location<select name="ward_id" value={ward} onChange={(e) => setWard(e.target.value)}>{wardOptions}</select></label>
        </div>
        <label>Notes<textarea name="notes" rows={2} maxLength={300} value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
      </form>
    )
  } else if (item.tracking_mode === 'INDIVIDUAL') {
    body = (
      <form id="eq-form" className="form" onSubmit={submit}>
        <p><strong>{item.equipment_code}</strong> · {item.equipment_type} · <Chip status={item.status} /></p>
        {inUse && (
          <p className="note">
            <Icon name="info" />
            <span>In use at bed{' '}
              {item.assigned_bed_id != null && item.bed_ward_id != null
                ? <Link to={`/allocations?ward=${item.bed_ward_id}&bed=${item.assigned_bed_id}`} onClick={onClose}>{item.bed_code}</Link>
                : item.bed_code ?? '—'}
              . It returns to Available when that patient is released.
            </span>
          </p>
        )}
        <div className="row2">
          <label>Status
            <select name="status" disabled={inUse} value={inUse ? 'IN_USE' : status} onChange={(e) => setStatus(e.target.value as EquipmentStatus)}>
              {(inUse ? (['IN_USE'] as EquipmentStatus[]) : EDITABLE).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            </select>
          </label>
          <label>Location<select name="ward_id" disabled={inUse} value={ward} onChange={(e) => setWard(e.target.value)}>{wardOptions}</select></label>
        </div>
        <label>Notes<textarea name="notes" rows={2} maxLength={300} value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
      </form>
    )
  } else {
    body = (
      <form id="eq-form" className="form" onSubmit={submit}>
        <p><strong>{item.equipment_type}</strong> stock · {item.ward_name || 'Shared pool'}</p>
        <div className="row2">
          <label>Total quantity<input name="quantity_total" type="number" min={0} max={10000} value={total} onChange={(e) => setTotal(e.target.value)} required /></label>
          <label>Available now<input name="quantity_available" type="number" min={0} max={Math.min(10000, Number(total) || 0)} value={avail} onChange={(e) => setAvail(e.target.value)} required /></label>
        </div>
        <label>Notes<textarea name="notes" rows={2} maxLength={300} value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
      </form>
    )
  }

  return (
    <Modal open onClose={onClose} title={item ? `Edit ${item.equipment_code}` : 'Add equipment'}
      footer={<>
        <button className="btn ghost" type="button" onClick={onClose}>Cancel</button>
        <button className="btn primary" form="eq-form" type="submit" disabled={pending}>{item ? 'Save' : 'Add equipment'}</button>
      </>}>
      {body}
    </Modal>
  )
}
