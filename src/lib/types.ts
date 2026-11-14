import type { FieldId, Status } from '../data/vitals'

export type Role = 'astronaut' | 'surgeon' | 'ground'

export type User = {
  id: number
  username: string
  role: Role
  name: string
  title: string
  crewId: number | null
}

export type CrewMember = {
  id: number
  name: string
  callsign: string
  position: string
  color: string
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

export type Mission = { name: string; profileId: string; day: number; totalDays: number; environment: string }
