/* Her editBedModal(): bed type, fixed fittings and notes (api.updateBed). */
import { useState, type FormEvent } from 'react'
import { api } from '../../lib/api'
import { errorMessage, useAction, useMeta } from '../../lib/queries'
import type { BedDetail } from '../../lib/types'
import { Icon } from '../g/Icon'
import { Modal } from '../g/Modal'
import { Checks, Loading, Spinner } from '../g/parts'

export function EditBedModal({ bed, open, onClose }: { bed: BedDetail; open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title={`Edit ${bed.bed_code}`}
      footer={<>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn primary" form="bed-form" type="submit">Save</button>
      </>}>
      {open && <BedForm key={bed.id} bed={bed} onClose={onClose} />}
    </Modal>
  )
}

function BedForm({ bed, onClose }: { bed: BedDetail; onClose: () => void }) {
  const meta = useMeta()
  const [bedType, setBedType] = useState(bed.bed_type)
  const [features, setFeatures] = useState<string[]>(bed.features)
  const [notes, setNotes] = useState(bed.notes ?? '')
  const [error, setError] = useState<string | null>(null)
  const occupied = bed.status === 'OCCUPIED'
  const save = useAction((b: { bed_type?: string; features?: string[]; notes: string }) => api.updateBed(bed.id, b), {
    success: (r) => `${r.bed_code} updated.`,
    onSuccess: () => onClose(),
  })

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (save.isPending) return
    setError(null)
    const specChanged = bedType !== bed.bed_type || features.length !== bed.features.length || features.some((f) => !bed.features.includes(f))
    // Type/features are sent whenever they changed, so the server's "occupied" rule is the one that decides.
    const body = specChanged || !occupied ? { bed_type: bedType, features, notes } : { notes }
    save.mutate(body, { onError: (err) => setError(errorMessage(err)) })
  }

  if (!meta.data) return meta.isError ? <p className="no-match"><Icon name="alert" />{errorMessage(meta.error)}</p> : <Loading />
  const types = meta.data.bed_types.includes(bed.bed_type) ? meta.data.bed_types : [bed.bed_type, ...meta.data.bed_types]
  return (
    <form id="bed-form" className="form" onSubmit={submit}>
      {occupied && <p className="note"><Icon name="info" />{bed.bed_code} is occupied. Its type and features can't change until the patient is released; notes can still be edited.</p>}
      <label>Bed type<select name="bed_type" value={bedType} onChange={(e) => setBedType(e.target.value)} disabled={occupied}>
        {types.map((t) => <option key={t} value={t}>{t}</option>)}
      </select></label>
      <fieldset><legend>Bed features (fixed fittings)</legend>
        <Checks name="features" options={meta.data.bed_features} value={features} onChange={setFeatures} disabled={occupied} />
      </fieldset>
      <label>Notes<textarea name="notes" rows={2} maxLength={300} value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
      {error && <p className="no-match" role="alert"><Icon name="alert" />{error}</p>}
      {save.isPending && <div className="loading-line"><Spinner />Saving…</div>}
    </form>
  )
}
