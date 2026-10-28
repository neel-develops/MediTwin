import type {
  Activity, Alert, Allocation, AssistantReply, Bed, BedDetail, Briefing, Equipment, Flow, Forecast, Meta, Patient,
  PatientDetail, Plan, Recommendations, Reports, SearchResults, Settings, Summary, Surge, UnlockAction, Ward,
} from './types'

export class ApiError extends Error {
  status: number
  code: string
  details: unknown
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message)
    this.status = status
    this.code = code
    this.details = details
  }
}

type Query = Record<string, string | number | boolean | null | undefined>

function qs(q?: Query) {
  if (!q) return ''
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v))
  const s = p.toString()
  return s ? `?${s}` : ''
}

async function request<T>(method: string, path: string, body?: unknown, q?: Query): Promise<T> {
  let res: Response
  try {
    res = await fetch(`/api${path}${qs(q)}`, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new ApiError(0, 'NETWORK', 'Cannot reach the MediTwin server. Check that the backend is running.')
  }
  const text = await res.text()
  let data: unknown = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = null
  }
  if (!res.ok) {
    const e = (data as { error?: { code?: string; message?: string; details?: unknown } } | null)?.error
    throw new ApiError(res.status, e?.code ?? 'HTTP_ERROR', e?.message ?? `Request failed (${res.status}).`, e?.details)
  }
  return data as T
}

const get = <T>(p: string, q?: Query) => request<T>('GET', p, undefined, q)
const post = <T>(p: string, b?: unknown, q?: Query) => request<T>('POST', p, b ?? {}, q)
const patch = <T>(p: string, b: unknown) => request<T>('PATCH', p, b)
const del = <T>(p: string) => request<T>('DELETE', p)

export const api = {
  meta: () => get<Meta>('/meta'),
  summary: () => get<Summary>('/dashboard/summary'),
  alerts: () => get<Alert[]>('/alerts'),
  activity: (limit = 30) => get<Activity[]>('/activity', { limit }),
  search: (q: string) => get<SearchResults>('/search', { q }),
  reports: () => get<Reports>('/reports'),
  surge: (count: number, seed: number) => post<Surge>('/simulate/surge', {}, { count, seed }),

  wards: () => get<Ward[]>('/wards'),
  createWard: (b: unknown) => post<Ward>('/wards', b),
  updateWard: (id: number, b: unknown) => patch<Ward>(`/wards/${id}`, b),
  generateBeds: (id: number, b: unknown) => post<Ward & { added: string[]; removed: string[] }>(`/wards/${id}/generate-beds`, b),
  reductionPreview: (id: number, count: number) => get<{ remove: { bed_code: string; status: string }[]; blocked: string[] }>(`/wards/${id}/reduction-preview`, { count }),

  beds: (q?: Query) => get<Bed[]>('/beds', q),
  bed: (id: number) => get<BedDetail>(`/beds/${id}`),
  bedStatus: (id: number, status: string) => patch<Bed>(`/beds/${id}/status`, { status }),
  bulkBedStatus: (b: { status: string; bed_ids?: number[]; ward_id?: number; from_status?: string }) =>
    post<{ changed: number; skipped: number; bed_codes: string[] }>('/beds/bulk-status', b),
  updateBed: (id: number, b: unknown) => patch<Bed>(`/beds/${id}`, b),
  bedCandidates: (id: number) =>
    get<{ patient_id: number; patient_code: string; display_name: string; priority: string; required_bed_type: string; eligible: boolean; matches: string[]; unmet: string[]; score: number }[]>(`/beds/${id}/candidates`),

  patients: (q?: Query) => get<Patient[]>('/patients', q),
  flow: (q?: Query) => get<Flow>('/patients/flow', q),
  patient: (id: number) => get<PatientDetail>(`/patients/${id}`),
  createPatient: (b: unknown) => post<Patient>('/patients', b),
  updatePatient: (id: number, b: unknown) => patch<Patient>(`/patients/${id}`, b),
  startMatching: (id: number) => post<Patient>(`/patients/${id}/matching`),
  stopMatching: (id: number) => del<Patient>(`/patients/${id}/matching`),

  recommendations: (patient_id: number, limit = 12) => get<Recommendations>('/allocations/recommendations', { patient_id, limit, soft: true }),
  allocations: (q?: Query) => get<Allocation[]>('/allocations', q),
  allocate: (patient_id: number, bed_id: number) => post<Allocation>('/allocations', { patient_id, bed_id }),
  admit: (id: number) => post<{ patient_code: string; bed_code: string }>(`/allocations/${id}/admit`),
  cancel: (id: number) => post<{ patient_code: string; bed_code: string }>(`/allocations/${id}/cancel`),
  release: (id: number, outcome: 'DISCHARGED' | 'TRANSFERRED') =>
    post<{ bed_code: string; bed_status: string; patient_code: string }>(`/allocations/${id}/release`, { outcome }),

  equipment: (q?: Query) => get<Equipment[]>('/equipment', q),
  createEquipment: (b: unknown) => post<Equipment>('/equipment', b),
  updateEquipment: (id: number, b: unknown) => patch<Equipment>(`/equipment/${id}`, b),

  settings: () => get<Settings>('/settings'),
  updateSettings: (b: unknown) => patch<Settings>('/settings', b),
  integrity: () => get<{ ok: boolean; problems: string[] }>('/integrity'),
  seedDemo: () => post<Record<string, number>>('/demo/seed'),
  resetDemo: () => post<Record<string, number>>('/demo/reset'),

  briefing: () => get<Briefing>('/ai/briefing'),
  plan: () => get<Plan>('/ai/plan'),
  applyPlan: (items: { patient_id: number; bed_id: number }[]) =>
    post<{ confirmed: number; failed: number; results: { ok: boolean; patient_code?: string; bed_code?: string; message?: string; patient_id: number }[] }>('/ai/plan/apply', { items }),
  forecast: (hours = 24, demand = 1) => get<Forecast>('/ai/forecast', { hours, demand }),
  unlock: (pid: number) => get<{ patient_id: number; blockers: string[]; unlock: UnlockAction[] }>(`/ai/unlock/${pid}`),
  assistant: (messages: { role: 'user' | 'assistant'; content: string }[]) => post<AssistantReply>('/ai/assistant', { messages }),
}
