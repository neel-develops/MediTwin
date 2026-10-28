/* Add / edit ward modal — Graphite markup from the design's wardModal(). */
import { useState, type FormEvent } from 'react'
import { Modal } from '../g/Modal'
import { Checks } from '../g/parts'
import { api } from '../../lib/api'
import { useAction, useMeta } from '../../lib/queries'
import type { Ward } from '../../lib/types'

/** Same rule as the backend's derive_prefix(), used for the live placeholder. */
export function derivePrefix(name: string): string {
  const words = name.toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/).filter(Boolean)
  if (!words.length) return ''
  if (words.length === 1) return words[0].slice(0, 3)
  return words.map((w) => (/^\d+$/.test(w) ? w : w[0])).join('').slice(0, 6)
}

interface Form { name: string; category: string; bed_code_prefix: string; bed_count: string; bed_type: string; features: string[] }
const blank: Form = { name: '', category: 'General Ward', bed_code_prefix: '', bed_count: '20', bed_type: 'General', features: [] }

export function WardModal({ open, ward, onClose }: { open: boolean; ward: Ward | null; onClose: () => void }) {
  const meta = useMeta()
  // The parent remounts this modal (key) per opening, so the form initialises once and background refetches never clobber typing.
  const [f, setF] = useState<Form>(() =>
    ward ? { ...blank, name: ward.name, category: ward.category, bed_code_prefix: ward.bed_code_prefix } : blank)

  const save = useAction(
    (d: Form) => {
      const prefix = d.bed_code_prefix.trim().toUpperCase()
      const p = prefix ? { bed_code_prefix: prefix } : {}
      if (ward) return api.updateWard(ward.id, { name: d.name, category: d.category, ...p })
      return api.createWard({ name: d.name, category: d.category, bed_count: d.bed_count, bed_type: d.bed_type, features: d.features, ...p })
    },
    { success: (r) => (ward ? `${r.name} saved.` : `${r.name} created with ${r.bed_count} beds.`), onSuccess: () => onClose() },
  )

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!save.isPending) save.mutate(f)
  }
  const categories = meta.data?.ward_categories ?? [f.category]
  const bedTypes = meta.data?.bed_types ?? [f.bed_type]

  return (
    <Modal open={open} onClose={onClose} title={ward ? `Edit ${ward.name}` : 'Add ward'}
      footer={<>
        <button className="btn ghost" type="button" onClick={onClose}>Cancel</button>
        <button className="btn primary" form="ward-form" type="submit" disabled={save.isPending}>{save.isPending ? 'Saving…' : ward ? 'Save' : 'Create ward & generate beds'}</button>
      </>}>
      <form id="ward-form" className="form" onSubmit={submit}>
        <div className="row2">
          <label>Ward name<input name="name" required maxLength={60} value={f.name} placeholder="e.g. Ward 3" data-autofocus
            onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
          <label>Category<select name="category" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select></label>
        </div>
        <label>Bed code prefix <small>(beds are named PREFIX-001, PREFIX-002 …)</small>
          <input name="bed_code_prefix" maxLength={6} value={f.bed_code_prefix} pattern="[A-Za-z0-9]{1,6}" title="1–6 letters or digits"
            placeholder={ward ? ward.bed_code_prefix : derivePrefix(f.name) || 'auto from name'}
            onChange={(e) => setF({ ...f, bed_code_prefix: e.target.value.toUpperCase() })} /></label>
        {ward ? (
          <p className="muted small">Changing the prefix renames all {ward.bed_count} bed codes in this ward. Use “Set bed count” to add or remove beds.</p>
        ) : (
          <>
            <div className="row2">
              <label>Number of beds<input name="bed_count" type="number" min={0} max={500} required value={f.bed_count}
                onChange={(e) => setF({ ...f, bed_count: e.target.value })} /></label>
              <label>Bed type for generated beds<select name="bed_type" value={f.bed_type} onChange={(e) => setF({ ...f, bed_type: e.target.value })}>
                {bedTypes.map((t) => <option key={t} value={t}>{t}</option>)}
              </select></label>
            </div>
            <fieldset><legend>Features for generated beds</legend>
              <Checks name="features" options={meta.data?.bed_features ?? []} value={f.features} onChange={(v) => setF({ ...f, features: v })} />
            </fieldset>
          </>
        )}
      </form>
    </Modal>
  )
}
