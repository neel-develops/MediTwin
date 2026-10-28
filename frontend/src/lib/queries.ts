import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from './api'
import { toast } from '../components/ui/toast'

const LIVE = 15_000

export const keys = {
  meta: ['meta'],
  summary: ['summary'],
  alerts: ['alerts'],
  activity: (n: number) => ['activity', n],
  wards: ['wards'],
  beds: (q: object) => ['beds', q],
  bed: (id: number) => ['bed', id],
  flow: (q: object) => ['flow', q],
  patient: (id: number) => ['patient', id],
  recs: (id: number) => ['recs', id],
  equipment: (q: object) => ['equipment', q],
  settings: ['settings'],
  briefing: ['briefing'],
  plan: ['plan'],
  forecast: (h: number, d: number) => ['forecast', h, d],
  reports: ['reports'],
}

export const useMeta = () => useQuery({ queryKey: keys.meta, queryFn: api.meta, staleTime: 60_000 })
export const useSummary = () => useQuery({ queryKey: keys.summary, queryFn: api.summary, refetchInterval: LIVE })
export const useAlerts = () => useQuery({ queryKey: keys.alerts, queryFn: api.alerts, refetchInterval: LIVE })
export const useActivity = (n = 30) => useQuery({ queryKey: keys.activity(n), queryFn: () => api.activity(n), refetchInterval: LIVE })
export const useWards = () => useQuery({ queryKey: keys.wards, queryFn: api.wards, refetchInterval: LIVE })
export const useBeds = (q: Record<string, string | number | undefined>, enabled = true) =>
  useQuery({ queryKey: keys.beds(q), queryFn: () => api.beds(q), enabled, refetchInterval: LIVE, placeholderData: (prev) => prev })
export const useBed = (id: number | null) => useQuery({ queryKey: keys.bed(id ?? 0), queryFn: () => api.bed(id as number), enabled: id != null })
export const useFlow = (q: Record<string, string | number | undefined>) =>
  useQuery({ queryKey: keys.flow(q), queryFn: () => api.flow(q), refetchInterval: LIVE, placeholderData: (prev) => prev })
export const usePatient = (id: number | null) => useQuery({ queryKey: keys.patient(id ?? 0), queryFn: () => api.patient(id as number), enabled: id != null })
export const useRecs = (id: number | null, enabled = true) =>
  useQuery({ queryKey: keys.recs(id ?? 0), queryFn: () => api.recommendations(id as number), enabled: id != null && enabled, retry: false })
export const useEquipment = (q: Record<string, string | undefined>) =>
  useQuery({ queryKey: keys.equipment(q), queryFn: () => api.equipment(q), refetchInterval: LIVE, placeholderData: (prev) => prev })
export const useSettings = () => useQuery({ queryKey: keys.settings, queryFn: api.settings })
export const useBriefing = () => useQuery({ queryKey: keys.briefing, queryFn: api.briefing, refetchInterval: 30_000 })
export const usePlan = () => useQuery({ queryKey: keys.plan, queryFn: api.plan })
export const useForecast = (h = 24, d = 1) => useQuery({ queryKey: keys.forecast(h, d), queryFn: () => api.forecast(h, d), placeholderData: (prev) => prev })
export const useReports = () => useQuery({ queryKey: keys.reports, queryFn: api.reports })

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message
  if (e instanceof Error) return e.message
  return 'Something went wrong.'
}

/**
 * A mutation that refreshes every query on success (all figures derive from the same stored data,
 * so everything is refetched) and shows a toast with the server's message on failure.
 */
export function useAction<TArgs, TResult>(fn: (args: TArgs) => Promise<TResult>, opts?: {
  success?: string | ((r: TResult, a: TArgs) => string)
  onSuccess?: (r: TResult, a: TArgs) => void
  silentError?: boolean
}) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: async (r, a) => {
      await qc.invalidateQueries()
      if (opts?.success) toast.success(typeof opts.success === 'function' ? opts.success(r, a) : opts.success)
      opts?.onSuccess?.(r, a)
    },
    onError: (e) => {
      if (!opts?.silentError) toast.error(errorMessage(e))
      if (e instanceof ApiError && e.status === 409) qc.invalidateQueries()
    },
  })
}
