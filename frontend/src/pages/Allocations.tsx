/* Bed Allocations — the design's concept layout (v39 PAGES.allocations): full-height 3D stage with the title,
   filters and status chips floating on it, an inspector on the right and a 4-card dock underneath.
   Ward tabs and bed search live in the top bar while this page is open. Wired to our API + AI place mode. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Inspector, type Placing } from '../components/alloc/Inspector'
import { BedStage } from '../components/BedStage'
import { Icon } from '../components/g/Icon'
import { BED_STATUSES, BedThumb, Chip, Donut, Empty, Loading, PageError, Prio, Skeleton, STATUS_LABEL, ago, useThumbs } from '../components/g/parts'
import { toast } from '../components/ui/toast'
import { api } from '../lib/api'
import { errorMessage, useActivity, useBeds, useBed, useMeta, usePatient, useRecs, useSettings, useSummary, useWards } from '../lib/queries'
import type { Bed, BedStatus } from '../lib/types'
import { groupName, type Stage } from '../scene/bedScene'
import '../styles/pages/Allocations.css'

type View = '3d' | 'list'
const EMPTY_BEDS: Bed[] = []
const shortCode = (code: string) => code.split('-').pop() ?? code
const FEED_DOT: Record<string, BedStatus> = { ALLOCATED: 'OCCUPIED', ADMITTED: 'OCCUPIED', RELEASED: 'AVAILABLE', ALLOCATION_CANCELLED: 'AVAILABLE', BED_STATUS: 'RESERVED', BEDS_GENERATED: 'CLEANING' }

export default function Allocations() {
  const nav = useNavigate()
  const [params, setParams] = useSearchParams()
  const wards = useWards()
  const settings = useSettings()
  const meta = useMeta()
  const summary = useSummary()
  const feed = useActivity(4)
  const thumbs = useThumbs()
  const groupSize = settings.data?.group_size ?? 10
  const stageRef = useRef<Stage | null>(null)

  // ---------------- URL state (her replaceHash conventions)
  const wardParam = params.get('ward') ? Number(params.get('ward')) : null
  const bedParam = params.get('bed') ? Number(params.get('bed')) : null
  const statusParam = params.get('status')
  const statusFilter = statusParam && (BED_STATUSES as string[]).includes(statusParam) ? (statusParam as BedStatus) : ''
  const forParam = params.get('for') ?? params.get('match')
  const placePid = forParam ? Number(forParam) : null

  const set = useCallback((patch: Record<string, string | number | null>) => {
    setParams((p) => {
      const n = new URLSearchParams(p)
      for (const [k, v] of Object.entries(patch)) {
        if (v == null || v === '') n.delete(k)
        else n.set(k, String(v))
      }
      return n
    }, { replace: true })
  }, [setParams])

  // ---------------- local state
  const [typeFilter, setTypeFilter] = useState('')
  const [search, setSearch] = useState('')
  const [view, setView] = useState<View>('3d')
  const [noWebgl, setNoWebgl] = useState(false)
  const [spin, setSpin] = useState(false)
  const [groupState, setGroupState] = useState<{ ward: number | null; group: number }>({ ward: null, group: 0 })
  const effectiveView: View = noWebgl ? 'list' : view

  // Top-bar slot (rendered by the app shell).
  const [slot, setSlot] = useState<HTMLElement | null>(null)
  useEffect(() => { setSlot(document.getElementById('topbar-slot')) }, [])

  // ---------------- AI place mode (?for=<patientId>)
  const recs = useRecs(placePid, placePid != null)
  const patientQ = usePatient(placePid)
  const placeDetail = patientQ.data && patientQ.data.id === placePid ? patientQ.data : null
  const placing: Placing | null = useMemo(() => {
    const d = recs.data
    if (placePid == null || !d || d.not_waiting) return null
    return { patientId: placePid, patientCode: d.patient_code, displayName: placeDetail?.display_name ?? '', recs: new Map(d.recommendations.map((r) => [r.bed_id, r])) }
  }, [recs.data, placePid, placeDetail])
  const byWard = useMemo(() => {
    const m: Record<number, number> = {}
    for (const r of recs.data?.recommendations ?? []) m[r.ward_id] = (m[r.ward_id] ?? 0) + 1
    return m
  }, [recs.data])
  const justPlaced = useRef<number | null>(null)
  const notWaiting = placePid != null && !!recs.data?.not_waiting
  useEffect(() => {
    if (!notWaiting) return
    if (justPlaced.current !== placePid) toast.info(`${recs.data?.patient_code ?? 'This patient'} is no longer waiting for a bed.`)
    set({ for: null, match: null })
  }, [notWaiting, placePid, recs.data?.patient_code, set])
  const recsFailed = placePid != null && recs.isError
  useEffect(() => {
    if (!recsFailed) return
    toast.error(`Couldn't load AI recommendations: ${errorMessage(recs.error)}`)
    set({ for: null, match: null })
  }, [recsFailed, recs.error, set])

  // ---------------- ward
  const activeWards = useMemo(() => (wards.data ?? []).filter((w) => w.is_active), [wards.data])
  const matchWard = recs.data?.recommendations[0]?.ward_id ?? null
  const wardId = wardParam != null && activeWards.some((w) => w.id === wardParam) ? wardParam
    : placePid != null && matchWard != null && activeWards.some((w) => w.id === matchWard) ? matchWard
      : activeWards[0]?.id ?? null
  const ward = activeWards.find((w) => w.id === wardId) ?? null
  const waitingForMatch = placePid != null && recs.isLoading
  useEffect(() => {
    if (wardId != null && wardParam !== wardId && !waitingForMatch && wards.isSuccess) set({ ward: wardId })
  }, [wardId, wardParam, waitingForMatch, wards.isSuccess, set])

  const bedsQ = useBeds({ ward_id: wardId ?? undefined }, wardId != null)
  const bedsLoading = wardId != null && (!bedsQ.data || bedsQ.isPlaceholderData)
  const beds = bedsQ.data && !bedsQ.isPlaceholderData ? bedsQ.data : EMPTY_BEDS
  const sceneBeds = useMemo(() => beds.map((b) => ({ id: b.id, bed_code: b.bed_code, status: b.status })), [beds])

  // Deep link ?bed= follows the bed to its ward.
  const selBed = useBed(bedParam)
  const selData = selBed.data && selBed.data.id === bedParam ? selBed.data : null
  useEffect(() => {
    if (selData && selData.ward_id !== wardId && activeWards.some((w) => w.id === selData.ward_id)) set({ ward: selData.ward_id })
  }, [selData, wardId, activeWards, set])
  useEffect(() => {
    if (bedParam != null && bedsQ.isSuccess && !bedsQ.isPlaceholderData && selBed.isError) set({ bed: null })
  }, [bedParam, bedsQ.isSuccess, bedsQ.isPlaceholderData, selBed.isError, set])

  // Section + inspector bed: the inspector always shows a bed — the chosen one, else the first of the section.
  const explicitIdx = bedParam != null ? beds.findIndex((b) => b.id === bedParam) : -1
  const groupRaw = groupState.ward === wardId ? groupState.group : 0
  const group = explicitIdx >= 0 ? Math.floor(explicitIdx / groupSize) : groupRaw * groupSize < beds.length ? groupRaw : 0
  const inspBed = explicitIdx >= 0 ? beds[explicitIdx] : beds[Math.min(group * groupSize, Math.max(0, beds.length - 1))] ?? null
  const focusId = explicitIdx >= 0 ? bedParam : null

  // ---------------- filters → highlight set
  const term = search.trim().toLowerCase()
  const filtering = !!(statusFilter || typeFilter || term)
  const passes = useCallback((b: Bed) => (!statusFilter || b.status === statusFilter) && (!typeFilter || b.bed_type === typeFilter) && (!term || b.bed_code.toLowerCase().includes(term)), [statusFilter, typeFilter, term])
  const match = useMemo(() => {
    if (placing) return new Set(beds.filter((b) => placing.recs.has(b.id) && passes(b)).map((b) => b.id))
    if (filtering) return new Set(beds.filter(passes).map((b) => b.id))
    return null
  }, [placing, filtering, beds, passes])
  const bedTypes = meta.data?.bed_types ?? Array.from(new Set(beds.map((b) => b.bed_type)))

  // ---------------- actions
  const selectWard = (id: number) => {
    if (id === wardId) return
    setGroupState({ ward: id, group: 0 })
    set({ ward: id, bed: null })
  }
  const selectBed = (id: number) => set({ bed: id })
  const selectGroup = (i: number, focus: boolean) => {
    setGroupState({ ward: wardId, group: i })
    if (explicitIdx >= 0 && Math.floor(explicitIdx / groupSize) !== i) set({ bed: null })
    stageRef.current?.setActiveGroup(i, { focus })
  }
  const toggleStatus = (s: BedStatus) => set({ status: statusFilter === s ? null : s })
  const clearFilters = () => { set({ status: null }); setTypeFilter(''); setSearch('') }
  const cancelPlace = () => set({ for: null, match: null })
  const toggleSpin = () => {
    const s = stageRef.current
    if (!s) return
    s.setAutoRotate(!s.autoRotate)
    setSpin(s.autoRotate)
  }

  const findBed = async (raw: string) => {
    const q = raw.trim().toLowerCase()
    if (!q) return
    const exact = beds.find((b) => b.bed_code.toLowerCase() === q || shortCode(b.bed_code) === q.padStart(3, '0'))
    const hits = beds.filter((b) => b.bed_code.toLowerCase().includes(q))
    const pick = exact ?? (hits.length === 1 ? hits[0] : null)
    if (pick) { selectBed(pick.id); toast.info(`Selected ${pick.bed_code}.`); return }
    try {
      const r = await api.search(raw.trim())
      const elsewhere = r.beds.find((b) => b.bed_code.toLowerCase() === q)
      if (elsewhere) { set({ ward: elsewhere.ward_id, bed: elsewhere.id }); return }
    } catch { /* fall through to the local message */ }
    if (hits.length) toast.info(`${hits.length} beds match “${raw.trim()}” — keep typing to narrow it down.`)
    else toast.error(`No bed with ID “${raw.trim()}”.`)
  }

  if (wards.isError) return <PageError error={wards.error} onRetry={() => wards.refetch()} />
  const noWards = wards.isSuccess && !activeWards.length
  const groupsCount = Math.ceil(beds.length / groupSize)
  const here = ward ? byWard[ward.id] ?? 0 : 0

  // ---------------- top bar: ward tabs + bed search
  const topbar = slot && createPortal(
    <>
      <div className="ward-tabs" role="tablist" aria-label="Ward">
        {activeWards.map((w) => (
          <button key={w.id} className={`ward-tab ${w.id === wardId ? 'on' : ''}`} role="tab" aria-selected={w.id === wardId} onClick={() => selectWard(w.id)}>
            {w.name}<span>{placing ? <b className={byWard[w.id] ? 'fit-ok' : 'fit-none'}>{byWard[w.id] ?? 0} fit</b> : w.bed_count}</span>
          </button>
        ))}
      </div>
      <label className="search-field sm bed-find"><span className="sr-only">Find bed by ID</span><Icon name="search" />
        <input type="search" placeholder="Find bed — e.g. W1-042" value={search} onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void findBed(e.currentTarget.value) } }} />
      </label>
    </>,
    slot,
  )

  // ---------------- stage overlays
  const banner = placing && recs.data ? (
    <>
      <span className="pb-icon" aria-hidden="true"><Icon name="user" /></span>
      <div>
        <strong>Placing {placing.patientCode}</strong> {placeDetail && <Prio priority={placeDetail.priority} />}
        <small>
          {placeDetail ? <>Needs {[placeDetail.required_bed_type, ...placeDetail.required_equipment_types, ...placeDetail.required_bed_features].join(' · ')} · </> : null}
          <b>{here}</b> suitable bed{here === 1 ? '' : 's'} here, {recs.data.eligible_count} in all wards — highlighted beds fit
        </small>
      </div>
      <button className="btn sm" onClick={() => nav(`/patients?patient=${placing.patientId}`)}><Icon name="user" />Patient</button>
      <button className="icon-btn plain" onClick={cancelPlace} aria-label="Stop placing this patient"><Icon name="x" /></button>
    </>
  ) : placePid != null && recs.isLoading ? (
    <>
      <span className="pb-icon" aria-hidden="true"><Icon name="spark" /></span>
      <div><strong>Finding suitable beds…</strong><small>Scoring every available bed for this patient.</small></div>
      <button className="icon-btn plain" onClick={cancelPlace} aria-label="Stop placing this patient"><Icon name="x" /></button>
    </>
  ) : null

  let message = null
  if (filtering && !placing) message = <>{match?.size ?? 0} of {beds.length} beds match. <button className="link" onClick={clearFilters}>Clear filters</button></>
  else if (noWebgl) message = <><Icon name="alert" /> The 3D view couldn't load (WebGL unavailable). The list view shows the same beds.</>
  else if (bedsLoading) message = <>Loading 3D view…</>

  const list = bedsLoading ? <Loading label="Loading beds…" /> : !beds.length ? (
    <div className="empty">This ward has no beds. Use Setup → Set bed count.</div>
  ) : (() => {
    const out = []
    for (let g = 0; g * groupSize < beds.length; g++) {
      const members = beds.slice(g * groupSize, (g + 1) * groupSize).filter((b) => !match || match.has(b.id))
      if (!members.length) continue
      out.push(
        <section key={g} className="bl-group">
          <h3><button className="link" onClick={() => selectGroup(g, true)}>{groupName(g)}</button><small>visual section</small></h3>
          <div className="tiles">
            {members.map((b) => (
              <button key={b.id} className={`tile st-${b.status} ${b.id === inspBed?.id ? 'on' : ''}`} onClick={() => selectBed(b.id)}
                aria-label={`${b.bed_code}, ${STATUS_LABEL[b.status]}, ${b.bed_type} bed`}>
                <BedThumb status={b.status} cls="tile-img" thumbs={thumbs} /><strong>{b.bed_code}</strong><Chip status={b.status} />
              </button>
            ))}
          </div>
        </section>,
      )
    }
    return out.length ? out : <div className="empty">No beds match the current filters.</div>
  })()

  const occPct = ward && ward.bed_count ? Math.round((ward.counts.OCCUPIED / ward.bed_count) * 100) : 0
  const waiting = summary.data?.queue.waiting

  return (
    <div className="page explorer cx">
      {topbar}
      <section className="stage-card cx-stage">
        <BedStage
          beds={sceneBeds} selectedId={inspBed?.id ?? null} focusId={focusId} matchIds={match} activeGroup={group} groupSize={groupSize}
          resetKey={`${wardId}-${groupSize}`} stageRef={stageRef} refitKey={`${wardId}-${!!banner}-${placing?.patientId ?? ''}`}
          onBedClick={selectBed} onGroupClick={(i) => selectGroup(i, true)} onUnavailable={() => setNoWebgl(true)}
          listMode={effectiveView === 'list'} placing={!!placing} list={list}
        >
          <div className="cx-head">
            <div className="cx-title">
              {noWards ? <><h1>No active wards</h1><p>Add a ward in <Link to="/setup">Setup</Link> to generate beds.</p></>
                : ward ? <><h1>{ward.name}</h1><p>{ward.bed_count} beds <span className="dot-sep">•</span> {ward.category}{groupsCount > 1 ? <> <span className="dot-sep">•</span> {groupsCount} sections</> : null}</p></>
                  : <><h1>—</h1><p>Loading wards…</p></>}
              <div className="cx-filters">
                <label className="sel"><span className="sr-only">Status</span>
                  <select value={statusFilter} onChange={(e) => set({ status: e.target.value || null })}>
                    <option value="">All statuses</option>
                    {BED_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                  </select>
                </label>
                <label className="sel"><span className="sr-only">Bed type</span>
                  <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
                    <option value="">All bed types</option>
                    {bedTypes.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </label>
                <Link className="btn sm tools-link" to="/beds" title="Table of every bed across all wards"><Icon name="layers" />All wards</Link>
              </div>
            </div>
            <div className="cx-chips" role="group" aria-label="Filter by status">
              {ward && BED_STATUSES.map((s) => (
                <button key={s} className={`cx-chip st-${s} ${statusFilter === s ? 'on' : ''}`} aria-pressed={statusFilter === s} onClick={() => toggleStatus(s)}>
                  <small><i aria-hidden="true" />{STATUS_LABEL[s]}</small><strong>{ward.counts[s]}</strong>
                </button>
              ))}
            </div>
          </div>
          <div className="place-banner" hidden={banner == null}>{banner}</div>
          <div className="stage-msg" hidden={message == null} role="status">{message}</div>
          <div className="cx-tools">
            <div className="tool-group cx-cam" role="toolbar" aria-label="Camera">
              <button type="button" onClick={() => stageRef.current?.zoom(0.8)} aria-label="Zoom in"><Icon name="plus" /></button>
              <button type="button" onClick={() => stageRef.current?.zoom(1.25)} aria-label="Zoom out"><Icon name="minus" /></button>
              <button type="button" onClick={() => stageRef.current?.rotate(-Math.PI / 4)} aria-label="Rotate"><Icon name="rotr" /></button>
              <button type="button" onClick={() => stageRef.current?.resetView()} aria-label="Reset view"><Icon name="target" /></button>
              <button type="button" onClick={toggleSpin} aria-label="Auto-rotate" aria-pressed={spin}><Icon name="orbit" /></button>
            </div>
            <div className="tool-group" role="group" aria-label="View">
              <button type="button" aria-pressed={effectiveView === '3d'} aria-label="3D view" disabled={noWebgl} onClick={() => setView('3d')}><Icon name="cube" /></button>
              <button type="button" aria-pressed={effectiveView === 'list'} aria-label="List view" onClick={() => setView('list')}><Icon name="list" /></button>
            </div>
          </div>
        </BedStage>
      </section>

      <aside className="card cx-insp" aria-live="polite">
        {noWards ? <div className="empty">No active wards yet.</div>
          : !ward || bedsLoading ? <div className="cx-insp-body"><Skeleton h={180} style={{ marginTop: 20 }} /><Skeleton h={220} style={{ marginTop: 14 }} /></div>
            : !beds.length || !inspBed ? <div className="empty">{ward.name} has no beds. Use Setup → Set bed count.</div>
              : (
                <Inspector ward={ward} beds={beds} bedId={inspBed.id} groupSize={groupSize} match={match} thumbs={thumbs} placing={placing}
                  onPickBed={selectBed} onPickGroup={(g) => selectGroup(g, true)}
                  onPlaceStart={() => { justPlaced.current = placePid }}
                  onPlaced={(pid) => nav(`/patients?patient=${pid}`)} />
              )}
      </aside>

      <section className="cx-dock" aria-label="Ward summary">
        <div className="card cx-occ">
          {ward ? <>
            <Donut counts={ward.counts} total={ward.bed_count} />
            <div><h6>Occupancy</h6><strong className="cx-big">{occPct}%</strong><p>{ward.counts.OCCUPIED} occupied · {ward.counts.RESERVED} reserved</p></div>
          </> : <Skeleton h="100%" />}
        </div>
        <button className="card cx-stat" onClick={() => toggleStatus('AVAILABLE')} aria-pressed={statusFilter === 'AVAILABLE'} disabled={!ward}>
          <h6>Ready now</h6><strong className="cx-big st-AVAILABLE">{ward?.counts.AVAILABLE ?? '—'}</strong><p>available beds in {ward?.name ?? 'this ward'}</p>
        </button>
        <button className="card cx-stat" onClick={() => nav('/patients?stage=WAITING')}>
          <h6>Waiting</h6><strong className="cx-big st-RESERVED">{waiting ?? '—'}</strong><p>patients need a bed</p>
        </button>
        <div className="card cx-feed">
          <div className="cx-feed-head"><h6>Live activity</h6><Link className="link small" to="/alerts?tab=activity">View all</Link></div>
          {feed.data ? (feed.data.length ? (
            <ul className="cx-feed-list">
              {feed.data.map((a) => (
                <li key={a.id} className={`st-${FEED_DOT[a.action] ?? 'CLEANING'}`}><i aria-hidden="true" /><span>{a.message}</span><time dateTime={a.created_at}>{ago(a.created_at).replace(' ago', '')}</time></li>
              ))}
            </ul>
          ) : <p className="muted small">No activity yet.</p>) : feed.isError ? <Empty sm>Couldn’t load activity.</Empty> : <Loading />}
        </div>
      </section>
    </div>
  )
}
