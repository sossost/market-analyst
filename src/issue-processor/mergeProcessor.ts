/**
 * "승인" 감지 → PR 리뷰 확인 → 반영 → 머지
 *
 * CEO가 Discord 스레드에 "승인"을 작성하면:
 * 1. PR 상태 확인 (OPEN인지)
 * 2. PR 리뷰 코멘트 확인 (Gemini 등 외부 리뷰어)
 * 3. 타당한 리뷰 있으면 Claude Code CLI로 반영 → 푸시
 * 4. squash merge 실행
 * 4.5. git checkout main && git pull (최신 코드 확보)
 * 4.6. post-merge 인프라 반영 (DB 마이그레이션, launchd 재로드)
 * 5. 로컬 브랜치 정리
 * 6. 스레드에 완료 알림
 * 7. PR 매핑 삭제
 */

import { execFile } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { logger } from '@/lib/logger'
import type { PrThreadMapping } from './types.js'
import { sendThreadMessage } from './discordClient.js'
import { removePrThreadMapping } from './prThreadStore.js'
import { fetchFailedChecks, fetchFailedRunLog, extractRunId } from '../pr-reviewer/checkCiStatus.js'
import { buildSandboxedEnv, classifyCliError } from './cliUtils.js'

const TAG = 'MERGE_PROCESSOR'
const GH_TIMEOUT_MS = 60_000
const GIT_TIMEOUT_MS = 30_000
const DB_PUSH_TIMEOUT_MS = 120_000
const LAUNCHD_TIMEOUT_MS = 30_000
const CI_FIX_CLI_TIMEOUT_MS = 15 * 60 * 1_000 // 15분
const CI_WAIT_MAX_MS = 10 * 60 * 1_000 // 10분
const CI_POLL_INTERVAL_MS = 30_000 // 30초
const MAX_BUFFER = 50 * 1024 * 1024 // 50MB

const DB_SCHEMA_PATTERNS = ['src/db/schema/', 'db/migrations/']
const LAUNCHD_PATTERN = 'scripts/launchd/'
const SELF_LABEL = 'com.market-analyst.issue-processor'
const LAUNCH_AGENTS_DIR = `${process.env.HOME}/Library/LaunchAgents`

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
    execFile(command, args, options, (error, stdout, stderr) => {
      if (error != null) {
        const detail = stderr?.trim()
        if (detail) {
          error.message = `${error.message}\n${detail}`
        }
        reject(error)
        return
      }
      resolve(stdout.trim())
    })
  })
}

/**
 * execFile을 Promise로 래핑하되, 성공 시 stdout과 stderr 모두 반환.
 * exit code 0이어도 stderr를 검사해야 하는 경우(DB 마이그레이션 등)에 사용.
 */
function execFileDetailed(
  command: string,
  args: string[],
  options: { timeout: number; env?: NodeJS.ProcessEnv; cwd?: string },
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(command, args, options, (error, stdout, stderr) => {
      if (error != null) {
        const detail = stderr?.trim()
        if (detail) {
          error.message = `${error.message}\n${detail}`
        }
        reject(error)
        return
      }
      resolve({ stdout: stdout.trim(), stderr: stderr.trim() })
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
 * PR 머지 후 변경된 파일 목록을 조회한다.
 * 조회 실패 시 null 반환.
 */
async function fetchMergedFiles(prNumber: number): Promise<string[] | null> {
  try {
    const raw = await gh(['pr', 'view', String(prNumber), '--json', 'files'])
    const data = JSON.parse(raw) as { files: Array<{ path: string }> }
    return data.files.map(f => f.path)
  } catch {
    return null
  }
}

const DB_OUTPUT_ERROR_PATTERN = /error:/i

/**
 * DB 마이그레이션을 적용한다 (yarn db:push --force).
 * exit code 0이어도 stdout/stderr에 `error:` 패턴이 있으면 실패로 처리한다.
 * 실패 시 throw — 호출자(runPostMergeInfra → processMerge)에서 처리.
 */
async function applyDbMigration(threadId: string): Promise<void> {
  await sendThreadMessage(threadId, '🗄️ DB 스키마 변경 감지 — drizzle-kit push 실행 중...')
  const { stdout, stderr } = await execFileDetailed('yarn', ['db:push', '--force'], {
    timeout: DB_PUSH_TIMEOUT_MS,
    cwd: process.cwd(),
  })

  const stdoutHasError = DB_OUTPUT_ERROR_PATTERN.test(stdout)
  const stderrHasError = DB_OUTPUT_ERROR_PATTERN.test(stderr)

  if (stdoutHasError || stderrHasError) {
    const detail = stderrHasError ? stderr : stdout
    throw new Error(`DB push exited 0 but output contains error: ${detail.slice(0, 300)}`)
  }

  logger.info(TAG, 'DB 마이그레이션 완료')
  await sendThreadMessage(threadId, '✅ DB 마이그레이션 완료')
}

/**
 * 개별 plist를 재로드한다 (unload → sed → load).
 * 자기 자신(issue-processor)은 스킵 — unload하면 이 프로세스가 죽는다.
 */
async function reloadPlist(plistFile: string): Promise<{ label: string; skipped: boolean }> {
  const label = plistFile.replace('.plist', '').replace('scripts/launchd/', '')
  const srcPath = `${process.cwd()}/${plistFile}`
  const targetPath = `${LAUNCH_AGENTS_DIR}/${label}.plist`

  if (label === SELF_LABEL) {
    logger.warn(TAG, `${label}: 자기 자신 — 재로드 스킵 (다음 수동 reload 필요)`)
    return { label, skipped: true }
  }

  // unload 기존 (없으면 무시)
  try {
    await execFileP('launchctl', ['unload', targetPath], { timeout: LAUNCHD_TIMEOUT_MS })
  } catch {
    // 이미 unload 상태면 무시
  }

  // 플레이스홀더 치환 후 복사 (Node.js native — 경로 특수문자 안전)
  const projectDir = process.cwd()
  const template = await readFile(srcPath, 'utf-8')
  const content = template.replace(/__PROJECT_DIR__/g, projectDir)
  await writeFile(targetPath, content, 'utf-8')

  // load
  await execFileP('launchctl', ['load', targetPath], { timeout: LAUNCHD_TIMEOUT_MS })
  return { label, skipped: false }
}

/**
 * 변경된 plist 파일만 개별 재로드한다.
 * setup-launchd.sh 전체 호출 대신 개별 처리 — 자기 자신(issue-processor) unload 방지.
 * 실패 시 스레드에 에러 알림 후 조용히 종료 — processMerge 흐름을 막지 않는다.
 */
async function reloadLaunchd(changedPlists: string[], threadId: string): Promise<void> {
  try {
    await sendThreadMessage(threadId, `⚙️ plist 변경 감지 (${changedPlists.length}개) — 개별 재로드 중...`)

    const results: string[] = []
    for (const plistFile of changedPlists) {
      const { label, skipped } = await reloadPlist(plistFile)
      if (skipped) {
        results.push(`⏭️ ${label} (자기 자신 — 스킵)`)
      } else {
        results.push(`✓ ${label}`)
        logger.info(TAG, `${label} 재로드 완료`)
      }
    }

    await sendThreadMessage(threadId, `✅ launchd 재로드 완료\n${results.join('\n')}`)
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    logger.error(TAG, `launchd 재로드 실패: ${reason}`)
    await sendThreadMessage(threadId, `❌ launchd 재로드 실패: ${reason.slice(0, 300)}`)
  }
}

/**
 * PR 머지 후 인프라 반영이 필요한지 판단하고 실행한다.
 * - DB 스키마/마이그레이션 파일 포함 → applyDbMigration
 * - launchd plist 파일 포함 → reloadLaunchd (개별 plist만, 자기 자신 제외)
 * - 해당 없으면 스킵
 */
async function runPostMergeInfra(prNumber: number, threadId: string): Promise<void> {
  const files = await fetchMergedFiles(prNumber)
  if (files == null) {
    logger.warn(TAG, `PR #${prNumber} 변경 파일 조회 실패 — 인프라 반영 스킵`)
    return
  }
  if (files.length === 0) {
    logger.info(TAG, `PR #${prNumber}: 변경 파일 없음 — 인프라 반영 스킵`)
    return
  }

  const needsDbMigration = files.some(
    f => DB_SCHEMA_PATTERNS.some(pattern => f.startsWith(pattern))
  )
  const changedPlists = files.filter(
    f => f.startsWith(LAUNCHD_PATTERN) && f.endsWith('.plist')
  )

  if (!needsDbMigration && changedPlists.length === 0) {
    logger.info(TAG, `PR #${prNumber}: 인프라 반영 대상 없음 — 스킵`)
    return
  }

  if (needsDbMigration) {
    await applyDbMigration(threadId)
  }
  if (changedPlists.length > 0) {
    await reloadLaunchd(changedPlists, threadId)
  }
}

/**
 * 로컬 main 브랜치를 최신 상태로 동기화한다.
 * squash merge 후, runPostMergeInfra 전에 호출해야 최신 스키마로 DB push가 실행된다.
 */
async function checkoutAndPullMain(): Promise<void> {
  await git(['checkout', 'main'])
  await git(['fetch', 'origin', 'main'])
  await git(['reset', '--hard', 'origin/main'])
}

/**
 * 로컬 브랜치가 존재하는지 확인하고 삭제한다.
 * checkoutAndPullMain이 이미 호출된 상태에서 사용한다.
 * 브랜치가 없거나 정리 실패 시 조용히 스킵.
 */
async function deleteLocalBranchIfExists(branchName: string): Promise<void> {
  try {
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

// ---------------------------------------------------------------------------
// PR 리뷰 코멘트 확인 + Claude Code CLI 반영
// ---------------------------------------------------------------------------

const REVIEW_CLI_TIMEOUT_MS = 30 * 60 * 1_000 // 30분

interface ReviewComment {
  body: string
  path: string
  author: { login: string }
  state: string
}

/**
 * PR 리뷰 코멘트를 조회한다.
 * PENDING/COMMENTED 상태의 미해결 코멘트만 반환.
 */
async function fetchReviewComments(prNumber: number): Promise<ReviewComment[]> {
  try {
    const raw = await gh([
      'api',
      `repos/${REPO}/pulls/${prNumber}/comments`,
      '--jq',
      '.[] | {body, path, author: {login: .user.login}, state}',
    ])

    if (raw === '') return []

    // gh api --jq는 각 줄에 JSON 객체를 출력
    return raw
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => JSON.parse(line) as ReviewComment)
  } catch {
    // 리뷰 조회 실패 시 빈 배열 (리뷰 없는 것으로 처리)
    return []
  }
}

/**
 * PR 리뷰 요약을 조회한다 (CHANGES_REQUESTED 등).
 */
async function hasChangesRequested(prNumber: number): Promise<{ requested: boolean; reviewers: string[] }> {
  try {
    const raw = await gh([
      'pr', 'view', String(prNumber),
      '--json', 'reviews',
    ])
    const data = JSON.parse(raw) as {
      reviews: Array<{ state: string; author: { login: string }; body: string }>
    }

    const changeRequests = data.reviews.filter((r) => r.state === 'CHANGES_REQUESTED')
    return {
      requested: changeRequests.length > 0,
      reviewers: changeRequests.map((r) => r.author.login),
    }
  } catch {
    return { requested: false, reviewers: [] }
  }
}

/**
 * Claude Code CLI로 리뷰 코멘트를 반영한다.
 */
async function applyReviewFeedback(
  branchName: string,
  prNumber: number,
  comments: ReviewComment[],
): Promise<void> {
  const commentsSummary = comments
    .map((c) => `[${c.author.login}] ${c.path}: ${c.body}`)
    .join('\n\n')

  const prompt = `## 미션

PR #${prNumber}에 달린 코드 리뷰 코멘트를 검토하고 타당한 것을 반영하라.

## 리뷰 코멘트

${commentsSummary}

## 실행 순서

1. \`git checkout ${branchName}\` 브랜치로 전환
2. 각 리뷰 코멘트를 검토:
   - 타당한 지적 (버그, 보안, 로직 오류) → 수정 반영
   - 스타일/취향 수준의 제안 → 스킵 가능
   - 잘못된 지적 → 스킵
3. 수정사항이 있으면 테스트 통과 확인
4. 커밋 (메시지: "fix: 리뷰 코멘트 반영")
5. \`git push origin ${branchName}\`
6. 각 리뷰 코멘트에 대해 PR에 리플라이를 달아라:
   - 반영한 코멘트: "반영 완료 — {커밋 해시}" 형태로 리플라이
   - 스킵한 코멘트: 스킵 사유를 간단히 리플라이
   - \`gh api repos/${REPO}/pulls/${prNumber}/comments/{comment_id}/replies -f body="..."\` 사용
7. \`git checkout main\`으로 복귀

## 규칙
- 타당성을 판단하여 반영. 모든 코멘트를 무조건 수용하지 마라.
- 테스트가 깨지면 커밋하지 마라.
- PR 반영 완료 후 반드시 \`git checkout main\`으로 복귀하라`

  const args = [
    '--print',
    '--dangerously-skip-permissions',
    '--output-format', 'text',
  ]

  const env = { ...process.env }
  delete env.ANTHROPIC_API_KEY
  delete env.DISCORD_BOT_TOKEN
  delete env.DISCORD_PR_CHANNEL_ID
  delete env.DISCORD_WEBHOOK_URL
  delete env.DISCORD_WEEKLY_WEBHOOK_URL
  delete env.DISCORD_ERROR_WEBHOOK_URL
  delete env.DISCORD_DEBATE_WEBHOOK_URL
  delete env.DISCORD_SYSTEM_REPORT_WEBHOOK_URL
  delete env.DISCORD_STOCK_REPORT_WEBHOOK_URL

  await new Promise<void>((resolve, reject) => {
    const child = execFile(
      'claude',
      args,
      {
        timeout: REVIEW_CLI_TIMEOUT_MS,
        maxBuffer: MAX_BUFFER,
        env,
        cwd: process.cwd(),
      },
      (error, _stdout, stderr) => {
        if (error != null) {
          // execFile의 error.message는 "Command failed: ..."만 포함.
          // 실제 원인(인증 만료, PATH 문제 등)은 stderr에 있으므로 병합.
          const detail = stderr?.trim()
          if (detail) {
            error.message = `${error.message}\n${detail}`
          }
          reject(error)
          return
        }
        resolve()
      },
    )
    child.stdin?.end(prompt, 'utf-8')
  })
}

// ---------------------------------------------------------------------------
// CI 게이트 — 머지 전 CI 상태 확인 + 1사이클 수정
// ---------------------------------------------------------------------------

/**
 * 브랜치의 CI를 수정하고 푸시한다.
 * buildCiFixPrompt 로직을 이슈 객체 없이 직접 구현한다.
 * 성공 시 true, 실패 시 false 반환.
 */
async function fixCiBranchInPlace(
  branchName: string,
  errorLog: string,
  prNumber: number,
): Promise<boolean> {
  // 프롬프트 인젝션 방지: 에러 로그에서 프롬프트 구조를 탈출할 수 있는 패턴 이스케이프
  const sanitizedLog = errorLog
    .replace(/```/g, '` ` `')
    .replace(/<\/?[a-zA-Z-]+>/g, (match) => match.replace(/</g, '&lt;').replace(/>/g, '&gt;'))

  const prompt = `## 미션

CI 실패를 수정하라. 아래 에러 로그를 분석하고 해당 브랜치에 수정 커밋을 푸시하라.

## 에러 로그

\`\`\`
${sanitizedLog}
\`\`\`

## 실행 순서

1. \`git fetch origin ${branchName} && git checkout -B ${branchName} origin/${branchName}\`
   - 기존 PR 브랜치를 체크아웃한다. 새 브랜치를 생성하지 마라.
2. 에러 로그를 분석하여 실패 원인을 파악하라.
3. 실패 원인을 수정하라:
   - 테스트 실패: 코드 버그 수정 또는 테스트 수정
   - 타입 에러: TypeScript 타입 오류 수정
   - 빌드 에러: 빌드 설정 또는 코드 수정
4. 테스트가 통과하는지 확인 (커버리지 80%+)
5. 변경사항 커밋:
   - 메시지: \`fix: CI 실패 수정 — PR #${prNumber}\`
   - **docs/features/ 파일은 커밋하지 마라**
6. \`git push origin ${branchName}\`
   - CI가 자동으로 재실행된다.
7. **반드시** \`git checkout main\`을 실행하여 main 브랜치로 복귀하라.

## 규칙
- 새 브랜치를 생성하지 마라 — 기존 PR 브랜치에 직접 커밋하라
- 새 PR을 생성하지 마라 — 기존 PR에 커밋이 추가되면 CI가 자동 재실행된다
- main 브랜치에 직접 커밋하지 마라
- 테스트 커버리지 80% 이상 유지
- 작업 완료 후 반드시 \`git checkout main\`으로 복귀하라

## 금지 사항 (절대 위반 불가)
- Discord API를 직접 호출하지 마라 (fetch, curl 등으로 discord.com 접근 금지)
- src/issue-processor/ 디렉토리의 코드를 직접 실행하지 마라 (npx tsx, node 등)
- 테스트 데이터로 외부 API를 호출하지 마라
- 임시 파일을 프로젝트 루트에 생성하지 마라`

  const args = [
    '--print',
    '--dangerously-skip-permissions',
    '--output-format', 'text',
  ]

  try {
    await new Promise<void>((resolve, reject) => {
      const child = execFile(
        'claude',
        args,
        {
          timeout: CI_FIX_CLI_TIMEOUT_MS,
          maxBuffer: MAX_BUFFER,
          env: buildSandboxedEnv(),
          cwd: process.cwd(),
        },
        (error, _stdout, stderr) => {
          if (error != null) {
            const classified = classifyCliError(error, stderr ?? '', CI_FIX_CLI_TIMEOUT_MS)
            reject(new Error(classified))
            return
          }
          resolve()
        },
      )
      child.stdin?.end(prompt, 'utf-8')
    })
    return true
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    logger.error(TAG, `CI 수정 CLI 실패: ${reason}`)
    return false
  }
}

/**
 * CI가 통과할 때까지 폴링한다.
 * 빈 배열 반환 시 CI 통과로 판단.
 * 타임아웃 시 false 반환.
 */
async function waitForCiPass(
  prNumber: number,
  maxWaitMs: number = CI_WAIT_MAX_MS,
  intervalMs: number = CI_POLL_INTERVAL_MS,
): Promise<boolean> {
  const startTime = Date.now()

  while (Date.now() - startTime < maxWaitMs) {
    await new Promise<void>((resolve) => setTimeout(resolve, intervalMs))

    const failedChecks = await fetchFailedChecks(prNumber)
    if (failedChecks.length === 0) {
      return true
    }

    const elapsed = Math.round((Date.now() - startTime) / 1_000)
    logger.info(TAG, `PR #${prNumber} CI 대기 중 (${elapsed}s 경과, 실패 ${failedChecks.length}건)`)
  }

  return false
}

/**
 * PR 리뷰 코멘트를 확인하고 타당한 것을 반영한다.
 * 리뷰가 없으면 바로 true 반환 (머지 진행).
 * 반영 성공 시 true, 실패 시 false.
 */
async function resolveReviewComments(mapping: PrThreadMapping): Promise<boolean> {
  const { prNumber, threadId, branchName } = mapping

  // 리뷰 코멘트 확인
  const comments = await fetchReviewComments(prNumber)
  const { requested, reviewers } = await hasChangesRequested(prNumber)

  if (comments.length === 0 && !requested) {
    logger.info(TAG, `PR #${prNumber}: 리뷰 코멘트 없음 — 바로 머지 진행`)
    return true
  }

  const reviewInfo = requested
    ? `변경 요청 리뷰어: ${reviewers.join(', ')}, 코멘트 ${comments.length}개`
    : `코멘트 ${comments.length}개`

  logger.info(TAG, `PR #${prNumber}: 리뷰 발견 (${reviewInfo}) — Claude Code로 반영 시작`)
  await sendThreadMessage(
    threadId,
    `📝 PR 리뷰 발견 (${reviewInfo})\n리뷰 코멘트를 검토하고 반영 중...`,
  )

  try {
    await applyReviewFeedback(branchName, prNumber, comments)
    logger.info(TAG, `PR #${prNumber}: 리뷰 반영 완료`)
    await sendThreadMessage(threadId, `✅ 리뷰 코멘트 반영 완료 — 머지 진행합니다.`)
    return true
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    logger.error(TAG, `PR #${prNumber}: 리뷰 반영 실패: ${reason}`)
    await sendThreadMessage(
      threadId,
      `❌ 리뷰 반영 실패: ${reason.slice(0, 300)}\n수동 확인이 필요합니다.`,
    )
    return false
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

  // 2. PR 리뷰 코멘트 확인 + 반영
  try {
    const reviewResolved = await resolveReviewComments(mapping)
    if (!reviewResolved) {
      return // 리뷰 반영 실패 시 머지 중단 (스레드에 이미 알림됨)
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    logger.error(TAG, `PR #${prNumber} 리뷰 처리 실패: ${reason}`)
    await sendThreadMessage(
      threadId,
      `리뷰 반영 중 오류 발생: ${reason.slice(0, 300)}\n수동 확인이 필요합니다.`,
    )
    return
  }

  // 2.5. CI 게이트: CI 실패 시 수정 시도 후 재트리거 대기
  try {
    const failedChecks = await fetchFailedChecks(prNumber)

    if (failedChecks.length > 0) {
      logger.warn(TAG, `PR #${prNumber} CI 실패 ${failedChecks.length}건 감지 — 수정 시도`)
      await sendThreadMessage(
        threadId,
        `⚠️ CI 실패 감지 (${failedChecks.length}건) — 자동 수정을 시도합니다. 최대 15분 소요.`,
      )

      // 실패 로그 수집 (첫 번째 실패 체크의 run ID 사용)
      let errorLog = '(로그 없음)'
      const firstRunId = extractRunId(failedChecks[0].link)
      if (firstRunId != null) {
        errorLog = await fetchFailedRunLog(firstRunId)
      }

      const fixSuccess = await fixCiBranchInPlace(branchName, errorLog, prNumber)
      if (!fixSuccess) {
        await sendThreadMessage(
          threadId,
          `❌ CI 수정 실패 — 머지를 중단합니다. 수동 확인이 필요합니다.`,
        )
        return
      }

      logger.info(TAG, `PR #${prNumber} CI 수정 완료 — 재트리거 대기 (최대 10분)`)
      await sendThreadMessage(threadId, `✅ CI 수정 완료 — CI 재트리거 대기 중 (최대 10분)...`)

      const ciPassed = await waitForCiPass(prNumber)
      if (!ciPassed) {
        await sendThreadMessage(
          threadId,
          `❌ CI 재실패 또는 타임아웃 — 머지를 중단합니다. 수동 확인이 필요합니다.`,
        )
        return
      }

      logger.info(TAG, `PR #${prNumber} CI 통과 확인 — 머지 진행`)
      await sendThreadMessage(threadId, `✅ CI 통과 확인 — 머지를 진행합니다.`)
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    logger.error(TAG, `PR #${prNumber} CI 게이트 처리 실패: ${reason}`)
    await sendThreadMessage(
      threadId,
      `❌ CI 게이트 처리 중 오류 발생: ${reason.slice(0, 300)}\n수동 확인이 필요합니다.`,
    )
    return
  }

  // 3. Squash merge 실행
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

  // 3.5. 로컬 main을 최신으로 동기화 (runPostMergeInfra가 신 스키마 기준으로 실행되도록)
  try {
    await checkoutAndPullMain()
    logger.info(TAG, `PR #${prNumber} 머지 후 로컬 main 동기화 완료`)
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    logger.error(TAG, `PR #${prNumber} 로컬 main 동기화 실패: ${reason}`)
    await sendThreadMessage(
      threadId,
      `❌ 머지 완료, 로컬 main 동기화 실패: ${reason.slice(0, 300)}\n수동 확인이 필요합니다.`,
    )
    return
  }

  // 3.6. Post-merge 인프라 반영 (DB 마이그레이션 실패 시 머지 흐름 중단)
  try {
    await runPostMergeInfra(prNumber, threadId)
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    logger.error(TAG, `PR #${prNumber} 인프라 반영 실패: ${reason}`)
    await sendThreadMessage(
      threadId,
      `❌ 머지 완료, 인프라 반영 실패: ${reason.slice(0, 300)}\n수동 확인이 필요합니다.`,
    )
    return
  }

  // 4. 로컬 브랜치 정리 (main checkout/pull은 이미 완료)
  await deleteLocalBranchIfExists(branchName)

  // 5. 스레드에 완료 알림
  try {
    await sendThreadMessage(
      threadId,
      `PR #${prNumber}이 머지되었습니다. 이 스레드는 종료됩니다.`,
    )
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    logger.warn(TAG, `완료 알림 발송 실패 (머지는 완료): ${reason}`)
  }

  // 6. 매핑 삭제
  removePrThreadMapping(prNumber)
  logger.info(TAG, `PR #${prNumber} 처리 완료 — 매핑 삭제`)
}
