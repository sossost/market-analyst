/**
 * 자율 이슈 처리 시스템 — 타입 정의
 */

export type TriageDecision = 'auto' | 'needs-ceo'

export interface TriageResult {
  issueNumber: number
  decision: TriageDecision
  reason: string
  branchType: 'fix' | 'feat' | 'refactor' | 'chore'
}

export interface GitHubIssue {
  number: number
  title: string
  body: string
  labels: string[]
}

export type AutoLabel =
  | 'auto:queued'
  | 'auto:in-progress'
  | 'auto:done'
  | 'auto:needs-ceo'

export const AUTO_LABELS: readonly AutoLabel[] = [
  'auto:queued',
  'auto:in-progress',
  'auto:done',
  'auto:needs-ceo',
] as const

export const MAX_ISSUES_PER_CYCLE = 2
