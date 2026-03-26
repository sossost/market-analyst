/**
 * 자율 이슈 처리 시스템 — 메인 오케스트레이터
 *
 * 1. 미처리 이슈 조회 (auto: 라벨 없는 이슈)
 * 2. 사전 트리아지 (~3분) — PROCEED / SKIP / ESCALATE 판정
 * 3. PROCEED만 Claude Code CLI로 구현 → PR 생성
 *
 * 1사이클 최대 1건 처리.
 */

import 'dotenv/config'

import { fetchUnprocessedIssues, addComment, addLabel } from './githubClient.js'
import { executeIssue } from './executeIssue.js'
import { triageIssue } from './triageIssue.js'
import { MAX_ISSUES_PER_CYCLE } from './types.js'
import { logger } from '@/lib/logger'

const TAG = 'ISSUE_PROCESSOR'

function log(message: string): void {
  logger.info(TAG, message)
}

/**
 * 트리아지 코멘트를 이슈에 남긴다.
 * 코멘트가 비어 있으면(폴백) 스킵한다.
 */
async function postTriageComment(issueNumber: number, comment: string): Promise<void> {
  if (comment === '') return
  await addComment(
    issueNumber,
    `**[사전 트리아지]**\n\n${comment}`,
  )
}

export async function processIssues(): Promise<void> {
  // Step 1: 미처리 이슈 조회 (auto: 라벨 없는 이슈)
  log('▶ 미처리 이슈 조회')
  const unprocessedIssues = await fetchUnprocessedIssues()
  log(`  발견: ${unprocessedIssues.length}건`)

  if (unprocessedIssues.length === 0) {
    log('  처리할 이슈 없음')
    return
  }

  // Step 2: 최대 MAX_ISSUES_PER_CYCLE건만 처리
  const toProcess = unprocessedIssues.slice(0, MAX_ISSUES_PER_CYCLE)

  for (const issue of toProcess) {
    try {
      // Step 2a: 사전 트리아지
      log(`▶ 트리아지: #${issue.number} "${issue.title}"`)
      const triage = await triageIssue(issue)
      log(`  트리아지 판정: ${triage.verdict}`)

      if (triage.verdict === 'SKIP') {
        await postTriageComment(issue.number, triage.comment)
        await addLabel(issue.number, 'auto:blocked')
        log(`  ✗ SKIP — auto:blocked 라벨 부착`)
        continue
      }

      if (triage.verdict === 'ESCALATE') {
        await postTriageComment(issue.number, triage.comment)
        await addLabel(issue.number, 'auto:needs-ceo')
        log(`  ⚠ ESCALATE — auto:needs-ceo 라벨 부착`)
        continue
      }

      // PROCEED: 트리아지 코멘트 남기고 실행
      await postTriageComment(issue.number, triage.comment)

      log(`▶ 실행: #${issue.number} "${issue.title}"`)
      const triageComment = triage.comment !== '' ? triage.comment : undefined
      const result = await executeIssue(issue, triageComment)

      if (result.success) {
        log(`  ✓ PR 생성 완료: ${result.prUrl}`)
      } else {
        log(`  ✗ 실행 실패: ${result.error}`)
      }
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : String(err)
      log(`  ✗ 실행 실패 #${issue.number}: ${errorMessage}`)
    }
  }
}

export async function main(): Promise<void> {
  log('=== 자율 이슈 처리 시스템 시작 (loopOrchestrator로 위임) ===')

  // loopOrchestrator가 Step 1~3 전체를 담당한다.
  // index.ts를 직접 실행하면 loopOrchestrator로 위임하여 하위 호환성 유지.
  const { runLoop } = await import('./loopOrchestrator.js')

  try {
    await runLoop()
  } catch (err) {
    const errorMessage =
      err instanceof Error ? err.message : String(err)
    log(`✗ 루프 오류: ${errorMessage}`)
    process.exit(1)
  }

  log('=== 자율 이슈 처리 시스템 완료 ===')
}

// CLI 직접 실행 시에만 main() 호출 (테스트에서는 import만)
// loopOrchestrator 직접 실행 시에는 여기를 타지 않도록 엄격 매칭
if (process.argv[1]?.endsWith('index.ts') && process.argv[1]?.includes('issue-processor')) {
  main()
}
