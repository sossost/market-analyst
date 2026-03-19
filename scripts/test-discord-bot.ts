/**
 * Discord Bot 연동 테스트 스크립트
 *
 * 실행: npx tsx scripts/test-discord-bot.ts
 *
 * 테스트 항목:
 * 1. Bot Token 유효성
 * 2. 채널 접근 권한
 * 3. 스레드 생성
 * 4. 스레드에 메시지 발송
 * 5. 스레드 메시지 읽기
 */

import 'dotenv/config'
import {
  createThread,
  sendThreadMessage,
  fetchThreadMessages,
} from '../src/issue-processor/discordClient.js'

const channelId = process.env.DISCORD_PR_CHANNEL_ID
const mode = process.argv[2] ?? 'full' // full | read <threadId>

async function main() {
  // 환경변수 확인
  if (process.env.DISCORD_BOT_TOKEN == null || process.env.DISCORD_BOT_TOKEN === '') {
    console.error('DISCORD_BOT_TOKEN이 설정되지 않았습니다')
    process.exit(1)
  }

  // read 모드: 기존 스레드 메시지 읽기만
  if (mode === 'read') {
    const threadId = process.argv[3]
    if (threadId == null) {
      console.error('사용법: npx tsx scripts/test-discord-bot.ts read <threadId>')
      process.exit(1)
    }
    console.log(`스레드 ${threadId} 메시지 읽기...\n`)
    const messages = await fetchThreadMessages(threadId)
    console.log(`${messages.length}개 메시지 조회 ✅\n`)
    for (const msg of messages) {
      console.log(`  [${msg.author.username} / ID:${msg.author.id}] ${msg.content}`)
    }
    return
  }

  // full 모드: 스레드 생성 + 메시지 발송 + 읽기
  console.log('=== Discord Bot 연동 테스트 ===\n')

  if (channelId == null || channelId === '') {
    console.error('DISCORD_PR_CHANNEL_ID가 설정되지 않았습니다')
    process.exit(1)
  }

  console.log('1. 스레드 생성 중...')
  const threadId = await createThread(
    channelId,
    '[테스트] PR #999 — Discord 연동 테스트',
    '🔧 **테스트 PR**\n\n이 스레드는 Discord Bot 연동 테스트입니다.\n\n- "승인"으로 머지, 피드백은 자유 텍스트로 작성해주세요.',
  )
  console.log(`   완료 ✅ (threadId: ${threadId})\n`)

  console.log('2. 메시지 발송 중...')
  await sendThreadMessage(threadId, '📝 피드백 반영 완료: 에러 핸들링 추가')
  console.log('   완료 ✅\n')

  await new Promise((resolve) => setTimeout(resolve, 1000))

  console.log('3. 메시지 읽기...')
  const messages = await fetchThreadMessages(threadId)
  console.log(`   ${messages.length}개 조회 ✅`)
  for (const msg of messages) {
    console.log(`   - [${msg.author.username}] ${msg.content.slice(0, 80)}`)
  }

  console.log('\n=== 모든 테스트 통과 ===')
  console.log(`\n스레드에 메시지를 써본 뒤:`)
  console.log(`  npx tsx scripts/test-discord-bot.ts read ${threadId}`)
}

main().catch((err) => {
  console.error('\n❌ 테스트 실패:', err.message)
  process.exit(1)
})
