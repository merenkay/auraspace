// Types for the offline condition knowledge base used by the AURA consultation engine.
import type { Context } from '../contexts'
import type { SystemId } from '../systems'
import type { FieldId } from '../vitals'

/** How fast the person should act. Ordered from least to most urgent. */
export type Urgency = 'selfcare' | 'soon' | 'urgent' | 'emergency'
export const URGENCY_RANK: Record<Urgency, number> = { selfcare: 0, soon: 1, urgent: 2, emergency: 3 }

export type SourceInfo = { org: string; title: string; url: string }

/** One sourced statement: plain-language text, the verbatim quote, and the source id. */
export type Cited = { t: string; q: string; s: string }
export type MedCaution = Cited & { tags: string[] }
/**
 * `rx`: prescription-only or issued by a clinician (shown as "only if prescribed").
 * `only`: contexts where it may be offered at all (e.g. NASA onboard-kit medicines in space only).
 */
export type MedEvidence = { name: string; purpose: string; q: string; s: string; cautions: MedCaution[]; rx?: boolean; only?: Context[] }

export type EvidenceKind = 'summary' | 'redflag' | 'symptom' | 'action' | 'dont' | 'escalate' | 'monitor' | 'prevention' | 'risk' | 'differential'
export type ConditionEvidence = Partial<Record<EvidenceKind, Cited[]>> & { meds?: MedEvidence[] }

/** A finding (symptom or exposure) that supports a condition. w = 1 (weak) … 3 (strong). */
export type FindingWeight = { id: string; w: 1 | 2 | 3; hallmark?: boolean }

export type ReadingTest = { metric: FieldId; op: '>=' | '<='; value: number }

/**
 * A red-flag combination. Every group in `need` must have at least one finding answered "yes".
 * `reading` (optional) must also be met by a current measurement.
 */
export type Rule = { label: string; need?: string[][]; reading?: ReadingTest[] }

export type AgeBand = 'under-40' | '40-64' | '65-79' | '80+'

export type Factor =
  | { kind: 'reading'; any: ReadingTest[]; w: number; label: string }
  | { kind: 'context'; contexts: Context[]; w: number; label: string }
  | { kind: 'profile'; condition?: string; medicine?: string; age?: AgeBand[]; w: number; label: string }

/** Something that makes the condition less likely: a finding answered `when`, or a current reading. */
export type Against = { finding?: string; when?: 'yes' | 'no'; reading?: ReadingTest; w: number; label: string }

export type ConditionDef = {
  id: string
  name: string
  system: SystemId
  contexts: Context[]
  /** Tier when this is the leading, well-matched candidate and no red-flag rule fired. */
  urgency: Urgency
  findings: FindingWeight[]
  emergencyIf?: Rule[]
  urgentIf?: Rule[]
  factors?: Factor[]
  against?: Against[]
  /** Short line shown in "what this could be". */
  blurb: string
  /**
   * The sourced "what to do" items are self-care (rest, diet, fluids), not first aid: when a red-flag rule makes
   * this an emergency they are not shown as "do this now" (the first step, getting help, is).
   */
  selfCareSteps?: boolean
}

export type Condition = ConditionDef & { ev: ConditionEvidence }
