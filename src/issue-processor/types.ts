/**
 * 자율 이슈 처리 시스템 — 타입 정의
 */

export interface GitHubIssue {
  number: number
  title: string
  body: string
  labels: string[]
  author: string
}

/** 이슈 처리를 허용할 GitHub 계정 — 프롬프트 인젝션 방지 */
export const ALLOWED_AUTHORS: readonly string[] = ['sossost'] as const

export type AutoLabel = 'auto:in-progress' | 'auto:done'

export const AUTO_LABELS: readonly AutoLabel[] = [
  'auto:in-progress',
  'auto:done',
] as const

export type BranchType = 'fix' | 'feat' | 'refactor' | 'chore'

export const MAX_ISSUES_PER_CYCLE = 1
