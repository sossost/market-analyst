/**
 * mergeProcessor.ts 단위 테스트
 *
 * 외부 의존성(gh CLI, git, Discord API)은 vi.fn()으로 모킹.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PrThreadMapping } from '../types.js'

// ---------------------------------------------------------------------------
// 모킹 — vi.mock은 호이스팅되므로 최상단에 배치
// ---------------------------------------------------------------------------

vi.mock('../discordClient.js', () => ({
  sendThreadMessage: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../prThreadStore.js', () => ({
  removePrThreadMapping: vi.fn(),
}))

// node:child_process 전체 모킹
vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
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

/**
 * execFile mock을 통해 gh/git 호출을 시뮬레이션하는 헬퍼.
 * promisify(execFile)은 내부적으로 execFile callback 패턴을 Promise로 변환.
 * callback-based mock을 시퀀셜로 등록.
 */
type ExecFileCallback = (error: Error | null, stdout: string, stderr: string) => void

function mockExecSequence(
  mockFn: ReturnType<typeof vi.fn>,
  responses: Array<{ error?: Error; stdout?: string }>,
) {
  let callIndex = 0
  mockFn.mockImplementation(
    (_cmd: string, _args: string[], _options: unknown, callback: ExecFileCallback) => {
      const response = responses[callIndex++]
      if (response == null) {
        callback(new Error('Unexpected call'), '', '')
        return { stdin: null }
      }
      if (response.error != null) {
        callback(response.error, '', '')
      } else {
        callback(null, response.stdout ?? '', '')
      }
      return { stdin: null }
    },
  )
}

// ---------------------------------------------------------------------------
// processMerge
// ---------------------------------------------------------------------------

describe('processMerge', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('OPEN PR을 squash merge하고 매핑을 삭제한다', async () => {
    const { execFile } = await import('node:child_process')
    const { sendThreadMessage } = await import('../discordClient.js')
    const { removePrThreadMapping } = await import('../prThreadStore.js')
    const { processMerge } = await import('../mergeProcessor.js')

    mockExecSequence(vi.mocked(execFile), [
      // gh pr view (상태 확인) — OPEN
      { stdout: JSON.stringify({ state: 'OPEN' }) },
      // gh pr merge
      { stdout: '' },
      // git checkout main
      { stdout: '' },
      // git pull
      { stdout: '' },
      // git branch (로컬 브랜치 목록 — 대상 브랜치 없음)
      { stdout: '  main\n  other-branch' },
    ])

    await processMerge(makeMapping(42))

    expect(sendThreadMessage).toHaveBeenCalledWith(
      'thread-42',
      expect.stringContaining('머지되었습니다'),
    )
    expect(removePrThreadMapping).toHaveBeenCalledWith(42)
  })

  it('MERGED 상태의 PR은 머지를 스킵하고 매핑을 삭제한다', async () => {
    const { execFile } = await import('node:child_process')
    const { sendThreadMessage } = await import('../discordClient.js')
    const { removePrThreadMapping } = await import('../prThreadStore.js')
    const { processMerge } = await import('../mergeProcessor.js')

    mockExecSequence(vi.mocked(execFile), [
      { stdout: JSON.stringify({ state: 'MERGED' }) },
    ])

    await processMerge(makeMapping(42))

    expect(sendThreadMessage).toHaveBeenCalledWith(
      'thread-42',
      expect.stringContaining('MERGED'),
    )
    expect(removePrThreadMapping).toHaveBeenCalledWith(42)
  })

  it('CLOSED 상태의 PR은 머지를 스킵하고 매핑을 삭제한다', async () => {
    const { execFile } = await import('node:child_process')
    const { removePrThreadMapping } = await import('../prThreadStore.js')
    const { processMerge } = await import('../mergeProcessor.js')

    mockExecSequence(vi.mocked(execFile), [
      { stdout: JSON.stringify({ state: 'CLOSED' }) },
    ])

    await processMerge(makeMapping(42))

    expect(removePrThreadMapping).toHaveBeenCalledWith(42)
  })

  it('PR 상태 조회 실패 시 스레드에 실패 알림을 보내고 매핑은 유지한다', async () => {
    const { execFile } = await import('node:child_process')
    const { sendThreadMessage } = await import('../discordClient.js')
    const { removePrThreadMapping } = await import('../prThreadStore.js')
    const { processMerge } = await import('../mergeProcessor.js')

    mockExecSequence(vi.mocked(execFile), [
      { error: new Error('gh: command not found') },
    ])

    await processMerge(makeMapping(42))

    expect(sendThreadMessage).toHaveBeenCalledWith(
      'thread-42',
      expect.stringContaining('실패'),
    )
    expect(removePrThreadMapping).not.toHaveBeenCalled()
  })

  it('squash merge 실패 시 스레드에 실패 알림을 보내고 매핑은 유지한다', async () => {
    const { execFile } = await import('node:child_process')
    const { sendThreadMessage } = await import('../discordClient.js')
    const { removePrThreadMapping } = await import('../prThreadStore.js')
    const { processMerge } = await import('../mergeProcessor.js')

    mockExecSequence(vi.mocked(execFile), [
      // gh pr view — OPEN
      { stdout: JSON.stringify({ state: 'OPEN' }) },
      // gh pr merge — 실패
      { error: new Error('merge conflict') },
    ])

    await processMerge(makeMapping(42))

    expect(sendThreadMessage).toHaveBeenCalledWith(
      'thread-42',
      expect.stringContaining('실패'),
    )
    expect(removePrThreadMapping).not.toHaveBeenCalled()
  })

  it('로컬 브랜치가 존재하면 삭제 후 매핑을 정리한다', async () => {
    const { execFile } = await import('node:child_process')
    const { removePrThreadMapping } = await import('../prThreadStore.js')
    const { processMerge } = await import('../mergeProcessor.js')

    const branchName = 'feat/issue-420'

    mockExecSequence(vi.mocked(execFile), [
      // gh pr view
      { stdout: JSON.stringify({ state: 'OPEN' }) },
      // gh pr merge
      { stdout: '' },
      // git checkout main
      { stdout: '' },
      // git pull
      { stdout: '' },
      // git branch — 브랜치 존재
      { stdout: `  main\n  ${branchName}` },
      // git branch -d
      { stdout: '' },
    ])

    await processMerge(makeMapping(42))

    expect(removePrThreadMapping).toHaveBeenCalledWith(42)

    // git branch -d 호출 확인
    const calls = vi.mocked(execFile).mock.calls
    const deleteBranchCall = calls.find((call) => {
      const args = call[1] as string[]
      return args.includes('-d') && args.includes(branchName)
    })
    expect(deleteBranchCall).toBeDefined()
  })
})
