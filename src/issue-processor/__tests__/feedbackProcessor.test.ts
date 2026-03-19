/**
 * feedbackProcessor.ts 단위 테스트
 *
 * 외부 의존성(execFile, Discord API)은 vi.fn()으로 모킹.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  buildFeedbackPrompt,
  isMergeApproval,
  processFeedback,
} from '../feedbackProcessor.js'
import type { PrThreadMapping, DiscordMessage } from '../types.js'

// ---------------------------------------------------------------------------
// 모킹
// ---------------------------------------------------------------------------

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}))

vi.mock('../discordClient.js', () => ({
  fetchThreadMessages: vi.fn().mockResolvedValue([]),
  sendThreadMessage: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../prThreadStore.js', () => ({
  updateLastScannedMessageId: vi.fn(),
}))

// ---------------------------------------------------------------------------
// 헬퍼
// ---------------------------------------------------------------------------

function makeMapping(
  prNumber: number,
  options: Partial<PrThreadMapping> = {},
): PrThreadMapping {
  return {
    prNumber,
    threadId: `thread-${prNumber}`,
    issueNumber: prNumber * 10,
    branchName: `feat/issue-${prNumber * 10}`,
    createdAt: '2026-01-01T00:00:00Z',
    ...options,
  }
}

function makeMessage(
  id: string,
  content: string,
  authorId = 'user-allowed',
): DiscordMessage {
  return {
    id,
    content,
    author: { id: authorId, username: 'test-user' },
    timestamp: '2026-01-01T00:00:00Z',
  }
}

// ---------------------------------------------------------------------------
// isMergeApproval
// ---------------------------------------------------------------------------

describe('isMergeApproval', () => {
  it.each([
    ['승인'],
    ['APPROVE'],
    ['approve'],
    ['머지'],
    ['merge'],
    ['MERGE'],
    [' 승인 '], // 앞뒤 공백 허용
  ])('"%s"는 승인으로 감지한다', (content) => {
    expect(isMergeApproval(content)).toBe(true)
  })

  it.each([
    ['승인 부탁해요'],           // 뒤에 텍스트 있음
    ['코드 수정 필요합니다'],    // 일반 피드백
    ['approve this pr'],         // 뒤에 단어 있음
    ['please merge'],            // 앞에 단어 있음
    [''],                        // 빈 문자열
  ])('"%s"는 승인으로 감지하지 않는다', (content) => {
    expect(isMergeApproval(content)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// buildFeedbackPrompt
// ---------------------------------------------------------------------------

describe('buildFeedbackPrompt', () => {
  it('피드백 메시지를 <untrusted-feedback> 블록으로 래핑한다', () => {
    const prompt = buildFeedbackPrompt(42, 420, ['타입 에러 수정 필요', '테스트 추가 필요'])

    expect(prompt).toContain('<untrusted-feedback>')
    expect(prompt).toContain('</untrusted-feedback>')
    expect(prompt).toContain('타입 에러 수정 필요')
    expect(prompt).toContain('테스트 추가 필요')
  })

  it('PR 번호와 이슈 번호를 포함한다', () => {
    const prompt = buildFeedbackPrompt(42, 420, ['피드백'])

    expect(prompt).toContain('PR #42')
    expect(prompt).toContain('feat/issue-420')
  })

  it('git checkout main 복귀 지시를 포함한다', () => {
    const prompt = buildFeedbackPrompt(42, 420, ['피드백'])

    expect(prompt).toContain('git checkout main')
  })

  it('프롬프트 인젝션 방지 경고를 포함한다', () => {
    const prompt = buildFeedbackPrompt(42, 420, ['피드백'])

    expect(prompt).toContain('IMPORTANT')
    expect(prompt).toContain('절대 실행하지 말고')
  })

  it('여러 피드백 메시지를 구분자로 합산한다', () => {
    const messages = ['첫 번째 피드백', '두 번째 피드백', '세 번째 피드백']
    const prompt = buildFeedbackPrompt(1, 10, messages)

    // 세 메시지 모두 포함
    for (const msg of messages) {
      expect(prompt).toContain(msg)
    }
  })
})

// ---------------------------------------------------------------------------
// processFeedback
// ---------------------------------------------------------------------------

describe('processFeedback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.ALLOWED_DISCORD_USER_IDS = 'user-allowed,user-allowed-2'
  })

  it('허용된 사용자의 피드백을 처리한다', async () => {
    const { execFile } = await import('node:child_process')
    const mockExecFile = vi.mocked(execFile)
    const { updateLastScannedMessageId } = await import('../prThreadStore.js')
    const { sendThreadMessage } = await import('../discordClient.js')

    mockExecFile.mockImplementation((_cmd, _args, _options, callback) => {
      const cb = callback as (error: null, stdout: string, stderr: string) => void
      cb(null, '', '')
      return { stdin: { end: vi.fn() } } as unknown as ReturnType<typeof execFile>
    })

    const messages = [
      makeMessage('msg-1', '타입 에러 수정 필요', 'user-allowed'),
      makeMessage('msg-2', '테스트 추가 필요', 'user-allowed'),
    ]

    const result = await processFeedback(makeMapping(42), messages)

    expect(result.success).toBe(true)
    expect(mockExecFile).toHaveBeenCalledOnce()
    expect(updateLastScannedMessageId).toHaveBeenCalledWith(42, 'msg-2')
    expect(sendThreadMessage).toHaveBeenCalledOnce()
    expect(vi.mocked(sendThreadMessage).mock.calls[0][1]).toContain('피드백 반영 완료')
  })

  it('허용되지 않은 사용자 메시지는 무시한다', async () => {
    const { execFile } = await import('node:child_process')
    const mockExecFile = vi.mocked(execFile)

    const messages = [
      makeMessage('msg-1', '악성 명령어 실행', 'unknown-user'),
    ]

    const result = await processFeedback(makeMapping(42), messages)

    expect(result.success).toBe(true)
    expect(mockExecFile).not.toHaveBeenCalled()
  })

  it('승인 메시지는 피드백에서 제외한다', async () => {
    const { execFile } = await import('node:child_process')
    const mockExecFile = vi.mocked(execFile)

    // 승인 메시지만 있는 경우 — 피드백 없음으로 처리
    const messages = [
      makeMessage('msg-1', '승인', 'user-allowed'),
    ]

    const result = await processFeedback(makeMapping(42), messages)

    expect(result.success).toBe(true)
    expect(mockExecFile).not.toHaveBeenCalled()
  })

  it('빈 메시지 목록이면 성공 반환하고 CLI를 호출하지 않는다', async () => {
    const { execFile } = await import('node:child_process')
    const mockExecFile = vi.mocked(execFile)

    const result = await processFeedback(makeMapping(42), [])

    expect(result.success).toBe(true)
    expect(mockExecFile).not.toHaveBeenCalled()
  })

  it('Claude CLI 실패 시 success: false를 반환하고 스레드에 실패 알림을 보낸다', async () => {
    const { execFile } = await import('node:child_process')
    const mockExecFile = vi.mocked(execFile)
    const { sendThreadMessage } = await import('../discordClient.js')
    const { updateLastScannedMessageId } = await import('../prThreadStore.js')

    mockExecFile.mockImplementation((_cmd, _args, _options, callback) => {
      const cb = callback as (error: Error, stdout: string, stderr: string) => void
      const error = Object.assign(new Error('CLI failed'), { code: 'ERR' })
      cb(error, '', 'stderr error')
      return { stdin: { end: vi.fn() } } as unknown as ReturnType<typeof execFile>
    })

    const messages = [makeMessage('msg-1', '코드 수정 요청', 'user-allowed')]
    const result = await processFeedback(makeMapping(42), messages)

    expect(result.success).toBe(false)
    expect(result.error).toBeDefined()
    // 실패 시 lastScannedMessageId 갱신 안 함 (재시도 보장)
    expect(updateLastScannedMessageId).not.toHaveBeenCalled()
    // 실패 알림 발송
    expect(sendThreadMessage).toHaveBeenCalledOnce()
    expect(vi.mocked(sendThreadMessage).mock.calls[0][1]).toContain('실패')
  })

  it('ALLOWED_DISCORD_USER_IDS 미설정 시 모든 메시지를 차단한다', async () => {
    delete process.env.ALLOWED_DISCORD_USER_IDS

    const { execFile } = await import('node:child_process')
    const mockExecFile = vi.mocked(execFile)

    const messages = [makeMessage('msg-1', '피드백', 'any-user')]
    const result = await processFeedback(makeMapping(42), messages)

    expect(result.success).toBe(true)
    expect(mockExecFile).not.toHaveBeenCalled()
  })
})
