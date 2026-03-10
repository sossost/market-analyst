/**
 * 자율 이슈 처리 시스템 — 메인 오케스트레이터
 *
 * 1. 미처리 이슈 조회
 * 2. LLM 트리아지 (자율 처리 가능 여부 판단)
 * 3. 자율 처리 가능 이슈 → Claude Code CLI로 구현 → PR 생성
 * 4. CEO 판단 필요 이슈 → 에스컬레이션 코멘트
 *
 * 1사이클 최대 2건 처리.
 */

import {
  addComment,
  addLabel,
  fetchQueuedIssues,
  fetchUnprocessedIssues,
} from './githubClient.js'
import { executeIssue } from './executeIssue.js'
import { triageIssue } from './triageIssue.js'
import { MAX_ISSUES_PER_CYCLE } from './types.js'

function log(message: string): void {
  const timestamp = new Date().toISOString()
  console.log(`[${timestamp}] ${message}`)
}

async function processTriageQueue(): Promise<void> {
  // Step 1: 미처리 이슈 조회 (auto: 라벨 없는 이슈)
  log('▶ 미처리 이슈 조회')
  const unprocessedIssues = await fetchUnprocessedIssues()
  log(`  발견: ${unprocessedIssues.length}건`)

  // Step 2: 트리아지 — 이슈별 try-catch 격리
  for (const issue of unprocessedIssues) {
    try {
      log(`▶ 트리아지: #${issue.number} "${issue.title}"`)
      const result = await triageIssue(issue)

      if (result.decision === 'auto') {
        await addLabel(issue.number, 'auto:queued')
        await addComment(
          issue.number,
          `🤖 [자율 이슈 처리 시스템]\n\n자율 처리 가능으로 판단되었습니다. 곧 자동으로 처리됩니다.\n\n**판단 사유**: ${result.reason}\n**브랜치 타입**: ${result.branchType}`,
        )
        log(`  → auto:queued (${result.reason})`)
      } else {
        await addLabel(issue.number, 'auto:needs-ceo')
        await addComment(
          issue.number,
          `🤖 [자율 이슈 처리 시스템]\n\n이 이슈는 자율 처리가 불가능하여 CEO 판단을 요청합니다.\n\n**사유**: ${result.reason}\n\n처리를 원하시면 이슈에 추가 지시를 남겨 주세요.`,
        )
        log(`  → auto:needs-ceo (${result.reason})`)
      }
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : String(err)
      log(`  ✗ 트리아지 실패 #${issue.number}: ${errorMessage}`)
      // 트리아지 실패는 다음 사이클에서 재시도 (라벨 안 붙이면 됨)
    }
  }
}

async function processExecutionQueue(): Promise<void> {
  // Step 3: auto:queued 이슈 실행 (최대 MAX_ISSUES_PER_CYCLE건)
  log('▶ 실행 대기 이슈 조회')
  const queuedIssues = await fetchQueuedIssues()
  log(`  대기 중: ${queuedIssues.length}건`)

  const toProcess = queuedIssues.slice(0, MAX_ISSUES_PER_CYCLE)

  for (const issue of toProcess) {
    try {
      log(`▶ 실행: #${issue.number} "${issue.title}"`)

      // 트리아지 정보 재생성 (실행에 필요한 branchType)
      const triage = await triageIssue(issue)
      const result = await executeIssue(issue, triage)

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

async function main(): Promise<void> {
  log('=== 자율 이슈 처리 시스템 시작 ===')

  try {
    // Phase 1: 트리아지 (새 이슈 분류)
    await processTriageQueue()

    // Phase 2: 실행 (queued 이슈 처리)
    await processExecutionQueue()
  } catch (err) {
    const errorMessage =
      err instanceof Error ? err.message : String(err)
    log(`✗ 시스템 오류: ${errorMessage}`)
    process.exit(1)
  }

  log('=== 자율 이슈 처리 시스템 완료 ===')
}

main()
