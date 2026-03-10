/**
 * 자율 이슈 처리 시스템 — 타입 정의
 */

export interface GitHubIssue {
  number: number
  title: string
  body: string
  labels: string[]
}

export type AutoLabel = 'auto:in-progress' | 'auto:done'

export const AUTO_LABELS: readonly AutoLabel[] = [
  'auto:in-progress',
  'auto:done',
] as const

export type BranchType = 'fix' | 'feat' | 'refactor' | 'chore'

export const MAX_ISSUES_PER_CYCLE = 2
