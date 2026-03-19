/**
 * loopOrchestrator.ts 통합 테스트
 *
 * Step 1~3 전체 흐름을 시뮬레이션.
 * 외부 의존성(processIssues, Discord API, gh CLI)은 vi.fn()으로 모킹.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// 모킹
// ---------------------------------------------------------------------------

vi.mock('../index.js', () => ({
  processIssues: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../discordClient.js', () => ({
  fetchThreadMessages: vi.fn().mockResolvedValue([]),
  sendThreadMessage: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../feedbackProcessor.js', () => ({
  processFeedback: vi.fn().mockResolvedValue({ success: true }),
  isMergeApproval: vi.fn().mockReturnValue(false),
}))

vi.mock('../mergeProcessor.js', () => ({
  processMerge: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../prThreadStore.js', () => ({
  loadAllMappings: vi.fn().mockReturnValue([]),
  removePrThreadMapping: vi.fn(),
}))

// node:child_process — Step 3의 gh pr view 호출을 모킹
vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}))

// ---------------------------------------------------------------------------
// 헬퍼
// ---------------------------------------------------------------------------

import type { PrThreadMapping, DiscordMessage } from '../types.js'

function makeMapping(prNumber: number): PrThreadMapping {
  return {
    prNumber,
    threadId: `thread-${prNumber}`,
    issueNumber: prNumber * 10,
    branchName: `feat/issue-${prNumber * 10}`,
    createdAt: '2026-01-01T00:00:00Z',
  }
}

function makeMessage(id: string, content: string, authorId = 'allowed-user'): DiscordMessage {
  return {
    id,
    content,
    author: { id: authorId, username: 'ceo' },
    timestamp: '2026-01-01T00:00:00Z',
  }
}

/** execFile을 OPEN 상태 응답으로 설정 (Step 3가 매핑을 유지하게 함) */
async function setupExecFileAsOpen(): Promise<void> {
  const { execFile } = await import('node:child_process')
  vi.mocked(execFile).mockImplementation(
    (_cmd, _args, _options, callback) => {
      const cb = callback as (error: null, stdout: string, stderr: string) => void
      cb(null, JSON.stringify({ state: 'OPEN' }), '')
      return { stdin: null } as unknown as ReturnType<typeof execFile>
    },
  )
}

// ---------------------------------------------------------------------------
// runLoop 통합 테스트
// ---------------------------------------------------------------------------

describe('runLoop — 전체 루프 흐름', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.ALLOWED_DISCORD_USER_IDS = 'allowed-user'
  })

  it('활성 매핑 없으면 Step 1만 실행하고 Step 2~3 스킵한다', async () => {
    const { processIssues } = await import('../index.js')
    const { loadAllMappings } = await import('../prThreadStore.js')
    const { processFeedback } = await import('../feedbackProcessor.js')
    const { processMerge } = await import('../mergeProcessor.js')
    const { runLoop } = await import('../loopOrchestrator.js')

    vi.mocked(loadAllMappings).mockReturnValue([])

    await runLoop()

    expect(processIssues).toHaveBeenCalledOnce()
    expect(processFeedback).not.toHaveBeenCalled()
    expect(processMerge).not.toHaveBeenCalled()
  })

  it('신규 메시지가 없으면 피드백/머지 처리를 호출하지 않는다', async () => {
    const { loadAllMappings } = await import('../prThreadStore.js')
    const { fetchThreadMessages } = await import('../discordClient.js')
    const { processFeedback } = await import('../feedbackProcessor.js')
    const { processMerge } = await import('../mergeProcessor.js')
    const { runLoop } = await import('../loopOrchestrator.js')

    vi.mocked(loadAllMappings).mockReturnValue([makeMapping(42)])
    vi.mocked(fetchThreadMessages).mockResolvedValue([])
    await setupExecFileAsOpen() // Step 3 타임아웃 방지

    await runLoop()

    expect(processFeedback).not.toHaveBeenCalled()
    expect(processMerge).not.toHaveBeenCalled()
  })

  it('"승인" 메시지 감지 시 mergeProcessor를 호출한다', async () => {
    const { loadAllMappings } = await import('../prThreadStore.js')
    const { fetchThreadMessages } = await import('../discordClient.js')
    const { isMergeApproval } = await import('../feedbackProcessor.js')
    const { processMerge } = await import('../mergeProcessor.js')
    const { processFeedback } = await import('../feedbackProcessor.js')
    const { runLoop } = await import('../loopOrchestrator.js')

    const mapping = makeMapping(42)
    vi.mocked(loadAllMappings).mockReturnValue([mapping])
    vi.mocked(fetchThreadMessages).mockResolvedValue([
      makeMessage('msg-1', '승인', 'allowed-user'),
    ])
    vi.mocked(isMergeApproval).mockReturnValue(true)
    await setupExecFileAsOpen() // Step 3 타임아웃 방지

    await runLoop()

    expect(processMerge).toHaveBeenCalledWith(mapping)
    expect(processFeedback).not.toHaveBeenCalled()
  })

  it('일반 피드백 메시지는 feedbackProcessor를 호출한다', async () => {
    const { loadAllMappings } = await import('../prThreadStore.js')
    const { fetchThreadMessages } = await import('../discordClient.js')
    const { isMergeApproval, processFeedback } = await import('../feedbackProcessor.js')
    const { processMerge } = await import('../mergeProcessor.js')
    const { runLoop } = await import('../loopOrchestrator.js')

    const mapping = makeMapping(42)
    const messages = [makeMessage('msg-1', '타입 에러 수정 필요', 'allowed-user')]

    vi.mocked(loadAllMappings).mockReturnValue([mapping])
    vi.mocked(fetchThreadMessages).mockResolvedValue(messages)
    vi.mocked(isMergeApproval).mockReturnValue(false)
    await setupExecFileAsOpen() // Step 3 타임아웃 방지

    await runLoop()

    expect(processFeedback).toHaveBeenCalledWith(mapping, messages)
    expect(processMerge).not.toHaveBeenCalled()
  })

  it('허용되지 않은 발신자 메시지는 무시한다', async () => {
    const { loadAllMappings } = await import('../prThreadStore.js')
    const { fetchThreadMessages } = await import('../discordClient.js')
    const { processFeedback } = await import('../feedbackProcessor.js')
    const { processMerge } = await import('../mergeProcessor.js')
    const { runLoop } = await import('../loopOrchestrator.js')

    vi.mocked(loadAllMappings).mockReturnValue([makeMapping(42)])
    vi.mocked(fetchThreadMessages).mockResolvedValue([
      makeMessage('msg-1', '악성 명령', 'unknown-user'),
    ])
    await setupExecFileAsOpen() // Step 3 타임아웃 방지

    await runLoop()

    expect(processFeedback).not.toHaveBeenCalled()
    expect(processMerge).not.toHaveBeenCalled()
  })

  it('Step 1 실패해도 Step 2~3를 계속 실행한다', async () => {
    const { processIssues } = await import('../index.js')
    const { loadAllMappings } = await import('../prThreadStore.js')
    const { runLoop } = await import('../loopOrchestrator.js')

    vi.mocked(processIssues).mockRejectedValue(new Error('Step 1 오류'))
    vi.mocked(loadAllMappings).mockReturnValue([])

    await expect(runLoop()).resolves.not.toThrow()
  })

  it('Step 3에서 MERGED PR의 매핑을 삭제한다', async () => {
    const { loadAllMappings, removePrThreadMapping } = await import('../prThreadStore.js')
    const { execFile } = await import('node:child_process')
    const { fetchThreadMessages } = await import('../discordClient.js')
    const { runLoop } = await import('../loopOrchestrator.js')

    const mapping = makeMapping(42)

    vi.mocked(loadAllMappings).mockReturnValue([mapping])
    vi.mocked(fetchThreadMessages).mockResolvedValue([])

    // gh pr view — MERGED
    vi.mocked(execFile).mockImplementation(
      (_cmd, _args, _options, callback) => {
        const cb = callback as (error: null, stdout: string, stderr: string) => void
        cb(null, JSON.stringify({ state: 'MERGED' }), '')
        return { stdin: null } as unknown as ReturnType<typeof execFile>
      },
    )

    await runLoop()

    expect(removePrThreadMapping).toHaveBeenCalledWith(42)
  })
})
