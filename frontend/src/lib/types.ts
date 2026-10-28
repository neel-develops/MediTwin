export type BedStatus = 'AVAILABLE' | 'OCCUPIED' | 'RESERVED' | 'CLEANING' | 'MAINTENANCE'
export type EquipmentStatus = 'AVAILABLE' | 'IN_USE' | 'RESERVED' | 'MAINTENANCE'
export type PatientStatus = 'WAITING' | 'ALLOCATED' | 'ADMITTED' | 'DISCHARGED' | 'TRANSFERRED'
export type Stage = 'WAITING' | 'MATCHING' | 'ALLOCATED' | 'ADMITTED' | 'CLOSED'
export type Priority = 'URGENT' | 'HIGH' | 'ROUTINE'
export type Severity = 'critical' | 'warning' | 'info' | 'action'

export type Counts = { total: number } & Record<BedStatus, number>

export interface Meta {
  bed_statuses: BedStatus[]
  bed_types: string[]
  bed_features: string[]
  device_types: string[]
  quantity_types: string[]
  equipment_statuses: EquipmentStatus[]
  patient_statuses: PatientStatus[]
  care_categories: string[]
  ward_categories: string[]
  priorities: Priority[]
  flow_stages: Stage[]
  manual_transitions: Record<BedStatus, BedStatus[]>
  hospital_name: string
  ai_engine: 'groq' | 'local'
  ai_model: string | null
}

export interface Ward {
  id: number
  name: string
  category: string
  bed_code_prefix: string
  is_active: boolean
  bed_count: number
  counts: Counts
  occupancy_pct: number
  available_pct: number
  bed_types: string[]
  created_at: string
  updated_at: string
}

export interface Bed {
  id: number
  bed_code: string
  seq_no: number
  ward_id: number
  ward_name: string
  bed_type: string
  status: BedStatus
  features: string[]
  notes: string
  current_patient_id: number | null
  patient_code: string | null
  patient_name: string | null
  created_at: string
  updated_at: string
}

export interface Equipment {
  id: number
  equipment_code: string
  equipment_type: string
  tracking_mode: 'INDIVIDUAL' | 'QUANTITY'
  status: EquipmentStatus
  ward_id: number | null
  ward_name: string
  assigned_bed_id: number | null
  bed_code: string | null
  bed_ward_id: number | null
  quantity_total: number | null
  quantity_available: number | null
  notes: string
  updated_at: string
}

export interface Allocation {
  id: number
  patient_id: number
  patient_code: string | null
  patient_name: string | null
  bed_id: number | null
  bed_code: string
  ward_name: string
  status: 'ACTIVE' | 'RELEASED' | 'CANCELLED'
  assigned_at: string
  admitted_at: string | null
  released_at: string | null
  confirmed_by: string
  equipment_ids: number[]
  outcome: string | null
  source: 'MANUAL' | 'AI_PLAN' | 'SEED'
  match_score: number | null
}

export interface Patient {
  id: number
  patient_code: string
  display_name: string
  care_category: string
  required_bed_type: string
  required_equipment_types: string[]
  required_bed_features: string[]
  priority: Priority
  status: PatientStatus
  stage: Stage
  match_started_at: string | null
  notes: string
  is_demo: boolean
  allocation_id: number | null
  bed_id: number | null
  bed_code: string | null
  bed_ward_id: number | null
  created_at: string
  updated_at: string
  waiting_minutes: number | null
}

export interface PatientDetail extends Patient {
  fit_count: number | null
  allocation: Allocation | null
  bed: Bed | null
  ward_name: string | null
  devices: Equipment[]
  history: Allocation[]
}

export interface BedDetail extends Bed {
  ward_active: boolean
  ward_category: string
  index_in_ward: number
  allocation: Allocation | null
  patient: Patient | null
  devices: Equipment[]
  allowed_transitions: BedStatus[]
}

export interface Factor {
  key: string
  label: string
  points: number
  max: number
  note: string
}

export interface DeviceRef {
  id: number
  equipment_code: string
  equipment_type: string
  ward_id: number | null
  same_ward: boolean
}

export interface Recommendation {
  rank: number
  bed_id: number
  bed_code: string
  bed_type: string
  features: string[]
  ward_id: number
  ward_name: string
  matches: string[]
  devices: DeviceRef[]
  score: number
  factors: Factor[]
}

export interface Recommendations {
  patient_id: number
  patient_code: string
  not_waiting?: boolean
  status?: PatientStatus
  eligible_count: number
  recommendations: Recommendation[]
  rejected_summary: { reason: string; count: number }[]
}

export interface FlowCard {
  id: number
  patient_code: string
  display_name: string
  care_category: string
  priority: Priority
  required_bed_type: string
  required_equipment_types: string[]
  required_bed_features: string[]
  status: PatientStatus
  stage: Stage
  since: string
  minutes: number
  bed_id: number | null
  bed_code: string | null
  ward_id: number | null
  ward_name: string | null
  allocation_id: number | null
  allocation_source: string | null
  fit_count: number | null
}

export interface Flow {
  totals: Record<string, number>
  filtered_counts: Record<string, number>
  stats: {
    longest_minutes: Record<string, number>
    no_fit: Record<string, number>
    urgent_waiting: number
    released_today: number
    total_patients: number
  }
  columns?: Record<string, FlowCard[]>
  stage?: string
  page?: number
  pages?: number
  total?: number
  items?: FlowCard[]
}

export interface DeviceCounts {
  total: number
  AVAILABLE: number
  IN_USE: number
  RESERVED: number
  MAINTENANCE: number
}

export interface Summary {
  hospital_name: string
  beds: Counts
  beds_by_type: ({ bed_type: string } & Counts)[]
  wards: Ward[]
  equipment: {
    devices: DeviceCounts
    by_type: Record<string, DeviceCounts>
    stock: { id: number; equipment_code: string; equipment_type: string; quantity_total: number; quantity_available: number }[]
  }
  patients: Record<PatientStatus, number>
  queue: { waiting: number; urgent: number; placeable_now: number; longest_wait_minutes: number; awaiting_arrival: number }
  flow_24h: { allocations: number; releases: number }
  generated_at: string
}

export interface Alert {
  id: string
  severity: 'critical' | 'warning' | 'info'
  kind: string
  title: string
  detail: string
  ward_id?: number
  patient_id?: number
  equipment_type?: string
}

export interface Activity {
  id: number
  actor_label: string
  action: string
  resource_type: string
  resource_id: number | null
  resource_code: string
  message: string
  created_at: string
}

export interface PlanItem extends Recommendation {
  step: number
  patient_id: number
  patient_code: string
  display_name: string
  priority: Priority
  care_category: string
  required_bed_type: string
  required_equipment_types: string[]
  required_bed_features: string[]
  waiting_minutes: number
  alternatives: number
  reasons: string[]
}

export interface UnlockAction {
  kind: 'BED_STATUS' | 'COMPAT' | 'EQUIPMENT_STATUS' | 'INFO'
  label: string
  detail: string
  bed_id?: number
  bed_code?: string
  to_status?: string
  bed_type?: string
  add_type?: string
  equipment_id?: number
  equipment_code?: string
}

export interface UnplacedPatient {
  patient_id: number
  patient_code: string
  display_name: string
  priority: Priority
  required_bed_type: string
  required_equipment_types: string[]
  required_bed_features: string[]
  waiting_minutes: number
  blockers: string[]
  unlock: UnlockAction[]
}

export interface Plan {
  generated_at: string
  waiting: number
  placed: number
  unplaced: number
  urgent_total: number
  urgent_placed: number
  avg_score: number | null
  baseline_placed: number
  available_beds: number
  items: PlanItem[]
  unplaced_patients: UnplacedPatient[]
  method: string
}

export interface ForecastWard {
  ward_id: number
  name: string
  key: string
  capacity: number
  now_pct: number
  peak_pct: number
  peak_hour: number
  peak_label: string
  peak_time: string
  risk: 'normal' | 'elevated' | 'high' | 'critical'
  discharges_expected: number
}

export interface Forecast {
  simulated: true
  hours: number
  demand_factor: number
  series: ({ hour: number; time: string; label: string; occupied: number; available: number; waiting: number; occupancy_pct: number } & Record<string, number | string>)[]
  wards: ForecastWard[]
  assumptions: string[]
}

export interface InsightAction {
  kind: 'OPEN_PLAN' | 'OPEN_FORECAST' | 'OPEN_EQUIPMENT' | 'MARK_CLEANED' | 'OPEN_BEDS'
  label: string
  bed_ids?: number[]
  type?: string
  status?: string
}

export interface Insight {
  id: string
  severity: Severity
  title: string
  detail: string
  action?: InsightAction
}

export interface Briefing {
  generated_at: string
  headline: string
  insights: Insight[]
  plan: Pick<Plan, 'waiting' | 'placed' | 'unplaced' | 'urgent_total' | 'urgent_placed' | 'avg_score' | 'baseline_placed'>
  forecast_peak: ForecastWard | null
}

export interface Settings {
  low_available_pct: number
  high_occupancy_pct: number
  equipment_min_available: Record<string, number>
  release_to_cleaning: boolean
  cleaning_turnaround_minutes: number
  group_size: number
  hospital_name: string
  bed_type_compat: Record<string, string[]>
}

export interface SearchResults {
  wards: { id: number; name: string; bed_code_prefix: string }[]
  beds: { id: number; bed_code: string; status: BedStatus; ward_id: number; ward_name: string }[]
  equipment: { id: number; equipment_code: string; equipment_type: string; status: EquipmentStatus }[]
  patients: { id: number; patient_code: string; display_name: string; status: PatientStatus }[]
}

export interface Reports {
  wards: Ward[]
  equipment_utilization: ({ type: string; utilization_pct: number } & DeviceCounts)[]
  allocation_history: Allocation[]
  allocations_hourly: { hours_ago: number; count: number }[]
  allocation_sources: Record<string, number>
  avg_match_score: number | null
}

export interface Surge {
  simulated: true
  arrivals: number
  placed: number
  unplaced: number
  by_type: { type: string; requested: number; placed: number }[]
  unplaced_reasons: { reason: string; count: number }[]
  wards_after: { name: string; bed_count: number; available: number; occupancy_pct: number }[]
}

export interface AssistantCard {
  kind: 'ALLOCATION' | 'BED' | 'OPEN_PLAN' | 'OPEN_FORECAST' | 'OPEN_WARD'
  patient_id?: number
  patient_code?: string
  patient_name?: string
  bed_id?: number
  bed_code?: string
  ward_id?: number
  ward_name?: string
  score?: number
  devices?: string[]
  reasons?: string[]
  placed?: number
  waiting?: number
}

export interface AssistantReply {
  reply: string
  cards: AssistantCard[]
  engine: 'groq' | 'local'
  suggestions: string[]
  notice?: string
  tools_used?: string[]
}
