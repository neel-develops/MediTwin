/* Her shared flows (app.js releaseFlow / confirmAllocation / admit / cancel-alloc / bed-status) wired to our API. */
import type { ReactNode } from 'react'
import { api } from '../../lib/api'
import { useAction, useSettings } from '../../lib/queries'
import type { Allocation, BedStatus } from '../../lib/types'
import { confirm } from '../g/Modal'
import { STATUS_LABEL, TRANSITION_LABEL } from '../g/parts'

export type Candidate = Awaited<ReturnType<typeof api.bedCandidates>>[number] & {
  devices?: { id?: number; equipment_code: string; equipment_type?: string }[]
}

export const deviceCodes = (devices?: { equipment_code: string }[]) => (devices ?? []).map((d) => d.equipment_code)

export function useAllocFlows() {
  const settings = useSettings()

  const allocate = useAction(
    (a: { patientId: number; bedId: number; devices: string[] }) => api.allocate(a.patientId, a.bedId),
    { success: (r, a) => `${r.patient_code ?? 'Patient'} allocated to ${r.bed_code}${a.devices.length ? ` with ${a.devices.join(', ')}` : ''}.` },
  )
  const release = useAction(
    (a: { allocId: number; outcome: 'DISCHARGED' | 'TRANSFERRED' }) => api.release(a.allocId, a.outcome),
    { success: (r, a) => `${r.patient_code} ${a.outcome.toLowerCase()}. ${r.bed_code} → ${(STATUS_LABEL[r.bed_status] ?? r.bed_status).toLowerCase()}.` },
  )
  const admit = useAction((allocId: number) => api.admit(allocId), { success: (r) => `${r.patient_code} admitted to ${r.bed_code}.` })
  const cancel = useAction((allocId: number) => api.cancel(allocId), {
    success: (r) => `Allocation cancelled. ${r.bed_code} is available and ${r.patient_code} is waiting again.`,
  })
  const status = useAction((a: { bedId: number; to: BedStatus }) => api.bedStatus(a.bedId, a.to), {
    success: (r) => `${r.bed_code} is now ${(STATUS_LABEL[r.status] ?? r.status).toLowerCase()}.`,
  })

  /** confirmAllocation(): rule-based confirm, then allocate. */
  async function confirmAllocation(patientId: number, bedId: number, summary: ReactNode, devices: string[], onDone?: (r: Allocation) => void, onConfirmed?: () => void) {
    const ok = await confirm({
      title: 'Confirm allocation',
      message: <>{summary}<br /><br /><span className="muted small">This is a rule-based resource match, not a clinical assessment. The system re-checks bed status, type, features and equipment when you confirm.</span></>,
      confirmLabel: 'Confirm allocation',
    })
    if (!ok) return
    onConfirmed?.()
    allocate.mutate({ patientId, bedId, devices }, { onSuccess: (r) => onDone?.(r) })
  }

  /** releaseFlow(): discharge or transfer out. */
  async function releaseFlow(allocId: number, outcome: 'DISCHARGED' | 'TRANSFERRED', label: string) {
    const toCleaning = settings.data?.release_to_cleaning ?? true
    const ok = await confirm({
      title: outcome === 'TRANSFERRED' ? 'Release for transfer?' : 'Discharge and release bed?',
      message: <>{label || 'This allocation'} will be closed. The bed will move to <strong>{toCleaning ? 'Cleaning' : 'Available'}</strong> and any allocated devices return to Available.</>,
      confirmLabel: outcome === 'TRANSFERRED' ? 'Release for transfer' : 'Discharge & release',
    })
    if (ok) release.mutate({ allocId, outcome })
  }

  async function cancelFlow(allocId: number, label: string) {
    const ok = await confirm({
      title: 'Cancel this allocation?',
      message: <>{label || 'This allocation'} will be cancelled. The bed returns to <strong>Available</strong>, any held devices are freed, and the patient goes back to <strong>Waiting</strong>.</>,
      confirmLabel: 'Cancel allocation',
      danger: true,
    })
    if (ok) cancel.mutate(allocId)
  }

  async function statusFlow(bedId: number, bedCode: string, from: BedStatus, to: BedStatus) {
    const ok = await confirm({
      title: `${TRANSITION_LABEL[to] ?? STATUS_LABEL[to]}: ${bedCode}?`,
      message: <>Change <strong>{bedCode}</strong> from {STATUS_LABEL[from].toLowerCase()} to <strong>{STATUS_LABEL[to].toLowerCase()}</strong>. Counts update everywhere immediately.</>,
      confirmLabel: TRANSITION_LABEL[to] ?? 'Change status',
      danger: to === 'MAINTENANCE',
    })
    if (ok) status.mutate({ bedId, to })
  }

  const busy = allocate.isPending || release.isPending || admit.isPending || cancel.isPending || status.isPending
  return { confirmAllocation, releaseFlow, cancelFlow, statusFlow, admit: (allocId: number) => admit.mutate(allocId), busy, allocating: allocate.isPending }
}
