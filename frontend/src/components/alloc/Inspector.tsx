/* Bed Allocations inspector — the design's renderPanel(): .cx-insp-head, .cx-hero, .cx-tabs, .cx-insp-body
   (details / equipment / patient + section strip) and .cx-actions; plus our AI best-fit score in place mode. */
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../../lib/api'
import { errorMessage, useBed } from '../../lib/queries'
import type { Bed, BedStatus, Recommendation, Ward } from '../../lib/types'
import { useUI } from '../../lib/ui'
import { groupName } from '../../scene/bedScene'
import { Icon } from '../g/Icon'
import { AiTag, BedThumb, FactorBars, ScoreBadge, Skeleton, STATUS_LABEL, TRANSITION_LABEL, ago } from '../g/parts'
import { AssignToBedModal } from './AssignToBedModal'
import { EditBedModal } from './EditBedModal'
import { deviceCodes, useAllocFlows, type Candidate } from './flows'

/** Place-a-patient mode: the patient and the AI's best-fit beds for them. */
export interface Placing {
  patientId: number
  patientCode: string
  displayName: string
  recs: Map<number, Recommendation>
}

type Tab = 'details' | 'equipment' | 'patient'
const TABS: Tab[] = ['details', 'equipment', 'patient']
const shortCode = (code: string) => code.split('-').pop() ?? code

export function Inspector({ ward, beds, bedId, groupSize, match, thumbs, placing, onPickBed, onPickGroup, onPlaced, onPlaceStart }: {
  ward: Ward
  beds: Bed[]
  bedId: number
  groupSize: number
  match: Set<number> | null
  thumbs: Record<BedStatus, string> | null
  placing: Placing | null
  onPickBed: (id: number) => void
  onPickGroup: (g: number) => void
  onPlaced: (patientId: number) => void
  onPlaceStart?: () => void
}) {
  const ui = useUI()
  const nav = useNavigate()
  const q = useBed(bedId)
  const bed = q.data && q.data.id === bedId ? q.data : null
  const flows = useAllocFlows()
  const [tabState, setTab] = useState<{ bed: number; tab: Tab }>({ bed: bedId, tab: 'details' })
  const tab: Tab = tabState.bed === bedId ? tabState.tab : 'details'
  const [modal, setModal] = useState<'assign' | 'edit' | null>(null)
  const rec = placing?.recs.get(bedId) ?? null
  const cand = useQuery({
    queryKey: ['candidates', bedId],
    queryFn: () => api.bedCandidates(bedId) as Promise<Candidate[]>,
    enabled: placing != null && rec == null,
  })

  if (q.isError) return <div className="empty"><Icon name="alert" />{errorMessage(q.error)}</div>
  if (!bed) {
    return (
      <>
        <div className="cx-insp-head"><small>{ward.name}</small><small>&nbsp;</small></div>
        <div className="cx-hero"><Skeleton h="100%" /></div>
        <div className="cx-insp-body"><Skeleton h={160} style={{ marginTop: 14 }} /></div>
      </>
    )
  }

  const gi = Math.floor(bed.index_in_ward / groupSize)
  const p = bed.patient
  const a = bed.allocation

  let content
  if (tab === 'details') {
    content = (
      <dl className="kv">
        <dt>Ward</dt><dd>{bed.ward_name}</dd>
        <dt>Section</dt><dd>{groupName(gi)}</dd>
        <dt>Bed type</dt><dd>{bed.bed_type}</dd>
        <dt>Features</dt><dd>{bed.features.length ? bed.features.join(', ') : <span className="muted">None</span>}</dd>
        <dt>Patient</dt><dd>{p ? p.patient_code : <span className="muted">No patient assigned</span>}</dd>
        <dt>Updated</dt><dd>{ago(bed.updated_at)}</dd>
        {bed.notes ? <><dt>Notes</dt><dd>{bed.notes}</dd></> : null}
      </dl>
    )
  } else if (tab === 'equipment') {
    content = (
      <dl className="kv">
        <dt>Fixed fittings</dt><dd>{bed.features.length ? bed.features.join(', ') : 'None'}</dd>
        <dt>Devices</dt>
        <dd>{bed.devices.length ? bed.devices.map((d, i) => (
          <span key={d.id}>{i > 0 ? ', ' : ''}<button className="link" onClick={() => nav(`/equipment?item=${d.id}`)}>{d.equipment_code}</button></span>
        )) : <span className="muted">None assigned</span>}</dd>
      </dl>
    )
  } else {
    content = p && a ? (
      <dl className="kv">
        <dt>Patient</dt><dd><button className="link" onClick={() => ui.openPatient(p.id)}>{p.patient_code}</button></dd>
        <dt>Name</dt><dd>{p.display_name}</dd>
        <dt>Care</dt><dd>{p.care_category}</dd>
        <dt>Needs</dt><dd>{[p.required_bed_type, ...p.required_equipment_types, ...p.required_bed_features].join(' · ')}</dd>
        <dt>Allocated</dt><dd>{ago(a.assigned_at)}</dd>
        <dt>Admitted</dt><dd>{a.admitted_at ? ago(a.admitted_at) : <span className="muted">Awaiting arrival</span>}</dd>
      </dl>
    ) : (
      <>
        <dl className="kv"><dt>Patient</dt><dd><span className="muted">No patient assigned</span></dd></dl>
        {bed.status !== 'AVAILABLE' && <p className="muted small cx-note">This bed is {STATUS_LABEL[bed.status].toLowerCase()} and can't take a patient until it is marked available.</p>}
      </>
    )
  }

  const placeConfirm = (devices: string[]) => {
    if (!placing) return
    void flows.confirmAllocation(placing.patientId, bed.id,
      <>Allocate <strong>{placing.patientCode}</strong>{placing.displayName ? <> ({placing.displayName})</> : null} to <strong>{bed.bed_code}</strong> in {bed.ward_name}{devices.length ? <> with {devices.join(', ')}</> : null}?</>,
      devices, () => onPlaced(placing.patientId), onPlaceStart)
  }

  // Placement mode replaces the normal actions (her renderPanel).
  let fit = null
  let primary = null
  let secondary = null
  if (placing) {
    if (rec && bed.status === 'AVAILABLE') {
      const devices = deviceCodes(rec.devices)
      fit = (
        <div className="alloc-fit">
          <div className="alloc-fit-head"><AiTag label="AI best fit" /><span>Rank #{rec.rank} for <strong>{placing.patientCode}</strong></span><span className="spacer" /><ScoreBadge score={Math.round(rec.score)} /></div>
          <FactorBars factors={rec.factors} />
          {devices.length > 0 && <p className="muted small">Reserves {devices.join(', ')}</p>}
        </div>
      )
      primary = <button className="btn primary block" disabled={flows.allocating} onClick={() => placeConfirm(devices)}><Icon name="check" />Confirm allocation · {placing.patientCode}</button>
    } else {
      const c = cand.data?.find((x) => x.patient_id === placing.patientId)
      if (cand.isLoading) primary = <div className="loading-line"><Icon name="refresh" cls="spin" />Checking {bed.bed_code} for {placing.patientCode}…</div>
      else if (c?.eligible && bed.status === 'AVAILABLE') {
        const devices = deviceCodes(c.devices)
        primary = <button className="btn primary block" disabled={flows.allocating} onClick={() => placeConfirm(devices)}><Icon name="check" />Confirm allocation · {placing.patientCode}</button>
      } else {
        primary = (
          <div className="place-no">
            <Icon name="alert" />
            <div>
              <strong>Not suitable for {placing.patientCode}</strong>
              <ul>{(c && c.unmet.length ? c.unmet : ['Bed is not available']).map((u) => <li key={u}>{u}</li>)}</ul>
              <small>Pick a highlighted bed instead.</small>
            </div>
          </div>
        )
      }
    }
  } else {
    if (bed.status === 'AVAILABLE') {
      primary = (
        <button className="btn primary block" disabled={!bed.ward_active} title={bed.ward_active ? undefined : 'This ward is inactive'} onClick={() => setModal('assign')}>
          <Icon name="user" />Assign patient
        </button>
      )
    } else if (bed.status === 'OCCUPIED' && p) {
      primary = <button className="btn primary block" onClick={() => ui.openPatient(p.id)}><Icon name="user" />View patient {p.patient_code}</button>
    }
    if (bed.status === 'OCCUPIED' && p && a) {
      secondary = p.status === 'ALLOCATED' ? (
        <>
          <button className="btn cx-ghost" disabled={flows.busy} onClick={() => flows.admit(a.id)}><Icon name="login" />Mark admitted</button>
          <button className="btn cx-ghost" disabled={flows.busy} onClick={() => void flows.cancelFlow(a.id, `${p.patient_code} → ${bed.bed_code}`)}><Icon name="undo" />Cancel</button>
        </>
      ) : (
        <>
          <button className="btn cx-ghost" disabled={flows.busy} onClick={() => void flows.releaseFlow(a.id, 'DISCHARGED', `${p.patient_code} in ${bed.bed_code}`)}>Discharge</button>
          <button className="btn cx-ghost" disabled={flows.busy} onClick={() => void flows.releaseFlow(a.id, 'TRANSFERRED', `${p.patient_code} in ${bed.bed_code}`)}>Transfer</button>
        </>
      )
    } else {
      secondary = (
        <>
          {bed.allowed_transitions.map((s) => (
            <button key={s} className="btn cx-ghost" title={TRANSITION_LABEL[s]} disabled={flows.busy} onClick={() => void flows.statusFlow(bed.id, bed.bed_code, bed.status, s)}>
              <i className={`sw st-${s}`} />{STATUS_LABEL[s]}
            </button>
          ))}
          <button className="btn cx-ghost cx-icon" onClick={() => setModal('edit')} aria-label="Edit bed type and features" title="Edit bed"><Icon name="edit" /></button>
        </>
      )
    }
  }

  const members = beds.slice(gi * groupSize, (gi + 1) * groupSize)
  const free = members.filter((b) => b.status === 'AVAILABLE').length

  return (
    <>
      <div className="cx-insp-head"><small>{groupName(gi)} · {ward.name}</small><small>{bed.bed_type} bed</small></div>
      <div className={`cx-hero st-${bed.status}`}>
        <div className="cx-hero-id"><h2>{bed.bed_code}</h2><span className={`pill st-${bed.status}`}><i aria-hidden="true" />{STATUS_LABEL[bed.status]}</span></div>
        <BedThumb status={bed.status} cls="cx-hero-img" thumbs={thumbs} />
      </div>
      <div className="tabs cx-tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t} role="tab" aria-selected={t === tab} className={t === tab ? 'on' : ''} onClick={() => setTab({ bed: bedId, tab: t })}>
            {t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>
      <div className="cx-insp-body" role="tabpanel">
        {content}
        {fit}
        <div className="cx-strip">
          <h5><button className="link" onClick={() => onPickGroup(gi)}>{groupName(gi)}</button><span>{free} free</span></h5>
          <div className="cx-mini-grid">
            {members.map((b) => (
              <button key={b.id} className={`cx-mini st-${b.status} ${b.id === bed.id ? 'on' : ''} ${match && !match.has(b.id) ? 'dim' : ''}`}
                onClick={() => onPickBed(b.id)} aria-label={`${b.bed_code}, ${STATUS_LABEL[b.status]}`} aria-pressed={b.id === bed.id}>
                <i aria-hidden="true" />{shortCode(b.bed_code)}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="cx-actions">{primary}{secondary && <div className="cx-row">{secondary}</div>}</div>
      <AssignToBedModal bed={bed} open={modal === 'assign'} onClose={() => setModal(null)} />
      <EditBedModal bed={bed} open={modal === 'edit'} onClose={() => setModal(null)} />
    </>
  )
}
