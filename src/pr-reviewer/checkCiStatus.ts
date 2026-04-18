/**
 * CI 상태 확인 및 실패 시 자동 이슈 생성
 *
 * PR reviewer 순회 시 CI 실패를 감지하면:
 * 1. 실패 로그 수집 (gh run view --log-failed)
 * 2. 중복 이슈 확인 (동일 PR에 대한 열린 CI 실패 이슈 존재 여부)
 * 3. 자동 이슈 생성 (bug + P1: high + triaged 라벨)
 *
 * issue processor가 이슈를 픽업하여 해당 PR 브랜치에 수정 커밋을 푸시한다.
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

/** CI 실패 이슈 타이틀 마커 — issue processor에서 감지용 */
export const CI_FAILURE_MARKER = 'CI 실패 —'

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

/** CI 실패 이슈 생성 대상 PR 정보 */
export interface CiCheckPr {
  number: number
  title: string
  headRefName: string
  url: string
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
 * 조회 실패 시 빈 배열 반환 (안전 실패).
 */
export async function fetchFailedChecks(prNumber: number): Promise<FailedCheck[]> {
  try {
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
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    logger.warn(TAG, `PR #${prNumber} CI 체크 조회 실패: ${reason}`)
    return []
  }
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

// ---------------------------------------------------------------------------
// 중복 이슈 확인
// ---------------------------------------------------------------------------

/**
 * 동일 PR에 대한 열린 CI 실패 이슈가 이미 존재하는지 확인한다.
 * 이슈 제목에 "CI 실패 —" 마커와 "(#PR번호)" 패턴으로 매칭.
 *
 * 조회 실패 시 안전하게 true 반환 — 중복 이슈 생성 방지 우선.
 */
export async function hasExistingCiFailureIssue(prNumber: number): Promise<boolean> {
  try {
    const raw = await gh([
      'issue', 'list',
      '--state', 'open',
      '--label', 'bug',
      '--search', `"CI 실패" in:title`,
      '--json', 'number,title',
      '--limit', '50',
    ])
    if (raw === '') return false

    const issues: Array<{ number: number; title: string }> = JSON.parse(raw)
    return issues.some((issue) => issue.title.includes(`(#${prNumber})`))
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    logger.warn(TAG, `PR #${prNumber} CI 실패 이슈 조회 실패 — 안전하게 존재로 처리: ${reason}`)
    return true
  }
}

// ---------------------------------------------------------------------------
// 이슈 생성
// ---------------------------------------------------------------------------

/**
 * XML 태그 이스케이프 — prompt injection 방지.
 * CI 에러 로그에 `</untrusted-issue>` 같은 문자열이 포함될 수 있으므로
 * issue body에 넣기 전에 꺾쇠를 무력화한다.
 */
function sanitizeForXmlBlock(text: string): string {
  return text
    .replaceAll('</', '<\\/')
    .replaceAll('<untrusted', '<\\_untrusted')
    .replaceAll('<triage', '<\\_triage')
}

/**
 * CI 실패 이슈의 본문을 생성한다.
 */
export function buildCiFailureIssueBody(
  pr: CiCheckPr,
  failedChecks: FailedCheck[],
  errorLog: string,
): string {
  const failedChecksSummary = failedChecks
    .map((check) => {
      const desc = sanitizeForXmlBlock(check.description || '(설명 없음)')
      return `- **${sanitizeForXmlBlock(check.name)}**: ${desc}`
    })
    .join('\n')

  return [
    '## CI 실패 자동 감지',
    '',
    `PR #${pr.number}의 CI가 실패했습니다.`,
    '',
    `**PR**: ${pr.url}`,
    `**브랜치**: \`${pr.headRefName}\``,
    '',
    '### 실패 Job',
    '',
    failedChecksSummary,
    '',
    '### 에러 로그',
    '',
    '```',
    sanitizeForXmlBlock(errorLog),
    '```',
    '',
    '### 처리 안내',
    '',
    '이 이슈는 PR reviewer가 자동 생성했습니다.',
    `issue processor가 자동 픽업하여 \`${pr.headRefName}\` 브랜치에 수정 커밋을 푸시합니다.`,
  ].join('\n')
}

/**
 * CI 실패 이슈를 생성한다.
 * 라벨: bug, P1: high, triaged (issue processor가 즉시 픽업 가능하도록)
 *
 * 생성된 이슈 번호를 반환한다. 실패 시 null.
 */
export async function createCiFailureIssue(
  pr: CiCheckPr,
  failedChecks: FailedCheck[],
  errorLog: string,
): Promise<number | null> {
  const title = `fix: ${CI_FAILURE_MARKER} ${pr.title} (#${pr.number})`
  const body = buildCiFailureIssueBody(pr, failedChecks, errorLog)

  try {
    const raw = await gh([
      'issue', 'create',
      '--title', title,
      '--body', body,
      '--label', 'bug,P1: high,triaged',
    ])

    const match = raw.match(/\/issues\/(\d+)/)
    const issueNumber = match != null ? parseInt(match[1], 10) : null

    logger.info(TAG, `CI 실패 이슈 생성 완료: PR #${pr.number} → 이슈 #${issueNumber}`)
    return issueNumber
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    logger.error(TAG, `CI 실패 이슈 생성 실패 (PR #${pr.number}): ${reason}`)
    return null
  }
}

// ---------------------------------------------------------------------------
// 오케스트레이터
// ---------------------------------------------------------------------------

/**
 * 모든 열린 PR의 CI 상태를 확인하고, 실패 시 이슈를 생성한다.
 *
 * 각 PR은 병렬로 확인하며, 개별 실패는 다른 PR 처리를 방해하지 않는다.
 */
export async function checkAllPrCiStatuses(): Promise<void> {
  logger.info(TAG, '▶ CI 상태 확인 시작')

  let raw: string
  try {
    raw = await gh([
      'pr', 'list',
      '--state', 'open',
      '--json', 'number,title,headRefName,url',
      '--limit', '20',
    ])
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    logger.error(TAG, `PR 목록 조회 실패: ${reason}`)
    return
  }

  if (raw === '') {
    logger.info(TAG, '  오픈 PR 없음')
    return
  }

  const prs: CiCheckPr[] = JSON.parse(raw)
  logger.info(TAG, `  ${prs.length}건 PR CI 확인`)

  const results = await Promise.allSettled(
    prs.map(async (pr) => {
      const failedChecks = await fetchFailedChecks(pr.number)
      if (failedChecks.length === 0) return

      logger.warn(TAG, `  PR #${pr.number}: CI 실패 ${failedChecks.length}건`)

      // 중복 이슈 확인
      const exists = await hasExistingCiFailureIssue(pr.number)
      if (exists) {
        logger.info(TAG, `  PR #${pr.number}: CI 실패 이슈 이미 존재 — 스킵`)
        return
      }

      // 실패 로그 수집 (첫 번째 실패 체크의 run ID 사용)
      let errorLog = ''
      const firstRunId = extractRunId(failedChecks[0].link)
      if (firstRunId != null) {
        errorLog = await fetchFailedRunLog(firstRunId)
      }

      await createCiFailureIssue(pr, failedChecks, errorLog)
    }),
  )

  const failCount = results.filter((r) => r.status === 'rejected').length
  if (failCount > 0) {
    logger.warn(TAG, `  ${failCount}건 PR CI 확인 중 에러 발생 (무시)`)
  }

  logger.info(TAG, '✓ CI 상태 확인 완료')
}
