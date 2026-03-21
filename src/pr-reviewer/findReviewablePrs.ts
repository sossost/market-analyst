/**
 * 리뷰 대상 PR 탐색 — gh CLI 기반
 *
 * 다음 조건을 모두 만족하는 PR을 반환한다:
 * 1. 상태 OPEN
 * 2. 이슈 프로세서가 생성한 브랜치 (fix/issue-*, feat/issue-*, ...)
 * 3. 아직 [자동 PR 리뷰] 코멘트가 없는 PR
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { logger } from '@/lib/logger.js'
import {
  ISSUE_BRANCH_PATTERN,
  MAX_PRS_PER_CYCLE,
  REPO,
  REVIEW_MARKER,
  type ReviewablePr,
} from './types.js'

const execFileAsync = promisify(execFile)

const TAG = 'PR_FINDER'

/**
 * gh CLI 실행 헬퍼
 */
async function gh(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('gh', args, {
    timeout: 30_000,
    env: { ...process.env, GH_REPO: REPO },
  })
  return stdout.trim()
}

/**
 * 브랜치명이 이슈 프로세서 생성 패턴과 일치하는지 확인한다.
 */
export function isIssueBranch(headRefName: string): boolean {
  return ISSUE_BRANCH_PATTERN.test(headRefName)
}

/**
 * PR의 코멘트 목록을 조회하여 [자동 PR 리뷰] 마커가 있는지 확인한다.
 * 조회 실패 시 안전하게 true(이미 리뷰됨)를 반환하여 해당 PR을 스킵한다.
 */
export async function hasReviewMarker(prNumber: number): Promise<boolean> {
  try {
    const raw = await gh([
      'pr',
      'view',
      String(prNumber),
      '--json',
      'comments',
    ])

    if (raw === '') return false

    const parsed: { comments: Array<{ body: string }> } = JSON.parse(raw)
    return parsed.comments.some((comment) =>
      comment.body.includes(REVIEW_MARKER),
    )
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    logger.warn(
      TAG,
      `PR #${prNumber} 코멘트 조회 실패 — 안전을 위해 리뷰됨으로 처리: ${reason}`,
    )
    // 조회 실패 시 스킵 (중복 리뷰 방지 우선)
    return true
  }
}

/**
 * PR의 body를 조회한다.
 * 조회 실패 시 빈 문자열 반환.
 */
async function fetchPrBody(prNumber: number): Promise<string> {
  try {
    const raw = await gh([
      'pr',
      'view',
      String(prNumber),
      '--json',
      'body',
    ])
    if (raw === '') return ''
    const parsed: { body: string } = JSON.parse(raw)
    return parsed.body ?? ''
  } catch {
    return ''
  }
}

/**
 * 리뷰 대상 PR 목록을 반환한다.
 * 최대 MAX_PRS_PER_CYCLE건으로 제한.
 */
export async function findReviewablePrs(): Promise<ReviewablePr[]> {
  logger.info(TAG, '오픈 PR 조회 중...')

  let raw: string
  try {
    raw = await gh([
      'pr',
      'list',
      '--state',
      'open',
      '--json',
      'number,title,headRefName,url',
      '--limit',
      '20',
    ])
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    logger.error(TAG, `PR 목록 조회 실패: ${reason}`)
    return []
  }

  if (raw === '') {
    logger.info(TAG, '오픈 PR 없음')
    return []
  }

  const prs: Array<{
    number: number
    title: string
    headRefName: string
    url: string
  }> = JSON.parse(raw)

  logger.info(TAG, `오픈 PR 총 ${prs.length}건 조회됨`)

  // Step 1: 이슈 브랜치 패턴 필터링
  const issuePrs = prs.filter((pr) => isIssueBranch(pr.headRefName))
  logger.info(TAG, `이슈 브랜치 패턴 일치: ${issuePrs.length}건`)

  if (issuePrs.length === 0) return []

  // Step 2: 미리뷰 PR 필터링 (병렬 조회)
  const markerChecks = await Promise.allSettled(
    issuePrs.map((pr) => hasReviewMarker(pr.number)),
  )

  const unreviewed = issuePrs.filter((_, idx) => {
    const result = markerChecks[idx]
    if (result.status === 'rejected') return false
    return !result.value
  })

  logger.info(TAG, `미리뷰 PR: ${unreviewed.length}건`)

  // Step 3: 최대 MAX_PRS_PER_CYCLE건 제한 + body 조회
  const targets = unreviewed.slice(0, MAX_PRS_PER_CYCLE)

  const reviewablePrs = await Promise.all(
    targets.map(async (pr) => {
      const body = await fetchPrBody(pr.number)
      return { ...pr, body }
    }),
  )

  return reviewablePrs
}
