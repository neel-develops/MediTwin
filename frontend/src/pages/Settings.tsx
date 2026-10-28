/* Settings — thresholds and allocation rules (Graphite design, PAGES.settings). */
import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from '../components/g/Icon'
import { PageError, Skeleton } from '../components/g/parts'
import { api } from '../lib/api'
import { useAction, useMeta, useSettings } from '../lib/queries'
import type { Settings as SettingsT } from '../lib/types'

interface Form {
  hospital_name: string
  low_available_pct: string
  high_occupancy_pct: string
  cleaning_turnaround_minutes: string
  group_size: string
  release_to_cleaning: boolean
  equipment_min_available: Record<string, string>
  bed_type_compat: Record<string, string[]>
}

const toForm = (s: SettingsT): Form => ({
  hospital_name: s.hospital_name,
  low_available_pct: String(s.low_available_pct),
  high_occupancy_pct: String(s.high_occupancy_pct),
  cleaning_turnaround_minutes: String(s.cleaning_turnaround_minutes),
  group_size: String(s.group_size),
  release_to_cleaning: s.release_to_cleaning,
  equipment_min_available: Object.fromEntries(Object.entries(s.equipment_min_available).map(([k, v]) => [k, String(v)])),
  bed_type_compat: { ...s.bed_type_compat },
})

export default function Settings() {
  const settings = useSettings()
  const meta = useMeta()
  // The form is filled once from the server so background refetches never clobber typing.
  const [f, setF] = useState<Form | null>(null)
  useEffect(() => {
    if (settings.data && !f) setF(toForm(settings.data))
  }, [settings.data, f])

  const save = useAction((patch: unknown) => api.updateSettings(patch), {
    success: 'Settings saved.',
    onSuccess: (r) => setF(toForm(r)),
  })

  const deviceTypes = meta.data?.device_types ?? (f ? Object.keys(f.equipment_min_available) : [])
  const bedTypes = meta.data?.bed_types ?? (f ? Object.keys(f.bed_type_compat) : [])

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!f || save.isPending) return
    save.mutate({
      hospital_name: f.hospital_name,
      low_available_pct: f.low_available_pct,
      high_occupancy_pct: f.high_occupancy_pct,
      cleaning_turnaround_minutes: f.cleaning_turnaround_minutes,
      group_size: f.group_size,
      release_to_cleaning: f.release_to_cleaning,
      equipment_min_available: Object.fromEntries(deviceTypes.map((t) => [t, f.equipment_min_available[t] ?? '0'])),
      bed_type_compat: Object.fromEntries(bedTypes.map((req) => {
        const cur = f.bed_type_compat[req] ?? [req]
        return [req, cur.includes(req) ? cur : [req, ...cur]]
      })),
    })
  }

  const toggleCompat = (req: string, t: string) => setF((cur) => {
    if (!cur) return cur
    const list = cur.bed_type_compat[req] ?? [req]
    return { ...cur, bed_type_compat: { ...cur.bed_type_compat, [req]: list.includes(t) ? list.filter((x) => x !== t) : [...list, t] } }
  })

  if (settings.isError && !settings.data) return <PageError error={settings.error} onRetry={() => void settings.refetch()} />

  return (
    <div className="page settings-page">
      <div className="page-head"><div><h1>Settings</h1><p className="muted">Alert thresholds and allocation rules. Changes apply to alerts and bed recommendations immediately.</p></div></div>
      <section className="card" id="s-settings">
        <h2><Icon name="gear" /> Thresholds &amp; allocation rules</h2>
        {!f ? (
          <Skeleton h={360} />
        ) : (
          <form id="settings-form" className="form" onSubmit={submit}>
            <div className="row2">
              <label>Hospital name<input name="hospital_name" maxLength={60} value={f.hospital_name} onChange={(e) => setF({ ...f, hospital_name: e.target.value })} /></label>
              <label>Cleaning turnaround (minutes)<input name="cleaning_turnaround_minutes" type="number" min={5} max={600} value={f.cleaning_turnaround_minutes}
                onChange={(e) => setF({ ...f, cleaning_turnaround_minutes: e.target.value })} /></label>
            </div>
            <div className="row2">
              <label>Low-availability alert at ≤ (%)<input name="low_available_pct" type="number" min={0} max={100} value={f.low_available_pct}
                onChange={(e) => setF({ ...f, low_available_pct: e.target.value })} /></label>
              <label>High-occupancy alert at ≥ (%)<input name="high_occupancy_pct" type="number" min={1} max={100} value={f.high_occupancy_pct}
                onChange={(e) => setF({ ...f, high_occupancy_pct: e.target.value })} /></label>
            </div>
            <fieldset><legend>Minimum available devices (shortage alert below)</legend>
              <div className="row3">
                {deviceTypes.map((t) => (
                  <label key={t}>{t}<input name={`min_${t}`} type="number" min={0} max={1000} value={f.equipment_min_available[t] ?? '0'}
                    onChange={(e) => setF({ ...f, equipment_min_available: { ...f.equipment_min_available, [t]: e.target.value } })} /></label>
                ))}
              </div>
            </fieldset>
            <div className="row2">
              <label>Beds per visual section in Bed Allocations<input name="group_size" type="number" min={4} max={30} value={f.group_size}
                onChange={(e) => setF({ ...f, group_size: e.target.value })} /></label>
              <label className="check inline"><input type="checkbox" name="release_to_cleaning" value="1" checked={f.release_to_cleaning}
                onChange={(e) => setF({ ...f, release_to_cleaning: e.target.checked })} /><span>Released beds go to <strong>Cleaning</strong> (otherwise straight to Available)</span></label>
            </div>
            <fieldset><legend>Bed-type compatibility — which bed types may be recommended for each requested type</legend>
              <div className="table-wrap">
                <table className="table compat">
                  <thead><tr><th>Requested</th>{bedTypes.map((t) => <th key={t}>{t}</th>)}</tr></thead>
                  <tbody>
                    {bedTypes.map((req) => (
                      <tr key={req}>
                        <th scope="row">{req}</th>
                        {bedTypes.map((t) => (
                          <td key={t}>
                            <input type="checkbox" name={`compat_${req}`} value={t} checked={t === req || (f.bed_type_compat[req] ?? [req]).includes(t)} disabled={t === req}
                              aria-label={`Allow ${t} bed for ${req} request`} onChange={() => toggleCompat(req, t)} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </fieldset>
            <div className="btn-row"><button className="btn primary" type="submit" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save settings'}</button></div>
          </form>
        )}
      </section>
      <p className="page-note"><Icon name="layers" />Wards, bed counts and sample data are managed in <Link to="/setup">Setup</Link>.</p>
    </div>
  )
}
