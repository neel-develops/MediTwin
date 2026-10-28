/* Shared Graphite fragments — React versions of the design commit's helpers
   (chip, statCard, stackBar, donut, activityList, alertList, bedThumb, timeTag). */
import { useEffect, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../../lib/api'
import { useAction } from '../../lib/queries'
import type { Activity, Alert, BedStatus, Counts, Factor, Priority, UnlockAction } from '../../lib/types'
import { bedThumbnails } from '../../scene/bedScene'
import { Icon } from './Icon'

export const BED_STATUSES: BedStatus[] = ['AVAILABLE', 'OCCUPIED', 'RESERVED', 'CLEANING', 'MAINTENANCE']
export const STATUS_LABEL: Record<string, string> = {
  AVAILABLE: 'Available', OCCUPIED: 'Occupied', RESERVED: 'Reserved', CLEANING: 'Cleaning', MAINTENANCE: 'Maintenance',
  IN_USE: 'In use', WAITING: 'Waiting', MATCHING: 'Matching', ALLOCATED: 'Allocated', ADMITTED: 'Admitted', DISCHARGED: 'Discharged',
  TRANSFERRED: 'Transferred', ACTIVE: 'Active', RELEASED: 'Released', CANCELLED: 'Cancelled', CLOSED: 'Closed',
}
export const TRANSITION_LABEL: Record<string, string> = { AVAILABLE: 'Mark available', RESERVED: 'Reserve bed', CLEANING: 'Mark for cleaning', MAINTENANCE: 'Send to maintenance' }
export const PRIORITY_LABEL: Record<Priority, string> = { URGENT: 'Urgent', HIGH: 'High', ROUTINE: 'Routine' }
export const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0)

/* ---------------- time (same wording as the design) */
export function ago(iso: string | null | undefined): string {
  if (!iso) return '—'
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`
  return `${Math.floor(s / 86400)} d ago`
}
export const fmtTime = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'
export function fmtDur(m: number | null | undefined): string {
  if (m == null) return '—'
  if (m < 60) return `${m} min`
  if (m < 1440) return `${Math.floor(m / 60)} h ${m % 60} m`
  return `${Math.floor(m / 1440)} d ${Math.floor((m % 1440) / 60)} h`
}
export function TimeTag({ iso }: { iso: string | null | undefined }) {
  return <time dateTime={iso ?? undefined} title={fmtTime(iso)}>{ago(iso)}</time>
}

/* ---------------- chips */
export function Chip({ status, label }: { status: string; label?: string }) {
  return <span className={`chip st-${status}`}><i aria-hidden="true" />{label ?? STATUS_LABEL[status] ?? status}</span>
}
export function Prio({ priority }: { priority: Priority }) {
  return <span className={`prio p-${priority}`}>{PRIORITY_LABEL[priority]}</span>
}
export function AiTag({ label = 'AI' }: { label?: string }) {
  return <span className="ai-tag"><Icon name="spark" />{label}</span>
}
export function ScoreBadge({ score }: { score: number }) {
  return <span className={`score ${score >= 85 ? '' : score >= 70 ? 'mid' : 'low'}`} title="AI resource match score — not a clinical score">{score}</span>
}

/* ---------------- stat card, stack bar, donut */
export function StatCard({ label, value, status, sub, icon, className }: { label: ReactNode; value: ReactNode; status?: string; sub?: ReactNode; icon?: string; className?: string }) {
  return (
    <div className={`stat ${status ? `st-${status}` : ''} ${className ?? ''}`}>
      <span className="stat-label">{status ? <i aria-hidden="true" /> : null}{icon ? <Icon name={icon} /> : null}{label}</span>
      <strong>{value}</strong>
      {sub != null && <small>{sub}</small>}
    </div>
  )
}

export function StackBar({ counts, total }: { counts: Record<BedStatus, number>; total?: number }) {
  const t = total ?? BED_STATUSES.reduce((n, s) => n + counts[s], 0)
  return (
    <div className="stack" role="img" aria-label={BED_STATUSES.map((s) => `${counts[s]} ${STATUS_LABEL[s].toLowerCase()}`).join(', ')}>
      {BED_STATUSES.map((s) => (counts[s] && t ? <span key={s} className={`seg st-${s}`} style={{ width: `${(counts[s] / t) * 100}%` }} /> : null))}
    </div>
  )
}

export function Donut({ counts, total, label = 'Total beds' }: { counts: Counts | Record<BedStatus, number>; total: number; label?: string }) {
  const r = 52, c = 2 * Math.PI * r
  const segs = BED_STATUSES.reduce<{ s: BedStatus; len: number; off: number }[]>((out, s) => {
    const off = out.length ? out[out.length - 1].off + out[out.length - 1].len : 0
    return [...out, { s, len: total ? (counts[s] / total) * c : 0, off }]
  }, [])
  return (
    <svg viewBox="0 0 140 140" className="donut" role="img" aria-label="Bed status breakdown">
      <g transform="rotate(-90 70 70)">
        <circle r={r} cx="70" cy="70" fill="none" stroke="rgba(238, 243, 246, .08)" strokeWidth="18" />
        {segs.filter((x) => x.len).map((x) => (
          <circle key={x.s} r={r} cx="70" cy="70" fill="none" className={`dseg st-${x.s}`} strokeWidth="18" strokeDasharray={`${x.len} ${c - x.len}`} strokeDashoffset={-x.off} />
        ))}
      </g>
      <text x="70" y="68" textAnchor="middle" className="d-num">{total}</text>
      <text x="70" y="88" textAnchor="middle" className="d-lbl">{label}</text>
    </svg>
  )
}

/* ---------------- activity & alerts */
export function ActivityList({ items }: { items: Activity[] }) {
  if (!items.length) return <div className="empty">No activity yet.</div>
  return (
    <ul className="activity">
      {items.map((a) => (
        <li key={a.id}><span className={`act-dot a-${a.action}`} aria-hidden="true" /><span className="act-msg">{a.message}</span><TimeTag iso={a.created_at} /></li>
      ))}
    </ul>
  )
}

function AlertLink({ a }: { a: Alert }) {
  const nav = useNavigate()
  if (a.ward_id) return <button className="link" onClick={() => nav(`/allocations?ward=${a.ward_id}`)}>Open ward</button>
  if (a.patient_id) return <button className="link" onClick={() => nav(`/patients?patient=${a.patient_id}`)}>Review patient</button>
  if (a.equipment_type) return <button className="link" onClick={() => nav(`/equipment?type=${encodeURIComponent(a.equipment_type!)}`)}>View equipment</button>
  if (a.kind === 'MAINTENANCE') return <button className="link" onClick={() => nav('/beds?status=MAINTENANCE')}>View beds</button>
  if (a.kind === 'CLEANING_BACKLOG') return <button className="link" onClick={() => nav('/beds?status=CLEANING')}>View beds</button>
  return null
}

export function AlertList({ items }: { items: Alert[] }) {
  if (!items.length) return <div className="empty ok"><Icon name="check" /> No alerts at current thresholds.</div>
  return (
    <ul className="alerts">
      {items.map((a) => (
        <li key={a.id} className={`sev-${a.severity}`}>
          <Icon name={a.severity === 'info' ? 'info' : 'alert'} cls={`sev-${a.severity}`} />
          <div><strong>{a.title}</strong><small>{a.detail}</small></div>
          <AlertLink a={a} />
        </li>
      ))}
    </ul>
  )
}

/* ---------------- empty, loading */
export function Empty({ children, ok, sm, icon }: { children: ReactNode; ok?: boolean; sm?: boolean; icon?: string }) {
  return <div className={`empty ${ok ? 'ok' : ''} ${sm ? 'sm' : ''}`}>{icon && <Icon name={icon} />}{children}</div>
}
export function Skeleton({ h = 40, w, style }: { h?: number | string; w?: number | string; style?: React.CSSProperties }) {
  return <div className="skeleton" style={{ height: h, width: w ?? '100%', ...style }} />
}
export function Spinner() {
  return <Icon name="refresh" cls="spin" />
}
export function Loading({ label = 'Loading…' }: { label?: string }) {
  return <div className="loading-line"><Spinner />{label}</div>
}
export function PageError({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div className="page"><section className="card page-error">
      <Icon name="alert" />
      <h2>Couldn’t load this page</h2>
      <p className="muted">{error instanceof Error ? error.message : 'The MediTwin server did not respond.'}</p>
      {onRetry && <button className="btn" onClick={onRetry}><Icon name="refresh" />Try again</button>}
    </section></div>
  )
}

/* ---------------- 3D bed thumbnails (rendered once, cached) */
export function useThumbs() {
  const [t, setT] = useState<Record<BedStatus, string> | null>(null)
  useEffect(() => {
    let live = true
    bedThumbnails().then((x) => live && setT(x)).catch(() => live && setT(null))
    return () => { live = false }
  }, [])
  return t
}
export function BedThumb({ status, cls, thumbs }: { status: BedStatus; cls?: string; thumbs: Record<BedStatus, string> | null }) {
  if (thumbs?.[status]) return <img className={cls ?? 'thumb'} src={thumbs[status]} alt="" />
  return <span className={`${cls ?? 'thumb'} thumb-fallback st-${status}`} aria-hidden="true"><Icon name="bed" /></span>
}

/* ---------------- AI explanation pieces */
export function FactorBars({ factors }: { factors: Factor[] }) {
  return (
    <div className="factors">
      {factors.map((f) => {
        const r = f.max ? f.points / f.max : 0
        return (
          <div key={f.key} className="factor" title={f.note}>
            <span>{f.label}</span>
            <span className="bar"><i className={r >= 0.75 ? 'hi' : r < 0.4 ? 'lo' : ''} style={{ width: `${r * 100}%` }} /></span>
            <b>{Math.round(f.points)}<small>/{f.max}</small></b>
          </div>
        )
      })}
    </div>
  )
}

/** One-click fixes the AI suggests for a patient with no suitable bed. */
export function UnlockList({ actions }: { actions: UnlockAction[] }) {
  const [pending, setPending] = useState<string | null>(null)
  const bed = useAction((a: UnlockAction) => api.bedStatus(a.bed_id!, a.to_status!), { success: (_r, a) => `${a.bed_code} is now available.` })
  const eq = useAction((a: UnlockAction) => api.updateEquipment(a.equipment_id!, { status: 'AVAILABLE' }), { success: (_r, a) => `${a.equipment_code} returned to service.` })
  const compat = useAction(async (a: UnlockAction) => {
    const s = await api.settings()
    const cur = s.bed_type_compat[a.bed_type!] ?? [a.bed_type!]
    return api.updateSettings({ bed_type_compat: { [a.bed_type!]: Array.from(new Set([...cur, a.add_type!])) } })
  }, { success: (_r, a) => `${a.add_type} beds are now accepted for ${a.bed_type} requests.` })
  const run = (a: UnlockAction) => {
    setPending(a.label)
    const done = { onSettled: () => setPending(null) }
    if (a.kind === 'BED_STATUS') bed.mutate(a, done)
    else if (a.kind === 'EQUIPMENT_STATUS') eq.mutate(a, done)
    else if (a.kind === 'COMPAT') compat.mutate(a, done)
  }
  return (
    <div className="unlock-list">
      {actions.map((a) => (
        <div key={a.label} className="unlock">
          <Icon name={a.kind === 'INFO' ? 'info' : 'wand'} />
          <div><strong>{a.label}</strong><small>{a.detail}</small></div>
          {a.kind !== 'INFO' && (
            <button className="btn sm" disabled={pending === a.label} onClick={() => run(a)}>{pending === a.label ? <Spinner /> : 'Apply'}</button>
          )}
        </div>
      ))}
    </div>
  )
}

/** Checkbox group with the design's `.checks` markup. */
export function Checks({ name, options, value, onChange, disabled }: { name: string; options: string[]; value: string[]; onChange: (v: string[]) => void; disabled?: boolean }) {
  return (
    <div className="checks">
      {options.map((o) => (
        <label key={o} className="check">
          <input type="checkbox" name={name} value={o} checked={value.includes(o)} disabled={disabled}
            onChange={(e) => onChange(e.target.checked ? [...value, o] : value.filter((x) => x !== o))} />
          <span>{o}</span>
        </label>
      ))}
    </div>
  )
}
