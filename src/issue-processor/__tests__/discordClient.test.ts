/**
 * discordClient.ts 단위 테스트
 *
 * 외부 의존성(fetch, Discord API)은 vi.fn()으로 모킹.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  createThread,
  sendThreadMessage,
  fetchThreadMessages,
} from '../discordClient.js'

// ---------------------------------------------------------------------------
// fetch 모킹
// ---------------------------------------------------------------------------

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

// ---------------------------------------------------------------------------
// 헬퍼
// ---------------------------------------------------------------------------

function makeOkResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response
}

function makeErrorResponse(status: number, body = 'error'): Response {
  return {
    ok: false,
    status,
    json: () => Promise.reject(new Error('no json')),
    text: () => Promise.resolve(body),
  } as unknown as Response
}

// ---------------------------------------------------------------------------
// createThread
// ---------------------------------------------------------------------------

describe('createThread', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.DISCORD_BOT_TOKEN = 'Bot test-token-123'
  })

  it('Discord API를 올바른 경로로 호출하고 threadId를 반환한다', async () => {
    // 1회차: 스레드 생성, 2회차: 초기 메시지 발송 (sendThreadMessage)
    mockFetch
      .mockResolvedValueOnce(makeOkResponse({ id: 'thread-abc' }))
      .mockResolvedValueOnce(makeOkResponse({ id: 'msg-1' }))

    const result = await createThread('channel-1', 'PR #42 — Fix bug', '초기 메시지')

    expect(result).toBe('thread-abc')
    expect(mockFetch).toHaveBeenCalledTimes(2)

    // 첫 번째 호출: 스레드 생성
    const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/channels/channel-1/threads')
    expect(options.method).toBe('POST')

    const body = JSON.parse(options.body as string)
    expect(body.name).toBe('PR #42 — Fix bug')
    expect(body.type).toBe(11) // PUBLIC_THREAD

    // 두 번째 호출: 초기 메시지 발송
    const [msgUrl] = mockFetch.mock.calls[1] as [string, RequestInit]
    expect(msgUrl).toContain('/channels/thread-abc/messages')
  })

  it('스레드 이름을 100자로 잘라낸다', async () => {
    mockFetch
      .mockResolvedValueOnce(makeOkResponse({ id: 'thread-xyz' }))
      .mockResolvedValueOnce(makeOkResponse({ id: 'msg-1' }))

    const longName = 'A'.repeat(150)
    await createThread('channel-1', longName, 'msg')

    const [, options] = mockFetch.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(options.body as string)
    expect(body.name.length).toBe(100)
  })

  it('Authorization 헤더에 Bot 토큰을 포함한다', async () => {
    mockFetch
      .mockResolvedValueOnce(makeOkResponse({ id: 'thread-abc' }))
      .mockResolvedValueOnce(makeOkResponse({ id: 'msg-1' }))

    await createThread('channel-1', 'PR #1', 'msg')

    const [, options] = mockFetch.mock.calls[0] as [string, RequestInit]
    const headers = options.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bot test-token-123')
  })

  it('DISCORD_BOT_TOKEN 미설정 시 에러를 throw한다', async () => {
    delete process.env.DISCORD_BOT_TOKEN

    await expect(createThread('channel-1', 'PR #1', 'msg')).rejects.toThrow(
      'DISCORD_BOT_TOKEN',
    )
  })

  it('Discord API 실패 시 에러를 throw한다', async () => {
    mockFetch.mockResolvedValueOnce(makeErrorResponse(403, 'Forbidden'))

    await expect(
      createThread('channel-1', 'PR #1', 'msg'),
    ).rejects.toThrow('스레드 생성 실패')
  })
})

// ---------------------------------------------------------------------------
// sendThreadMessage
// ---------------------------------------------------------------------------

describe('sendThreadMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.DISCORD_BOT_TOKEN = 'Bot test-token-123'
  })

  it('올바른 경로와 content로 메시지를 발송한다', async () => {
    mockFetch.mockResolvedValueOnce(makeOkResponse({ id: 'msg-1' }))

    await sendThreadMessage('thread-abc', '처리 완료!')

    expect(mockFetch).toHaveBeenCalledOnce()
    const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/channels/thread-abc/messages')
    expect(options.method).toBe('POST')

    const body = JSON.parse(options.body as string)
    expect(body.content).toBe('처리 완료!')
  })

  it('Discord API 실패 시 에러를 throw한다', async () => {
    mockFetch.mockResolvedValueOnce(makeErrorResponse(500, 'Server Error'))

    await expect(
      sendThreadMessage('thread-abc', '메시지'),
    ).rejects.toThrow('메시지 발송 실패')
  })
})

// ---------------------------------------------------------------------------
// fetchThreadMessages
// ---------------------------------------------------------------------------

describe('fetchThreadMessages', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.DISCORD_BOT_TOKEN = 'Bot test-token-123'
  })

  it('메시지를 오래된 순(오름차순)으로 반환한다', async () => {
    // Discord API는 최신순으로 반환 — 함수가 뒤집어야 함
    const rawMessages = [
      { id: 'msg-3', content: '셋째', author: { id: '1', username: 'ceo' }, timestamp: '2026-01-03' },
      { id: 'msg-2', content: '둘째', author: { id: '1', username: 'ceo' }, timestamp: '2026-01-02' },
      { id: 'msg-1', content: '첫째', author: { id: '1', username: 'ceo' }, timestamp: '2026-01-01' },
    ]
    mockFetch.mockResolvedValueOnce(makeOkResponse(rawMessages))

    const result = await fetchThreadMessages('thread-abc')

    expect(result).toHaveLength(3)
    expect(result[0].id).toBe('msg-1') // 가장 오래된 것이 첫 번째
    expect(result[2].id).toBe('msg-3') // 가장 최신이 마지막
  })

  it('sinceMessageId가 있으면 after 파라미터를 URL에 포함한다', async () => {
    mockFetch.mockResolvedValueOnce(makeOkResponse([]))

    await fetchThreadMessages('thread-abc', 'msg-100')

    const [url] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('after=msg-100')
  })

  it('sinceMessageId가 없으면 after 파라미터를 포함하지 않는다', async () => {
    mockFetch.mockResolvedValueOnce(makeOkResponse([]))

    await fetchThreadMessages('thread-abc')

    const [url] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).not.toContain('after=')
  })

  it('빈 메시지 목록을 반환해도 에러 없이 처리한다', async () => {
    mockFetch.mockResolvedValueOnce(makeOkResponse([]))

    const result = await fetchThreadMessages('thread-abc')
    expect(result).toEqual([])
  })

  it('Discord API 실패 시 에러를 throw한다', async () => {
    mockFetch.mockResolvedValueOnce(makeErrorResponse(403, 'Forbidden'))

    await expect(
      fetchThreadMessages('thread-abc'),
    ).rejects.toThrow('메시지 조회 실패')
  })
})
