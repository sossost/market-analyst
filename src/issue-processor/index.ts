/**
 * 자율 이슈 처리 시스템 — 메인 오케스트레이터
 *
 * 1. 미처리 이슈 조회 (auto: 라벨 없는 이슈)
 *    - SKIP/ESCALATE는 triageBatch(09:00)가 auto:blocked/auto:needs-ceo 라벨로 이미 필터링
 * 2. 이슈 코멘트에서 사전 트리아지 분석 추출
 * 3. Claude Code CLI로 구현 → PR 생성
 *
 * 1사이클 최대 1건 처리.
 */

import 'dotenv/config'

import { fetchUnprocessedIssues, fetchTriageComment } from './githubClient.js'
import { executeIssue, isCiFailureIssue, executeCiFailureIssue } from './executeIssue.js'
import { MAX_ISSUES_PER_CYCLE } from './types.js'
import { logger } from '@/lib/logger'

const TAG = 'ISSUE_PROCESSOR'

function log(message: string): void {
  logger.info(TAG, message)
}

export async function processIssues(): Promise<void> {
  // Step 1: 미처리 이슈 조회 (auto: 라벨 없는 이슈)
  // SKIP/ESCALATE 이슈는 triageBatch가 auto:blocked/auto:needs-ceo 라벨을 붙여 이미 필터링됨
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
      // CI 실패 이슈는 전용 실행 경로로 라우팅
      if (isCiFailureIssue(issue.title)) {
        log(`▶ CI 실패 수정: #${issue.number} "${issue.title}"`)
        const result = await executeCiFailureIssue(issue)
        if (result.success) {
          log(`  ✓ CI 수정 커밋 푸시 완료`)
        } else {
          log(`  ✗ CI 수정 실패: ${result.error}`)
        }
      } else {
        // 일반 이슈: 사전 트리아지 분석 조회 + 구현 실행
        log(`▶ 트리아지 코멘트 조회: #${issue.number}`)
        const triageComment = await fetchTriageComment(issue.number)
        log(`  트리아지 코멘트: ${triageComment != null ? '있음' : '없음 (폴백)'}`)

        log(`▶ 실행: #${issue.number} "${issue.title}"`)
        const result = await executeIssue(issue, triageComment)

        if (result.success) {
          log(`  ✓ PR 생성 완료: ${result.prUrl}`)
        } else {
          log(`  ✗ 실행 실패: ${result.error}`)
        }
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
