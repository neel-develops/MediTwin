/* Reports — Graphite design (her PAGES.reports), wired to our /reports, /summary and /simulate/surge. */
import { useState } from 'react'
import { BED_STATUSES, Chip, Empty, PageError, ScoreBadge, Skeleton, Spinner, StackBar, StatCard, STATUS_LABEL, fmtTime, pct } from '../components/g/parts'
import { Icon } from '../components/g/Icon'
import { toast } from '../components/ui/toast'
import { api } from '../lib/api'
import { errorMessage, useReports, useSummary } from '../lib/queries'
import type { Surge } from '../lib/types'
import '../styles/pages/Reports.css'

const SOURCE_LABEL: Record<string, string> = { MANUAL: 'Manual', AI_PLAN: 'AI plan', SEED: 'Initial data' }
const EQ_SEGS = ['IN_USE', 'RESERVED', 'MAINTENANCE', 'AVAILABLE'] as const

export default function Reports() {
  const r = useReports()
  const summary = useSummary()
  if (r.isError) return <PageError error={r.error} onRetry={() => r.refetch()} />
  const d = r.data
  const stock = summary.data?.equipment.stock ?? []
  const sources = d ? Object.entries(d.allocation_sources) : []

  return (
    <div className="page">
      <div className="page-head"><div><h1>Reports</h1><p className="muted">Summaries computed from stored records</p></div></div>
      <div className="grid-2">
        <section className="card" id="r-occ">
          <h2>Occupancy by ward</h2>
          {!d ? <Skeleton h={180} /> : d.wards.length ? (
            <>
              <ul className="bars">
                {d.wards.map((w) => (
                  <li key={w.id}>
                    <span className="bar-label">{w.name}<small>{w.counts.OCCUPIED}/{w.bed_count} · {w.occupancy_pct}%</small></span>
                    {w.bed_count ? <StackBar counts={w.counts} total={w.bed_count} /> : <span className="muted small">No beds</span>}
                  </li>
                ))}
              </ul>
              <div className="legend-inline">{BED_STATUSES.map((st) => <span key={st}><i className={`sw st-${st}`} />{STATUS_LABEL[st]}</span>)}</div>
            </>
          ) : <Empty>No wards.</Empty>}
        </section>

        <section className="card" id="r-eq">
          <h2>Equipment utilization</h2>
          {!d || summary.isLoading ? <Skeleton h={180} /> : d.equipment_utilization.length || stock.length || summary.isError ? (
            <>
              <ul className="bars">
                {d.equipment_utilization.map((x) => (
                  <li key={x.type}>
                    <span className="bar-label">{x.type}<small>{x.IN_USE}/{x.total} in use · {x.utilization_pct}%</small></span>
                    <div className="stack" role="img" aria-label={`${x.type}: ${x.IN_USE} in use, ${x.RESERVED} reserved, ${x.MAINTENANCE} maintenance, ${x.AVAILABLE} available`}>
                      {EQ_SEGS.map((st) => (x[st] && x.total ? <span key={st} className={`seg eq-${st}`} style={{ width: `${(x[st] / x.total) * 100}%` }} /> : null))}
                    </div>
                  </li>
                ))}
                {stock.map((q) => (
                  <li key={q.id}>
                    <span className="bar-label">{q.equipment_type}<small>{q.quantity_total - q.quantity_available}/{q.quantity_total} out · counted stock</small></span>
                    <div className="stack">
                      <span className="seg eq-IN_USE" style={{ width: `${pct(q.quantity_total - q.quantity_available, q.quantity_total)}%` }} />
                      <span className="seg eq-AVAILABLE" style={{ width: `${pct(q.quantity_available, q.quantity_total)}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
              {summary.isError && <p className="muted small">Counted stock unavailable — {errorMessage(summary.error)} <button className="link" onClick={() => summary.refetch()}>Try again</button></p>}
              <div className="legend-inline">
                <span><i className="sw eq-IN_USE" />In use</span><span><i className="sw eq-RESERVED" />Reserved</span>
                <span><i className="sw eq-MAINTENANCE" />Maintenance</span><span><i className="sw eq-AVAILABLE" />Available</span>
              </div>
              <p className="muted small">Utilization = in use ÷ in-service units (maintenance excluded).</p>
            </>
          ) : <Empty>No equipment registered.</Empty>}
        </section>

        <SurgeSim />

        <section className="card span2 rp-hist" id="r-hist">
          <div className="card-head">
            <div>
              <h2>Recent allocation history</h2>
              {d && <p className="muted small">Most recent {d.allocation_history.length} allocation{d.allocation_history.length === 1 ? '' : 's'}{d.avg_match_score ? ` · average match score ${Math.round(d.avg_match_score)}` : ''}</p>}
            </div>
            {sources.length > 0 && (
              <div className="rp-sources" aria-label="Allocations by source">
                {sources.map(([k, v]) => <span key={k} className="chip">{SOURCE_LABEL[k] ?? k} <b>{v}</b></span>)}
              </div>
            )}
          </div>
          {!d ? <Skeleton h={220} /> : d.allocation_history.length ? (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Patient</th><th>Bed</th><th>Ward</th><th>Status</th><th>Source</th><th>Match</th><th>Assigned</th><th>Released</th><th>Confirmed by</th></tr></thead>
                <tbody>
                  {d.allocation_history.map((a) => (
                    <tr key={a.id}>
                      <td><strong>{a.patient_code ?? '—'}</strong>{a.patient_name ? <div className="small muted">{a.patient_name}</div> : null}</td>
                      <td>{a.bed_code}</td>
                      <td>{a.ward_name}</td>
                      <td><Chip status={a.status} /></td>
                      <td className="small">{SOURCE_LABEL[a.source] ?? a.source}</td>
                      <td>{a.match_score ? <ScoreBadge score={Math.round(a.match_score)} /> : <span className="rp-muted-dash">—</span>}</td>
                      <td className="small">{fmtTime(a.assigned_at)}</td>
                      <td className="small">{a.released_at ? `${fmtTime(a.released_at)}${a.outcome ? ` (${a.outcome.toLowerCase()})` : ''}` : '—'}</td>
                      <td className="small">{a.confirmed_by}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <Empty>No allocations yet.</Empty>}
        </section>
      </div>
    </div>
  )
}

function SurgeSim() {
  const [count, setCount] = useState('30')
  const [seed, setSeed] = useState('7')
  const [res, setRes] = useState<Surge | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const run = async () => {
    const n = Math.round(Number(count))
    if (!Number.isFinite(n) || n < 1 || n > 300) {
      setErr('Arrivals must be between 1 and 300.')
      return
    }
    setBusy(true)
    setErr(null)
    try {
      const out = await api.surge(n, Math.round(Number(seed)) || 7)
      setRes(out)
      toast.success(`Simulated ${out.arrivals} arrivals — nothing was saved.`)
    } catch (e) {
      const m = errorMessage(e)
      setErr(m)
      toast.error(m)
    } finally {
      setBusy(false)
    }
  }
  const clear = () => { setRes(null); setErr(null) }

  return (
    <section className="card span2 sim rp-sim" id="r-sim">
      <div className="card-head"><h2><Icon name="flask" /> Demand surge simulation</h2><span className="sim-badge">SIMULATED · not live data · nothing is saved</span></div>
      <p className="muted small sim-hint">Generates synthetic arrivals (55% General, 15% ICU, 15% Pediatric, 10% Maternity, 5% Isolation) and places each on the best compatible bed using the same allocation rules, on a temporary copy of the current data. Same seed, same scenario.</p>
      <form className="filters" onSubmit={(e) => { e.preventDefault(); if (!busy) void run() }}>
        <label>Arrivals<input id="sim-count" type="number" min={1} max={300} value={count} onChange={(e) => setCount(e.target.value)} /></label>
        <label>Random seed<input id="sim-seed" type="number" min={1} max={9999} value={seed} onChange={(e) => setSeed(e.target.value)} /></label>
        <button type="submit" className="btn primary" disabled={busy}>{busy ? <Spinner /> : <Icon name="flask" />}Run simulation</button>
        {res && <button type="button" className="btn ghost" onClick={clear}>Clear</button>}
      </form>
      {err && <p className="sim-err" role="alert">{err}</p>}
      {res && (
        <div className="sim-out">
          <div className="stats compact">
            <StatCard label="Simulated arrivals" value={res.arrivals} />
            <StatCard label="Placed" value={<>{res.placed}<small> / {res.arrivals}</small></>} status="AVAILABLE" />
            <StatCard label="No suitable bed" value={res.unplaced} status="OCCUPIED" />
          </div>
          <div className="grid-2">
            <div>
              <h3 className="sub">By requested bed type</h3>
              <table className="table">
                <thead><tr><th>Type</th><th>Requested</th><th>Placed</th></tr></thead>
                <tbody>{res.by_type.map((x) => <tr key={x.type}><td>{x.type}</td><td className="num">{x.requested}</td><td className="num">{x.placed}</td></tr>)}</tbody>
              </table>
              <h3 className="sub">Main reasons arrivals could not be placed</h3>
              {res.unplaced_reasons.length
                ? <ul className="plain">{res.unplaced_reasons.map((x) => <li key={x.reason}><strong>{x.count}</strong> {x.reason}</li>)}</ul>
                : <Empty ok sm icon="check">Everyone was placed.</Empty>}
            </div>
            <div>
              <h3 className="sub">Wards after simulated surge</h3>
              <ul className="bars">
                {res.wards_after.map((w) => (
                  <li key={w.name}>
                    <span className="bar-label">{w.name}<small>{w.available} available · {w.occupancy_pct}% occupied</small></span>
                    <div className="stack"><span className="seg st-OCCUPIED" style={{ width: `${w.occupancy_pct}%` }} /></div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
