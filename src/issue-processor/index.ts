/**
 * 자율 이슈 처리 시스템 — 메인 오케스트레이터
 *
 * 1. 미처리 이슈 조회 (auto: 라벨 없는 이슈)
 * 2. 바로 Claude Code CLI로 구현 → PR 생성
 *
 * CEO가 PR 리뷰에서 최종 판단하므로 트리아지 불필요.
 * 1사이클 최대 2건 처리.
 */

import 'dotenv/config'

import { fetchUnprocessedIssues } from './githubClient.js'
import { executeIssue } from './executeIssue.js'
import { MAX_ISSUES_PER_CYCLE } from './types.js'

function log(message: string): void {
  const timestamp = new Date().toISOString()
  console.log(`[${timestamp}] ${message}`)
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

  // Step 2: 최대 MAX_ISSUES_PER_CYCLE건만 실행
  const toProcess = unprocessedIssues.slice(0, MAX_ISSUES_PER_CYCLE)

  for (const issue of toProcess) {
    try {
      log(`▶ 실행: #${issue.number} "${issue.title}"`)
      const result = await executeIssue(issue)

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
  log('=== 자율 이슈 처리 시스템 시작 ===')

  try {
    await processIssues()
  } catch (err) {
    const errorMessage =
      err instanceof Error ? err.message : String(err)
    log(`✗ 시스템 오류: ${errorMessage}`)
    process.exit(1)
  }

  log('=== 자율 이슈 처리 시스템 완료 ===')
}

// CLI 직접 실행 시에만 main() 호출 (테스트에서는 import만)
if (process.argv[1]?.includes('issue-processor')) {
  main()
}
