/* Dashboard — one-screen overview built only from the Graphite design's components
   (her original dashboard stats, .card, .stack, donut + .legend, .alerts, .table, chips, .prio). */
import { useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Area, AreaChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { api } from '../lib/api'
import { clock, greeting, plural } from '../lib/format'
import { useAction, useAlerts, useBriefing, useForecast, usePlan, useSettings, useSummary } from '../lib/queries'
import type { ForecastWard, Insight, PlanItem, Priority, UnplacedPatient } from '../lib/types'
import { useUI } from '../lib/ui'
import { Icon } from '../components/g/Icon'
import { confirm } from '../components/g/Modal'
import { AiTag, AlertList, BED_STATUSES, Donut, PageError, Prio, STATUS_LABEL, ScoreBadge, Skeleton, Spinner, StackBar, StatCard, TimeTag, fmtDur, pct } from '../components/g/parts'
import '../styles/pages/Dashboard.css'

export default function Dashboard() {
  const summary = useSummary()
  const ui = useUI()
  const nav = useNavigate()
  if (summary.isError && !summary.data) return <PageError error={summary.error} onRetry={() => summary.refetch()} />
  const s = summary.data
  const now = new Date()
  const b = s?.beds
  const dev = s?.equipment.devices
  return (
    <div className="page dash">
      <div className="page-head">
        <div>
          <h1>{greeting(now)}</h1>
          <p className="muted">{now.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })} · {s?.hospital_name ?? '…'} · live totals from stored records</p>
        </div>
        <div className="head-actions">
          <button className="btn" onClick={() => ui.openRegister()}><Icon name="plus" />Register patient</button>
          <button className="btn primary" onClick={() => nav('/ai')}><Icon name="wand" />Run AI allocation</button>
        </div>
      </div>

      <section className="stats dash-stats" aria-label="Bed, equipment and patient totals">
        {!s || !b || !dev ? Array.from({ length: 8 }, (_, i) => <Skeleton key={i} h={86} />) : (
          <>
            <Link to="/beds" className="stat-link"><StatCard label="Total beds" value={b.total} sub={`${s.wards.length} active wards`} /></Link>
            {BED_STATUSES.map((st) => (
              <Link key={st} to={`/beds?status=${st}`} className="stat-link"><StatCard label={STATUS_LABEL[st]} value={b[st]} status={st} sub={`${pct(b[st], b.total)}% of beds`} /></Link>
            ))}
            <Link to="/equipment" className="stat-link">
              <StatCard className="equip" icon="monitor" label="Devices" value={<>{dev.AVAILABLE}<small> available</small></>} sub={`${dev.IN_USE} in use · ${dev.MAINTENANCE} maint.`} />
            </Link>
            <Link to="/patients" className="stat-link">
              <StatCard className={s.queue.urgent ? 'warn' : ''} icon="user" label="Waiting patients" value={s.queue.waiting}
                sub={`${s.queue.urgent} urgent · ${s.queue.placeable_now} placeable`} />
            </Link>
          </>
        )}
      </section>

      <div className="dash-grid">
        <WardCapacity />
        <Briefing />
        <BedOverview />
        <ForecastCard />
        <AdmissionQueue />
        <AlertsCard />
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ ward capacity */
const RISK_CHIP: Record<ForecastWard['risk'], string> = { critical: 'st-OCCUPIED', high: 'st-RESERVED', elevated: 'st-ALLOCATED', normal: 'st-AVAILABLE' }

function WardCapacity() {
  const summary = useSummary()
  const f = useForecast(24, 1)
  const nav = useNavigate()
  const peaks = useMemo(() => new Map((f.data?.wards ?? []).map((w) => [w.ward_id, w])), [f.data])
  const wards = summary.data?.wards
  return (
    <section className="card d-wards">
      <div className="card-head">
        <h2><Icon name="layers" />Ward capacity</h2>
        <Link className="link" to="/allocations">Bed Allocations<Icon name="chev" /></Link>
      </div>
      <div className="d-body">
        {!wards ? <div className="sk-list">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} h={40} />)}</div>
          : !wards.length ? <div className="empty">No active wards. <Link className="link" to="/setup">Add a ward</Link></div>
          : (
            <ul className="ward-sum">
              {wards.map((w) => {
                const p = peaks.get(w.id)
                const freeCls = w.counts.AVAILABLE === 0 ? 'none' : w.available_pct <= 10 ? 'low' : ''
                return (
                  <li key={w.id}>
                    <button className="ward-row" onClick={() => nav(`/allocations?ward=${w.id}`)} aria-label={`Open ${w.name} in Bed Allocations`}>
                      <span className="wr-name"><strong>{w.name}</strong><small>{w.bed_count} beds · {w.occupancy_pct}%</small></span>
                      <span className="wr-bar">{w.bed_count ? <StackBar counts={w.counts} total={w.bed_count} /> : <span className="muted small">No beds</span>}</span>
                      <span className={`wr-free ${freeCls}`}><b>{w.counts.AVAILABLE}</b><small>free</small></span>
                      <span className="wr-peak">
                        {p ? <span className={`chip ${RISK_CHIP[p.risk]}`} title={`Projected 24 h peak ${Math.round(p.peak_pct)}% ${p.peak_label} (${p.risk})`}><i aria-hidden="true" />{Math.round(p.peak_pct)}%</span>
                          : f.isError ? <span className="muted small">—</span> : <Skeleton h={20} w={52} />}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
      </div>
      <p className="d-foot muted small">Chip = projected 24 h peak occupancy</p>
    </section>
  )
}

/* ------------------------------------------------------------------ AI briefing */
const SEV_ICON: Record<string, string> = { critical: 'alert', warning: 'alert', action: 'zap', info: 'info' }

function Briefing() {
  const br = useBriefing()
  const nav = useNavigate()
  const clean = useAction((ids: number[]) => api.bulkBedStatus({ status: 'AVAILABLE', from_status: 'CLEANING', bed_ids: ids }), {
    success: (r) => `${plural(r.changed, 'bed')} marked available.`,
  })
  const act = async (i: Insight) => {
    const a = i.action
    if (!a) return
    if (a.kind === 'OPEN_PLAN') nav('/ai')
    else if (a.kind === 'OPEN_FORECAST') nav('/ai?tab=forecast')
    else if (a.kind === 'OPEN_EQUIPMENT') nav(a.type ? `/equipment?type=${encodeURIComponent(a.type)}` : '/equipment')
    else if (a.kind === 'OPEN_BEDS') nav(a.status ? `/beds?status=${a.status}` : '/beds')
    else if (a.kind === 'MARK_CLEANED' && a.bed_ids?.length) {
      const ok = await confirm({
        title: 'Mark cleaned beds ready?',
        message: <>{plural(a.bed_ids.length, 'bed')} past the cleaning turnaround will become <strong>Available</strong>. Only do this once housekeeping has confirmed they are clean.</>,
        confirmLabel: 'Mark ready',
      })
      if (ok) clean.mutate(a.bed_ids)
    }
  }
  const d = br.data
  return (
    <section className="card ai d-brief" aria-label="MediTwin AI briefing">
      <div className="card-head">
        <h2><Icon name="spark" />AI briefing<AiTag /></h2>
        {d && d.insights.length > 2
          ? <Link className="link" to="/ai">+{d.insights.length - 2} more<Icon name="chev" /></Link>
          : <span className="muted small">{d ? <>updated <TimeTag iso={d.generated_at} /></> : br.isError ? 'unavailable' : 'analysing…'}</span>}
      </div>
      <div className="d-body">
        {br.isError && !d ? (
          <div className="empty sm">The briefing could not be generated.<button className="btn sm" onClick={() => br.refetch()}><Icon name="refresh" />Try again</button></div>
        ) : !d ? (
          <div className="sk-list"><Skeleton h={38} /><Skeleton h={44} /><Skeleton h={44} /></div>
        ) : (
          <>
            <p className="brief-headline">{d.headline}</p>
            <div className="brief-metrics">
              <div><strong>{d.plan.placed}<small>/{d.plan.waiting}</small></strong><small>placeable now</small></div>
              <div><strong className={d.plan.placed > d.plan.baseline_placed ? 'up' : ''}>{d.plan.placed - d.plan.baseline_placed > 0 ? `+${d.plan.placed - d.plan.baseline_placed}` : '='}</strong><small>vs first-come</small></div>
              <div><strong>{d.plan.urgent_placed}<small>/{d.plan.urgent_total}</small></strong><small>urgent placed</small></div>
              <div><strong>{d.plan.avg_score ?? '—'}</strong><small>avg match</small></div>
            </div>
            {d.insights.length ? (
              <ul className="alerts brief-list">
                {d.insights.slice(0, 2).map((i) => (
                  <li key={i.id} className={i.severity === 'critical' ? 'sev-critical' : i.severity === 'warning' ? 'sev-warning' : ''}>
                    <Icon name={SEV_ICON[i.severity] ?? 'info'} cls={i.severity === 'critical' ? 'sev-critical' : i.severity === 'warning' ? 'sev-warning' : 'brief-ico'} />
                    <div><strong>{i.title}</strong><small>{i.detail}</small></div>
                    {i.action ? (
                      <button className="link" disabled={i.action.kind === 'MARK_CLEANED' && clean.isPending} onClick={() => void act(i)}>
                        {i.action.kind === 'MARK_CLEANED' && clean.isPending ? <Spinner /> : null}{i.action.label}
                      </button>
                    ) : <span />}
                  </li>
                ))}
              </ul>
            ) : <div className="empty ok sm"><Icon name="check" /> Nothing needs attention right now.</div>}
          </>
        )}
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ bed overview */
function BedOverview() {
  const summary = useSummary()
  const nav = useNavigate()
  const s = summary.data
  return (
    <section className="card d-overview">
      <div className="card-head">
        <h2>Bed overview</h2>
        <Link className="link" to="/beds">View all</Link>
      </div>
      <div className="d-body">
        {!s ? <Skeleton h={150} /> : (
          <div className="overview">
            <Donut counts={s.beds} total={s.beds.total} />
            <ul className="legend">
              {BED_STATUSES.map((st) => (
                <li key={st}>
                  <button className="link" onClick={() => nav(`/beds?status=${st}`)}><i className={`sw st-${st}`} />{STATUS_LABEL[st]}</button>
                  <strong>{s.beds[st]}</strong>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      {s && s.beds_by_type.length > 0 && (
        <p className="d-foot muted small">Free by type: {s.beds_by_type.map((t) => `${t.bed_type} ${t.AVAILABLE}/${t.total}`).join(' · ')}</p>
      )}
    </section>
  )
}

/* ------------------------------------------------------------------ forecast */
function ForecastCard() {
  const f = useForecast(24, 1)
  const settings = useSettings()
  const series = f.data?.series ?? []
  const chart = useMemo(() => series.map((x) => ({ clock: clock(x.time), occupancy_pct: x.occupancy_pct })), [series])
  const now = series[0]?.occupancy_pct
  const peak = series.reduce<{ occupancy_pct: number; time: string } | null>((m, x) => (!m || x.occupancy_pct > m.occupancy_pct ? x : m), null)
  const hot = [...(f.data?.wards ?? [])].sort((a, b) => b.peak_pct - a.peak_pct)[0]
  const threshold = settings.data?.high_occupancy_pct ?? 85
  return (
    <section className="card d-forecast">
      <div className="card-head">
        <h2><Icon name="trend" />Occupancy · next 24 h</h2>
        <span className="sim-badge">SIMULATED</span>
      </div>
      <div className="fc-figs">
        <div><small>Now</small><strong>{now != null ? `${Math.round(now)}%` : '—'}</strong></div>
        <div><small>Peak</small><strong>{peak ? `${Math.round(peak.occupancy_pct)}%` : '—'}</strong><small>{peak ? `at ${clock(peak.time)}` : ''}</small></div>
        <div><small>Pressure point</small><strong className="fc-ward">{hot ? hot.name : '—'}</strong><small>{hot ? `${Math.round(hot.peak_pct)}% ${hot.peak_label}` : ''}</small></div>
      </div>
      <div className="d-body fc-chart">
        {chart.length ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chart} margin={{ top: 6, right: 6, left: -26, bottom: 0 }}>
              <defs>
                <linearGradient id="dash-fc" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" style={{ stopColor: 'var(--accent)', stopOpacity: 0.35 }} />
                  <stop offset="100%" style={{ stopColor: 'var(--accent)', stopOpacity: 0 }} />
                </linearGradient>
              </defs>
              <XAxis dataKey="clock" tick={{ fontSize: 10, fill: 'var(--text-2)' }} tickLine={false} axisLine={{ stroke: 'var(--border)' }} interval={5} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: 'var(--text-2)' }} tickLine={false} axisLine={false} unit="%" width={52} />
              <ReferenceLine y={threshold} stroke="var(--coral)" strokeDasharray="4 4" />
              <Tooltip
                cursor={{ stroke: 'var(--border-strong)' }}
                contentStyle={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 10, fontSize: 12, color: 'var(--text)' }}
                labelStyle={{ color: 'var(--text-2)' }} itemStyle={{ color: 'var(--text)' }}
                formatter={(v) => [`${Math.round(Number(v))}%`, 'Projected']}
              />
              <Area type="monotone" dataKey="occupancy_pct" stroke="var(--accent)" strokeWidth={2} fill="url(#dash-fc)" isAnimationActive={false}
                activeDot={{ r: 3, fill: 'var(--accent)', stroke: 'var(--panel)' }} />
            </AreaChart>
          </ResponsiveContainer>
        ) : f.isError ? <div className="empty sm">Forecast unavailable</div> : <Skeleton h="100%" />}
      </div>
      <p className="d-foot muted small"><Link className="link" to="/ai?tab=forecast">Open forecast</Link> · dashed line = {threshold}% alert threshold</p>
    </section>
  )
}

/* ------------------------------------------------------------------ admission queue */
type QueueRow = { kind: 'placed'; i: PlanItem; pr: Priority; wait: number } | { kind: 'unplaced'; u: UnplacedPatient; pr: Priority; wait: number }
const RANK: Record<Priority, number> = { URGENT: 0, HIGH: 1, ROUTINE: 2 }

function AdmissionQueue() {
  const plan = usePlan()
  const ui = useUI()
  const allocate = useAction((i: PlanItem) => api.allocate(i.patient_id, i.bed_id), {
    success: (r) => `${r.patient_code ?? 'Patient'} allocated to ${r.bed_code}.`,
  })
  const rows = useMemo<QueueRow[]>(() => {
    if (!plan.data) return []
    const placed: QueueRow[] = plan.data.items.map((i) => ({ kind: 'placed', i, pr: i.priority, wait: i.waiting_minutes }))
    const un: QueueRow[] = plan.data.unplaced_patients.map((u) => ({ kind: 'unplaced', u, pr: u.priority, wait: u.waiting_minutes }))
    return [...placed, ...un].sort((a, b) => RANK[a.pr] - RANK[b.pr] || b.wait - a.wait)
  }, [plan.data])
  const ask = async (i: PlanItem) => {
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
  return (
    <section className="card d-queue">
      <div className="card-head">
        <h2>Admission queue<AiTag label="AI matched" /></h2>
        <Link className="link" to="/ai">Plan all<Icon name="chev" /></Link>
      </div>
      <div className="d-body">
        {plan.isLoading ? <div className="sk-list">{[0, 1, 2, 3].map((i) => <Skeleton key={i} h={36} />)}</div>
          : plan.isError && !plan.data ? <div className="empty sm">Couldn’t load the plan.<button className="btn sm" onClick={() => plan.refetch()}><Icon name="refresh" />Try again</button></div>
          : !rows.length ? (
            <div className="empty"><Icon name="check" />Nobody is waiting for a bed.<button className="btn sm" onClick={() => ui.openRegister()}><Icon name="plus" />Register patient</button></div>
          ) : (
            <table className="table q-table">
              <thead><tr><th scope="col">Patient</th><th scope="col">AI-matched bed</th><th scope="col"><span className="sr-only">Action</span></th></tr></thead>
              <tbody>
                {rows.map((r) => r.kind === 'placed' ? (
                  <tr key={`p${r.i.patient_id}`}>
                    <td>
                      <button className="link strong" onClick={() => ui.openPatient(r.i.patient_id)}>{r.i.patient_code}</button>
                      <span className="q-meta"><Prio priority={r.i.priority} /><small className="muted">{r.i.required_bed_type} · {fmtDur(r.i.waiting_minutes)}</small></span>
                    </td>
                    <td><span className="q-match"><span><strong>{r.i.bed_code}</strong><small className="muted">{r.i.ward_name}</small></span><ScoreBadge score={r.i.score} /></span></td>
                    <td className="actions">
                      <button className="btn sm primary" disabled={allocate.isPending} onClick={() => void ask(r.i)}>
                        {allocate.isPending && allocate.variables?.patient_id === r.i.patient_id ? <Spinner /> : null}Allocate
                      </button>
                    </td>
                  </tr>
                ) : (
                  <tr key={`u${r.u.patient_id}`}>
                    <td>
                      <button className="link strong" onClick={() => ui.openPatient(r.u.patient_id)}>{r.u.patient_code}</button>
                      <span className="q-meta"><Prio priority={r.u.priority} /><small className="muted">{r.u.required_bed_type} · {fmtDur(r.u.waiting_minutes)}</small></span>
                    </td>
                    <td><span className="q-blocker"><Icon name="alert" />{r.u.blockers[0] ?? 'No suitable bed right now'}</span></td>
                    <td className="actions"><button className="btn sm" onClick={() => ui.openPatient(r.u.patient_id)}><Icon name="wand" />Fix</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ alerts */
function AlertsCard() {
  const alerts = useAlerts()
  const list = alerts.data ?? []
  return (
    <section className="card d-alerts">
      <div className="card-head">
        <h2>Current alerts</h2>
        <Link className="link" to="/alerts">View all{alerts.data ? ` (${list.length})` : ''}</Link>
      </div>
      <div className="d-body">
        {alerts.isLoading ? <div className="sk-list"><Skeleton h={48} /><Skeleton h={48} /></div>
          : alerts.isError && !alerts.data ? <div className="empty sm">Couldn’t load alerts.<button className="btn sm" onClick={() => alerts.refetch()}><Icon name="refresh" />Try again</button></div>
          : <AlertList items={list} />}
      </div>
    </section>
  )
}
