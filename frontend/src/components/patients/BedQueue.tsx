/* Bed queue — every waiting patient as a "bed pass": a queue map (urgency × care type) to see
   pressure at a glance, compact rows or pass cards grouped by urgency, and the selected
   patient's full pass with the AI match breakdown. Data: /api/ai/plan (placed + unplaced). */
import { useMemo, useState } from 'react'
import { api } from '../../lib/api'
import { plural } from '../../lib/format'
import { useAction, useMeta, usePlan } from '../../lib/queries'
import type { PlanItem, Priority, UnplacedPatient } from '../../lib/types'
import { useUI } from '../../lib/ui'
import { Icon } from '../g/Icon'
import { confirm } from '../g/Modal'
import { FactorBars, PageError, PRIORITY_LABEL, Skeleton, Spinner, UnlockList, fmtDur } from '../g/parts'
import { PatientDetailPanel } from './PatientDetail'
import '../../styles/pages/BedQueue.css'

/* Staff wait targets per priority (minutes) — operational targets, not clinical triage. */
const TARGET: Record<Priority, number> = { URGENT: 30, HIGH: 90, ROUTINE: 240 }
const LANES: { k: Priority; note: string }[] = [
  { k: 'URGENT', note: 'target 30 min' }, { k: 'HIGH', note: 'target 90 min' }, { k: 'ROUTINE', note: 'target 4 h' },
]
const ROW_LIMIT = 12
const PASS_LIMIT = 6

type Q = {
  id: number; code: string; name: string; pr: Priority; type: string; needs: string; wait: number
  item?: PlanItem; un?: UnplacedPatient
}
const late = (q: Q) => q.wait > TARGET[q.pr]
const ratio = (q: Q) => q.wait / TARGET[q.pr]
const byPressure = (a: Q, b: Q) => Number(late(b)) - Number(late(a)) || ratio(b) - ratio(a)

export function BedQueue({ patientId, onOpen, onClose }: { patientId: number | null; onOpen: (id: number) => void; onClose: () => void }) {
  const plan = usePlan()
  const meta = useMeta()
  const ui = useUI()
  const [view, setView] = useState<'rows' | 'passes'>('rows')
  const [cell, setCell] = useState<[Priority, string] | null>(null)
  const [search, setSearch] = useState('')
  const [closed, setClosed] = useState<Set<Priority>>(() => new Set(['ROUTINE']))
  const [expanded, setExpanded] = useState<Set<Priority>>(() => new Set())
  const [sel, setSel] = useState<number | null>(null)

  const allocate = useAction((i: PlanItem) => api.allocate(i.patient_id, i.bed_id), {
    success: (r) => `${r.patient_code ?? 'Patient'} allocated to ${r.bed_code}.`,
  })
  const bulk = useAction((rows: PlanItem[]) => api.applyPlan(rows.map((r) => ({ patient_id: r.patient_id, bed_id: r.bed_id }))), {
    success: (r) => `${plural(r.confirmed, 'allocation')} confirmed${r.failed ? `, ${r.failed} skipped` : ''}.`,
  })

  const all = useMemo<Q[]>(() => {
    if (!plan.data) return []
    const needs = (p: { required_bed_features: string[]; required_equipment_types: string[] }) =>
      [...p.required_bed_features, ...p.required_equipment_types].join(' · ') || 'No special needs'
    return [
      ...plan.data.items.map((i) => ({ id: i.patient_id, code: i.patient_code, name: i.display_name, pr: i.priority, type: i.required_bed_type, needs: needs(i), wait: i.waiting_minutes, item: i })),
      ...plan.data.unplaced_patients.map((u) => ({ id: u.patient_id, code: u.patient_code, name: u.display_name, pr: u.priority, type: u.required_bed_type, needs: needs(u), wait: u.waiting_minutes, un: u })),
    ]
  }, [plan.data])

  const types = useMemo(() => {
    const known = meta.data?.bed_types ?? []
    const extra = all.map((q) => q.type).filter((t) => !known.includes(t))
    return [...known, ...Array.from(new Set(extra))]
  }, [meta.data, all])

  const term = search.trim().toLowerCase()
  const visible = useMemo(() => all.filter((q) => (!cell || (q.pr === cell[0] && q.type === cell[1]))
    && (!term || `${q.code} ${q.name} ${q.type} ${q.needs} ${q.item?.bed_code ?? ''} ${q.item?.ward_name ?? ''}`.toLowerCase().includes(term))), [all, cell, term])

  const current = all.find((q) => q.id === sel) ?? [...visible].sort((a, b) => (a.pr === 'URGENT' ? 0 : 1) - (b.pr === 'URGENT' ? 0 : 1) || byPressure(a, b))[0]

  const askAllocate = async (i: PlanItem) => {
    const ok = await confirm({
      title: 'Confirm allocation',
      message: <>
        Allocate <strong>{i.patient_code}</strong> to <strong>{i.bed_code}</strong> ({i.ward_name}) · match score {i.score}/100
        {i.devices.length ? <> with {i.devices.map((d) => d.equipment_code).join(', ')}</> : null}?
        <br /><br /><span className="muted small">This is a rule-based resource match, not a clinical assessment. The system re-checks bed status, type, features and equipment when you confirm.</span>
      </>,
      confirmLabel: 'Confirm allocation',
    })
    if (ok) allocate.mutate(i)
  }
  const askBulk = async (k: Priority, rows: PlanItem[]) => {
    const ok = await confirm({
      title: `Allocate ${plural(rows.length, `${PRIORITY_LABEL[k].toLowerCase()} patient`)}?`,
      message: <>Each patient goes to their AI-matched bed: {rows.slice(0, 6).map((r) => `${r.patient_code} → ${r.bed_code}`).join(', ')}{rows.length > 6 ? ` and ${rows.length - 6} more` : ''}.
        <br /><br /><span className="muted small">Every row is re-checked on its own; any that no longer fit are skipped.</span></>,
      confirmLabel: `Allocate ${rows.length}`,
    })
    if (ok) bulk.mutate(rows)
  }
  const pick = (q: Q) => { setSel(q.id); if (patientId != null) onClose() }
  const toggle = (k: Priority) => setClosed((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n })

  if (plan.isError && !plan.data) return <PageError error={plan.error} onRetry={() => plan.refetch()} />

  const busy = (id: number) => allocate.isPending && allocate.variables?.patient_id === id
  const ready = all.filter((q) => q.item)

  return (
    <div className="bq">
      <div className="bq-main">
        <section className="bq-top">
          <div className="card bq-map">
            <div className="bq-h">
              <h3>Queue map · urgency × care type</h3>
              {cell && <button className="link" onClick={() => setCell(null)}><Icon name="x" />Clear filter</button>}
            </div>
            {!plan.data ? <Skeleton h={150} /> : <QueueMap all={all} types={types} cell={cell} onCell={(c) => { setCell(c); if (c) setClosed((s) => { const n = new Set(s); n.delete(c[0]); return n }) }} />}
          </div>
          <div className="card bq-kpis">
            <div className="bq-h"><h3>Right now</h3></div>
            <div className="bq-kp">
              <div><strong>{plan.data ? all.length : '…'}</strong><small>waiting for a bed</small></div>
              <div className="c"><strong>{plan.data ? all.filter((q) => q.pr === 'URGENT').length : '…'}</strong><small>urgent</small></div>
              <div className="a"><strong>{plan.data ? all.filter(late).length : '…'}</strong><small>past wait target</small></div>
              <div className="m"><strong>{plan.data ? ready.length : '…'}</strong><small>AI-ready{plan.data?.avg_score != null ? ` · avg ${plan.data.avg_score}%` : ''}</small></div>
            </div>
          </div>
        </section>

        <section className="card bq-list" aria-busy={plan.isFetching}>
          <div className="bq-tools">
            <label className="search-field sm grow"><span className="sr-only">Search the queue</span><Icon name="search" />
              <input type="search" placeholder="Search patient, bed or need…" value={search} onChange={(e) => setSearch(e.target.value)} /></label>
            <div className="seg-toggle" role="tablist" aria-label="Layout">
              <button role="tab" aria-selected={view === 'rows'} className={view === 'rows' ? 'on' : ''} onClick={() => setView('rows')}><Icon name="list" />Compact</button>
              <button role="tab" aria-selected={view === 'passes'} className={view === 'passes' ? 'on' : ''} onClick={() => setView('passes')}><Icon name="grid" />Passes</button>
            </div>
          </div>
          <div className="bq-scroll">
            {!plan.data ? <div className="bq-sk">{[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} h={40} />)}</div>
              : !all.length ? (
                <div className="empty"><Icon name="check" />Nobody is waiting for a bed.<button className="btn sm" onClick={() => ui.openRegister()}><Icon name="plus" />Register patient</button></div>
              ) : !visible.length ? <div className="empty">No waiting patients match this filter.</div>
              : LANES.map(({ k, note }) => {
                const qs = visible.filter((q) => q.pr === k).sort(byPressure)
                if (!qs.length) return null
                const isOpen = !closed.has(k) || !!term
                const lim = view === 'rows' ? ROW_LIMIT : PASS_LIMIT
                const shown = expanded.has(k) ? qs : qs.slice(0, lim)
                const readyRows = qs.flatMap((q) => (q.item ? [q.item] : []))
                const lt = qs.filter(late).length
                return (
                  <div key={k} className={`bq-lane p-${k} ${isOpen ? '' : 'closed'}`}>
                    <div className="bq-lane-h">
                      <button className="bq-lane-t" aria-expanded={isOpen} onClick={() => toggle(k)}>
                        <Icon name="chevd" cls="chev" /><h2>{PRIORITY_LABEL[k]}</h2><span className="n">{qs.length}</span>
                        <small>{note}{lt ? <> · <b>{lt} past target</b></> : null}</small>
                      </button>
                      {readyRows.length > 0 && (
                        <button className="btn sm" disabled={bulk.isPending} onClick={() => void askBulk(k, readyRows)}>
                          {bulk.isPending ? <Spinner /> : <Icon name="check" />}Allocate all ready ({readyRows.length})
                        </button>
                      )}
                    </div>
                    {isOpen && (
                      <>
                        {view === 'rows'
                          ? <div className="bq-rows">{shown.map((q) => <Row key={q.id} q={q} on={current?.id === q.id} busy={busy(q.id)} onPick={pick} onAllocate={askAllocate} />)}</div>
                          : <div className="bq-passes">{shown.map((q) => <Pass key={q.id} q={q} on={current?.id === q.id} busy={busy(q.id)} onPick={pick} onAllocate={askAllocate} />)}</div>}
                        {qs.length > shown.length && (
                          <button className="bq-more" onClick={() => setExpanded((s) => new Set(s).add(k))}>Show all {qs.length} {PRIORITY_LABEL[k].toLowerCase()} patients</button>
                        )}
                      </>
                    )}
                  </div>
                )
              })}
          </div>
        </section>
      </div>

      <aside className="card bq-side" aria-live="polite" key={patientId ?? current?.id ?? 'none'}>
        {patientId != null ? <PatientDetailPanel id={patientId} onClose={onClose} />
          : !plan.data ? <><Skeleton h={150} /><Skeleton h={200} /></>
          : !current ? <div className="empty"><Icon name="check" />Everyone waiting has been placed.</div>
          : <SidePass q={current} busy={busy(current.id)} onAllocate={askAllocate} onOpen={onOpen} />}
      </aside>
    </div>
  )
}

/* ------------------------------------------------------------------ queue map */
function QueueMap({ all, types, cell, onCell }: { all: Q[]; types: string[]; cell: [Priority, string] | null; onCell: (c: [Priority, string] | null) => void }) {
  const counts = (k: Priority, t: string) => all.filter((q) => q.pr === k && q.type === t)
  const max = Math.max(1, ...LANES.flatMap(({ k }) => types.map((t) => counts(k, t).length)))
  return (
    <div className="qmap" style={{ gridTemplateColumns: `76px repeat(${types.length}, minmax(0, 1fr)) 44px` }} role="grid" aria-label="Waiting patients by urgency and care type">
      <span />
      {types.map((t) => <span key={t} className="qh c">{t}</span>)}
      <span className="qh c">All</span>
      {LANES.map(({ k }) => (
        <div key={k} className="qrow" role="row">
          <span className={`qh p-${k}`}>{PRIORITY_LABEL[k]}</span>
          {types.map((t) => {
            const qs = counts(k, t), n = qs.length, lt = qs.filter(late).length
            const on = !!cell && cell[0] === k && cell[1] === t
            if (!n) return <span key={t} className="qcell zero" role="gridcell">0</span>
            return (
              <button key={t} role="gridcell" className={`qcell p-${k} ${on ? 'on' : ''}`} style={{ ['--k' as string]: (n / max).toFixed(2) }}
                aria-pressed={on} title={`${n} ${PRIORITY_LABEL[k].toLowerCase()} · ${t}${lt ? ` · ${lt} past target` : ''}`}
                onClick={() => onCell(on ? null : [k, t])}>
                <b>{n}</b>{lt ? <span className="late">{lt} late</span> : null}
                <i className="fill" style={{ width: `${(n / max) * 100}%` }} />
              </button>
            )
          })}
          <span className="qtot">{all.filter((q) => q.pr === k).length}</span>
        </div>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ row & pass */
type ItemProps = { q: Q; on: boolean; busy: boolean; onPick: (q: Q) => void; onAllocate: (i: PlanItem) => void }

function WaitBar({ q }: { q: Q }) {
  return (
    <span className={`bq-wait ${late(q) ? 'late' : ''}`}>
      <small><b>{fmtDur(q.wait)}</b> / {fmtDur(TARGET[q.pr])}</small>
      <span><i style={{ width: `${Math.min(100, ratio(q) * 100)}%` }} /></span>
    </span>
  )
}

function Action({ q, busy, onPick, onAllocate }: Omit<ItemProps, 'on'>) {
  return q.item
    ? <button className="btn sm primary" disabled={busy} onClick={(e) => { e.stopPropagation(); onAllocate(q.item!) }}>{busy ? <Spinner /> : null}Allocate</button>
    : <button className="btn sm danger" onClick={(e) => { e.stopPropagation(); onPick(q) }}><Icon name="wand" />Unlock</button>
}

function Row(p: ItemProps) {
  const { q, on, onPick } = p
  return (
    <div className={`bq-row p-${q.pr} ${on ? 'on' : ''}`} role="button" tabIndex={0} onClick={() => onPick(q)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(q) } }}>
      <span className="edge" aria-hidden="true" />
      <span className="who"><b>{q.code}</b><small>{q.name}</small></span>
      <span className="care">{q.type}</span>
      <span className="needs" title={q.needs}>{q.needs}</span>
      <WaitBar q={q} />
      {q.item
        ? <span className="bed"><b>{q.item.bed_code}</b><small>{q.item.ward_name}</small></span>
        : <span className="bed none" title={q.un?.blockers[0]}><b>No bed fits</b><small>{q.un?.blockers[0] ?? ''}</small></span>}
      <span>{q.item ? <span className={`bq-score ${q.item.score >= 85 ? '' : 'mid'}`}>{q.item.score}%</span> : null}</span>
      <Action {...p} />
    </div>
  )
}

function Ring({ score }: { score: number }) {
  const r = 20, c = 2 * Math.PI * r
  return (
    <svg className={`bq-ring ${score >= 85 ? '' : 'mid'}`} viewBox="0 0 50 50" role="img" aria-label={`Match ${score} of 100`}>
      <circle className="bg" cx="25" cy="25" r={r} />
      <circle className="fg" cx="25" cy="25" r={r} strokeDasharray={c} strokeDashoffset={c * (1 - score / 100)} />
      <text x="25" y="30" textAnchor="middle">{score}</text>
    </svg>
  )
}

function Pass(p: ItemProps) {
  const { q, on, onPick } = p
  return (
    <article className={`pass p-${q.pr} ${q.item ? '' : 'stuck'} ${on ? 'on' : ''}`} role="button" tabIndex={0} onClick={() => onPick(q)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(q) } }}>
      <div className="pm">
        <div className="p-top"><div><div className="p-id">{q.code}</div><div className="p-name">{q.name}</div></div><span className={`prio p-${q.pr}`}>{PRIORITY_LABEL[q.pr]}</span></div>
        <div className="route">
          <div><span className="lbl">FROM</span><b>Waiting</b></div>
          <div className="track"><i style={{ width: `${Math.min(100, ratio(q) * 100)}%` }} /></div>
          <div className="to"><span className="lbl">TO</span><b>{q.item?.ward_name ?? '—'}</b></div>
        </div>
        <div className="meta">
          <div><small>CARE</small><b>{q.type}</b></div>
          <div><small>NEEDS</small><b>{q.needs}</b></div>
          <div><small>WAITING</small><b className={late(q) ? 'late' : ''}>{fmtDur(q.wait)}</b></div>
        </div>
      </div>
      <div className="stub">
        <span className="lbl">BED</span>
        {q.item ? <><span className="bedc">{q.item.bed_code}</span><Ring score={q.item.score} /></> : <><span className="nobed">NO BED<br />FITS</span><Icon name="alert" cls="nobed-ico" /></>}
        <Action {...p} />
      </div>
    </article>
  )
}

/* ------------------------------------------------------------------ side */
function SidePass({ q, busy, onAllocate, onOpen }: { q: Q; busy: boolean; onAllocate: (i: PlanItem) => void; onOpen: (id: number) => void }) {
  return (
    <>
      <div className="bq-side-h"><h3>Bed pass</h3><button className="link" onClick={() => onOpen(q.id)}>Full record<Icon name="chev" /></button></div>
      <Pass q={q} on={false} busy={busy} onPick={() => onOpen(q.id)} onAllocate={onAllocate} />
      <div className="bq-facts">
        <div><small>Waiting</small><b className={late(q) ? 'late' : ''}>{fmtDur(q.wait)}</b></div>
        <div><small>Target</small><b>{fmtDur(TARGET[q.pr])}</b></div>
        <div><small>Bed type</small><b>{q.type}</b></div>
        <div><small>Options</small><b>{q.item ? `${q.item.alternatives + 1} suitable` : 'None'}</b></div>
      </div>
      {q.item ? (
        <div className="bq-why">
          <h4>Why {q.item.bed_code}? <span className="muted">AI match {q.item.score}/100</span></h4>
          <FactorBars factors={q.item.factors} />
          {q.item.devices.length > 0 && <p className="muted small">Devices: {q.item.devices.map((d) => d.equipment_code).join(', ')}</p>}
          <button className="btn primary block" disabled={busy} onClick={() => onAllocate(q.item!)}>{busy ? <Spinner /> : <Icon name="check" />}Allocate {q.item.bed_code}</button>
        </div>
      ) : (
        <div className="bq-stuck">
          <h4><Icon name="alert" />No bed fits right now</h4>
          <ul>{(q.un?.blockers ?? []).map((b) => <li key={b}>{b}</li>)}</ul>
          {q.un && q.un.unlock.length > 0 && <><h4 className="ai"><Icon name="spark" />AI unlock suggestions</h4><UnlockList actions={q.un.unlock} /></>}
        </div>
      )}
      <p className="muted small">Rule-based resource match, not a clinical assessment. Staff confirm every allocation. Wait targets are operational, not triage.</p>
    </>
  )
}
