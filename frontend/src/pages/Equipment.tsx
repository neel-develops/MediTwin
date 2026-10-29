/* Equipment — device fleet cards (click to filter), counted stock with inline issue/return,
   one clean device list with quick filters, and a "where devices are" panel by location.
   Deep links: ?type= ?status= ?ward= ?q= ?item= */
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { EquipmentModal } from '../components/equipment/EquipmentModal'
import { Icon } from '../components/g/Icon'
import { Chip, PageError, pct, Skeleton, STATUS_LABEL, TimeTag } from '../components/g/parts'
import { toast } from '../components/ui/toast'
import { api } from '../lib/api'
import { useAction, useEquipment, useMeta, useSettings, useSummary, useWards } from '../lib/queries'
import type { Equipment as Eq } from '../lib/types'
import '../styles/pages/Equipment.css'

const DEV_STATUSES = ['AVAILABLE', 'IN_USE', 'RESERVED', 'MAINTENANCE'] as const
const TYPE_ICON: Record<string, string> = { Monitor: 'monitor', Ventilator: 'wind', 'Infusion Pump': 'droplet' }
const typeIcon = (t: string) => TYPE_ICON[t] ?? 'cpu'
const plural = (t: string) => (t.endsWith('s') ? t : `${t}s`)

/** Text filter kept in the URL (replace) without fighting the caret while typing. */
function useUrlText(key: string): [string, (v: string) => void] {
  const [params, setParams] = useSearchParams()
  const urlValue = params.get(key) ?? ''
  const [value, setValue] = useState(urlValue)
  const written = useRef<string[]>([])
  useEffect(() => {
    const i = written.current.lastIndexOf(urlValue)
    if (i >= 0) { written.current = written.current.slice(i + 1); return }
    written.current = []
    setValue(urlValue)
  }, [urlValue])
  const set = (v: string) => {
    setValue(v)
    written.current.push(v)
    setParams((p) => { const n = new URLSearchParams(p); if (v) n.set(key, v); else n.delete(key); return n }, { replace: true })
  }
  return [value, set]
}

export default function Equipment() {
  const [params, setParams] = useSearchParams()
  const nav = useNavigate()
  const summary = useSummary()
  const settings = useSettings()
  const wards = useWards()
  const meta = useMeta()
  const type = params.get('type') ?? ''
  const status = params.get('status') ?? ''
  const ward = params.get('ward') ?? ''
  const itemParam = params.get('item')
  const [search, setSearch] = useUrlText('q')
  const q = useDeferredValue(search.trim().toLowerCase())
  const [adding, setAdding] = useState(false)

  const all = useEquipment({})
  const setParam = (k: string, v: string) =>
    setParams((p) => { const n = new URLSearchParams(p); if (v) n.set(k, v); else n.delete(k); return n }, { replace: true })
  const clearAll = () => setParams((p) => { const n = new URLSearchParams(p); ['type', 'status', 'ward', 'q'].forEach((k) => n.delete(k)); return n }, { replace: true })

  // ?item=<id> opens that item's edit modal
  const itemId = itemParam && /^\d+$/.test(itemParam) ? Number(itemParam) : null
  const editing = itemId != null ? all.data?.find((e) => e.id === itemId) ?? null : null
  const missing = itemParam != null && all.isSuccess && !editing
  useEffect(() => {
    if (!missing) return
    toast.error(`Equipment #${itemParam} was not found.`)
    setParam('item', '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missing])

  const devices = useMemo(() => (all.data ?? []).filter((e) => e.tracking_mode === 'INDIVIDUAL'), [all.data])
  const stock = useMemo(() => (all.data ?? []).filter((e) => e.tracking_mode === 'QUANTITY'), [all.data])
  const byType = summary.data?.equipment.by_type ?? {}
  const min = settings.data?.equipment_min_available ?? {}
  const deviceTypes = (meta.data?.device_types ?? Object.keys(byType)).filter((t) => byType[t])
  const isStockType = stock.some((s) => s.equipment_type === type)

  // filters: location → type → status → search; chip counts ignore their own dimension
  const atWard = (e: Eq) => !ward || (ward === 'pool' ? e.ward_id == null : String(e.ward_id) === ward)
  const matchQ = (e: Eq) => !q || `${e.equipment_code} ${e.equipment_type} ${e.ward_name} ${e.bed_code ?? ''} ${e.notes}`.toLowerCase().includes(q)
  const base = devices.filter((e) => atWard(e) && matchQ(e))
  const statusCount = (s: string) => base.filter((e) => (!type || e.equipment_type === type) && (!s || e.status === s)).length
  const rows = base.filter((e) => (!type || e.equipment_type === type) && (!status || e.status === status))
    .sort((a, b) => a.equipment_type.localeCompare(b.equipment_type) || a.equipment_code.localeCompare(b.equipment_code))
  const filtering = !!(type || status || ward || q)

  // where devices are: per location, counts by status
  const places = useMemo(() => {
    const m = new Map<string, { key: string; name: string; AVAILABLE: number; IN_USE: number; RESERVED: number; MAINTENANCE: number; total: number }>()
    const order = [...(wards.data ?? []).map((w) => [String(w.id), w.name] as const), ['pool', 'Shared pool'] as const]
    order.forEach(([key, name]) => m.set(key, { key, name, AVAILABLE: 0, IN_USE: 0, RESERVED: 0, MAINTENANCE: 0, total: 0 }))
    devices.filter((e) => !type || e.equipment_type === type).forEach((e) => {
      const key = e.ward_id == null ? 'pool' : String(e.ward_id)
      if (!m.has(key)) m.set(key, { key, name: e.ward_name || 'Unknown', AVAILABLE: 0, IN_USE: 0, RESERVED: 0, MAINTENANCE: 0, total: 0 })
      const r = m.get(key)!
      r[e.status as (typeof DEV_STATUSES)[number]] += 1
      r.total += 1
    })
    return [...m.values()].filter((r) => r.total > 0)
  }, [devices, wards.data, type])
  const placeMax = Math.max(1, ...places.map((p) => p.total))

  if (all.isError && !all.data) return <PageError error={all.error} onRetry={() => all.refetch()} />

  return (
    <div className="page eqp">
      <div className="page-head">
        <div><h1>Equipment</h1><p className="muted">Devices are reserved with a bed when a patient is allocated · counted stock is tracked by quantity</p></div>
        <div className="head-actions"><button className="btn primary" onClick={() => setAdding(true)}><Icon name="plus" />Add equipment</button></div>
      </div>

      {/* ---------------- fleet + stock */}
      <section className="eq-top" aria-label="Equipment by type">
        {!summary.data ? Array.from({ length: 6 }, (_, i) => <Skeleton key={i} h={118} />) : (
          <>
            {deviceTypes.map((t) => {
              const x = byType[t]
              const need = min[t] ?? 0
              const low = x.AVAILABLE < need
              const out = x.AVAILABLE === 0
              const on = type === t
              return (
                <button key={t} type="button" className={`eq-card ${on ? 'on' : ''} ${out ? 'out' : low ? 'low' : ''}`} aria-pressed={on}
                  onClick={() => setParam('type', on ? '' : t)} title={on ? 'Show all types' : `Show only ${plural(t).toLowerCase()}`}>
                  <span className="eq-card-h">
                    <span className="eq-ico"><Icon name={typeIcon(t)} /></span>
                    <span className="eq-name">{plural(t)}</span>
                    <span className={`eq-health ${out ? 'out' : low ? 'low' : 'ok'}`}>{out ? 'None free' : low ? `Low · min ${need}` : 'Healthy'}</span>
                  </span>
                  <span className="eq-num"><strong>{x.AVAILABLE}</strong><small>free of {x.total}</small></span>
                  <span className="eq-bar" aria-hidden="true">
                    {DEV_STATUSES.map((s) => (x[s] ? <i key={s} className={`st-${s}`} style={{ width: `${pct(x[s], x.total)}%` }} /> : null))}
                  </span>
                  <span className="eq-legend">
                    <span><i className="st-IN_USE" />{x.IN_USE} in use</span>
                    {x.RESERVED ? <span><i className="st-RESERVED" />{x.RESERVED} reserved</span> : null}
                    <span><i className="st-MAINTENANCE" />{x.MAINTENANCE} repair</span>
                  </span>
                </button>
              )
            })}
            {stock.length > 0 && (
              <div className="eq-card stock-group">
                <span className="eq-card-h"><span className="eq-ico"><Icon name="layers" /></span><span className="eq-name">Counted stock</span><span className="muted small">issue / return</span></span>
                <div className="eq-stock-rows">{stock.map((s) => <StockRow key={s.id} s={s} onEdit={() => setParam('item', String(s.id))} />)}</div>
              </div>
            )}
          </>
        )}
      </section>

      <div className="eq-main">
        {/* ---------------- device list */}
        <section className="card eq-list">
          <div className="eq-tools">
            <div className="search-field sm eq-search">
              <Icon name="search" />
              <input type="search" aria-label="Search devices" placeholder="Search device ID, bed or notes…" value={search} onChange={(e) => setSearch(e.target.value)} />
              {search && <button className="eq-x" aria-label="Clear search" onClick={() => setSearch('')}><Icon name="x" /></button>}
            </div>
            <label className="sel eq-loc">
              <span className="sr-only">Device type</span>
              <select value={isStockType ? '' : type} onChange={(e) => setParam('type', e.target.value)}>
                <option value="">All types</option>
                {deviceTypes.map((t) => <option key={t} value={t}>{plural(t)}</option>)}
              </select>
            </label>
            <label className="sel eq-loc">
              <span className="sr-only">Location</span>
              <select value={ward} onChange={(e) => setParam('ward', e.target.value)}>
                <option value="">All locations</option>
                {(wards.data ?? []).map((w) => <option key={w.id} value={String(w.id)}>{w.name}</option>)}
                <option value="pool">Shared pool</option>
              </select>
            </label>
            {filtering && <button className="link eq-clear" onClick={clearAll}><Icon name="x" />Clear all</button>}
          </div>
          <div className="eq-chips" role="group" aria-label="Filter by status">
            <button className={`eq-chip ${!status ? 'on' : ''}`} onClick={() => setParam('status', '')}>All {type && !isStockType ? plural(type).toLowerCase() : 'devices'}<b>{statusCount('')}</b></button>
            {DEV_STATUSES.map((s) => (
              <button key={s} className={`eq-chip st ${status === s ? 'on' : ''}`} onClick={() => setParam('status', status === s ? '' : s)}>
                <i className={`dot st-${s}`} />{STATUS_LABEL[s] ?? s}<b>{statusCount(s)}</b>
              </button>
            ))}
          </div>

          {isStockType ? (
            <div className="empty sm">{type} is counted stock — adjust it with the − / + buttons on its card above.<button className="btn sm" onClick={() => setParam('type', '')}>Show all devices</button></div>
          ) : !all.data ? (
            <div className="eq-skeleton">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} h={40} />)}</div>
          ) : rows.length ? (
            <div className="eq-scroll">
              <table className="table eq-table">
                <thead><tr><th>Device</th><th>Location</th><th>Status</th><th>With</th><th>Updated</th><th><span className="sr-only">Action</span></th></tr></thead>
                <tbody>
                  {rows.map((e) => {
                    const inUse = e.status === 'IN_USE'
                    return (
                      <tr key={e.id} className={editing?.id === e.id ? 'on' : undefined}>
                        <td>
                          <span className="eq-dev">
                            <span className="eq-ico sm"><Icon name={typeIcon(e.equipment_type)} /></span>
                            <span><strong>{e.equipment_code}</strong><small>{e.equipment_type}{e.notes ? ` · ${e.notes}` : ''}</small></span>
                          </span>
                        </td>
                        <td>{e.ward_name || 'Shared pool'}</td>
                        <td><Chip status={e.status} /></td>
                        <td>{e.bed_code && e.assigned_bed_id != null && e.bed_ward_id != null
                          ? <button className="link strong" onClick={() => nav(`/allocations?ward=${e.bed_ward_id}&bed=${e.assigned_bed_id}`)}><Icon name="bed" />{e.bed_code}</button>
                          : <span className="muted">—</span>}</td>
                        <td className="muted small"><TimeTag iso={e.updated_at} /></td>
                        <td className="actions">
                          {inUse && e.assigned_bed_id != null && e.bed_ward_id != null
                            ? <button className="btn sm ghost" title="In use with a patient — open the bed to release it" onClick={() => nav(`/allocations?ward=${e.bed_ward_id}&bed=${e.assigned_bed_id}`)}><Icon name="arrow" />Open bed</button>
                            : <button className="btn sm ghost" disabled={inUse} title={inUse ? 'In use — release the allocation first' : `Edit ${e.equipment_code}`} onClick={() => setParam('item', String(e.id))}><Icon name="edit" />Edit</button>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty">No devices match these filters.{filtering && <button className="btn sm" onClick={clearAll}>Clear filters</button>}</div>
          )}
          <p className="eq-foot muted small">{all.data ? `Showing ${rows.length} of ${devices.length} devices` : ''}</p>
        </section>

        {/* ---------------- where devices are */}
        <aside className="card eq-where">
          <div className="card-head"><h2><Icon name="layers" />Where devices are</h2>{type && !isStockType ? <span className="muted small">{plural(type)}</span> : null}</div>
          {!all.data ? <div className="eq-skeleton">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} h={44} />)}</div> : (
            <ul className="eq-places">
              {places.map((p) => {
                const on = ward === p.key
                return (
                  <li key={p.key}>
                    <button className={`eq-place ${on ? 'on' : ''}`} aria-pressed={on} onClick={() => setParam('ward', on ? '' : p.key)}>
                      <span className="eq-place-h"><strong>{p.name}</strong><span><b className={p.AVAILABLE ? 'free' : 'none'}>{p.AVAILABLE}</b> free · {p.total}</span></span>
                      <span className="eq-bar" style={{ width: `${(p.total / placeMax) * 100}%` }} aria-hidden="true">
                        {DEV_STATUSES.map((s) => (p[s] ? <i key={s} className={`st-${s}`} style={{ width: `${pct(p[s], p.total)}%` }} /> : null))}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
          <div className="eq-key">
            {DEV_STATUSES.map((s) => <span key={s}><i className={`st-${s}`} />{STATUS_LABEL[s] ?? s}</span>)}
          </div>
          <p className="eq-tip"><Icon name="info" />Click a ward to filter the list. Shared-pool devices can be sent to any ward when a patient needs one.</p>
        </aside>
      </div>

      {adding && <EquipmentModal key="add" item={null} onClose={() => setAdding(false)} />}
      {editing && <EquipmentModal key={editing.id} item={editing} onClose={() => setParam('item', '')} />}
    </div>
  )
}

function StockRow({ s, onEdit }: { s: Eq; onEdit: () => void }) {
  const avail = s.quantity_available ?? 0
  const total = s.quantity_total ?? 0
  const low = total > 0 && avail / total < 0.25
  const upd = useAction((n: number) => api.updateEquipment(s.id, { quantity_available: n }), {
    success: (r) => `${r.equipment_type}: ${r.quantity_available} of ${r.quantity_total} available.`,
  })
  return (
    <div className={`eq-srow ${avail === 0 ? 'out' : low ? 'low' : ''}`}>
      <button className="eq-sname link-plain" onClick={onEdit} title={`Edit ${s.equipment_type} totals · ${s.ward_name || 'Shared pool'}`}>{s.equipment_type}</button>
      <span className="eq-bar" aria-hidden="true"><i className={avail === 0 ? 'st-OCCUPIED' : low ? 'st-RESERVED' : 'st-AVAILABLE'} style={{ width: `${pct(avail, total)}%` }} /></span>
      <span className="eq-scount"><b>{avail}</b>/{total}</span>
      <span className="eq-step">
        <button disabled={avail <= 0 || upd.isPending} onClick={() => upd.mutate(avail - 1)} aria-label={`Issue one ${s.equipment_type}`} title="Issue one"><Icon name="minus" /></button>
        <button disabled={avail >= total || upd.isPending} onClick={() => upd.mutate(avail + 1)} aria-label={`Return one ${s.equipment_type}`} title="Return one"><Icon name="plus" /></button>
      </span>
    </div>
  )
}
