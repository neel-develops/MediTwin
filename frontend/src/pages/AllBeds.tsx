/* All beds — the design's 2D table (PAGES.beds): every bed across active wards, filterable via the URL. */
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Icon } from '../components/g/Icon'
import { BED_STATUSES, Chip, PageError, Skeleton, STATUS_LABEL, TimeTag } from '../components/g/parts'
import { useBeds, useMeta, useWards } from '../lib/queries'
import type { Bed, BedStatus } from '../lib/types'
import '../styles/pages/AllBeds.css'

const PAGE_SIZE = 50

/** Her pageNumbers(): first, last and neighbours of the current page, gaps as an ellipsis. */
function pageNumbers(cur: number, total: number): (number | '…')[] {
  const out: (number | '…')[] = []
  for (let n = 1; n <= total; n++) {
    if (n === 1 || n === total || Math.abs(n - cur) <= 1) out.push(n)
    else if (out[out.length - 1] !== '…') out.push('…')
  }
  return out
}

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

export default function AllBeds() {
  const [params, setParams] = useSearchParams()
  const nav = useNavigate()
  const wards = useWards()
  const meta = useMeta()
  const status = params.get('status') ?? ''
  const ward = params.get('ward') ?? ''
  const type = params.get('type') ?? ''
  const [search, setSearch] = useUrlText('q')
  const q = useDeferredValue(search.trim())
  const beds = useBeds({ ward_id: ward || undefined, status: status || undefined, bed_type: type || undefined, search: q || undefined })

  const setParam = (k: string, v: string) =>
    setParams((p) => { const n = new URLSearchParams(p); if (v) n.set(k, v); else n.delete(k); return n }, { replace: true })

  // page resets whenever the filters change
  const filterKey = `${status}|${ward}|${type}|${q}`
  const [pageState, setPageState] = useState({ key: filterKey, page: 1 })
  const page = pageState.key === filterKey ? pageState.page : 1
  const setPage = (n: number) => setPageState({ key: filterKey, page: n })

  const list: Bed[] = useMemo(() => beds.data ?? [], [beds.data])
  const counts = useMemo(() => {
    const c = Object.fromEntries(BED_STATUSES.map((s) => [s, 0])) as Record<BedStatus, number>
    for (const b of list) c[b.status] = (c[b.status] ?? 0) + 1
    return c
  }, [list])
  const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE))
  const cur = Math.min(page, pages)
  const first = (cur - 1) * PAGE_SIZE
  const shown = list.slice(first, first + PAGE_SIZE)

  const activeWards = (wards.data ?? []).filter((w) => w.is_active)
  const bedTypes = meta.data?.bed_types ?? []
  const openBed = (b: Bed) => nav(`/allocations?ward=${b.ward_id}&bed=${b.id}`)

  if (beds.isError && !beds.data) return <PageError error={beds.error} onRetry={() => beds.refetch()} />

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>All beds</h1><p className="muted">Every bed across all wards in one table — a fast, non-3D alternative to Bed Allocations</p></div>
        <div className="head-actions"><Link className="btn" to="/allocations"><Icon name="bed" />Back to Bed Allocations</Link></div>
      </div>
      <section className="card">
        <div className="filters">
          <label className="search-field sm grow">
            <span className="sr-only">Search bed ID</span><Icon name="search" />
            <input id="b-search" type="search" placeholder="Search bed ID…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </label>
          <label className="sel">
            <span className="sr-only">Ward</span>
            <select id="b-ward" value={ward} onChange={(e) => setParam('ward', e.target.value)}>
              <option value="">All wards</option>
              {activeWards.map((w) => <option key={w.id} value={String(w.id)}>{w.name}</option>)}
              {ward && wards.data && !activeWards.some((w) => String(w.id) === ward) && (
                <option value={ward}>{wards.data.find((w) => String(w.id) === ward)?.name ?? `Ward ${ward}`}</option>
              )}
            </select>
          </label>
          <label className="sel">
            <span className="sr-only">Status</span>
            <select id="b-status" value={status} onChange={(e) => setParam('status', e.target.value)}>
              <option value="">All statuses</option>
              {BED_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            </select>
          </label>
          <label className="sel">
            <span className="sr-only">Bed type</span>
            <select id="b-type" value={type} onChange={(e) => setParam('type', e.target.value)}>
              <option value="">All bed types</option>
              {bedTypes.map((t) => <option key={t} value={t}>{t}</option>)}
              {type && !bedTypes.includes(type) && <option value={type}>{type}</option>}
            </select>
          </label>
        </div>

        <div id="b-summary" className="filter-summary" aria-live="polite">
          {beds.data ? (
            <>
              <strong>{list.length}</strong> beds ·{' '}
              {BED_STATUSES.map((s) => <span key={s} className="ab-count"><Chip status={s} /> {counts[s]}</span>)}
              {beds.isFetching && <Icon name="refresh" cls="spin ab-sync" />}
            </>
          ) : <Skeleton h={24} w={360} />}
        </div>

        {beds.isLoading || !beds.data ? (
          <div className="ab-skeleton">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} h={36} />)}</div>
        ) : list.length ? (
          <>
            <div className="table-wrap" id="b-table">
              <table className="table">
                <thead>
                  <tr><th>Bed ID</th><th>Ward</th><th>Type</th><th>Features</th><th>Status</th><th>Patient</th><th>Updated</th><th><span className="sr-only">Actions</span></th></tr>
                </thead>
                <tbody>
                  {shown.map((b) => (
                    <tr key={b.id} className="ab-row" onClick={() => openBed(b)} title={`Open ${b.bed_code} in Bed Allocations`}>
                      <td><strong>{b.bed_code}</strong></td>
                      <td>{b.ward_name}</td>
                      <td>{b.bed_type}</td>
                      <td className="small">{b.features.join(', ') || '—'}</td>
                      <td><Chip status={b.status} /></td>
                      <td>{b.patient_code || '—'}</td>
                      <td className="small"><TimeTag iso={b.updated_at} /></td>
                      <td className="actions">
                        <button className="btn sm ghost" onClick={(e) => { e.stopPropagation(); openBed(b) }} aria-label={`View ${b.bed_code} in Bed Allocations`}>
                          <Icon name="cube" />View
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="muted small table-foot">
              {pages > 1 ? `Showing ${first + 1}–${first + shown.length} of ${list.length}. Narrow with filters.` : `${list.length} bed${list.length === 1 ? '' : 's'}`}
            </p>
            {pages > 1 && (
              <nav className="pager" aria-label="Pages">
                <button className="btn sm" onClick={() => setPage(cur - 1)} disabled={cur <= 1}>‹ Prev</button>
                {pageNumbers(cur, pages).map((n, i) => (n === '…'
                  ? <span key={`gap-${i}`} className="gap">…</span>
                  : <button key={n} className={`pg ${n === cur ? 'on' : ''}`} onClick={() => setPage(n)} aria-current={n === cur ? 'page' : undefined}>{n}</button>))}
                <button className="btn sm" onClick={() => setPage(cur + 1)} disabled={cur >= pages}>Next ›</button>
              </nav>
            )}
          </>
        ) : (
          <div className="empty">No beds match these filters.</div>
        )}
      </section>
    </div>
  )
}
