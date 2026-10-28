/* Alerts & activity — Graphite design (her PAGES.alerts), wired to our live /alerts and /activity. */
import { useEffect, useRef } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ActivityList, AlertList, Loading, Skeleton } from '../components/g/parts'
import { Icon } from '../components/g/Icon'
import { errorMessage, useActivity, useAlerts, useMeta, useSettings } from '../lib/queries'
import type { Alert } from '../lib/types'

const RESOURCES: Record<string, string> = { bed: 'Beds & allocations', patient: 'Patients', equipment: 'Equipment', ward: 'Wards', settings: 'Settings' }
const SEVERITIES: { s: Alert['severity']; label: string }[] = [
  { s: 'critical', label: 'Critical' },
  { s: 'warning', label: 'Warning' },
  { s: 'info', label: 'Info' },
]

export default function Alerts() {
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab')
  const filter = params.get('resource') ?? ''
  const alerts = useAlerts()
  const act = useActivity(200)
  const settings = useSettings()
  const meta = useMeta()
  const activityRef = useRef<HTMLElement>(null)

  // ?tab=activity → bring the activity history card into view and focus it.
  useEffect(() => {
    if (tab !== 'activity') return
    const el = activityRef.current
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    el.focus({ preventScroll: true })
  }, [tab])

  const setFilter = (v: string) => {
    const next = new URLSearchParams(params)
    if (v) next.set('resource', v)
    else next.delete('resource')
    setParams(next, { replace: true })
  }

  const list = alerts.data ?? []
  const groups = SEVERITIES.map((g) => ({ ...g, items: list.filter((a) => a.severity === g.s) })).filter((g) => g.items.length)
  const s = settings.data
  const deviceTypes = meta.data?.device_types ?? Object.keys(s?.equipment_min_available ?? {})
  const events = (act.data ?? []).filter((e) => !filter || e.resource_type === filter)

  return (
    <div className="page">
      <div className="page-head"><div><h1>Alerts &amp; activity</h1><p className="muted">Alerts are computed from stored data using the thresholds in <Link to="/settings">Settings</Link></p></div></div>
      <div className="split even">
        <section className="card" id="a-alerts">
          <div className="card-head"><h2>Current alerts{alerts.data ? ` (${list.length})` : ''}</h2></div>
          {s && (
            <p className="muted small">Low availability ≤ {s.low_available_pct}% · high occupancy ≥ {s.high_occupancy_pct}% · device minimums: {deviceTypes.map((t) => `${t} ${s.equipment_min_available[t] ?? 0}`).join(', ')}</p>
          )}
          {alerts.isLoading && <div style={{ display: 'grid', gap: 8 }}><Skeleton h={52} /><Skeleton h={52} /><Skeleton h={52} /></div>}
          {alerts.isError && (
            <div className="empty"><Icon name="alert" />Couldn’t load alerts — {errorMessage(alerts.error)} <button className="link" onClick={() => alerts.refetch()}>Try again</button></div>
          )}
          {alerts.data && (groups.length <= 1 ? <AlertList items={list} /> : groups.map((g) => (
            <div key={g.s}>
              <h3 className="sub">{g.label} · {g.items.length}</h3>
              <AlertList items={g.items} />
            </div>
          )))}
        </section>
        <section className="card" id="a-activity-card" ref={activityRef} tabIndex={-1} aria-label="Activity history">
          <div className="card-head"><h2>Activity history</h2>
            <label className="sel"><span className="sr-only">Resource</span>
              <select id="a-filter" value={filter} onChange={(e) => setFilter(e.target.value)}>
                <option value="">All activity</option>
                {Object.entries(RESOURCES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
          </div>
          <div id="a-activity">
            {act.isLoading && <Loading label="Loading activity…" />}
            {act.isError && (
              <div className="empty"><Icon name="alert" />Couldn’t load activity — {errorMessage(act.error)} <button className="link" onClick={() => act.refetch()}>Try again</button></div>
            )}
            {act.data && (filter && !events.length ? <div className="empty">No activity for this filter yet.</div> : <ActivityList items={events} />)}
          </div>
        </section>
      </div>
    </div>
  )
}
