/* AI Allocation — our feature, built from the Graphite design vocabulary
   (.page-head, .seg-toggle, .stats/.stat, .card, .table-wrap/.table, .reasons, .rec-card, .sim-badge, .modal). */
import { Fragment, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Icon } from '../components/g/Icon'
import { confirm, Modal } from '../components/g/Modal'
import { AiTag, Chip, Empty, FactorBars, PageError, Prio, ScoreBadge, Skeleton, Spinner, StatCard, UnlockList, ago, fmtDur, fmtTime } from '../components/g/parts'
import { toast } from '../components/ui/toast'
import { api } from '../lib/api'
import { clock, plural } from '../lib/format'
import { useAction, useForecast, usePlan, useSettings } from '../lib/queries'
import type { ForecastWard, PlanItem } from '../lib/types'
import { useUI } from '../lib/ui'
import '../styles/pages/AI.css'

type Tab = 'plan' | 'forecast'
type ApplyResult = Awaited<ReturnType<typeof api.applyPlan>> & { rows: PlanItem[] }

export default function AI() {
  const [params, setParams] = useSearchParams()
  const tab: Tab = params.get('tab') === 'forecast' ? 'forecast' : 'plan'
  const ui = useUI()
  const setTab = (t: Tab) => setParams((p) => { const n = new URLSearchParams(p); n.set('tab', t); return n }, { replace: true })
  return (
    <div className="page ai-page">
      <div className="page-head">
        <div>
          <h1 className="ai-h1">AI Allocation <AiTag label="MediTwin AI" /></h1>
          <p className="muted">Plans beds for the whole queue at once, explains every pick and projects capacity · staff approve every allocation</p>
        </div>
        <div className="head-actions">
          <button className="btn" onClick={() => ui.openAssistant()}><Icon name="spark" cls="ai-ico" />Ask the assistant</button>
          <div className="seg-toggle" role="group" aria-label="AI workspace">
            <button aria-pressed={tab === 'plan'} onClick={() => setTab('plan')}><Icon name="wand" />Allocation plan</button>
            <button aria-pressed={tab === 'forecast'} onClick={() => setTab('forecast')}><Icon name="trend" />Capacity forecast</button>
          </div>
        </div>
      </div>
      {tab === 'plan' ? <PlanTab /> : <ForecastTab />}
    </div>
  )
}

/* ================================================================== plan */
function PlanTab() {
  const plan = usePlan()
  const ui = useUI()
  // store exclusions, so a background refetch never re-ticks a row the user left out
  const [excluded, setExcluded] = useState<Set<number>>(new Set())
  const [open, setOpen] = useState<number | null>(null)
  const [result, setResult] = useState<ApplyResult | null>(null)
  const items = useMemo(() => plan.data?.items ?? [], [plan.data])
  const apply = useAction((rows: PlanItem[]) => api.applyPlan(rows.map((r) => ({ patient_id: r.patient_id, bed_id: r.bed_id }))), {
    success: (r) => `${plural(r.confirmed, 'allocation')} confirmed${r.failed ? `, ${r.failed} skipped` : ''}.`,
    onSuccess: (r, rows) => { setResult({ ...r, rows }); setExcluded(new Set()) },
  })

  if (plan.isError && !plan.data) return <PageError error={plan.error} onRetry={() => plan.refetch()} />
  const p = plan.data
  const chosen = items.filter((i) => !excluded.has(i.patient_id))
  const allOn = items.length > 0 && chosen.length === items.length
  const someOn = chosen.length > 0 && !allOn
  const delta = p ? p.placed - p.baseline_placed : 0

  const replan = async () => {
    setResult(null)
    setExcluded(new Set())
    const r = await plan.refetch()
    if (r.isError) toast.error('Could not re-plan. The MediTwin server did not respond.')
    else toast.info('Plan regenerated from live data.')
  }
  const approve = async () => {
    if (!chosen.length) return
    const ok = await confirm({
      title: `Approve ${plural(chosen.length, 'allocation')}?`,
      message: 'Each allocation is saved in its own transaction after the server rechecks the bed and devices. Anything that changed since planning is skipped and reported — nothing is half-saved.',
      confirmLabel: 'Approve & allocate',
    })
    if (ok) apply.mutate(chosen)
  }
  const toggle = (id: number) => setExcluded((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })

  return (
    <>
      {!p ? (
        <div className="stats">{[0, 1, 2, 3].map((i) => <Skeleton key={i} h={96} style={{ borderRadius: 16 }} />)}</div>
      ) : (
        <div className="stats ai-stats">
          <StatCard icon="user" label="Can be placed now" value={<>{p.placed}<small> / {p.waiting}</small></>}
            sub={p.waiting ? (p.unplaced ? `${p.unplaced} need${p.unplaced === 1 ? 's' : ''} an unlock action` : 'Everyone can be placed') : 'Nobody waiting'} />
          <StatCard icon="trend" label="Vs first-come-first-served" status={delta > 0 ? 'AVAILABLE' : undefined}
            value={delta > 0 ? `+${delta}` : delta === 0 ? '=' : `${delta}`}
            sub={`First-come-first-served places ${p.baseline_placed}. Same beds, smarter order.`} />
          <StatCard icon="shield" label="Urgent patients placed" status={p.urgent_total && p.urgent_placed < p.urgent_total ? 'OCCUPIED' : undefined}
            value={<>{p.urgent_placed}<small> / {p.urgent_total}</small></>} sub="Staff-set priority is always planned first" />
          <StatCard icon="target" label="Average match score" value={p.avg_score ?? '—'} sub="Resource fit out of 100 — not clinical" />
        </div>
      )}

      <section className="card ai">
        <div className="card-head">
          <div className="ai-head-text">
            <h2><Icon name="wand" cls="ai-ico" />Proposed allocations{p && <small className="muted ai-gen" title={fmtTime(p.generated_at)}>generated {ago(p.generated_at)}</small>}</h2>
            <p className="muted small">Review the plan, untick anything you disagree with, then approve. Each row is rechecked by the server.</p>
          </div>
          <div className="head-actions">
            <button className="btn" onClick={() => void replan()} disabled={plan.isFetching}>
              <Icon name="refresh" cls={plan.isFetching ? 'spin' : ''} />Re-plan
            </button>
            <button className="btn primary" disabled={!chosen.length || apply.isPending} onClick={() => void approve()}>
              {apply.isPending ? <Spinner /> : <Icon name="check" />}Approve {chosen.length ? plural(chosen.length, 'allocation') : ''}
            </button>
          </div>
        </div>

        {!p && <div className="ai-skel">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} h={44} />)}</div>}
        {p && !items.length && (
          <Empty icon="user">
            <strong>{p.waiting ? 'No placements possible right now' : 'Nobody is waiting for a bed'}</strong>
            <span>{p.waiting ? 'See the unlock suggestions below.' : 'Register a patient to see the AI plan.'}</span>
            {!p.waiting && <button className="btn primary sm" onClick={() => ui.openRegister()}><Icon name="plus" />Register patient</button>}
          </Empty>
        )}
        {items.length > 0 && (
          <div className="table-wrap">
            <table className="table ai-plan">
              <thead>
                <tr>
                  <th className="ai-cb">
                    <input type="checkbox" aria-label="Select all allocations" checked={allOn}
                      ref={(el) => { if (el) el.indeterminate = someOn }}
                      onChange={() => setExcluded(allOn ? new Set(items.map((i) => i.patient_id)) : new Set())} />
                  </th>
                  <th>#</th><th>Patient</th><th>Needs</th><th><span className="sr-only">to</span></th><th>Planned bed</th><th>Devices</th><th className="ai-r">Score</th>
                  <th><span className="sr-only">Why</span></th>
                </tr>
              </thead>
              <tbody>
                {items.map((i) => (
                  <PlanRow key={i.patient_id} i={i} on={!excluded.has(i.patient_id)} open={open === i.patient_id}
                    onToggle={() => toggle(i.patient_id)} onOpen={() => setOpen(open === i.patient_id ? null : i.patient_id)}
                    onPatient={() => ui.openPatient(i.patient_id)} />
                ))}
              </tbody>
            </table>
          </div>
        )}
        {items.length > 0 && <p className="muted small table-foot">{chosen.length} of {plural(items.length, 'proposed allocation')} selected · scores are resource fit, not clinical priority</p>}
      </section>

      {p && p.unplaced_patients.length > 0 && (
        <section className="card">
          <div className="card-head">
            <div className="ai-head-text">
              <h2><Icon name="alert" cls="ai-warn" />Can’t be placed yet</h2>
              <p className="muted small">The AI found what is blocking each patient and the quickest way to unblock them.</p>
            </div>
          </div>
          <ul className="ai-unplaced">
            {p.unplaced_patients.map((u, idx) => (
              <li key={u.patient_id} className="rec-card" style={{ ['--i' as string]: idx }}>
                <div className="rc-top">
                  <div className="rc-id">
                    <span className="ai-who"><button className="link strong code" onClick={() => ui.openPatient(u.patient_id)}>{u.patient_code}</button><Prio priority={u.priority} /></span>
                    <small>{u.display_name}</small>
                  </div>
                  <span className="pc-time" title="Waiting time"><Icon name="clock" />{fmtDur(u.waiting_minutes)}</span>
                </div>
                <p className="muted small ai-needs-line">
                  Needs {u.required_bed_type} bed{u.required_equipment_types.length ? ` + ${u.required_equipment_types.join(', ')}` : ''}{u.required_bed_features.length ? ` · ${u.required_bed_features.join(', ')}` : ''}
                </p>
                <ul className="reasons">{u.blockers.map((b) => <li key={b} className="no"><Icon name="x" />{b}</li>)}</ul>
                {u.unlock.length > 0 && <><h3 className="sub">Quickest fixes</h3><UnlockList actions={u.unlock} /></>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {p && (
        <details className="card ai-how">
          <summary><h2><Icon name="brain" cls="ai-ico" />How the AI plans</h2><Icon name="chevd" cls="ai-chev" /></summary>
          <div className="ai-steps">
            <Step n={1} title="Hard rules first">Only beds that are available, the right (or configured compatible) type, with every required feature and a free device of each needed type. The same rules the server enforces at confirmation.</Step>
            <Step n={2} title="Smart ordering">Priority tiers set by staff go first. Inside a tier, the patient with the fewest suitable beds is placed first, so scarce beds aren’t taken by someone with many options.</Step>
            <Step n={3} title="Explainable score">Each fit scores 0–100: bed type (30), features (20), devices ready (20), keeping scarce beds free (15), ward suits care category (10), ward load (5).</Step>
          </div>
          <p className="note"><Icon name="info" />{p.method} This is resource optimization on fictional data, not a clinical or triage decision.</p>
        </details>
      )}

      <Modal open={!!result} onClose={() => setResult(null)} title="Plan applied"
        footer={<button className="btn primary" onClick={() => setResult(null)}>Done</button>}>
        {result && (
          <>
            <div className="stats compact ai-result-stats">
              <StatCard label="Confirmed" value={result.confirmed} status="AVAILABLE" />
              <StatCard label="Skipped" value={result.failed} status={result.failed ? 'OCCUPIED' : undefined} />
              <StatCard label="Requested" value={result.results.length} />
            </div>
            {result.results.length ? (
              <ul className="reasons ai-results">
                {result.results.map((r) => {
                  const row = result.rows.find((x) => x.patient_id === r.patient_id)
                  const who = r.patient_code ?? row?.patient_code ?? `#${r.patient_id}`
                  const bed = r.bed_code ?? row?.bed_code ?? '—'
                  return (
                    <li key={r.patient_id} className={r.ok ? 'ok' : 'no'}>
                      <Icon name={r.ok ? 'check' : 'x'} />
                      <span><b className="code">{who}</b> → <b className="code">{bed}</b>{!r.ok && <> · {r.message ?? 'Skipped'}</>}</span>
                    </li>
                  )
                })}
              </ul>
            ) : <Empty sm>No rows were sent.</Empty>}
          </>
        )}
      </Modal>
    </>
  )
}

function PlanRow({ i, on, open, onToggle, onOpen, onPatient }: { i: PlanItem; on: boolean; open: boolean; onToggle: () => void; onOpen: () => void; onPatient: () => void }) {
  return (
    <Fragment>
      <tr className={`${on ? '' : 'ai-off'} ${open ? 'ai-open' : ''}`}>
        <td className="ai-cb"><input type="checkbox" checked={on} onChange={onToggle} aria-label={`Include ${i.patient_code}`} /></td>
        <td className="num muted">{i.step}</td>
        <td>
          <div className="ai-who"><button className="link strong code" onClick={onPatient} title={`Open ${i.patient_code}`}>{i.patient_code}</button><Prio priority={i.priority} /></div>
          <div><small className="muted">{i.display_name} · waiting {fmtDur(i.waiting_minutes)}</small></div>
        </td>
        <td>
          <div className="pc-needs">
            <span className="need"><Icon name="bed" />{i.required_bed_type}</span>
            {i.required_bed_features.map((f) => <span key={f} className="need feat">{f}</span>)}
            {i.required_equipment_types.map((e) => <span key={e} className="need dev">{e}</span>)}
          </div>
        </td>
        <td className="ai-arrow"><Icon name="arrow" /></td>
        <td>
          <strong className="code">{i.bed_code}</strong>
          <div><small className="muted">{i.ward_name} · {plural(i.alternatives, 'alternative')}</small></div>
        </td>
        <td>
          {i.devices.length ? (
            <div className="pc-needs">{i.devices.map((d) => <span key={d.id} className="need dev" title={d.equipment_type}><Icon name="cpu" /><span className="code">{d.equipment_code}</span></span>)}</div>
          ) : <span className="muted">—</span>}
        </td>
        <td className="ai-r"><ScoreBadge score={i.score} /></td>
        <td className="ai-r">
          <button className="icon-btn plain" onClick={onOpen} aria-expanded={open} aria-label={`Why ${i.bed_code} for ${i.patient_code}`} title="Why this bed">
            <Icon name="chevd" cls={`ai-chev ${open ? 'up' : ''}`} />
          </button>
        </td>
      </tr>
      {open && (
        <tr className="ai-why-row">
          <td colSpan={9}>
            <div className="ai-why">
              <div>
                <h3 className="sub"><Icon name="spark" cls="ai-ico" />Why this bed</h3>
                <ul className="reasons">{i.reasons.map((r) => <li key={r} className="ok"><Icon name="check" />{r}</li>)}</ul>
              </div>
              <div>
                <h3 className="sub">Match score breakdown · {i.score}/100</h3>
                <FactorBars factors={i.factors} />
              </div>
            </div>
          </td>
        </tr>
      )}
    </Fragment>
  )
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="ai-step">
      <div className="ai-step-head"><span className="ai-step-n">{n}</span><strong>{title}</strong></div>
      <p className="muted small">{children}</p>
    </div>
  )
}

/* ================================================================== forecast */
/* Ward lines use the Graphite palette only (graphite.css tokens: accent, mint, amber, pearl, fog, slate). */
const WARD_COLORS = ['#7db4e6', '#5ed3a5', '#f4c35a', '#eef3f6', '#8da4b3', '#4f6e85']
const CORAL = '#f3786a'
const FOG = '#8da4b3'
const HORIZONS = [12, 24, 48, 72]
const RISK: Record<ForecastWard['risk'], { status: string; label: string }> = {
  critical: { status: 'OCCUPIED', label: 'Critical' },
  high: { status: 'RESERVED', label: 'High' },
  elevated: { status: 'ACTIVE', label: 'Elevated' },
  normal: { status: 'AVAILABLE', label: 'Normal' },
}

function ForecastTab() {
  const [hours, setHours] = useState(24)
  const [demand, setDemand] = useState(1)
  const [d, setD] = useState(1)
  useEffect(() => {
    const t = window.setTimeout(() => setD(demand), 250)
    return () => window.clearTimeout(t)
  }, [demand])
  const f = useForecast(hours, d)
  const settings = useSettings()
  const threshold = settings.data?.high_occupancy_pct ?? 85
  const data = f.data
  const chart = useMemo(() => (data?.series ?? []).map((x) => ({ ...x, clock: clock(x.time) })), [data])

  if (f.isError && !data) return <PageError error={f.error} onRetry={() => f.refetch()} />
  const scenario = demand > 1.2 ? 'surge' : demand < 0.9 ? 'quiet' : 'normal'
  return (
    <>
      <section className="card sim ai-controls">
        <div className="ai-ctl">
          <h3 className="sub">Horizon</h3>
          <div className="seg-toggle" role="group" aria-label="Forecast horizon">
            {HORIZONS.map((h) => <button key={h} aria-pressed={hours === h} onClick={() => setHours(h)}>{h} h</button>)}
          </div>
        </div>
        <div className="ai-ctl grow">
          <div className="ai-ctl-row">
            <h3 className="sub"><label htmlFor="ai-demand">Demand scenario</label></h3>
            <strong className="num">{demand.toFixed(1)}× · {scenario}</strong>
          </div>
          <input id="ai-demand" type="range" className="ai-range" min={0.5} max={2.5} step={0.1} value={demand}
            onChange={(e) => setDemand(Number(e.target.value))} aria-valuetext={`${demand.toFixed(1)} times normal demand`} />
          <div className="ai-range-scale"><span>0.5× quiet</span><span>1× normal</span><span>2.5× major surge</span></div>
        </div>
        <span className="sim-badge">SIMULATED · projection, not live data</span>
      </section>

      <section className="card">
        <div className="card-head">
          <div className="ai-head-text">
            <h2><Icon name="trend" cls="ai-ico" />Projected occupancy by ward</h2>
            <p className="muted small">From expected stay lengths, cleaning turnaround and arrivals — dashed line is your high-occupancy threshold ({threshold}%)</p>
          </div>
          {f.isFetching && <span className="loading-line"><Spinner />Updating…</span>}
        </div>
        <div className="ai-chart">
          {!data ? <Skeleton h="100%" /> : !data.wards.length ? <Empty icon="hospital">No active wards to forecast. Add wards in Setup.</Empty> : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chart} margin={{ top: 8, right: 20, left: -8, bottom: 0 }}>
                <CartesianGrid stroke="rgba(238, 243, 246, .06)" vertical={false} />
                <XAxis dataKey="clock" tick={{ fontSize: 11, fill: FOG }} tickLine={false} axisLine={{ stroke: 'rgba(238, 243, 246, .18)' }}
                  interval={Math.max(0, Math.round(data.series.length / 12) - 1)} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: FOG }} tickLine={false} axisLine={false} unit="%" />
                <Tooltip contentStyle={{ background: 'var(--panel)', borderRadius: 12, border: '1px solid var(--border)', fontSize: 12, boxShadow: 'var(--shadow-lg)', color: 'var(--text)' }}
                  labelStyle={{ color: 'var(--text-2)' }} cursor={{ stroke: 'rgba(238, 243, 246, .18)' }} formatter={(v, n) => [`${v}%`, n]} />
                <Legend iconType="circle" wrapperStyle={{ fontSize: 12, paddingTop: 8, color: 'var(--text-2)' }} />
                <ReferenceLine y={threshold} stroke={CORAL} strokeDasharray="5 5" />
                {data.wards.map((w, idx) => (
                  <Line key={w.key} type="monotone" dataKey={w.key} name={w.name} stroke={WARD_COLORS[idx % WARD_COLORS.length]} strokeWidth={2.2} dot={false} isAnimationActive={false} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </section>

      {!data ? (
        <div className="stats">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} h={110} style={{ borderRadius: 16 }} />)}</div>
      ) : data.wards.length > 0 && (
        <div className="stats ai-risks">
          {data.wards.map((w, idx) => (
            <div key={w.ward_id} className={`stat ai-risk st-${RISK[w.risk].status}`}>
              <span className="stat-label">
                <span className="ai-swatch" style={{ background: WARD_COLORS[idx % WARD_COLORS.length] }} aria-hidden="true" />
                <span className="ai-risk-name">{w.name}</span>
                <Chip status={RISK[w.risk].status} label={RISK[w.risk].label} />
              </span>
              <strong className="num"><small>{Math.round(w.now_pct)}%</small> <Icon name="arrow" cls="ai-arrow-sm" /> {Math.round(w.peak_pct)}%</strong>
              <small>Peak {w.peak_label} ({clock(w.peak_time)}) · {plural(w.discharges_expected, 'discharge')} expected · {w.capacity} beds</small>
            </div>
          ))}
        </div>
      )}

      {data && data.assumptions.length > 0 && (
        <section className="card">
          <h2><Icon name="info" />Planning assumptions</h2>
          <ul className="plain ai-assumptions">{data.assumptions.map((a) => <li key={a}>{a}</li>)}</ul>
        </section>
      )}
    </>
  )
}
