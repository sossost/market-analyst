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

export type AutoLabel = 'auto:in-progress' | 'auto:done' | 'auto:blocked'

export const AUTO_LABELS: readonly AutoLabel[] = [
  'auto:in-progress',
  'auto:done',
  'auto:blocked',
] as const

export type BranchType = 'fix' | 'feat' | 'refactor' | 'chore'

export type PriorityLabel = 'P0: critical' | 'P1: high' | 'P2: medium' | 'P3: low'

export const PRIORITY_ORDER: Record<PriorityLabel | '__default', number> = {
  'P0: critical': 0,
  'P1: high': 1,
  'P2: medium': 2,
  'P3: low': 3,
  __default: 4,
} as const

export const MAX_ISSUES_PER_CYCLE = 1

// ---------------------------------------------------------------------------
// Discord 양방향 소통 타입
// ---------------------------------------------------------------------------

/** Discord 스레드 정보 */
export interface DiscordThread {
  threadId: string
  name: string
}

/** Discord 메시지 */
export interface DiscordMessage {
  id: string
  content: string
  author: {
    id: string
    username: string
  }
  timestamp: string
}

/** PR ↔ Discord 스레드 매핑 */
export interface PrThreadMapping {
  prNumber: number
  threadId: string
  issueNumber: number
  branchName: string
  /** 다음 스캔 시 중복 처리 방지 */
  lastScannedMessageId?: string
  createdAt: string
}

/** 피드백 처리 결과 */
export interface FeedbackResult {
  success: boolean
  error?: string
}
