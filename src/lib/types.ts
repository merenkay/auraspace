import type { Context } from '../data/contexts'
import type { FieldId, Status } from '../data/vitals'

export type Role = 'astronaut' | 'surgeon' | 'ground' | 'member'

export type User = {
  id: number
  username: string
  email?: string | null
  role: Role
  name: string
  title: string
  crewId: number | null
  context: Context
}

export type CrewMember = {
  id: number
  name: string
  callsign: string
  position: string
  color: string
  context?: Context
}

export type Measurement = {
  id: number
  crewId: number
  metric: FieldId
  value: number
  day: number
  at: string // ISO timestamp
  source: string // device | manual | live | sim
  device: string
}

export type Task = { id: string; label: string; time: string; done: boolean }

export type ReportSummary = {
  overall: Status
  score: number
  alerts: { title: string; level: Status }[]
  vitals: { label: string; value: string; status: Status }[]
}

export type Report = {
  id: number
  crewId: number
  crewName: string
  day: number
  createdAt: string
  status: 'queued' | 'delivered' | 'reviewed'
  summary: ReportSummary
  reviewNote: string | null
  reviewedBy: string | null
}

export type Mission = {
  name: string
  profileId: string
  day: number
  totalDays: number | null
  environment: string
  context: Context
}

export type CodeTicket = { email: string; expiresIn: number; demoCode?: string }

/** One daily value from a device export (e.g. Samsung Health). `localDate` is the calendar day in the export's time zone. */
export type ImportRow = { metric: FieldId; value: number; localDate: string; at: string }

/** Outcome of an import. Re-importing never duplicates: a day already imported keeps its first value. */
export type ImportResult = {
  added: number
  unchanged: number // same day + metric + device already stored with the same value
  conflicts: number // already stored with a different value; the earlier value was kept (records are append-only)
  rejected: number // failed validation
  measurements: Measurement[] // the rows that were added
}
