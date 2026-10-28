import { createContext, useContext } from 'react'

export interface UI {
  /** Opens the patient in the Patients page detail panel (the design's flow). */
  openPatient: (id: number) => void
  openAssistant: (prompt?: string) => void
  /** Register-patient modal; after saving, opens the new patient. */
  openRegister: () => void
  openEditPatient: (id: number) => void
}

export const UIContext = createContext<UI>({ openPatient: () => {}, openAssistant: () => {}, openRegister: () => {}, openEditPatient: () => {} })
export const useUI = () => useContext(UIContext)

/** Route titles used by the top bar, document title and breadcrumbs. */
export const ROUTE_TITLES: Record<string, string> = {
  '/': 'Dashboard', '/allocations': 'Bed Allocations', '/beds': 'All beds', '/patients': 'Patients', '/ai': 'AI Allocation',
  '/equipment': 'Equipment', '/alerts': 'Alerts', '/reports': 'Reports', '/setup': 'Setup', '/settings': 'Settings',
}
/** Pages that are not in the rail highlight the section they belong to. */
export const NAV_SECTION: Record<string, string> = { '/beds': '/allocations', '/settings': '/setup' }
