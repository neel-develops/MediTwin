/* Dashboard — one-screen overview: 6 stat tiles, then two rows of three cards.
   Only Graphite components and tokens (card, stack, donut, chips, prio, alerts, table). */
import { useMemo, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { api } from '../lib/api'
import { greeting, plural } from '../lib/format'
import { useAction, useAlerts, useBriefing, useForecast, usePlan, useSummary } from '../lib/queries'
import type { Alert, ForecastWard, Insight, PlanItem, Priority, UnplacedPatient } from '../lib/types'
import { useUI } from '../lib/ui'
import { Icon } from '../components/g/Icon'
import { confirm } from '../components/g/Modal'
import { AiTag, BED_STATUSES, Donut, PageError, Prio, STATUS_LABEL, Skeleton, Spinner, StackBar, pct } from '../components/g/parts'
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
          <p className="muted">{now.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })} · {s?.hospital_name ?? '…'} · Live totals from stored records</p>
        </div>
        <div className="head-actions">
          <button className="btn" onClick={() => ui.openRegister()}><Icon name="plus" />Register patient</button>
          <button className="btn primary" onClick={() => nav('/ai')}><Icon name="wand" />Run AI allocation</button>
        </div>
      </div>

      <section className="dash-stats" aria-label="Bed, equipment and patient totals">
        {!s || !b || !dev ? Array.from({ length: 6 }, (_, i) => <Skeleton key={i} h={96} />) : (
          <>
            <DStat to="/beds" icon="bed" label="Total beds" value={b.total} sub={`${plural(s.wards.length, 'active ward')}`} />
            <DStat to="/beds?status=AVAILABLE" status="AVAILABLE" label="Available" value={b.AVAILABLE} sub={`${pct(b.AVAILABLE, b.total)}% of beds`} />
            <DStat to="/beds?status=OCCUPIED" status="OCCUPIED" label="Occupied" value={b.OCCUPIED} sub={`${pct(b.OCCUPIED, b.total)}% of beds`} />
            <DStat to="/beds?status=RESERVED" status="RESERVED" label="Reserved" value={b.RESERVED} sub={`${pct(b.RESERVED, b.total)}% of beds`} />
            <DStat to="/equipment" icon="monitor" label="Devices available" value={dev.AVAILABLE} sub={`${dev.IN_USE} in use · ${dev.MAINTENANCE} maint.`} />
            <DStat to="/patients" icon="user" tone={s.queue.urgent ? 'warn' : undefined} label="Waiting patients" value={s.queue.waiting}
              sub={`${s.queue.urgent} urgent · ${s.queue.placeable_now} placeable`} />
          </>
        )}
      </section>

      <div className="dash-row r1">
        <WardCapacity />
        <Briefing />
        <BedOverview />
      </div>
      <div className="dash-row r2">
        <ForecastCard />
        <AdmissionQueue />
        <AlertsCard />
      </div>
    </div>
  )
}

function DStat({ to, icon, status, tone, label, value, sub }: { to: string; icon?: string; status?: string; tone?: 'warn'; label: string; value: ReactNode; sub: string }) {
  return (
    <Link to={to} className={`dstat ${tone ?? ''}`}>
      <span className="dstat-top">
        <span className={`dstat-ico ${status ? `st-${status}` : ''}`} aria-hidden="true">{status ? <i /> : <Icon name={icon ?? 'info'} />}</span>
        <span className="dstat-label">{label}</span>
      </span>
      <strong>{value}</strong>
      <small>{sub}</small>
    </Link>
  )
}

function CardHead({ icon, title, tag, children }: { icon: string; title: string; tag?: ReactNode; children?: ReactNode }) {
  return (
    <div className="card-head">
      <h2><span className="h-ico"><Icon name={icon} /></span>{title}{tag}</h2>
      {children}
    </div>
  )
}

/* ------------------------------------------------------------------ ward capacity */
const RISK_CHIP: Record<ForecastWard['risk'], string> = { critical: 'st-OCCUPIED', high: 'st-RESERVED', elevated: 'st-AVAILABLE', normal: 'st-AVAILABLE' }

function WardCapacity() {
  const summary = useSummary()
  const f = useForecast(24, 1)
  const nav = useNavigate()
  const peaks = useMemo(() => new Map((f.data?.wards ?? []).map((w) => [w.ward_id, w])), [f.data])
  const wards = summary.data?.wards
  return (
    <section className="card d-wards">
      <CardHead icon="layers" title="Ward capacity">
        <Link className="link" to="/allocations">Bed Allocations<Icon name="chev" /></Link>
      </CardHead>
      <div className="d-body">
        {!wards ? <div className="sk-list">{[0, 1, 2, 3].map((i) => <Skeleton key={i} h={44} />)}</div>
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
                      <span className={`wr-free ${freeCls}`}><b>{w.counts.AVAILABLE}</b> free</span>
                      <span className="wr-peak">
                        {p ? <span className={`chip ${RISK_CHIP[p.risk]}`} title={`Projected 24 h peak ${Math.round(p.peak_pct)}% ${p.peak_label}`}>{Math.round(p.peak_pct)}%</span>
                          : f.isError ? <span className="muted small">—</span> : <Skeleton h={20} w={44} />}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ AI briefing */
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
      <CardHead icon="spark" title="AI briefing" tag={<AiTag />}>
        {d && d.insights.length > 2 ? <Link className="link" to="/ai">+{d.insights.length - 2} more<Icon name="chev" /></Link> : null}
      </CardHead>
      <div className="d-body">
        {br.isError && !d ? (
          <div className="empty sm">The briefing could not be generated.<button className="btn sm" onClick={() => br.refetch()}><Icon name="refresh" />Try again</button></div>
        ) : !d ? (
          <div className="sk-list"><Skeleton h={64} /><Skeleton h={64} /></div>
        ) : d.insights.length ? (
          <ul className="insights">
            {d.insights.slice(0, 2).map((i) => {
              const tone = i.severity === 'critical' ? 'coral' : i.severity === 'warning' ? 'amber' : 'mint'
              return (
                <li key={i.id} className={`insight t-${tone}`}>
                  <span className="ins-ico"><Icon name={tone === 'mint' ? 'check' : 'alert'} /></span>
                  <div>
                    <strong>{i.title}</strong>
                    <p>{i.detail}</p>
                    {i.action ? (
                      <button className="link" disabled={i.action.kind === 'MARK_CLEANED' && clean.isPending} onClick={() => void act(i)}>
                        {i.action.kind === 'MARK_CLEANED' && clean.isPending ? <Spinner /> : null}{i.action.label}<Icon name="chev" />
                      </button>
                    ) : null}
                  </div>
                </li>
              )
            })}
          </ul>
        ) : <div className="empty ok sm"><Icon name="check" /> {d.headline || 'Nothing needs attention right now.'}</div>}
      </div>
      <button className="btn block review-btn" onClick={() => nav('/ai')}><Icon name="spark" />Review allocation plan<Icon name="arrow" /></button>
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
      <CardHead icon="chart" title="Bed overview">
        <Link className="link" to="/beds">View all<Icon name="chev" /></Link>
      </CardHead>
      <div className="d-body">
        {!s ? <Skeleton h={150} /> : (
          <div className="overview">
            <Donut counts={s.beds} total={s.beds.total} />
            <ul className="legend">
              {BED_STATUSES.map((st) => (
                <li key={st}>
                  <button className="link" onClick={() => nav(`/beds?status=${st}`)}><i className={`sw st-${st}`} />{STATUS_LABEL[st]}</button>
                  <span><strong>{s.beds[st]}</strong><small>({pct(s.beds[st], s.beds.total)}%)</small></span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      {s && s.beds_by_type.length > 0 && (
        <p className="d-foot">Free by type: {s.beds_by_type.map((t) => <span key={t.bed_type}>{t.bed_type} <b>{t.AVAILABLE}</b>/{t.total}</span>)}</p>
      )}
    </section>
  )
}

/* ------------------------------------------------------------------ forecast */
const hm = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })

function ForecastCard() {
  const f = useForecast(24, 1)
  const series = f.data?.series ?? []
  const chart = useMemo(() => series.map((x) => ({ clock: hm(x.time), occupancy_pct: x.occupancy_pct })), [series])
  const now = series[0]?.occupancy_pct
  const peak = series.reduce<{ occupancy_pct: number; time: string } | null>((m, x) => (!m || x.occupancy_pct > m.occupancy_pct ? x : m), null)
  const hot = [...(f.data?.wards ?? [])].sort((a, b) => b.peak_pct - a.peak_pct)[0]
  return (
    <section className="card d-forecast">
      <CardHead icon="trend" title="Occupancy · next 24 h">
        <span className="sim-badge">SIMULATED</span>
      </CardHead>
      <div className="fc-figs">
        <div><small>Now</small><strong>{now != null ? `${Math.round(now)}%` : '—'}</strong></div>
        <div><small>Peak</small><strong>{peak ? `${Math.round(peak.occupancy_pct)}%` : '—'}{peak ? <small> ({hm(peak.time)})</small> : null}</strong></div>
        <div><small>Pressure point</small><strong className="fc-ward">{hot ? hot.name : '—'}{hot ? <small> ({Math.round(hot.peak_pct)}% {hot.peak_label})</small> : null}</strong></div>
      </div>
      <div className="d-body fc-chart">
        {chart.length ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chart} margin={{ top: 6, right: 8, left: -18, bottom: 0 }}>
              <defs>
                <linearGradient id="dash-fc" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" style={{ stopColor: 'var(--accent)', stopOpacity: 0.35 }} />
                  <stop offset="100%" style={{ stopColor: 'var(--accent)', stopOpacity: 0 }} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke="var(--border-soft)" />
              <XAxis dataKey="clock" tick={{ fontSize: 10, fill: 'var(--text-2)' }} tickLine={false} axisLine={{ stroke: 'var(--border)' }} interval={3} />
              <YAxis domain={[0, 100]} ticks={[0, 50, 100]} tick={{ fontSize: 10, fill: 'var(--text-2)' }} tickLine={false} axisLine={false} unit="%" width={44} />
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
      <p className="d-foot"><Icon name="info" />
        {peak ? <>Forecast: bed occupancy expected to peak at {Math.round(peak.occupancy_pct)}% around {hm(peak.time)} (simulated).</> : 'Forecast based on scheduled discharges and arrivals (simulated).'}
      </p>
    </section>
  )
}

/* ------------------------------------------------------------------ admission queue */
type QueueRow = { kind: 'placed'; i: PlanItem; pr: Priority; wait: number } | { kind: 'unplaced'; u: UnplacedPatient; pr: Priority; wait: number }
const RANK: Record<Priority, number> = { URGENT: 0, HIGH: 1, ROUTINE: 2 }
const careOf = (p: { required_bed_type: string; required_equipment_types: string[]; required_bed_features: string[] }) =>
  [p.required_bed_type, ...p.required_bed_features, ...p.required_equipment_types].join(' · ')

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
      <CardHead icon="user" title="Admission queue" tag={<AiTag label="AI matched" />}>
        <Link className="link" to="/ai">View all<Icon name="chev" /></Link>
      </CardHead>
      <div className="d-body">
        {plan.isLoading ? <div className="sk-list">{[0, 1, 2, 3].map((i) => <Skeleton key={i} h={34} />)}</div>
          : plan.isError && !plan.data ? <div className="empty sm">Couldn’t load the plan.<button className="btn sm" onClick={() => plan.refetch()}><Icon name="refresh" />Try again</button></div>
          : !rows.length ? (
            <div className="empty"><Icon name="check" />Nobody is waiting for a bed.<button className="btn sm" onClick={() => ui.openRegister()}><Icon name="plus" />Register patient</button></div>
          ) : (
            <table className="table q-table">
              <colgroup><col className="c-id" /><col className="c-urg" /><col /><col className="c-bed" /><col className="c-match" /><col className="c-act" /></colgroup>
              <thead><tr>
                <th scope="col">Patient</th><th scope="col">Urgency</th><th scope="col">Care needs</th>
                <th scope="col">Bed</th><th scope="col">Match</th><th scope="col"><span className="sr-only">Action</span></th>
              </tr></thead>
              <tbody>
                {rows.map((r) => r.kind === 'placed' ? (
                  <tr key={`p${r.i.patient_id}`}>
                    <td><button className="link strong" onClick={() => ui.openPatient(r.i.patient_id)}>{r.i.patient_code}</button></td>
                    <td><Prio priority={r.i.priority} /></td>
                    <td className="q-care" title={careOf(r.i)}>{careOf(r.i)}</td>
                    <td className="q-bed" title={r.i.ward_name}><strong>{r.i.bed_code}</strong></td>
                    <td><span className={`q-score ${r.i.score >= 85 ? '' : r.i.score >= 70 ? 'mid' : 'low'}`} title="AI resource match score — not a clinical score">{r.i.score}%</span></td>
                    <td className="actions">
                      <button className="btn sm primary" disabled={allocate.isPending} onClick={() => void ask(r.i)}>
                        {allocate.isPending && allocate.variables?.patient_id === r.i.patient_id ? <Spinner /> : null}Allocate
                      </button>
                    </td>
                  </tr>
                ) : (
                  <tr key={`u${r.u.patient_id}`}>
                    <td><button className="link strong" onClick={() => ui.openPatient(r.u.patient_id)}>{r.u.patient_code}</button></td>
                    <td><Prio priority={r.u.priority} /></td>
                    <td className="q-care" title={careOf(r.u)}>{careOf(r.u)}</td>
                    <td className="q-blocker" colSpan={2} title={r.u.blockers[0]}><Icon name="alert" />{r.u.blockers[0] ?? 'No suitable bed'}</td>
                    <td className="actions"><button className="btn sm" onClick={() => ui.openPatient(r.u.patient_id)}>Fix</button></td>
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
const SEV_PILL: Record<Alert['severity'], [string, string]> = { critical: ['High', 'coral'], warning: ['Medium', 'amber'], info: ['Low', 'accent'] }

function alertAction(a: Alert): [string, string] {
  if (a.patient_id) return ['View options', `/patients?patient=${a.patient_id}`]
  if (a.ward_id) return ['View beds', `/allocations?ward=${a.ward_id}`]
  if (a.equipment_type) return ['View devices', `/equipment?type=${encodeURIComponent(a.equipment_type)}`]
  if (a.kind === 'EQUIPMENT_SHORTAGE' || a.id === 'maint-dev') return ['View devices', '/equipment']
  if (a.kind === 'MAINTENANCE') return ['View beds', '/beds?status=MAINTENANCE']
  if (a.kind === 'CLEANING_BACKLOG') return ['View beds', '/beds?status=CLEANING']
  return ['View list', '/alerts']
}

function AlertsCard() {
  const alerts = useAlerts()
  const nav = useNavigate()
  const list = alerts.data ?? []
  return (
    <section className="card d-alerts">
      <CardHead icon="bell" title="Current alerts">
        <Link className="link" to="/alerts">View all{alerts.data ? ` (${list.length})` : ''}<Icon name="chev" /></Link>
      </CardHead>
      <div className="d-body">
        {alerts.isLoading ? <div className="sk-list"><Skeleton h={52} /><Skeleton h={52} /></div>
          : alerts.isError && !alerts.data ? <div className="empty sm">Couldn’t load alerts.<button className="btn sm" onClick={() => alerts.refetch()}><Icon name="refresh" />Try again</button></div>
          : !list.length ? <div className="empty ok"><Icon name="check" /> No alerts at current thresholds.</div>
          : (
            <ul className="d-alert-list">
              {list.map((a) => {
                const [sev, tone] = SEV_PILL[a.severity]
                const [label, to] = alertAction(a)
                return (
                  <li key={a.id}>
                    <span className={`al-ico t-${tone}`}><Icon name={a.severity === 'info' ? 'info' : 'alert'} /></span>
                    <div className="al-text"><strong>{a.title}</strong><small>{a.detail}</small></div>
                    <span className={`al-pill t-${tone}`}>{sev}</span>
                    <button className="btn sm" onClick={() => nav(to)}>{label}</button>
                  </li>
                )
              })}
            </ul>
          )}
      </div>
    </section>
  )
}
