/* Equipment — the design's PAGES.equipment: per-type stats, filters, one table of devices and stock,
   plus our counted-stock quick adjust and ?type= / ?q= / ?item= deep links. */
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { EquipmentModal } from '../components/equipment/EquipmentModal'
import { Icon } from '../components/g/Icon'
import { Chip, Empty, PageError, pct, Skeleton, STATUS_LABEL, TimeTag } from '../components/g/parts'
import { toast } from '../components/ui/toast'
import { api } from '../lib/api'
import { useAction, useEquipment, useMeta, useSettings, useSummary, useWards } from '../lib/queries'
import type { Equipment as Eq } from '../lib/types'
import '../styles/pages/Equipment.css'

/** Text filter kept in the URL (replace, like her replaceHash) without fighting the caret while typing. */
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
  const q = useDeferredValue(search.trim())
  const [adding, setAdding] = useState(false)

  const list = useEquipment({ type: type || undefined, status: status || undefined, ward_id: ward || undefined, search: q || undefined })
  const all = useEquipment({})

  const setParam = (k: string, v: string) =>
    setParams((p) => { const n = new URLSearchParams(p); if (v) n.set(k, v); else n.delete(k); return n }, { replace: true })

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

  const stock = useMemo(() => (all.data ?? []).filter((e) => e.tracking_mode === 'QUANTITY'), [all.data])
  const byType = summary.data?.equipment.by_type ?? {}
  const min = settings.data?.equipment_min_available ?? {}
  const deviceTypes = meta.data?.device_types ?? Object.keys(byType)
  const allTypes = [...deviceTypes, ...(meta.data?.quantity_types ?? [])]
  const statuses = meta.data?.equipment_statuses ?? ['AVAILABLE', 'IN_USE', 'RESERVED', 'MAINTENANCE']
  const toggleType = (t: string) => setParam('type', type === t ? '' : t)

  if (list.isError && !list.data) return <PageError error={list.error} onRetry={() => list.refetch()} />
  const items = list.data ?? []

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Equipment</h1><p className="muted">Individually tracked devices are allocated with beds; counted stock is tracked by quantity</p></div>
        <div className="head-actions">
          <button className="btn primary" onClick={() => setAdding(true)}><Icon name="plus" />Add equipment</button>
        </div>
      </div>

      <section className="stats" id="e-stats" aria-label="Equipment by type">
        {!summary.data ? Array.from({ length: 3 }, (_, i) => <Skeleton key={i} h={98} />) : (
          <>
            {deviceTypes.filter((t) => byType[t]).map((t) => {
              const x = byType[t]
              const need = min[t] ?? 0
              const low = x.AVAILABLE < need
              const on = type === t
              return (
                <button key={t} type="button" className={`stat eq-stat ${low ? 'warn' : ''} ${on ? 'on' : ''}`} aria-pressed={on} onClick={() => toggleType(t)}
                  title={on ? 'Show all types' : `Show only ${t.toLowerCase()}s`}>
                  <span className="stat-label"><Icon name="monitor" />{t}s</span>
                  <strong>{x.AVAILABLE}<small> / {x.total} available</small></strong>
                  <small>{x.IN_USE} in use · {x.MAINTENANCE} maintenance{x.RESERVED ? ` · ${x.RESERVED} reserved` : ''}{low ? ` · below minimum ${need}` : ''}</small>
                  <span className="eq-util" aria-label={`${pct(x.IN_USE, x.total - x.MAINTENANCE)}% utilised`}>
                    <span className="eq-bar" aria-hidden="true">
                      <i className="st-AVAILABLE" style={{ width: `${pct(x.AVAILABLE, x.total)}%` }} />
                      <i className="st-IN_USE" style={{ width: `${pct(x.IN_USE, x.total)}%` }} />
                      <i className="st-RESERVED" style={{ width: `${pct(x.RESERVED, x.total)}%` }} />
                      <i className="st-MAINTENANCE" style={{ width: `${pct(x.MAINTENANCE, x.total)}%` }} />
                    </span>
                    <small>{pct(x.IN_USE, x.total - x.MAINTENANCE)}% utilised</small>
                  </span>
                </button>
              )
            })}
            {summary.data.equipment.stock.map((s) => {
              const on = type === s.equipment_type
              return (
                <button key={s.id} type="button" className={`stat eq-stat ${on ? 'on' : ''}`} aria-pressed={on} onClick={() => toggleType(s.equipment_type)}
                  title={on ? 'Show all types' : `Show only ${s.equipment_type.toLowerCase()}`}>
                  <span className="stat-label"><Icon name="layers" />{s.equipment_type} stock</span>
                  <strong>{s.quantity_available}<small> / {s.quantity_total}</small></strong>
                  <small>counted, not individually tracked</small>
                </button>
              )
            })}
          </>
        )}
      </section>

      <section className="card">
        <div className="filters">
          <label className="search-field sm grow">
            <span className="sr-only">Search equipment</span><Icon name="search" />
            <input id="e-search" type="search" placeholder="Search equipment ID or type…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </label>
          <label className="sel">
            <span className="sr-only">Location</span>
            <select id="e-ward" value={ward} onChange={(e) => setParam('ward', e.target.value)}>
              <option value="">All locations</option>
              <option value="pool">Shared pool</option>
              {(wards.data ?? []).map((w) => <option key={w.id} value={String(w.id)}>{w.name}</option>)}
            </select>
          </label>
          <label className="sel">
            <span className="sr-only">Type</span>
            <select id="e-type" value={type} onChange={(e) => setParam('type', e.target.value)}>
              <option value="">All types</option>
              {allTypes.map((t) => <option key={t} value={t}>{t}</option>)}
              {type && !allTypes.includes(type) && <option value={type}>{type}</option>}
            </select>
          </label>
          <label className="sel">
            <span className="sr-only">Status</span>
            <select id="e-status" value={status} onChange={(e) => setParam('status', e.target.value)}>
              <option value="">All statuses</option>
              {statuses.map((s) => <option key={s} value={s}>{STATUS_LABEL[s] ?? s}</option>)}
            </select>
          </label>
        </div>

        {list.isLoading || !list.data ? (
          <div className="eq-skeleton">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} h={36} />)}</div>
        ) : items.length ? (
          <>
            <div className="table-wrap" id="e-table">
              <table className="table">
                <thead>
                  <tr><th>ID</th><th>Type</th><th>Tracking</th><th>Location</th><th>Status</th><th>Assigned bed</th><th>Updated</th><th>Notes</th><th><span className="sr-only">Actions</span></th></tr>
                </thead>
                <tbody>
                  {items.map((e) => {
                    const individual = e.tracking_mode === 'INDIVIDUAL'
                    const inUse = individual && e.status === 'IN_USE'
                    return (
                      <tr key={e.id} className={editing?.id === e.id ? 'on' : undefined}>
                        <td><strong>{e.equipment_code}</strong></td>
                        <td>{e.equipment_type}</td>
                        <td className="small">{individual ? 'Individual' : `Quantity · ${e.quantity_available}/${e.quantity_total}`}</td>
                        <td>{e.ward_name || '—'}</td>
                        <td>{individual ? <Chip status={e.status} /> : <span className="small">{e.quantity_available} available</span>}</td>
                        <td>
                          {e.bed_code && e.assigned_bed_id != null && e.bed_ward_id != null
                            ? <button className="link" onClick={() => nav(`/allocations?ward=${e.bed_ward_id}&bed=${e.assigned_bed_id}`)}>{e.bed_code}</button>
                            : e.bed_code || '—'}
                        </td>
                        <td className="small"><TimeTag iso={e.updated_at} /></td>
                        <td className="small">{e.notes || ''}</td>
                        <td className="actions">
                          <button className="btn sm ghost" onClick={() => setParam('item', String(e.id))} disabled={inUse}
                            title={inUse ? 'In use — release the allocation first' : `Edit ${e.equipment_code}`} aria-label={`Edit ${e.equipment_code}`}>
                            <Icon name="edit" />Edit
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <p className="muted small table-foot">{items.length} item{items.length === 1 ? '' : 's'}</p>
          </>
        ) : (
          <div className="empty">No equipment matches these filters.</div>
        )}
      </section>

      <section className="card">
        <div className="card-head">
          <div><h2>Counted stock</h2><p className="muted small">Adjust as items are issued or returned</p></div>
        </div>
        {!all.data ? (
          <div className="eq-skeleton">{Array.from({ length: 2 }, (_, i) => <Skeleton key={i} h={56} />)}</div>
        ) : stock.length ? (
          <div className="eq-stock">{stock.map((s) => <StockRow key={s.id} s={s} onEdit={() => setParam('item', String(s.id))} />)}</div>
        ) : (
          <Empty sm>No counted stock yet. Use Add equipment to track items by quantity.</Empty>
        )}
      </section>

      {adding && <EquipmentModal key="add" item={null} onClose={() => setAdding(false)} />}
      {editing && <EquipmentModal key={editing.id} item={editing} onClose={() => setParam('item', '')} />}
    </div>
  )
}

function StockRow({ s, onEdit }: { s: Eq; onEdit: () => void }) {
  const avail = s.quantity_available ?? 0
  const total = s.quantity_total ?? 0
  const upd = useAction((n: number) => api.updateEquipment(s.id, { quantity_available: n }), {
    success: (r) => `${r.equipment_type}: ${r.quantity_available} of ${r.quantity_total} available.`,
  })
  return (
    <div className="eq-stock-row">
      <div className="eq-stock-name">
        <strong>{s.equipment_type}</strong>
        <small className="muted">{s.ward_name || 'Shared pool'} · {s.equipment_code}</small>
      </div>
      <div className="eq-stepper">
        <button className="icon-btn plain" disabled={avail <= 0 || upd.isPending} onClick={() => upd.mutate(avail - 1)} aria-label={`Issue one ${s.equipment_type}`}><Icon name="minus" /></button>
        <span className="eq-count"><strong>{avail}</strong><small> / {total} available</small></span>
        <button className="icon-btn plain" disabled={avail >= total || upd.isPending} onClick={() => upd.mutate(avail + 1)} aria-label={`Return one ${s.equipment_type}`}><Icon name="plus" /></button>
      </div>
      <span className="eq-bar" aria-hidden="true"><i className={avail === 0 ? 'st-OCCUPIED' : 'st-AVAILABLE'} style={{ width: `${pct(avail, total)}%` }} /></span>
      <button className="btn sm ghost" onClick={onEdit} aria-label={`Edit ${s.equipment_type} stock totals`}><Icon name="edit" />Edit totals</button>
    </div>
  )
}
