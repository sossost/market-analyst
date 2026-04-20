/**
 * 자동 PR 리뷰 시스템 — 오케스트레이터
 *
 * 1. 리뷰 대상 PR 탐색 (findReviewablePrs)
 * 2. Strategic + Code 리뷰 병렬 실행 (runStrategicReviewer, runCodeReviewer)
 * 3. PR 코멘트 게시 (postReviewComment)
 * 4. CI 상태 확인 — 실패 시 강제 HOLD (fetchFailedChecks)
 * 5. Hold Gate 적용 (applyHoldGate)
 */

import 'dotenv/config'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { logger } from '@/lib/logger.js'
import { findReviewablePrs } from './findReviewablePrs.js'
import { runStrategicReviewer, runCodeReviewer } from './runReviewer.js'
import { postReviewComment } from './postReviewComment.js'
import { parseStrategicVerdict, applyHoldGate } from './holdGate.js'
import { fetchFailedChecks } from './checkCiStatus.js'
import { findMappingByPrNumber } from '../issue-processor/prThreadStore.js'
import { sendThreadMessage } from '../issue-processor/discordClient.js'
import { REPO } from './types.js'
import type { StrategicVerdict } from './types.js'

const execFileAsync = promisify(execFile)

const TAG = 'PR_REVIEWER'
const GH_TIMEOUT_MS = 30_000
const CI_BLOCK_COMMENT = '⛔ CI 실패로 인한 블락 — CI가 통과한 후 재심사 가능합니다.'

export async function reviewPrs(): Promise<void> {
  logger.info(TAG, '▶ 리뷰 대상 PR 탐색')
  const prs = await findReviewablePrs()
  logger.info(TAG, `  발견: ${prs.length}건`)

  if (prs.length === 0) {
    logger.info(TAG, '  리뷰할 PR 없음')
    return
  }

  // 모든 PR을 병렬 리뷰 (PR당 Strategic + Code도 병렬)
  // 근거: :30 시작 → 타임아웃 30분 → :00 종료 → 다음 이슈 프로세서(:00)와 맞닿음
  // 순차 실행 시 2건 × 30분 = 60분 → 다음 사이클과 충돌
  await Promise.allSettled(
    prs.map(async (pr) => {
      logger.info(TAG, `▶ PR #${pr.number} "${pr.title}" 리뷰 시작`)

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

      await postReviewComment(pr.number, strategic, code)

      if (strategic.success === true && code.success === true) {
        logger.info(TAG, `  ✓ PR #${pr.number} 리뷰 완료`)
      } else if (strategic.success === false && code.success === false) {
        logger.error(TAG, `  ✗ PR #${pr.number} 두 리뷰어 모두 실패`)
      } else {
        logger.warn(TAG, `  ⚠ PR #${pr.number} 부분 리뷰 완료 (일부 실패)`)
      }

      // Discord PR 스레드에 리뷰 완료 알림 (Hold Gate보다 먼저 — Gate가 매핑을 삭제하므로)
      await notifyDiscordThread(pr.number)

      // CI 상태 확인 후 holdGate 판정
      // CI 실패 시: strategic 판정 무시하고 강제 HOLD
      // CI 통과 시: strategic 판정 기준으로 holdGate 실행
      const verdict = await resolveVerdictWithCiGate(pr.number, strategic)
      await applyHoldGate(pr.number, verdict)
    }),
  )
}

/**
 * CI 상태를 확인하여 최종 holdGate 판정을 결정한다.
 *
 * CI 실패 시:
 * - PR에 CI 블락 코멘트 게시
 * - 강제 HOLD 반환 (strategic 판정 무시)
 *
 * CI 통과 시:
 * - strategic 판정 기준으로 동작 (기존 로직 유지)
 */
async function resolveVerdictWithCiGate(
  prNumber: number,
  strategic: { success: boolean; output?: string },
): Promise<StrategicVerdict> {
  const failedChecks = await fetchFailedChecks(prNumber)

  if (failedChecks.length > 0) {
    logger.warn(TAG, `  PR #${prNumber} CI 실패 ${failedChecks.length}건 — 강제 HOLD`)

    try {
      await execFileAsync(
        'gh',
        ['pr', 'comment', String(prNumber), '--body', CI_BLOCK_COMMENT],
        { timeout: GH_TIMEOUT_MS, env: { ...process.env, GH_REPO: REPO } },
      )
      logger.info(TAG, `  PR #${prNumber} CI 블락 코멘트 게시 완료`)
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      logger.warn(TAG, `  PR #${prNumber} CI 블락 코멘트 게시 실패 (무시): ${reason}`)
    }

    return 'HOLD'
  }

  // CI 통과 — strategic 판정 기준으로 동작
  if (strategic.success === true && strategic.output != null) {
    return parseStrategicVerdict(strategic.output) ?? 'PROCEED'
  }

  return 'PROCEED'
}

/**
 * PR의 Discord 스레드에 리뷰 완료 알림을 보낸다.
 * 스레드 매핑이 없거나 발송 실패 시 로그만 남기고 진행한다.
 */
async function notifyDiscordThread(prNumber: number): Promise<void> {
  try {
    const mapping = findMappingByPrNumber(prNumber)
    if (mapping == null) {
      logger.info(TAG, `  PR #${prNumber} Discord 스레드 매핑 없음 — 알림 스킵`)
      return
    }

    await sendThreadMessage(
      mapping.threadId,
      `🔍 PR #${prNumber} 자동 리뷰 완료 — GitHub PR 코멘트를 확인하세요.`,
    )
    logger.info(TAG, `  Discord 알림 발송: PR #${prNumber}`)
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    logger.warn(TAG, `  Discord 알림 실패 (무시): ${reason}`)
  }
}

export async function main(): Promise<void> {
  logger.info(TAG, '=== 자동 PR 리뷰 시스템 시작 ===')

  try {
    await reviewPrs()
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)
    logger.error(TAG, `✗ 리뷰 오류: ${errorMessage}`)
  }

  logger.info(TAG, '=== 자동 PR 리뷰 시스템 완료 ===')
}

// CLI 직접 실행 시에만 main() 호출
if (process.argv[1]?.endsWith('index.ts') && process.argv[1]?.includes('pr-reviewer')) {
  main()
}
