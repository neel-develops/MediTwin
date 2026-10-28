/* Sticky patient detail panel (.pf-detail) from the Graphite design — wired to our API and AI ranking. */
import { useQuery } from '@tanstack/react-query'
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, ApiError } from '../../lib/api'
import { keys, useAction, useRecs, useSettings } from '../../lib/queries'
import type { Allocation, DeviceRef, PatientDetail as PD, Recommendation, UnlockAction } from '../../lib/types'
import { useUI } from '../../lib/ui'
import { Icon } from '../g/Icon'
import { confirm } from '../g/Modal'
import { AiTag, BedThumb, Chip, FactorBars, fmtTime, Loading, ScoreBadge, Skeleton, STATUS_LABEL, UnlockList, useThumbs } from '../g/parts'
import { CARE_ICON, fitClass, fitLabel, fmtDur, isFlowStage, PrioPill, STAGE_META } from './flow'

type Outcome = 'DISCHARGED' | 'TRANSFERRED'

export function PatientDetailPanel({ id, onClose }: { id: number; onClose: () => void }) {
  const nav = useNavigate()
  const ui = useUI()
  const thumbs = useThumbs()
  const settings = useSettings()
  const q = useQuery({ queryKey: keys.patient(id), queryFn: () => api.patient(id), refetchInterval: 15_000 })
  const p = q.data
  const matching = p?.stage === 'MATCHING'
  const recs = useRecs(id, matching)
  const r = recs.data && !recs.data.not_waiting ? recs.data : undefined
  const noFit = matching && r?.eligible_count === 0
  const unlock = useQuery({ queryKey: ['unlock', id], queryFn: () => api.unlock(id), enabled: noFit, retry: false })
  const [why, setWhy] = useState<number | null>(null)

  const startMatch = useAction(() => api.startMatching(id), { success: (x) => `Bed search started for ${x.patient_code}.` })
  const stopMatch = useAction(() => api.stopMatching(id), { success: (x) => `${x.patient_code} moved back to Waiting.` })
  const admit = useAction((allocId: number) => api.admit(allocId), { success: (x) => `${x.patient_code} admitted to ${x.bed_code}.` })
  const cancel = useAction((allocId: number) => api.cancel(allocId), {
    success: (x) => `Allocation cancelled. ${x.bed_code} is available and ${x.patient_code} is waiting again.`,
  })
  const release = useAction((a: { allocId: number; outcome: Outcome }) => api.release(a.allocId, a.outcome), {
    success: (x, a) => `${x.patient_code} ${a.outcome.toLowerCase()}. ${x.bed_code} → ${(STATUS_LABEL[x.bed_status] ?? x.bed_status).toLowerCase()}.`,
  })
  const allocate = useAction((rec: Recommendation) => api.allocate(id, rec.bed_id), {
    success: (x: Allocation & { devices?: DeviceRef[] }) =>
      `${x.patient_code ?? 'Patient'} allocated to ${x.bed_code}${x.devices?.length ? ` with ${x.devices.map((d) => d.equipment_code).join(', ')}` : ''}.`,
  })

  // A deep link to a patient that no longer exists falls back to the command summary, like the design.
  const missing = q.isError && q.error instanceof ApiError && q.error.status === 404
  useEffect(() => { if (missing) onClose() }, [missing, onClose])
  useEffect(() => { setWhy(null) }, [id])

  if (q.isError && !p) {
    return (
      <>
        <PanelHead onClose={onClose} />
        <div className="pd-callout none"><Icon name="alert" /><div><strong>Couldn’t load this patient</strong><small>{q.error instanceof Error ? q.error.message : 'The MediTwin server did not respond.'}</small></div></div>
        <div className="pd-actions"><button className="btn" onClick={() => q.refetch()}><Icon name="refresh" />Try again</button></div>
      </>
    )
  }
  if (!p) {
    return (
      <>
        <div className="pd-head"><div className="pd-id"><Skeleton h={46} w={46} style={{ borderRadius: 14 }} /><div><Skeleton h={20} w={140} /><Skeleton h={14} w={110} style={{ marginTop: 6 }} /></div></div>
          <button className="icon-btn plain" onClick={onClose} aria-label="Close patient details"><Icon name="x" /></button></div>
        <Skeleton h={26} w={220} />
        <Skeleton h={72} />
        <Skeleton h={70} />
        <Skeleton h={120} />
      </>
    )
  }

  const stage = p.stage
  const open = isFlowStage(stage)
  const alloc = p.allocation
  const steps: [string, string | null | undefined, boolean][] = [
    ['Registered', p.created_at, true],
    ['Matching', p.match_started_at || alloc?.assigned_at, stage !== 'WAITING'],
    ['Allocated', alloc?.assigned_at, stage === 'ALLOCATED' || stage === 'ADMITTED'],
    ['Admitted', alloc?.admitted_at, stage === 'ADMITTED'],
  ]
  const curIdx = { WAITING: 0, MATCHING: 1, ALLOCATED: 2, ADMITTED: 3, CLOSED: -1 }[stage]
  const sinceIso = stage === 'WAITING' ? p.created_at
    : stage === 'MATCHING' ? p.match_started_at
      : stage === 'ALLOCATED' ? alloc?.assigned_at
        : stage === 'ADMITTED' ? alloc?.admitted_at || alloc?.assigned_at : p.updated_at
  const mins = sinceIso ? Math.max(0, Math.round((Date.now() - Date.parse(sinceIso)) / 60000)) : null
  const clockLabel = { WAITING: 'Waiting for', MATCHING: 'Searching for', ALLOCATED: 'Bed held for', ADMITTED: 'In bed for', CLOSED: '' }[stage]
  const fit = p.fit_count ?? 0
  const edit = <button className="btn ghost" onClick={() => ui.openEditPatient(p.id)}><Icon name="edit" />Edit</button>

  const to3d = (ward: number, bed?: number) => nav(`/allocations?for=${p.id}&ward=${ward}${bed ? `&bed=${bed}` : ''}`)

  const doRelease = async (outcome: Outcome) => {
    if (!alloc || !p.bed) return
    const label = `${p.patient_code} in ${p.bed.bed_code}`
    const toCleaning = settings.data?.release_to_cleaning ?? true
    const ok = await confirm({
      title: outcome === 'TRANSFERRED' ? 'Release for transfer?' : 'Discharge and release bed?',
      message: <>{label} will be closed. The bed will move to <strong>{toCleaning ? 'Cleaning' : 'Available'}</strong> and any allocated devices return to Available.</>,
      confirmLabel: outcome === 'TRANSFERRED' ? 'Release for transfer' : 'Discharge & release',
    })
    if (ok) release.mutate({ allocId: alloc.id, outcome })
  }
  const doCancel = async () => {
    if (!alloc || !p.bed) return
    const ok = await confirm({
      title: 'Cancel this allocation?',
      message: <>{p.patient_code} → {p.bed.bed_code} will be cancelled. The bed returns to <strong>Available</strong>, any held devices are freed, and the patient goes back to <strong>Waiting</strong>.</>,
      confirmLabel: 'Cancel allocation', danger: true,
    })
    if (ok) cancel.mutate(alloc.id)
  }
  const doAdmit = async () => {
    if (!alloc || !p.bed) return
    const ok = await confirm({
      title: 'Mark patient admitted?',
      message: <><strong>{p.patient_code}</strong> ({p.display_name}) has arrived in <strong>{p.bed.bed_code}</strong>. The bed stays <strong>Occupied</strong> and the patient moves to <strong>Admitted</strong>.</>,
      confirmLabel: 'Mark admitted',
    })
    if (ok) admit.mutate(alloc.id)
  }
  const choose = async (rec: Recommendation) => {
    const ok = await confirm({
      title: 'Confirm allocation',
      message: <>Allocate <strong>{p.patient_code}</strong> ({p.display_name}) to <strong>{rec.bed_code}</strong> in {rec.ward_name}
        {rec.devices.length ? ` with ${rec.devices.map((d) => d.equipment_code).join(', ')}` : ''}?<br /><br />
        <span className="muted small">AI match score {rec.score}/100. This is a resource match, not a clinical assessment. The system re-checks bed status, type, features and equipment when you confirm.</span></>,
      confirmLabel: 'Confirm allocation',
    })
    if (ok) allocate.mutate(rec)
  }

  return (
    <>
      <div className="pd-head">
        <div className="pd-id"><div className={`pd-badge sg-${stage}`} aria-hidden="true"><Icon name={open ? STAGE_META[stage].icon : 'out'} /></div>
          <div><h2>{p.patient_code}</h2><p>{p.display_name}</p></div></div>
        <button className="icon-btn plain" onClick={onClose} aria-label="Close patient details"><Icon name="x" /></button>
      </div>
      <div className="pd-pills">
        <span className={`stage-pill sg-${stage}`}>{open ? STAGE_META[stage].label : STATUS_LABEL[p.status] ?? p.status}</span>
        <PrioPill priority={p.priority} suffix=" priority" />
        <span className="pd-care"><Icon name={CARE_ICON[p.care_category] || 'user'} />{p.care_category}</span>
        {alloc?.source === 'AI_PLAN' && <AiTag label="AI plan" />}
      </div>
      {open && (
        <div className="pd-clock"><div><small>{clockLabel}</small><strong>{fmtDur(mins)}</strong></div>
          <ol className="stepper">{steps.map(([label, t, done], i) => (
            <li key={label} className={`${done ? 'done' : ''} ${i === curIdx ? 'cur' : ''}`}><i aria-hidden="true" /><span>{label}</span><small>{t && done ? fmtTime(t) : '—'}</small></li>
          ))}</ol></div>
      )}
      <h3 className="sub">Care requirements</h3>
      <div className="req-grid">
        <div className="req"><Icon name="bed" /><small>Bed type</small><strong>{p.required_bed_type}</strong></div>
        <div className="req"><Icon name="monitor" /><small>Devices</small><strong>{p.required_equipment_types.length ? p.required_equipment_types.join(', ') : 'None'}</strong></div>
        <div className="req"><Icon name="shield" /><small>Bed features</small><strong>{p.required_bed_features.length ? p.required_bed_features.join(', ') : 'None'}</strong></div>
      </div>
      {p.notes && <p className="pd-notes">{p.notes}</p>}

      {stage === 'WAITING' && (
        <>
          <div className={`pd-callout ${fitClass(fit)}`}><Icon name={fit ? 'check' : 'alert'} /><div><strong>{fitLabel(fit)} right now</strong>
            <small>{fit ? 'Start a bed search to review the best matches and place this patient.' : 'No active, available bed meets every requirement. Start a search to see what is missing.'}</small></div></div>
          <div className="pd-actions">
            <button className="btn primary" disabled={startMatch.isPending} onClick={() => startMatch.mutate(undefined)}><Icon name={startMatch.isPending ? 'refresh' : 'search'} cls={startMatch.isPending ? 'spin' : undefined} />Find suitable beds</button>
            {edit}
          </div>
        </>
      )}

      {stage === 'MATCHING' && (
        <MatchSection p={p} recs={r} loading={recs.isLoading || (!!recs.data?.not_waiting)} error={recs.isError ? recs.error : null} onRetry={() => recs.refetch()}
          unlock={unlock.data} unlockLoading={unlock.isLoading} unlockError={unlock.isError}
          why={why} setWhy={setWhy} onChoose={choose} to3d={to3d} busy={allocate.isPending}
          actions={<div className="pd-actions">
            {r && r.recommendations.length > 0 && <button className="btn" onClick={() => to3d(r.recommendations[0].ward_id)}><Icon name="cube" />See all in 3D</button>}
            <button className="btn ghost" disabled={stopMatch.isPending} onClick={() => stopMatch.mutate(undefined)}><Icon name="pause" />Pause search</button>
            {edit}
          </div>} />
      )}

      {(stage === 'ALLOCATED' || stage === 'ADMITTED') && alloc && p.bed && (
        <>
          <h3 className="sub">{stage === 'ALLOCATED' ? 'Bed held for this patient' : 'Current bed'}</h3>
          <div className="pd-bed"><div className="bed-art st-OCCUPIED"><BedThumb status="OCCUPIED" cls="art-img" thumbs={thumbs} /></div>
            <div><strong>{p.bed.bed_code}</strong><small>{p.ward_name} · {p.bed.bed_type} bed</small>
              {p.devices.length > 0 && <small title={p.devices.map((d) => `${d.equipment_type} ${d.equipment_code}`).join(', ')}><Icon name="monitor" />{p.devices.map((d) => d.equipment_code).join(', ')}</small>}
              {alloc.source === 'AI_PLAN' && <small><Icon name="spark" />Placed by AI plan{alloc.match_score != null ? ` · score ${Math.round(alloc.match_score)}` : ''}</small>}
            </div>
            <button className="btn sm ghost" onClick={() => nav(`/allocations?ward=${p.bed!.ward_id}&bed=${p.bed!.id}`)}><Icon name="cube" />Open in 3D</button></div>
          <div className="pd-actions">
            {stage === 'ALLOCATED' ? (
              <>
                <button className="btn primary" disabled={admit.isPending} onClick={doAdmit}><Icon name="login" />Mark admitted</button>
                <button className="btn" disabled={cancel.isPending} onClick={doCancel}><Icon name="undo" />Cancel allocation</button>
              </>
            ) : (
              <>
                <button className="btn" disabled={release.isPending} onClick={() => doRelease('DISCHARGED')}><Icon name="out" />Discharge</button>
                <button className="btn" disabled={release.isPending} onClick={() => doRelease('TRANSFERRED')}><Icon name="out" />Transfer out</button>
              </>
            )}
            {edit}
          </div>
        </>
      )}

      {stage === 'CLOSED' && (
        <div className="pd-callout"><Icon name="info" /><div><strong>{STATUS_LABEL[p.status] ?? p.status}</strong><small>This patient has left the flow. Their history is kept below.</small></div></div>
      )}

      {p.history.length > 0 && (
        <>
          <h3 className="sub">Allocation history</h3>
          <ul className="history">{p.history.map((a) => (
            <li key={a.id}><Chip status={a.status} /> <strong>{a.bed_code}</strong> · {fmtTime(a.assigned_at)}
              {a.released_at ? ` → ${fmtTime(a.released_at)} (${(a.outcome || '').toLowerCase()})` : ''}
              {a.source === 'AI_PLAN' ? ' · AI plan' : ''}</li>
          ))}</ul>
        </>
      )}
    </>
  )
}

function PanelHead({ onClose }: { onClose: () => void }) {
  return (
    <div className="pd-head"><div className="pd-id"><div className="pd-badge sg-CLOSED" aria-hidden="true"><Icon name="user" /></div><div><h2>Patient</h2><p>Details unavailable</p></div></div>
      <button className="icon-btn plain" onClick={onClose} aria-label="Close patient details"><Icon name="x" /></button></div>
  )
}

function MatchSection({ p, recs, loading, error, onRetry, unlock, unlockLoading, unlockError, why, setWhy, onChoose, to3d, busy, actions }: {
  p: PD
  recs: { eligible_count: number; recommendations: Recommendation[]; rejected_summary: { reason: string; count: number }[] } | undefined
  loading: boolean
  error: unknown
  onRetry: () => void
  unlock: { blockers: string[]; unlock: UnlockAction[] } | undefined
  unlockLoading: boolean
  unlockError: boolean
  why: number | null
  setWhy: (v: number | null) => void
  onChoose: (r: Recommendation) => void
  to3d: (ward: number, bed?: number) => void
  busy: boolean
  actions: ReactNode
}) {
  const head = (n: number | null) => (
    <div className="pd-match-head"><h3 className="sub">Suitable beds <AiTag label="AI ranked" /></h3>
      <span className="muted small">{n == null ? 'Searching…' : `${n} found · ranked by resource fit, not clinical score`}</span></div>
  )
  if (error) {
    return (
      <>
        {head(null)}
        <div className="pd-callout none"><Icon name="alert" /><div><strong>Couldn’t load suitable beds</strong><small>{error instanceof Error ? error.message : 'The MediTwin server did not respond.'}</small></div></div>
        <div className="pd-actions"><button className="btn" onClick={onRetry}><Icon name="refresh" />Try again</button></div>
        {actions}
      </>
    )
  }
  if (loading || !recs) {
    return <>{head(null)}<Skeleton h={64} /><Skeleton h={64} /><Skeleton h={64} />{actions}</>
  }
  const rejected = recs.rejected_summary.length > 0 && (
    <details className="rejected" open={!recs.eligible_count}><summary>Why other beds were excluded</summary>
      <ul>{recs.rejected_summary.map((x) => <li key={x.reason}><strong>{x.count}</strong> {x.reason}</li>)}</ul></details>
  )
  if (!recs.eligible_count) {
    return (
      <>
        {head(0)}
        <div className="pd-callout none"><Icon name="alert" /><div><strong>No suitable bed found</strong><small>Change a requirement, free a bed, or add capacity in Setup.</small>
          {unlock && unlock.blockers.length > 0 && <ul className="pd-blockers">{unlock.blockers.map((b) => <li key={b}>{b}</li>)}</ul>}</div></div>
        <div className="pd-ai-head"><h3 className="sub">AI suggestions to create a bed</h3><AiTag /></div>
        {unlockLoading ? <Loading label="Looking for one-click fixes…" />
          : unlockError ? <p className="muted small">AI suggestions are unavailable right now.</p>
            : unlock && unlock.unlock.length ? <UnlockList actions={unlock.unlock} />
              : <p className="muted small">No one-click fix found — a bed of this kind has to be freed or added in Setup.</p>}
        {rejected}
        {actions}
      </>
    )
  }
  const list = recs.recommendations.slice(0, 6)
  return (
    <>
      {head(recs.eligible_count)}
      <ol className="rec-cards">{list.map((x, i) => (
        <li key={x.bed_id} className="rec-card" style={{ '--i': i } as CSSProperties}>
          <div className="rc-top"><span className="rank">#{x.rank}</span><ScoreBadge score={x.score} />
            <div className="rc-id"><strong>{x.bed_code}</strong><small>{x.ward_name} · {x.bed_type}</small></div>
            <button className="btn sm ghost" onClick={() => to3d(x.ward_id, x.bed_id)} title={`Show ${x.bed_code} in Bed Allocations`}><Icon name="cube" />3D</button>
            <button className="btn sm primary" disabled={busy} onClick={() => onChoose(x)} aria-label={`Allocate ${x.bed_code} to ${p.patient_code}`}>Allocate</button></div>
          <ul className="rc-why">{x.matches.map((m) => <li key={m}><Icon name="check" />{m}</li>)}</ul>
          {x.devices.length > 0 && <p className="rc-dev"><Icon name="monitor" />Reserves {x.devices.map((d) => `${d.equipment_code}${d.same_ward ? '' : ' (other ward)'}`).join(', ')}</p>}
          {x.factors.length > 0 && (
            <>
              <button className={`link small rc-explain ${why === x.bed_id ? 'on' : ''}`} aria-expanded={why === x.bed_id} onClick={() => setWhy(why === x.bed_id ? null : x.bed_id)}>
                <Icon name="spark" />Why this score<Icon name="chevd" cls="rc-chev" /></button>
              {why === x.bed_id && <FactorBars factors={x.factors} />}
            </>
          )}
        </li>
      ))}</ol>
      {recs.eligible_count > list.length && <p className="muted small">Top {list.length} of {recs.eligible_count}. Use “See all in 3D” to browse every suitable bed.</p>}
      {rejected}
      {actions}
    </>
  )
}

