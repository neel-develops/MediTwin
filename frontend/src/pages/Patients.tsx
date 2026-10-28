/* Patient Flow — the Graphite design's flow command center (app.js PAGES.patients), on our live API. */
import { useQuery } from '@tanstack/react-query'
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Icon } from '../components/g/Icon'
import { PageError, PRIORITY_LABEL, Skeleton } from '../components/g/parts'
import { PatientDetailPanel } from '../components/patients/PatientDetail'
import {
  FLOW_STAGES, fmtDur, isFlowStage, PAGE_SIZE, pageNumbers, PatientCard, PrioPill, STAGE_META, type FlowStage,
} from '../components/patients/flow'
import { api } from '../lib/api'
import { keys, useFlow, useMeta, useWards } from '../lib/queries'
import type { Flow, FlowCard } from '../lib/types'
import { useUI } from '../lib/ui'
import '../styles/pages/Patients.css'

const EMPTY_FILTERS = { priority: '', care: '', bed_type: '', ward_id: '' }

export default function Patients() {
  const ui = useUI()
  const nav = useNavigate()
  const meta = useMeta()
  const wards = useWards()
  const [sp, setSp] = useSearchParams()
  const boardRef = useRef<HTMLElement>(null)

  // URL state (her replaceHash: ?patient=&stage=); legacy ?status=WAITING|ALLOCATED maps to a stage.
  const rawPatient = Number(sp.get('patient'))
  const patientId = Number.isFinite(rawPatient) && rawPatient > 0 ? rawPatient : null
  const statusParam = sp.get('status')
  const stageParam = sp.get('stage') ?? (statusParam === 'WAITING' || statusParam === 'ALLOCATED' ? statusParam : '')
  const stage: FlowStage | '' = isFlowStage(stageParam) ? stageParam : ''

  const [search, setSearch] = useState('')
  const [q, setQ] = useState('')
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const [page, setPage] = useState(1)

  useEffect(() => {
    const t = window.setTimeout(() => setQ(search.trim()), 200)
    return () => window.clearTimeout(t)
  }, [search])
  useEffect(() => { setPage(1) }, [q, filters, stage])

  const patch = useCallback((fn: (n: URLSearchParams) => void) => {
    setSp((cur) => { const n = new URLSearchParams(cur); fn(n); return n }, { replace: true })
  }, [setSp])
  const pick = useCallback((id: number) => patch((n) => n.set('patient', String(id))), [patch])
  const closePatient = useCallback(() => patch((n) => n.delete('patient')), [patch])
  const setStage = (s: FlowStage | '') => patch((n) => {
    n.delete('status')
    if (s && s !== stage) n.set('stage', s); else n.delete('stage')
  })
  const backToBoard = () => patch((n) => { n.delete('status'); n.delete('stage') })

  // ?register=1 opens the register modal (her `params.register`).
  useEffect(() => {
    if (sp.get('register')) { ui.openRegister(); patch((n) => n.delete('register')) }
  }, [sp, ui, patch])

  const base = { search: q, care_category: filters.care, bed_type: filters.bed_type, priority: filters.priority, ward_id: filters.ward_id }
  const flow = useFlow(stage ? { ...base, stage, page, page_size: PAGE_SIZE } : { ...base, per_column: 5 })
  const f = flow.data
  const filtering = !!q || Object.values(filters).some(Boolean)
  const setF = (k: keyof typeof EMPTY_FILTERS) => (e: React.ChangeEvent<HTMLSelectElement>) => setFilters((x) => ({ ...x, [k]: e.target.value }))
  const clear = () => { setSearch(''); setQ(''); setFilters(EMPTY_FILTERS) }
  const goPage = (n: number) => { setPage(n); boardRef.current?.scrollIntoView({ block: 'nearest' }) }

  if (flow.isError && !f) return <PageError error={flow.error} onRetry={() => flow.refetch()} />

  return (
    <div className="page pflow">
      <div className="page-head"><div><h1>Patient Flow</h1><p className="muted">Live from stored records · priority is staff-set, not clinical triage</p></div>
        <div className="head-actions">
          <button className="btn" onClick={() => nav('/ai?tab=plan')}><Icon name="wand" />AI plan for queue</button>
          <button className="btn primary" onClick={() => ui.openRegister()}><Icon name="plus" />Register patient</button>
        </div></div>

      <section className="flow-strip" aria-label="Patient flow stages">
        {f ? <FlowStrip f={f} stage={stage} onStage={setStage} /> : FLOW_STAGES.map((s, i) => (
          <Fragment key={s}>{i > 0 && <span className="flow-arrow" aria-hidden="true"><i /></span>}<div className="pf-skel-tile"><Skeleton h={86} style={{ borderRadius: 18 }} /></div></Fragment>
        ))}
      </section>

      <section className="card pf-toolbar">
        <div className="pf-tabs" role="tablist" aria-label="Stage">
          <button role="tab" className={`pf-tab ${!stage ? 'on' : ''}`} aria-selected={!stage} onClick={backToBoard}>
            Board<span>{f ? FLOW_STAGES.reduce((n, s) => n + (f.filtered_counts[s] ?? 0), 0) : '…'}</span></button>
          {FLOW_STAGES.map((s) => (
            <button key={s} role="tab" className={`pf-tab sg-${s} ${stage === s ? 'on' : ''}`} aria-selected={stage === s} onClick={() => setStage(s)}>
              <i aria-hidden="true" />{STAGE_META[s].label}<span>{f ? f.filtered_counts[s] ?? 0 : '…'}</span></button>
          ))}
          {filtering && <button className="link pf-clear" onClick={clear}><Icon name="x" />Clear filters</button>}
        </div>
        <div className="pf-filters">
          <label className="search-field sm grow"><span className="sr-only">Search patients</span><Icon name="search" />
            <input type="search" placeholder="Search patient code, name or bed…" value={search} onChange={(e) => setSearch(e.target.value)} /></label>
          <label className="sel"><span className="sr-only">Priority</span>
            <select value={filters.priority} onChange={setF('priority')}><option value="">Any priority</option>
              {(meta.data?.priorities ?? (['URGENT', 'HIGH', 'ROUTINE'] as const)).map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}</select></label>
          <label className="sel"><span className="sr-only">Care category</span>
            <select value={filters.care} onChange={setF('care')}><option value="">All care categories</option>
              {meta.data?.care_categories.map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
          <label className="sel"><span className="sr-only">Bed type needed</span>
            <select value={filters.bed_type} onChange={setF('bed_type')}><option value="">Any bed type</option>
              {meta.data?.bed_types.map((t) => <option key={t} value={t}>{t}</option>)}</select></label>
          <label className="sel"><span className="sr-only">Ward of assigned bed</span>
            <select value={filters.ward_id} onChange={setF('ward_id')}><option value="">Any ward (bed)</option>
              {wards.data?.filter((w) => w.is_active || String(w.id) === filters.ward_id).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></label>
        </div>
      </section>

      <div className="pf-main">
        <section ref={boardRef} className={stage ? 'pf-focus' : 'pf-board'} aria-live="polite" aria-busy={flow.isFetching}>
          {!f ? <BoardSkeleton focus={!!stage} />
            : stage ? <Focus f={f} stage={stage} patientId={patientId} onPick={pick} onBack={backToBoard} onPage={goPage} />
              : !f.columns ? <BoardSkeleton focus={false} />
              : FLOW_STAGES.map((s) => {
                const cards = f.columns?.[s] ?? []
                const n = f.filtered_counts[s] ?? 0
                return (
                  <section key={s} className={`pf-col sg-${s}`} aria-label={STAGE_META[s].label}>
                    <header><span className="sg-dot" aria-hidden="true"><Icon name={STAGE_META[s].icon} /></span><div><h2>{STAGE_META[s].label}</h2><small>{STAGE_META[s].note}</small></div><span className="pf-count">{n}</span></header>
                    <div className="pf-cards">{cards.length
                      ? cards.map((c, i) => <PatientCard key={c.id} c={c} i={i} on={c.id === patientId} onPick={pick} />)
                      : <div className="pf-empty"><Icon name="check" /><span>No patients here{n === 0 && f.totals[s] ? ' match the filters' : ''}.</span></div>}</div>
                    {n > cards.length && <button className="pf-more" onClick={() => setStage(s)}>View all {n} <Icon name="arrow" /></button>}
                  </section>
                )
              })}
        </section>
        <aside className="card pf-detail" aria-live="polite" key={patientId ?? 'summary'}>
          {patientId != null ? <PatientDetailPanel id={patientId} onClose={closePatient} /> : <CommandSummary f={f} onPick={pick} />}
        </aside>
      </div>
    </div>
  )
}

function FlowStrip({ f, stage, onStage }: { f: Flow; stage: FlowStage | ''; onStage: (s: FlowStage) => void }) {
  const { totals, stats } = f
  const t = (s: FlowStage) => totals[s] ?? 0
  const sub: Record<FlowStage, string> = {
    WAITING: t('WAITING') ? `Longest wait ${fmtDur(stats.longest_minutes.WAITING)}` : 'Nobody waiting',
    MATCHING: t('MATCHING') ? `Longest search ${fmtDur(stats.longest_minutes.MATCHING)}` : 'No active searches',
    ALLOCATED: t('ALLOCATED') ? `Oldest hold ${fmtDur(stats.longest_minutes.ALLOCATED)}` : 'No beds on hold',
    ADMITTED: `${stats.released_today} discharged or transferred today`,
  }
  return (
    <>
      {FLOW_STAGES.map((s, i) => {
        const noFit = stats.no_fit[s] ?? 0
        return (
          <Fragment key={s}>
            {i > 0 && <span className="flow-arrow" aria-hidden="true"><i /></span>}
            <button className={`stage-tile sg-${s} ${stage === s ? 'on' : ''}`} aria-pressed={stage === s} onClick={() => onStage(s)}>
              <span className="sg-icon" aria-hidden="true"><Icon name={STAGE_META[s].icon} /></span>
              <span className="sg-body"><small>{STAGE_META[s].label}</small><strong>{t(s)}</strong><em>{sub[s]}{s === 'WAITING' && noFit > 0 && stats.urgent_waiting > 0 ? ` · ${stats.urgent_waiting} urgent` : ''}</em></span>
              {noFit ? <span className="sg-flag none"><Icon name="alert" />{noFit} no bed fits</span>
                : s === 'WAITING' && stats.urgent_waiting ? <span className="sg-flag urgent">{stats.urgent_waiting} urgent</span> : null}
            </button>
          </Fragment>
        )
      })}
    </>
  )
}

function Focus({ f, stage, patientId, onPick, onBack, onPage }: {
  f: Flow; stage: FlowStage; patientId: number | null; onPick: (id: number) => void; onBack: () => void; onPage: (n: number) => void
}) {
  // While a new stage loads, placeholder data may still be the board shape.
  const items = f.stage === stage ? f.items ?? [] : []
  const total = f.stage === stage ? f.total ?? 0 : 0
  const page = f.page ?? 1
  const pages = f.pages ?? 1
  const first = (page - 1) * PAGE_SIZE + 1
  return (
    <>
      <div className={`pf-focus-head sg-${stage}`}>
        <span className="sg-dot" aria-hidden="true"><Icon name={STAGE_META[stage].icon} /></span>
        <div><h2>{STAGE_META[stage].label}</h2><small>{total ? `Showing ${first}–${first + items.length - 1} of ${total}` : 'No patients'} · {STAGE_META[stage].note}</small></div>
        <button className="btn sm ghost" onClick={onBack}><Icon name="layers" />Back to board</button>
      </div>
      {f.stage !== stage ? <div className="pf-grid">{[0, 1, 2, 3].map((i) => <Skeleton key={i} h={130} style={{ borderRadius: 14 }} />)}</div>
        : items.length ? <div className="pf-grid">{items.map((c, i) => <PatientCard key={c.id} c={c} i={i} on={c.id === patientId} onPick={onPick} />)}</div>
          : <div className="pf-empty big"><Icon name="check" /><span>No {STAGE_META[stage].label.toLowerCase()} patients match these filters.</span></div>}
      {f.stage === stage && pages > 1 && (
        <nav className="pager" aria-label="Pages">
          <button className="btn sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>‹ Prev</button>
          {pageNumbers(page, pages).map((n, i) => (n === '…'
            ? <span key={`g${i}`} className="gap">…</span>
            : <button key={n} className={`pg ${n === page ? 'on' : ''}`} aria-current={n === page ? 'page' : undefined} onClick={() => onPage(n)}>{n}</button>))}
          <button className="btn sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next ›</button>
        </nav>
      )}
    </>
  )
}

function BoardSkeleton({ focus }: { focus: boolean }) {
  if (focus) return <div className="pf-grid">{[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} h={130} style={{ borderRadius: 14 }} />)}</div>
  return (
    <>
      {FLOW_STAGES.map((s) => (
        <section key={s} className={`pf-col sg-${s}`} aria-label={STAGE_META[s].label}>
          <header><span className="sg-dot" aria-hidden="true"><Icon name={STAGE_META[s].icon} /></span><div><h2>{STAGE_META[s].label}</h2><small>{STAGE_META[s].note}</small></div><span className="pf-count">…</span></header>
          <div className="pf-cards">{[0, 1, 2].map((i) => <Skeleton key={i} h={120} style={{ borderRadius: 14 }} />)}</div>
        </section>
      ))}
    </>
  )
}

/* Command summary (her overviewPanel) — shown when no patient is selected. */
function useFlowQuery(q: Record<string, string | number>) {
  return useQuery({ queryKey: keys.flow(q), queryFn: () => api.flow(q), refetchInterval: 15_000 })
}

function CommandSummary({ f, onPick }: { f: Flow | undefined; onPick: (id: number) => void }) {
  const uW = useFlowQuery({ stage: 'WAITING', priority: 'URGENT', page_size: 3 })
  const uM = useFlowQuery({ stage: 'MATCHING', priority: 'URGENT', page_size: 3 })
  const sM = useFlowQuery({ stage: 'MATCHING', page_size: 200 })
  const sW = useFlowQuery({ stage: 'WAITING', page_size: 200 })
  const totals = f?.totals ?? uW.data?.totals
  const urgent = useMemo(() => [...(uW.data?.items ?? []), ...(uM.data?.items ?? [])], [uW.data, uM.data])
  const stuck = useMemo(() => [...(sM.data?.items ?? []), ...(sW.data?.items ?? [])].filter((c) => c.fit_count === 0).slice(0, 4), [sM.data, sW.data])
  const t = (s: string) => totals?.[s] ?? 0
  const mini = (c: FlowCard) => (
    <button key={c.id} className="pd-mini" onClick={() => onPick(c.id)}>
      <strong>{c.patient_code}</strong><span>{isFlowStage(c.stage) ? STAGE_META[c.stage].label : c.stage} · {fmtDur(c.minutes)}</span><PrioPill priority={c.priority} />
    </button>
  )
  const err = uW.isError || uM.isError || sM.isError || sW.isError
  return (
    <>
      <div className="pd-head"><div className="pd-id"><div className="pd-badge sg-MATCHING" aria-hidden="true"><Icon name="activity" /></div><div><h2>Command summary</h2><p>Select a patient card for details and actions</p></div></div></div>
      <div className="pd-sum">
        <div><strong>{totals ? t('WAITING') + t('MATCHING') : '…'}</strong><small>need a bed</small></div>
        <div><strong>{totals ? t('ALLOCATED') : '…'}</strong><small>arriving</small></div>
        <div><strong>{totals ? t('ADMITTED') : '…'}</strong><small>in beds</small></div>
      </div>
      <h3 className="sub">Urgent and waiting</h3>
      {uW.isLoading || uM.isLoading ? <><Skeleton h={40} /><Skeleton h={40} /></>
        : urgent.length ? <div className="pd-minis">{urgent.map(mini)}</div> : <p className="muted small">No urgent patients are waiting.</p>}
      <h3 className="sub">No bed fits right now</h3>
      {sM.isLoading || sW.isLoading ? <><Skeleton h={40} /><Skeleton h={40} /></>
        : stuck.length ? <div className="pd-minis">{stuck.map(mini)}</div> : <p className="muted small">Every waiting patient has at least one suitable bed.</p>}
      {err && <p className="muted small">Some summary figures could not be refreshed.</p>}
      <p className="pd-foot-note"><Icon name="info" />Patients are shown as cards, never as figures. Board columns show the first 5 per stage — open a stage to page through everyone.</p>
    </>
  )
}
