/**
 * 자동 PR 리뷰 시스템 — 타입 정의
 */

/** 리뷰 대상 PR */
export interface ReviewablePr {
  number: number
  title: string
  headRefName: string
  url: string
  body: string
}

// ---------------------------------------------------------------------------
// Strategic Reviewer
// ---------------------------------------------------------------------------

export type GoalAlignment = 'ALIGNED' | 'SUPPORT' | 'NEUTRAL' | 'MISALIGNED'
export type IssueFulfillment = 'YES' | 'PARTIAL' | 'NO'
export type InvalidityJudgment = 'CLEAR' | 'FLAGGED'
export type StrategicVerdict = 'PROCEED' | 'HOLD' | 'REJECT'

export interface StrategicReviewResult {
  goalAlignment: GoalAlignment
  issueFulfillment: IssueFulfillment
  invalidityJudgment: InvalidityJudgment
  verdict: StrategicVerdict
  rawOutput: string
}

// ---------------------------------------------------------------------------
// Code Reviewer
// ---------------------------------------------------------------------------

export type IssueSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'
export type CodeVerdict = 'PASS' | 'REVIEW_NEEDED' | 'BLOCK'

export interface CodeReviewIssue {
  severity: IssueSeverity
  location: string
  description: string
}

export interface CodeReviewResult {
  issues: CodeReviewIssue[]
  verdict: CodeVerdict
  criticalHighCount: number
  rawOutput: string
}

// ---------------------------------------------------------------------------
// 통합 결과
// ---------------------------------------------------------------------------

export type ReviewerType = 'strategic' | 'code'

export interface ReviewerOutput {
  type: ReviewerType
  prNumber: number
  success: boolean
  output?: string
  error?: string
}

export interface ReviewResult {
  prNumber: number
  strategic: ReviewerOutput
  code: ReviewerOutput
}

/** 한 사이클에서 처리할 최대 PR 수 */
export const MAX_PRS_PER_CYCLE = 2

/** 중복 리뷰 방지 마커 */
export const REVIEW_MARKER = '[자동 PR 리뷰]'

/** GitHub 리포지토리 식별자 */
export const REPO = 'sossost/market-analyst'
