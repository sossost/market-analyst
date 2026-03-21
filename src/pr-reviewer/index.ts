/**
 * 자동 PR 리뷰 시스템 — 오케스트레이터
 *
 * 1. 리뷰 대상 PR 탐색 (findReviewablePrs)
 * 2. Strategic + Code 리뷰 병렬 실행 (runStrategicReviewer, runCodeReviewer)
 * 3. PR 코멘트 게시 (postReviewComment)
 */

import 'dotenv/config'

import { logger } from '@/lib/logger.js'
import { findReviewablePrs } from './findReviewablePrs.js'
import { runStrategicReviewer, runCodeReviewer } from './runReviewer.js'
import { postReviewComment } from './postReviewComment.js'

const TAG = 'PR_REVIEWER'

export async function reviewPrs(): Promise<void> {
  logger.info(TAG, '▶ 리뷰 대상 PR 탐색')
  const prs = await findReviewablePrs()
  logger.info(TAG, `  발견: ${prs.length}건`)

  if (prs.length === 0) {
    logger.info(TAG, '  리뷰할 PR 없음')
    return
  }

  for (const pr of prs) {
    logger.info(TAG, `▶ PR #${pr.number} "${pr.title}" 리뷰 시작`)

    // Strategic + Code 리뷰 병렬 실행
    const [strategicSettled, codeSettled] = await Promise.allSettled([
      runStrategicReviewer(pr),
      runCodeReviewer(pr),
    ])

    const strategic =
      strategicSettled.status === 'fulfilled'
        ? strategicSettled.value
        : {
            type: 'strategic' as const,
            prNumber: pr.number,
            success: false,
            error:
              strategicSettled.reason instanceof Error
                ? strategicSettled.reason.message
                : String(strategicSettled.reason),
          }

    const code =
      codeSettled.status === 'fulfilled'
        ? codeSettled.value
        : {
            type: 'code' as const,
            prNumber: pr.number,
            success: false,
            error:
              codeSettled.reason instanceof Error
                ? codeSettled.reason.message
                : String(codeSettled.reason),
          }

    // PR 코멘트 게시
    await postReviewComment(pr.number, strategic, code)

    if (strategic.success === true && code.success === true) {
      logger.info(TAG, `  ✓ PR #${pr.number} 리뷰 완료`)
    } else if (strategic.success === false && code.success === false) {
      logger.error(TAG, `  ✗ PR #${pr.number} 두 리뷰어 모두 실패`)
    } else {
      logger.warn(TAG, `  ⚠ PR #${pr.number} 부분 리뷰 완료 (일부 실패)`)
    }
  }
}

export async function main(): Promise<void> {
  logger.info(TAG, '=== 자동 PR 리뷰 시스템 시작 ===')

  try {
    await reviewPrs()
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)
    logger.error(TAG, `✗ 오류: ${errorMessage}`)
    process.exit(1)
  }

  logger.info(TAG, '=== 자동 PR 리뷰 시스템 완료 ===')
}

// CLI 직접 실행 시에만 main() 호출
if (process.argv[1]?.endsWith('index.ts') && process.argv[1]?.includes('pr-reviewer')) {
  main()
}
