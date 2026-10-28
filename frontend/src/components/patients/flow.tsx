/* Patient-flow fragments from the Graphite design (app.js: STAGE_META, fmtDur, needChips, fitLabel/fitClass, patientCard). */
import type { CSSProperties } from 'react'
import type { FlowCard, Priority, Stage } from '../../lib/types'
import { Icon } from '../g/Icon'
import { AiTag, fmtTime, PRIORITY_LABEL } from '../g/parts'

export type FlowStage = Exclude<Stage, 'CLOSED'>
export const FLOW_STAGES: FlowStage[] = ['WAITING', 'MATCHING', 'ALLOCATED', 'ADMITTED']

export const STAGE_META: Record<FlowStage, { label: string; icon: string; note: string }> = {
  WAITING: { label: 'Waiting', icon: 'clock', note: 'No bed search yet' },
  MATCHING: { label: 'Matching', icon: 'search', note: 'Bed search in progress' },
  ALLOCATED: { label: 'Allocated', icon: 'bed', note: 'Bed held · awaiting arrival' },
  ADMITTED: { label: 'Admitted', icon: 'login', note: 'In bed now' },
}
export const CARE_ICON: Record<string, string> = {
  'General Medicine': 'steth', 'Surgery Recovery': 'scissors', 'Critical Care': 'heart', Paediatrics: 'smile', Maternity: 'smile', 'Infectious Disease': 'shield',
}
export const DEVICE_ICON: Record<string, string> = { Monitor: 'monitor', Ventilator: 'wind', 'Infusion Pump': 'droplet' }
export const FEATURE_SHORT: Record<string, string> = { 'Oxygen Outlet': 'O₂', Suction: 'Suction', 'Isolation Capable': 'Isolation', Bariatric: 'Bariatric' }
export const PAGE_SIZE = 24

export const isFlowStage = (s: string | null | undefined): s is FlowStage => !!s && (FLOW_STAGES as string[]).includes(s)

/** The design's compact duration: 45m · 3h 12m · 2d 4h. */
export function fmtDur(m: number | null | undefined): string {
  if (m == null || Number.isNaN(m)) return '—'
  if (m < 60) return `${m}m`
  if (m < 1440) return `${Math.floor(m / 60)}h ${m % 60}m`
  return `${Math.floor(m / 1440)}d ${Math.floor((m % 1440) / 60)}h`
}
export const fitLabel = (n: number) => (n === 0 ? 'No bed fits' : `${n} bed${n === 1 ? '' : 's'} fit`)
export const fitClass = (n: number) => (n === 0 ? 'none' : n <= 3 ? 'few' : 'ok')

export function pageNumbers(cur: number, total: number): (number | '…')[] {
  const out: (number | '…')[] = []
  for (let n = 1; n <= total; n++) {
    if (n === 1 || n === total || Math.abs(n - cur) <= 1) out.push(n)
    else if (out[out.length - 1] !== '…') out.push('…')
  }
  return out
}

export function NeedChips({ p, compact }: { p: { required_bed_type: string; required_equipment_types: string[]; required_bed_features: string[] }; compact?: boolean }) {
  return (
    <>
      <span className="need type"><Icon name="bed" />{p.required_bed_type}</span>
      {p.required_equipment_types.map((d) => (
        <span key={`d-${d}`} className="need dev" title={d}><Icon name={DEVICE_ICON[d] || 'monitor'} />{compact ? '' : d}</span>
      ))}
      {p.required_bed_features.map((f) => (
        <span key={`f-${f}`} className="need feat" title={f}>{compact ? FEATURE_SHORT[f] || f : f}</span>
      ))}
    </>
  )
}

export function PrioPill({ priority, suffix }: { priority: Priority; suffix?: string }) {
  return <span className={`prio p-${priority}`}>{PRIORITY_LABEL[priority]}{suffix}</span>
}

export function PatientCard({ c, i, on, onPick }: { c: FlowCard; i: number; on: boolean; onPick: (id: number) => void }) {
  const stage = isFlowStage(c.stage) ? STAGE_META[c.stage].label : c.stage
  const fit = c.fit_count ?? 0
  return (
    <button type="button" className={`pcard pr-${c.priority} ${on ? 'on' : ''}`} style={{ '--i': i } as CSSProperties} onClick={() => onPick(c.id)}
      aria-pressed={on} aria-label={`${c.patient_code}, ${PRIORITY_LABEL[c.priority]} priority, ${stage}${c.allocation_source === 'AI_PLAN' ? ', placed by AI plan' : ''}`}>
      <span className="pc-top"><strong>{c.patient_code}</strong>
        <span className="pc-tags">{c.allocation_source === 'AI_PLAN' && <AiTag label="AI plan" />}<PrioPill priority={c.priority} /></span>
      </span>
      <span className="pc-name">{c.display_name}</span>
      <span className="pc-cat"><Icon name={CARE_ICON[c.care_category] || 'user'} />{c.care_category}</span>
      <span className="pc-needs"><NeedChips p={c} compact /></span>
      <span className="pc-foot">
        <span className="pc-time" title={fmtTime(c.since)}><Icon name="clock" />{fmtDur(c.minutes)}</span>
        {c.bed_code
          ? <span className="pc-bed" title={`${c.bed_code} · ${c.ward_name || ''}`}><Icon name="bed" /><b>{c.bed_code}</b></span>
          : c.fit_count != null && <span className={`pc-fit ${fitClass(fit)}`}>{fit === 0 && <Icon name="alert" />}{fitLabel(fit)}</span>}
      </span>
    </button>
  )
}
