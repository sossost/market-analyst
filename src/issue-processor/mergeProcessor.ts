/**
 * "승인" 감지 → PR 리뷰 확인 → 반영 → 머지
 *
 * CEO가 Discord 스레드에 "승인"을 작성하면:
 * 1. PR 상태 확인 (OPEN인지)
 * 2. PR 리뷰 코멘트 확인 (Gemini 등 외부 리뷰어)
 * 3. 타당한 리뷰 있으면 Claude Code CLI로 반영 → 푸시
 * 4. squash merge 실행
 * 5. 로컬 브랜치 정리
 * 6. 스레드에 완료 알림
 * 7. PR 매핑 삭제
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

// ---------------------------------------------------------------------------
// PR 리뷰 코멘트 확인 + Claude Code CLI 반영
// ---------------------------------------------------------------------------

const REVIEW_CLI_TIMEOUT_MS = 30 * 60 * 1_000 // 30분
const MAX_BUFFER = 50 * 1024 * 1024 // 50MB

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
6. \`git checkout main\`으로 복귀

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
      (error) => {
        if (error != null) {
          reject(error)
          return
        }
        resolve()
      },
    )
    child.stdin?.end(prompt, 'utf-8')
  })
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
