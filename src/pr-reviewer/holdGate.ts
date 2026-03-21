/**
 * PR Review Hold Gate
 *
 * Strategic Reviewer의 판정(PROCEED | HOLD | REJECT)을 파싱하고,
 * HOLD/REJECT 시 PR을 Draft 전환 + auto:blocked 라벨 부착 + 매핑 제거한다.
 *
 * 각 단계 실패 시 에러 로그 후 다음 단계를 계속 진행한다.
 * 파싱 실패 시 PROCEED로 폴백하여 멀쩡한 PR이 Draft 전환되는 것을 방지한다.
 */

import { execFile } from 'node:child_process'
import { logger } from '@/lib/logger.js'
import { removePrThreadMapping } from '../issue-processor/prThreadStore.js'
import type { StrategicVerdict } from './types.js'

const TAG = 'HOLD_GATE'

const REPO = 'sossost/market-analyst'
const GH_TIMEOUT_MS = 30_000

/** Strategic Reviewer 출력에서 종합 판정을 추출하는 정규식 */
const VERDICT_PATTERN = /^종합:\s*(PROCEED|HOLD|REJECT)/m

/**
 * gh CLI 헬퍼 — Draft 전환 및 라벨 부착용
 */
function ghRun(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      'gh',
      args,
      {
        timeout: GH_TIMEOUT_MS,
        env: { ...process.env, GH_REPO: REPO },
      },
      (error) => {
        if (error != null) {
          reject(error)
          return
        }
        resolve()
      },
    )
  })
}

/**
 * Strategic Reviewer 출력에서 종합 판정을 파싱한다.
 * 파싱 실패 시 null을 반환한다.
 * 호출자는 null이면 PROCEED로 폴백해야 한다.
 */
export function parseStrategicVerdict(output: string): StrategicVerdict | null {
  const match = VERDICT_PATTERN.exec(output)
  if (match == null) return null
  return match[1] as StrategicVerdict
}

/**
 * HOLD/REJECT 판정 시 후처리를 실행한다.
 *
 * 실행 순서:
 * 1. Draft 전환 — gh pr ready {prNumber} --undo
 * 2. auto:blocked 라벨 부착 — gh pr edit {prNumber} --add-label "auto:blocked"
 * 3. prThreadStore 매핑 제거
 *
 * 각 단계 실패 시 에러 로그 후 다음 단계를 계속 진행한다.
 * PROCEED 판정이면 즉시 반환한다.
 */
export async function applyHoldGate(
  prNumber: number,
  verdict: StrategicVerdict,
): Promise<void> {
  if (verdict === 'PROCEED') return

  logger.warn(TAG, `PR #${prNumber} 판정: ${verdict} — Hold Gate 실행`)

  // Step 1: Draft 전환
  try {
    await ghRun(['pr', 'ready', String(prNumber), '--undo'])
    logger.info(TAG, `PR #${prNumber} Draft 전환 완료`)
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    logger.error(TAG, `PR #${prNumber} Draft 전환 실패 (계속 진행): ${reason}`)
  }

  // Step 2: auto:blocked 라벨 부착
  try {
    await ghRun(['pr', 'edit', String(prNumber), '--add-label', 'auto:blocked'])
    logger.info(TAG, `PR #${prNumber} auto:blocked 라벨 부착 완료`)
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    logger.error(TAG, `PR #${prNumber} 라벨 부착 실패 (계속 진행): ${reason}`)
  }

  // Step 3: prThreadStore 매핑 제거
  try {
    removePrThreadMapping(prNumber)
    logger.info(TAG, `PR #${prNumber} 매핑 제거 완료`)
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    logger.error(TAG, `PR #${prNumber} 매핑 제거 실패: ${reason}`)
  }
}
