/* Her assignToBedModal(): waiting patients checked against one bed, with our AI match score. */
import { useQuery } from '@tanstack/react-query'
import { api } from '../../lib/api'
import { errorMessage } from '../../lib/queries'
import type { BedDetail } from '../../lib/types'
import { useUI } from '../../lib/ui'
import { Icon } from '../g/Icon'
import { Modal } from '../g/Modal'
import { Chip, Empty, Loading, Prio, ScoreBadge } from '../g/parts'
import { deviceCodes, useAllocFlows, type Candidate } from './flows'

export function AssignToBedModal({ bed, open, onClose }: { bed: BedDetail; open: boolean; onClose: () => void }) {
  const ui = useUI()
  const flows = useAllocFlows()
  const q = useQuery({ queryKey: ['candidates', bed.id], queryFn: () => api.bedCandidates(bed.id) as Promise<Candidate[]>, enabled: open })
  const cands = q.data ?? []

  const pick = (c: Candidate) => {
    const devices = deviceCodes(c.devices)
    onClose() // her confirm dialog replaces this modal
    void flows.confirmAllocation(c.patient_id, bed.id,
      <>Allocate <strong>{c.patient_code}</strong> to <strong>{bed.bed_code}</strong> ({bed.ward_name}){devices.length ? <> with {devices.join(', ')}</> : null}?</>,
      devices)
  }

  return (
    <Modal open={open} onClose={onClose} title={`Assign patient to ${bed.bed_code}`} wide
      footer={<>
        <button className="btn ghost" onClick={onClose}>Close</button>
        <button className="btn" onClick={() => { onClose(); ui.openRegister() }}><Icon name="plus" />Register patient</button>
      </>}>
      {q.isLoading && <Loading label="Checking waiting patients…" />}
      {q.isError && <Empty icon="alert">{errorMessage(q.error)} <button className="link" onClick={() => q.refetch()}>Try again</button></Empty>}
      {q.isSuccess && (cands.length ? (
        <>
          <p className="muted">Waiting patients checked against <strong>{bed.bed_code}</strong> ({bed.bed_type}{bed.features.length ? `, ${bed.features.join(', ')}` : ''}).</p>
          <div className="cand-list">
            {cands.map((c) => (
              <div key={c.patient_id} className={`cand ${c.eligible ? 'ok' : 'no'}`}>
                <div className="cand-head">
                  <strong>{c.patient_code}</strong> · {c.display_name}
                  {(c.priority === 'URGENT' || c.priority === 'HIGH' || c.priority === 'ROUTINE') && <Prio priority={c.priority} />}
                  <span className="spacer" />
                  {c.eligible ? (
                    <>
                      <ScoreBadge score={Math.round(c.score)} />
                      <button className="btn primary sm" disabled={flows.allocating} onClick={() => pick(c)}>Allocate</button>
                    </>
                  ) : <Chip status="MAINTENANCE" label="Not suitable" />}
                </div>
                <ul className="reasons">
                  {c.matches.map((m) => <li key={`ok-${m}`} className="ok"><Icon name="check" />{m}</li>)}
                  {c.unmet.map((m) => <li key={`no-${m}`} className="no"><Icon name="x" />{m}</li>)}
                </ul>
              </div>
            ))}
          </div>
        </>
      ) : <div className="empty">No patients are waiting for a bed. Register a patient first.</div>)}
    </Modal>
  )
}
