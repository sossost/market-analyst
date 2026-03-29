/**
 * 배치 트리아지 진입점
 *
 * 별도 cron(09:00 KST)에 의해 실행된다.
 * 미트리아지 이슈 전체를 조회하여 하나씩 트리아지하고, 결과를 이슈에 기록한다.
 *
 * PROCEED: 코멘트 + triaged 라벨 → 이슈 프로세서(10:00~)가 가져감
 * SKIP: 코멘트 + auto:blocked + triaged 라벨 → 이슈 프로세서가 필터링
 * ESCALATE: 코멘트 + auto:needs-ceo + triaged 라벨 → CEO가 직접 판단
 *
 * triaged 라벨은 모든 판정에 공통으로 부착하여 배치 재실행 시 중복 처리를 방지한다.
 * fetchUntriagedIssues()가 triaged 라벨이 있는 이슈를 제외하므로 재실행에 안전하다.
 */

import 'dotenv/config'

import { fetchUntriagedIssues, addComment, addLabel } from './githubClient.js'
import { triageIssue } from './triageIssue.js'
import { logger } from '@/lib/logger'

const TAG = 'TRIAGE_BATCH'

function log(message: string): void {
  logger.info(TAG, message)
}

export async function runTriageBatch(): Promise<void> {
  log('▶ 배치 트리아지 시작')

  const issues = await fetchUntriagedIssues()
  log(`  미트리아지 이슈: ${issues.length}건`)

  if (issues.length === 0) {
    log('  트리아지할 이슈 없음')
    return
  }

  for (const issue of issues) {
    try {
      log(`▶ 트리아지: #${issue.number} "${issue.title}"`)
      const result = await triageIssue(issue)
      log(`  판정: ${result.verdict}`)

      // 폴백 PROCEED (트리아지 실패) — triaged 라벨 없이 넘어가서 다음 배치에서 재시도
      if (result.comment === '') {
        log(`  ⚠ 트리아지 실패 (폴백) — triaged 라벨 미부착, 다음 배치에서 재시도`)
        continue
      }

      await addComment(
        issue.number,
        `**[사전 트리아지]**\n\n${result.comment}`,
      )

      if (result.verdict === 'SKIP') {
        await addLabel(issue.number, 'auto:blocked')
        await addLabel(issue.number, 'triaged')
        log(`  ✗ SKIP — auto:blocked + triaged 라벨 부착`)
        continue
      }

      if (result.verdict === 'ESCALATE') {
        await addLabel(issue.number, 'auto:needs-ceo')
        await addLabel(issue.number, 'triaged')
        log(`  ⚠ ESCALATE — auto:needs-ceo + triaged 라벨 부착`)
        continue
      }

      // PROCEED: triaged 라벨 부착 → 이슈 프로세서가 정상 처리
      await addLabel(issue.number, 'triaged')
      log(`  ✓ PROCEED — triaged 라벨 부착, 이슈 프로세서 대기`)
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
