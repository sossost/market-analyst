/**
 * 배치 트리아지 진입점
 *
 * 별도 cron(09:00 KST)에 의해 실행된다.
 * 미처리 이슈 전체를 조회하여 하나씩 트리아지하고, 결과를 이슈에 기록한다.
 *
 * PROCEED: 코멘트만 남기고 라벨 안 붙임 → 이슈 프로세서(10:00~)가 가져감
 * SKIP: 코멘트 + auto:blocked 라벨 → 이슈 프로세서가 필터링
 * ESCALATE: 코멘트 + auto:needs-ceo 라벨 → CEO가 직접 판단
 */

import 'dotenv/config'

import { fetchUnprocessedIssues, addComment, addLabel } from './githubClient.js'
import { triageIssue } from './triageIssue.js'
import { logger } from '@/lib/logger'

const TAG = 'TRIAGE_BATCH'

function log(message: string): void {
  logger.info(TAG, message)
}

export async function runTriageBatch(): Promise<void> {
  log('▶ 배치 트리아지 시작')

  const issues = await fetchUnprocessedIssues()
  log(`  미처리 이슈: ${issues.length}건`)

  if (issues.length === 0) {
    log('  트리아지할 이슈 없음')
    return
  }

  for (const issue of issues) {
    try {
      log(`▶ 트리아지: #${issue.number} "${issue.title}"`)
      const result = await triageIssue(issue)
      log(`  판정: ${result.verdict}`)

      // 코멘트 남기기 (비어 있으면 스킵 — 폴백 PROCEED 케이스)
      if (result.comment !== '') {
        await addComment(
          issue.number,
          `**[사전 트리아지]**\n\n${result.comment}`,
        )
      }

      if (result.verdict === 'SKIP') {
        await addLabel(issue.number, 'auto:blocked')
        log(`  ✗ SKIP — auto:blocked 라벨 부착`)
        continue
      }

      if (result.verdict === 'ESCALATE') {
        await addLabel(issue.number, 'auto:needs-ceo')
        log(`  ⚠ ESCALATE — auto:needs-ceo 라벨 부착`)
        continue
      }

      // PROCEED: 라벨 없음 — 이슈 프로세서가 정상 처리
      log(`  ✓ PROCEED — 이슈 프로세서 대기`)
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err)
      log(`  ✗ 트리아지 실패 #${issue.number}: ${errorMessage}`)
      // 한 이슈 실패 시 다음 이슈 계속 처리
    }
  }

  log('▶ 배치 트리아지 완료')
}

async function main(): Promise<void> {
  try {
    await runTriageBatch()
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)
    logger.error(TAG, `배치 트리아지 오류: ${errorMessage}`)
    process.exit(1)
  }
}

// CLI 직접 실행 시에만 main() 호출
if (process.argv[1]?.includes('triageBatch')) {
  main()
}
