/* Setup — wards, bed counts and demo data (Graphite design, PAGES.setup). */
import { useCallback, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Icon } from '../components/g/Icon'
import { Empty, PageError, Skeleton, StackBar } from '../components/g/parts'
import { confirm } from '../components/g/Modal'
import { WardModal } from '../components/setup/WardModal'
import { ResizeWardModal } from '../components/setup/ResizeWardModal'
import { toast } from '../components/ui/toast'
import { api } from '../lib/api'
import { errorMessage, useAction, useWards } from '../lib/queries'
import type { Ward } from '../lib/types'
import '../styles/pages/Setup.css'

const code = (prefix: string, n: number) => `${prefix}-${String(n).padStart(3, '0')}`

export default function Setup() {
  const wards = useWards()
  const [wardModal, setWardModal] = useState<{ open: boolean; id: number | null }>({ open: false, id: null })
  const [resizeId, setResizeId] = useState<number | null>(null)
  const closeWard = useCallback(() => setWardModal({ open: false, id: null }), [])
  const closeResize = useCallback(() => setResizeId(null), [])

  const toggle = useAction((v: { id: number; is_active: boolean }) => api.updateWard(v.id, { is_active: v.is_active }), {
    success: (r) => `${r.name} ${r.is_active ? 'reactivated' : 'deactivated'}.`,
  })
  const toggleWard = async (row: Ward) => {
    // Re-read the ward first (like the design's api.getWard) so a stale table row never sends the wrong state.
    const w = (await wards.refetch()).data?.find((x) => x.id === row.id) ?? row
    if (w.is_active) {
      const ok = await confirm({ title: `Deactivate ${w.name}?`, message: 'Inactive wards are hidden from Bed Allocations, totals and recommendations. Their beds are kept.', confirmLabel: 'Deactivate', danger: true })
      if (!ok) return
    }
    toggle.mutate({ id: w.id, is_active: !w.is_active })
  }

  if (wards.isError && !wards.data) return <PageError error={wards.error} onRetry={() => void wards.refetch()} />

  const list = wards.data ?? []
  const editing = wardModal.id != null ? list.find((w) => w.id === wardModal.id) ?? null : null
  const resizing = resizeId != null ? list.find((w) => w.id === resizeId) ?? null : null

  return (
    <div className="page setup-page">
      <div className="page-head">
        <div><h1>Setup</h1><p className="muted">Configure wards and bed counts. Bed Allocations lays beds out automatically — no floor plans or physical positions.</p></div>
        <div className="head-actions"><button className="btn primary" onClick={() => setWardModal({ open: true, id: null })}><Icon name="plus" />Add ward</button></div>
      </div>

      <section className="card" id="s-wards">
        <h2>Wards</h2>
        {wards.isLoading ? (
          <Skeleton h={220} />
        ) : list.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Ward</th><th>Category</th><th>Prefix</th><th>Beds</th><th>Bed IDs</th><th>Status mix</th><th>Occupancy</th><th>State</th><th><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {list.map((w) => (
                  <tr key={w.id} className={w.is_active ? '' : 'inactive'}>
                    <td><strong>{w.name}</strong></td>
                    <td>{w.category}</td>
                    <td>{w.bed_code_prefix}</td>
                    <td>{w.bed_count}</td>
                    <td className="small">{w.bed_count ? `${code(w.bed_code_prefix, 1)} … ${code(w.bed_code_prefix, w.bed_count)}` : '—'}</td>
                    <td className="setup-mix">{w.bed_count ? <StackBar counts={w.counts} total={w.counts.total} /> : <span className="muted">—</span>}</td>
                    <td>{w.occupancy_pct}%</td>
                    <td>{w.is_active ? <span className="chip st-AVAILABLE"><i />Active</span> : <span className="chip st-CLEANING"><i />Inactive</span>}</td>
                    <td className="actions">
                      <button className="btn sm ghost" onClick={() => setWardModal({ open: true, id: w.id })}><Icon name="edit" />Edit</button>
                      <button className="btn sm ghost" onClick={() => setResizeId(w.id)}><Icon name="bed" />Set bed count</button>
                      <button className="btn sm ghost" onClick={() => void toggleWard(w)} disabled={toggle.isPending && toggle.variables?.id === w.id}>{w.is_active ? 'Deactivate' : 'Activate'}</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>No wards yet. Add one to generate beds.</Empty>
        )}
      </section>

      <DemoCard />

      <p className="page-note"><Icon name="gear" />Alert thresholds, device minimums and bed-type compatibility rules are in <Link to="/settings">Settings</Link>.</p>

      <WardModal key={wardModal.open ? `w-${wardModal.id ?? 'new'}` : 'ward-closed'} open={wardModal.open && (wardModal.id == null || !!editing)} ward={editing} onClose={closeWard} />
      <ResizeWardModal key={resizeId != null ? `resize-${resizeId}` : 'resize-closed'} ward={resizing} onClose={closeResize} />
    </div>
  )
}

function DemoCard() {
  const integrity = useQuery({ queryKey: ['integrity'], queryFn: api.integrity, refetchInterval: 15_000 })
  const seed = useAction(() => api.seedDemo(), {
    onSuccess: (r) => {
      const n = (k: string) => r[k] ?? 0
      if (n('wards') + n('beds') + n('patients') + n('equipment'))
        toast.info(`Added missing sample data (${n('wards')} wards, ${n('beds')} beds, ${n('patients')} patients, ${n('equipment')} equipment).`)
      else toast.info('Sample data already complete — nothing duplicated.')
    },
  })
  const reset = useAction(() => api.resetDemo(), { success: 'Demo data reset.' })
  const resetDemo = async () => {
    const ok = await confirm({
      title: 'Reset to sample data?',
      message: <>This replaces <strong>all</strong> wards, beds, patients, equipment, allocations and activity with fresh fictional sample data.</>,
      confirmLabel: 'Reset data',
      danger: true,
    })
    if (ok) reset.mutate()
  }
  const p = integrity.data?.problems ?? []

  return (
    <section className="card" id="s-demo">
      <h2><Icon name="db" /> Sample data</h2>
      <p className="muted">All records are fictional and stored in the MediTwin server’s local SQLite database. They persist across reloads and restarts until reset.</p>
      <div className="btn-row wrap">
        <button className="btn" onClick={() => seed.mutate()} disabled={seed.isPending || reset.isPending}><Icon name="refresh" cls={seed.isPending ? 'spin' : undefined} />Add missing sample data</button>
        <button className="btn danger" onClick={() => void resetDemo()} disabled={seed.isPending || reset.isPending}>{reset.isPending ? 'Resetting…' : 'Reset demo data'}</button>
      </div>
      <p className="muted small">“Add missing sample data” is repeatable — it never duplicates wards, beds, patients or equipment.</p>
      <div className="integrity" aria-live="polite">
        {integrity.isLoading ? (
          <span className="muted">Checking data consistency…</span>
        ) : integrity.isError ? (
          <span className="err"><Icon name="alert" /> Could not run the consistency check: {errorMessage(integrity.error)}</span>
        ) : p.length ? (
          <span className="err"><Icon name="alert" /> {p.length} consistency problem(s): {p[0]}</span>
        ) : (
          <><Icon name="check" /> Data consistency check passed (allocations, bed states, patient states, device assignments).</>
        )}
      </div>
    </section>
  )
}
