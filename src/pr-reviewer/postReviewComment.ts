/**
 * GitHub PR 코멘트 작성 — gh CLI 기반
 *
 * 두 리뷰어의 결과를 하나의 PR 코멘트로 합산하여 게시한다.
 * [자동 PR 리뷰] 마커를 포함하여 중복 실행 방지 식별자로 활용한다.
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { logger } from '@/lib/logger.js'
import { REPO, REVIEW_MARKER, type ReviewerOutput } from './types.js'

const execFileAsync = promisify(execFile)

const TAG = 'POST_REVIEW'

/**
 * gh CLI 실행 헬퍼
 */
async function gh(args: string[]): Promise<void> {
  await execFileAsync('gh', args, {
    timeout: 30_000,
    env: { ...process.env, GH_REPO: REPO },
  })
}

/**
 * 리뷰어 출력을 코멘트 섹션 문자열로 포맷한다.
 */
function formatReviewerSection(
  label: string,
  result: ReviewerOutput,
): string {
  if (result.success === false) {
    return `## ${label}\n\n> 리뷰 실패: ${result.error ?? '알 수 없는 오류'}`
  }

  const output = result.output ?? '(출력 없음)'
  return `## ${label}\n\n${output}`
}

/**
 * Strategic + Code 리뷰 결과를 하나의 PR 코멘트로 조합한다.
 */
export function buildReviewComment(
  strategic: ReviewerOutput,
  code: ReviewerOutput,
): string {
  const strategicSection = formatReviewerSection('Strategic Review', strategic)
  const codeSection = formatReviewerSection('Code Review', code)

  const allFailed = strategic.success === false && code.success === false

  const summary = allFailed
    ? '\n\n> ⚠️ Strategic + Code 리뷰 모두 실패했습니다. 수동 리뷰가 필요합니다.'
    : ''

  return [
    `${REVIEW_MARKER}`,
    '',
    strategicSection,
    '',
    '---',
    '',
    codeSection,
    summary,
  ]
    .join('\n')
    .trim()
}

/**
 * PR에 리뷰 코멘트를 게시한다.
 * PR이 머지/클로즈된 경우 에러 로그만 남기고 계속 진행한다.
 */
export async function postReviewComment(
  prNumber: number,
  strategic: ReviewerOutput,
  code: ReviewerOutput,
): Promise<void> {
  const body = buildReviewComment(strategic, code)

  logger.info(TAG, `PR #${prNumber} 코멘트 게시 중...`)

  try {
    await gh([
      'pr',
      'comment',
      String(prNumber),
      '--body',
      body,
    ])
    logger.info(TAG, `PR #${prNumber} 코멘트 게시 완료`)
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    // PR이 리뷰 도중 클로즈/머지되어도 계속 진행
    logger.error(TAG, `PR #${prNumber} 코멘트 게시 실패: ${reason}`)
  }
}
