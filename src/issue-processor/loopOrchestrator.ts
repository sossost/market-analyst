/**
 * 1시간 루프 오케스트레이터
 *
 * 매 정시 launchd에 의해 호출된다 (KST 09:00~02:00, 18회/일).
 *
 * Step 1: 미처리 이슈 처리 (기존 로직 + Discord 스레드 생성)
 * Step 2: 열린 PR 피드백/승인 스캔
 * Step 3: 완료된 PR 매핑 정리
 */

import 'dotenv/config'

import { execFile, execSync } from 'node:child_process'
import { logger } from '@/lib/logger'
import { processIssues } from './index.js'
import { fetchThreadMessages } from './discordClient.js'
import { processFeedback, isMergeApproval } from './feedbackProcessor.js'
import { processMerge } from './mergeProcessor.js'
import {
  loadAllMappings,
  removePrThreadMapping,
} from './prThreadStore.js'
import { getAllowedUserIds } from './discordAuth.js'
import type { PrThreadMapping } from './types.js'

const TAG = 'LOOP_ORCHESTRATOR'

const REPO = 'sossost/market-analyst'
const GH_TIMEOUT_MS = 30_000

/**
 * gh CLI 헬퍼 — PR 상태 확인용
 */
function ghCheck(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('gh', args, {
      timeout: GH_TIMEOUT_MS,
      env: { ...process.env, GH_REPO: REPO },
    }, (error, stdout) => {
      if (error != null) {
        reject(error)
        return
      }
      resolve(stdout.trim())
    })
  })
}

/**
 * PR이 MERGED 또는 CLOSED 상태인지 확인한다.
 */
async function isPrDone(prNumber: number): Promise<boolean> {
  try {
    const raw = await ghCheck(['pr', 'view', String(prNumber), '--json', 'state'])
    const data = JSON.parse(raw) as { state: string }
    return data.state === 'MERGED' || data.state === 'CLOSED'
  } catch {
    // 조회 실패 시 false (다음 루프에서 재시도)
    return false
  }
}

/**
 * Step 2: 열린 PR 매핑을 스캔하여 피드백/승인 처리.
 */
async function scanPrFeedbacks(mappings: PrThreadMapping[]): Promise<void> {
  if (mappings.length === 0) {
    logger.info(TAG, 'Step 2: 활성 PR 매핑 없음 — 스킵')
    return
  }

  logger.info(TAG, `Step 2: ${mappings.length}개 PR 스캔 시작`)

  const allowedUserIds = getAllowedUserIds()

  for (const mapping of mappings) {
    try {
      const newMessages = await fetchThreadMessages(
        mapping.threadId,
        mapping.lastScannedMessageId,
      )

      if (newMessages.length === 0) {
        logger.info(TAG, `PR #${mapping.prNumber}: 신규 메시지 없음`)
        continue
      }

      // 허용된 발신자 메시지만 처리
      const allowedMessages = newMessages.filter(
        (msg) => allowedUserIds.length > 0 && allowedUserIds.includes(msg.author.id),
      )

      if (allowedMessages.length === 0) {
        logger.info(TAG, `PR #${mapping.prNumber}: 허용된 발신자 메시지 없음`)
        continue
      }

      // 우선순위: "승인" 메시지가 하나라도 있으면 머지 처리
      const hasApproval = allowedMessages.some((msg) => isMergeApproval(msg.content))

      if (hasApproval) {
        logger.info(TAG, `PR #${mapping.prNumber}: "승인" 감지 → 머지 처리`)
        await processMerge(mapping)
      } else {
        // 일반 피드백 처리
        await processFeedback(mapping, allowedMessages)
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      logger.error(TAG, `PR #${mapping.prNumber} 스캔 실패: ${reason}`)
      // 한 PR 실패 시 다른 PR 계속 처리
    }
  }
}

/**
 * Step 3: 완료된 PR (MERGED/CLOSED) 매핑 정리.
 */
async function cleanupDoneMappings(mappings: PrThreadMapping[]): Promise<void> {
  if (mappings.length === 0) return

  logger.info(TAG, `Step 3: ${mappings.length}개 매핑 정리 확인`)

  for (const mapping of mappings) {
    const done = await isPrDone(mapping.prNumber)
    if (done) {
      removePrThreadMapping(mapping.prNumber)
      logger.info(TAG, `PR #${mapping.prNumber} 완료 — 매핑 삭제`)
    }
  }
}

/**
 * 현재 브랜치가 main이 아니면 main으로 전환한다.
 * issue-processor.sh의 ensure_main_branch와 동일한 역할 — 방어적 이중 가드.
 */
function ensureMainBranch(): void {
  try {
    const currentBranch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf-8' }).trim()
    if (currentBranch !== 'main') {
      logger.warn(TAG, `현재 브랜치: ${currentBranch} → main으로 전환`)
      execSync('git checkout main', { encoding: 'utf-8' })
      execSync('git pull --rebase origin main', { encoding: 'utf-8' })
      logger.info(TAG, 'main 브랜치 전환 + pull 완료')
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    logger.error(TAG, `main 브랜치 전환 실패: ${reason}`)
    throw new Error('main 브랜치 전환 실패 — 루프 중단')
  }
}

/**
 * 1시간 루프 진입점.
 * launchd에 의해 매 정시 호출됨.
 */
export async function runLoop(): Promise<void> {
  logger.info(TAG, '=== 루프 시작 ===')

  // Step 0: main 브랜치 보장
  ensureMainBranch()

  // Step 1: 열린 PR 피드백/승인 스캔 (먼저 처리하여 PR 정리)
  const mappings = loadAllMappings()
  await scanPrFeedbacks(mappings)

  // Step 2: 완료된 PR 매핑 정리
  const updatedMappings = loadAllMappings()
  await cleanupDoneMappings(updatedMappings)

  // Step 3: 열린 PR이 없으면 미처리 이슈 처리
  const activeMappings = loadAllMappings()
  if (activeMappings.length > 0) {
    logger.info(TAG, `Step 3: 열린 PR ${activeMappings.length}개 존재 — 이슈 처리 스킵`)
  } else {
    logger.info(TAG, 'Step 3: 열린 PR 없음 — 미처리 이슈 처리')
    try {
      await processIssues()
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      logger.error(TAG, `Step 3 이슈 처리 실패: ${reason}`)
    }
  }

  logger.info(TAG, '=== 루프 완료 ===')
}

export async function main(): Promise<void> {
  try {
    await runLoop()
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    logger.error(TAG, `루프 오류: ${reason}`)
    process.exit(1)
  }
}

// CLI 직접 실행 시에만 main() 호출
if (process.argv[1]?.includes('loopOrchestrator')) {
  main()
}
