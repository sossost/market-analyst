/**
 * "승인" 감지 → PR 자동 머지 처리
 *
 * CEO가 Discord 스레드에 "승인"을 작성하면:
 * 1. PR 상태 확인 (OPEN인지)
 * 2. squash merge 실행
 * 3. 로컬 브랜치 정리
 * 4. 스레드에 완료 알림
 * 5. PR 매핑 삭제
 */

import { execFile } from 'node:child_process'
import { logger } from '@/lib/logger'
import type { PrThreadMapping } from './types.js'
import { sendThreadMessage } from './discordClient.js'
import { removePrThreadMapping } from './prThreadStore.js'

const TAG = 'MERGE_PROCESSOR'
const GH_TIMEOUT_MS = 60_000
const GIT_TIMEOUT_MS = 30_000

const REPO = 'sossost/market-analyst'

/**
 * execFile을 Promise로 래핑하는 내부 헬퍼.
 * promisify를 사용하지 않아 테스트에서 execFile 모킹이 직접 작동한다.
 */
function execFileP(
  command: string,
  args: string[],
  options: { timeout: number; env?: NodeJS.ProcessEnv; cwd?: string },
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, args, options, (error, stdout) => {
      if (error != null) {
        reject(error)
        return
      }
      resolve(stdout.trim())
    })
  })
}

/**
 * gh CLI 실행 헬퍼
 */
async function gh(args: string[]): Promise<string> {
  return execFileP('gh', args, {
    timeout: GH_TIMEOUT_MS,
    env: { ...process.env, GH_REPO: REPO },
  })
}

/**
 * git CLI 실행 헬퍼
 */
async function git(args: string[]): Promise<string> {
  return execFileP('git', args, {
    timeout: GIT_TIMEOUT_MS,
    cwd: process.cwd(),
  })
}

/**
 * PR 상태를 조회한다.
 */
type PrState = 'OPEN' | 'CLOSED' | 'MERGED'

async function fetchPrState(prNumber: number): Promise<PrState> {
  const raw = await gh([
    'pr',
    'view',
    String(prNumber),
    '--json',
    'state',
  ])
  const data = JSON.parse(raw) as { state: string }
  return data.state as PrState
}

/**
 * 로컬 브랜치가 존재하는지 확인하고 삭제한다.
 * 브랜치가 없거나 정리 실패 시 조용히 스킵.
 */
async function deleteLocalBranchIfExists(branchName: string): Promise<void> {
  try {
    await git(['checkout', 'main'])
    await git(['pull', '--rebase', 'origin', 'main'])

    const localBranches = await git(['branch'])
    const branchExists = localBranches
      .split('\n')
      .some((b) => b.trim().replace(/^\*\s*/, '') === branchName)

    if (!branchExists) {
      logger.info(TAG, `로컬 브랜치 없음: ${branchName} — 스킵`)
      return
    }

    await git(['branch', '-d', branchName])
    logger.info(TAG, `로컬 브랜치 삭제: ${branchName}`)
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    logger.warn(TAG, `로컬 브랜치 정리 실패 (계속 진행): ${reason}`)
  }
}

/**
 * "승인" 감지 시 PR을 squash merge한다.
 *
 * @param mapping — PR ↔ Discord 스레드 매핑
 */
export async function processMerge(mapping: PrThreadMapping): Promise<void> {
  const { prNumber, threadId, branchName } = mapping

  logger.info(TAG, `PR #${prNumber} 머지 요청 처리 시작`)

  // 1. PR 상태 확인
  let prState: PrState
  try {
    prState = await fetchPrState(prNumber)
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    logger.error(TAG, `PR #${prNumber} 상태 조회 실패: ${reason}`)
    await sendThreadMessage(
      threadId,
      `머지 처리 실패: PR 상태를 조회할 수 없습니다. (${reason.slice(0, 200)})`,
    )
    return
  }

  if (prState !== 'OPEN') {
    logger.info(TAG, `PR #${prNumber} 이미 ${prState} 상태 — 머지 스킵`)
    await sendThreadMessage(
      threadId,
      `PR #${prNumber}는 이미 ${prState} 상태입니다. 머지를 스킵합니다.`,
    )
    // MERGED/CLOSED면 매핑 정리
    removePrThreadMapping(prNumber)
    return
  }

  // 2. Squash merge 실행
  try {
    await gh(['pr', 'merge', String(prNumber), '--squash', '--delete-branch'])
    logger.info(TAG, `PR #${prNumber} squash merge 완료`)
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    logger.error(TAG, `PR #${prNumber} 머지 실패: ${reason}`)
    await sendThreadMessage(
      threadId,
      `머지 실패: ${reason.slice(0, 300)}\n수동 처리가 필요합니다.`,
    )
    return
  }

  // 3. 로컬 브랜치 정리
  await deleteLocalBranchIfExists(branchName)

  // 4. 스레드에 완료 알림
  try {
    await sendThreadMessage(
      threadId,
      `PR #${prNumber}이 머지되었습니다. 이 스레드는 종료됩니다.`,
    )
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    logger.warn(TAG, `완료 알림 발송 실패 (머지는 완료): ${reason}`)
  }

  // 5. 매핑 삭제
  removePrThreadMapping(prNumber)
  logger.info(TAG, `PR #${prNumber} 처리 완료 — 매핑 삭제`)
}
