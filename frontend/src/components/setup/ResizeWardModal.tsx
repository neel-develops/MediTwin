/* "Set bed count" modal — Graphite markup from the design's resizeWardModal(), with a live server-side reduction preview. */
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Modal, confirm } from '../g/Modal'
import { Icon } from '../g/Icon'
import { Checks } from '../g/parts'
import { api } from '../../lib/api'
import { errorMessage, useAction, useMeta } from '../../lib/queries'
import type { Ward } from '../../lib/types'

const defaultType = (category: string) =>
  category === 'Critical Care' ? 'ICU' : category === 'Paediatrics' ? 'Pediatric' : category === 'Maternity' ? 'Maternity' : 'General'
const code = (prefix: string, n: number) => `${prefix}-${String(n).padStart(3, '0')}`

function useDebounced<T>(v: T, ms: number): T {
  const [d, setD] = useState(v)
  useEffect(() => {
    const t = window.setTimeout(() => setD(v), ms)
    return () => window.clearTimeout(t)
  }, [v, ms])
  return d
}

export function ResizeWardModal({ ward, onClose }: { ward: Ward | null; onClose: () => void }) {
  const meta = useMeta()
  // The parent remounts this modal (key) per ward, so state initialises once from the ward that was opened.
  const [count, setCount] = useState(() => (ward ? String(ward.bed_count) : ''))
  const [bedType, setBedType] = useState(() => (ward ? defaultType(ward.category) : 'General'))
  const [features, setFeatures] = useState<string[]>([])
  const [serverErr, setServerErr] = useState<string | null>(null)
  const wardId = ward?.id ?? null

  const n = Number(count)
  const valid = count.trim() !== '' && Number.isInteger(n) && n >= 0 && n <= 500
  const current = ward?.bed_count ?? 0
  const debounced = useDebounced(n, 250)
  const preview = useQuery({
    queryKey: ['reduction-preview', wardId, debounced, current],
    queryFn: () => api.reductionPreview(wardId as number, debounced),
    enabled: wardId != null && valid && debounced < current && debounced === n,
    retry: false,
    placeholderData: (prev) => prev,
  })

  const apply = useAction(
    (b: { count: number; bed_type: string; features: string[] }) => api.generateBeds(wardId as number, b),
    { success: (r) => `${r.name} now has ${r.bed_count} beds.`, onSuccess: () => onClose() },
  )

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!ward || !valid || apply.isPending) return
    setServerErr(null)
    if (n < ward.bed_count) {
      try {
        const p = await api.reductionPreview(ward.id, n)
        if (!p.blocked.length) {
          const ok = await confirm({ title: 'Remove beds?', message: `Remove ${p.remove.length} bed(s) from ${ward.name}? This cannot be undone.`, confirmLabel: 'Remove beds', danger: true })
          if (!ok) return
        }
      } catch (err) {
        setServerErr(errorMessage(err))
        return
      }
    }
    // The server rejects unsafe reductions; its message is toasted and shown inline.
    apply.mutate({ count: n, bed_type: bedType, features }, { onError: (err) => setServerErr(errorMessage(err)) })
  }

  let body: ReactNode = null
  if (ward && valid) {
    if (n > current) body = <><Icon name="plus" /> Adds {n - current} bed(s).</>
    else if (n === current) body = 'No change.'
    else if (preview.isError) body = <span className="err"><Icon name="alert" /> {errorMessage(preview.error)}</span>
    else if (!preview.data || debounced !== n || preview.isPlaceholderData) body = <span className="muted">Checking which beds would be removed…</span>
    else {
      const p = preview.data
      const nonAvail = p.remove.filter((b) => b.status !== 'AVAILABLE')
      body = p.blocked.length
        ? <span className="err"><Icon name="alert" /> Blocked: {p.blocked.length} of the beds that would be removed are occupied ({p.blocked.slice(0, 10).join(', ')}{p.blocked.length > 10 ? '…' : ''}). Release those patients first.</span>
        : p.remove.length
          ? <><Icon name="minus" /> Removes {p.remove.length} bed(s): {p.remove[0].bed_code} … {p.remove[p.remove.length - 1].bed_code}{nonAvail.length ? ` — includes ${nonAvail.length} reserved/cleaning/maintenance bed(s).` : '.'}</>
          : 'No change.'
    }
  }

  return (
    <Modal open={!!ward} onClose={onClose} title={ward ? `Set bed count — ${ward.name}` : ''}
      footer={<>
        <button className="btn ghost" type="button" onClick={onClose}>Cancel</button>
        <button className="btn primary" form="resize-form" type="submit" disabled={!valid || apply.isPending}>{apply.isPending ? 'Applying…' : 'Apply'}</button>
      </>}>
      {ward && (
        <form id="resize-form" className="form" onSubmit={submit}>
          <p className="muted">Currently <strong>{ward.bed_count}</strong> beds ({code(ward.bed_code_prefix, 1)} … {code(ward.bed_code_prefix, Math.max(ward.bed_count, 1))}). New beds are added at the end. Reducing removes the highest-numbered beds and is blocked if any of them has a patient.</p>
          <label>Bed count<input name="count" type="number" min={0} max={500} required value={count} data-autofocus
            onChange={(e) => { setCount(e.target.value); setServerErr(null) }} /></label>
          <div className="row2">
            <label>Type for new beds<select name="bed_type" value={bedType} onChange={(e) => setBedType(e.target.value)}>
              {(meta.data?.bed_types ?? [bedType]).map((t) => <option key={t} value={t}>{t}</option>)}
            </select></label>
          </div>
          <fieldset><legend>Features for new beds</legend>
            <Checks name="features" options={meta.data?.bed_features ?? []} value={features} onChange={setFeatures} />
          </fieldset>
          <div id="resize-preview" className="preview" aria-live="polite">{body}</div>
          {serverErr && <div className="preview" role="alert"><span className="err"><Icon name="alert" /> {serverErr}</span></div>}
        </form>
      )}
    </Modal>
  )
}
