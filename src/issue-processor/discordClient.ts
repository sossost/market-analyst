/**
 * Discord REST API 클라이언트 — Bot Token 기반
 *
 * Discord REST API를 직접 호출하여 스레드 생성/읽기/쓰기를 수행한다.
 * 기존 src/agent/discord.ts의 fetch 패턴을 재활용.
 *
 * 환경변수:
 *   DISCORD_BOT_TOKEN — Discord Bot Token (Bot 접두사 포함)
 *   DISCORD_PR_CHANNEL_ID — PR 전용 채널 ID
 */

import { logger } from '@/lib/logger'
import type { DiscordMessage } from './types.js'

const DISCORD_API_BASE = 'https://discord.com/api/v10'
const FETCH_TIMEOUT_MS = 10_000

const TAG = 'DISCORD_CLIENT'

/**
 * DISCORD_BOT_TOKEN 환경변수를 읽어 반환한다.
 * 미설정 시 에러를 throw하지 않고 null 반환 (호출 측에서 처리).
 */
function getBotToken(): string | null {
  const token = process.env.DISCORD_BOT_TOKEN
  if (token == null || token === '') return null
  return token
}

/**
 * Discord REST API 공통 fetch 헬퍼
 * Bot Token을 Authorization 헤더에 포함한다.
 */
export async function discordFetch(
  path: string,
  options: RequestInit = {},
): Promise<Response> {
  const token = getBotToken()
  if (token == null) {
    throw new Error('DISCORD_BOT_TOKEN 환경변수가 설정되지 않았습니다')
  }

  // DISCORD_BOT_TOKEN에 이미 "Bot " 접두사가 포함된 경우 중복 추가 방지
  const authHeader = token.startsWith('Bot ') ? token : `Bot ${token}`

  const url = `${DISCORD_API_BASE}${path}`
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: authHeader,
      'Content-Type': 'application/json',
      ...options.headers,
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })

  return response
}

/**
 * 채널에 새 스레드를 생성한다 (PR 생성 시 호출).
 *
 * Discord 스레드 유형: PUBLIC_THREAD (type: 11)
 * 채널 메시지 없이 스레드를 직접 생성하는 방식을 사용한다.
 *
 * @param channelId — 스레드를 생성할 채널 ID
 * @param name — 스레드 이름 (PR 번호 + 이슈 제목)
 * @param initialMessage — 스레드 첫 메시지 내용
 * @returns threadId
 */
export async function createThread(
  channelId: string,
  name: string,
  initialMessage: string,
): Promise<string> {
  // 1. 채널에 스레드 생성 (메시지 없는 포럼/일반 채널 스레드)
  const threadResponse = await discordFetch(
    `/channels/${channelId}/threads`,
    {
      method: 'POST',
      body: JSON.stringify({
        name: name.slice(0, 100), // Discord 스레드 이름 최대 100자
        type: 11, // PUBLIC_THREAD
        auto_archive_duration: 10080, // 7일 (분 단위)
        message: {
          content: initialMessage,
        },
      }),
    },
  )

  if (threadResponse.ok === false) {
    const body = await threadResponse.text().catch(() => '')
    throw new Error(
      `Discord 스레드 생성 실패 (${threadResponse.status}): ${body}`,
    )
  }

  const threadData = (await threadResponse.json()) as { id: string }
  logger.info(TAG, `스레드 생성 완료: ${threadData.id} "${name}"`)

  // 일반 텍스트 채널에서는 message 파라미터가 표시되지 않을 수 있으므로
  // 초기 메시지를 별도로 발송하여 확실히 보이도록 한다.
  await sendThreadMessage(threadData.id, initialMessage)

  return threadData.id
}

/**
 * 스레드에 메시지를 발송한다.
 *
 * @param threadId — 대상 스레드 ID
 * @param content — 메시지 내용
 */
export async function sendThreadMessage(
  threadId: string,
  content: string,
): Promise<void> {
  const response = await discordFetch(`/channels/${threadId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ content }),
  })

  if (response.ok === false) {
    const body = await response.text().catch(() => '')
    throw new Error(
      `Discord 메시지 발송 실패 (${response.status}): ${body}`,
    )
  }

  logger.info(TAG, `스레드 메시지 발송 완료: thread=${threadId}`)
}

/**
 * 스레드의 메시지를 조회한다.
 * sinceMessageId가 있으면 해당 메시지 이후의 신규 메시지만 반환한다.
 *
 * @param threadId — 대상 스레드 ID
 * @param sinceMessageId — 이 ID 이후의 메시지만 조회 (증분 스캔용)
 * @returns DiscordMessage 배열 (오래된 순)
 */
export async function fetchThreadMessages(
  threadId: string,
  sinceMessageId?: string,
): Promise<DiscordMessage[]> {
  const params = new URLSearchParams({ limit: '100' })
  if (sinceMessageId != null) {
    params.set('after', sinceMessageId)
  }

  const response = await discordFetch(
    `/channels/${threadId}/messages?${params.toString()}`,
  )

  if (response.ok === false) {
    const body = await response.text().catch(() => '')
    throw new Error(
      `Discord 메시지 조회 실패 (${response.status}): ${body}`,
    )
  }

  const messages = (await response.json()) as DiscordMessage[]

  // Discord API는 최신순으로 반환 — 오래된 순으로 뒤집기
  return messages.reverse()
}
