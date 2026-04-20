/**
 * CI 상태 확인 유틸리티
 *
 * PR의 CI 체크 결과를 조회하고 실패 로그를 수집한다.
 * pr-reviewer holdGate 연동 및 머지 플로우에서 재사용한다.
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { logger } from '@/lib/logger.js'
import { REPO } from './types.js'

const execFileAsync = promisify(execFile)

const TAG = 'CI_CHECK'
const GH_TIMEOUT_MS = 30_000
const MAX_LOG_LENGTH = 2_000
const MAX_BUFFER = 10 * 1024 * 1024 // 10MB

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** gh pr checks --json 결과 항목 */
interface CiCheckRaw {
  name: string
  state: string
  link: string
  description: string
}

/** 파싱된 실패 체크 정보 */
export interface FailedCheck {
  name: string
  link: string
  description: string
}

// ---------------------------------------------------------------------------
// gh CLI 헬퍼
// ---------------------------------------------------------------------------

async function gh(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('gh', args, {
    timeout: GH_TIMEOUT_MS,
    env: { ...process.env, GH_REPO: REPO },
  })
  return stdout.trim()
}

// ---------------------------------------------------------------------------
// CI 체크 조회
// ---------------------------------------------------------------------------

/**
 * PR의 CI 체크 결과를 조회하여 실패한 체크만 반환한다.
 * 조회 실패 시 throw — 호출자가 머지 중단 등 안전 처리를 해야 한다.
 */
export async function fetchFailedChecks(prNumber: number): Promise<FailedCheck[]> {
  const raw = await gh([
    'pr', 'checks', String(prNumber),
    '--json', 'name,state,link,description',
  ])
  if (raw === '') return []

  const checks: CiCheckRaw[] = JSON.parse(raw)
  return checks
    .filter((check) => check.state === 'FAIL')
    .map((check) => ({
      name: check.name,
      link: check.link,
      description: check.description,
    }))
}

// ---------------------------------------------------------------------------
// 실패 로그 수집
// ---------------------------------------------------------------------------

/**
 * CI run link URL에서 run ID를 추출한다.
 * 예: https://github.com/owner/repo/actions/runs/12345678/job/67890 → "12345678"
 */
export function extractRunId(link: string): string | null {
  const match = link.match(/\/actions\/runs\/(\d+)/)
  if (match == null) return null
  return match[1]
}

/**
 * 실패한 CI run의 로그를 수집한다.
 * 로그가 MAX_LOG_LENGTH를 초과하면 마지막 부분만 유지한다 (핵심 에러는 보통 끝에 위치).
 */
export async function fetchFailedRunLog(runId: string): Promise<string> {
  try {
    const { stdout, stderr } = await execFileAsync(
      'gh',
      ['run', 'view', runId, '--log-failed'],
      {
        timeout: GH_TIMEOUT_MS,
        env: { ...process.env, GH_REPO: REPO },
        maxBuffer: MAX_BUFFER,
      },
    )

    const log = stdout.trim() || stderr.trim()
    if (log.length > MAX_LOG_LENGTH) {
      return '... (앞부분 생략)\n' + log.slice(-MAX_LOG_LENGTH)
    }
    return log
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    logger.warn(TAG, `Run ${runId} 로그 수집 실패: ${reason}`)
    return '(로그 수집 실패)'
  }
}
