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

type ExecFileCallback = (error: Error | null, stdout: string, stderr: string) => void

function mockExecSequence(
  mockFn: ReturnType<typeof vi.fn>,
  responses: Array<{ error?: Error; stdout?: string; stderr?: string }>,
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
        callback(response.error, '', response.stderr ?? '')
      } else {
        callback(null, response.stdout ?? '', response.stderr ?? '')
      }
      return { stdin: null }
    },
  )
}

/** 리뷰 없는 OPEN PR의 리뷰 체크까지 시퀀스 (merge 미포함) */
function openPrNoReviewCheckSequence() {
  return [
    // 1. gh pr view (상태 확인) — OPEN
    { stdout: JSON.stringify({ state: 'OPEN' }) },
    // 2. gh api (리뷰 코멘트 조회) — 없음
    { stdout: '' },
    // 3. gh pr view --json reviews (변경 요청 확인) — 없음
    { stdout: JSON.stringify({ reviews: [] }) },
  ]
}

/** 리뷰 없는 OPEN PR의 전체 시퀀스 (merge + fetchMergedFiles 포함) */
function openPrNoReviewSequence() {
  return [
    ...openPrNoReviewCheckSequence(),
    // 4. gh pr merge
    { stdout: '' },
    // 5. gh pr view --json files (fetchMergedFiles — 인프라 반영 대상 없음)
    { stdout: JSON.stringify({ files: [] }) },
  ]
}

// ---------------------------------------------------------------------------
// processMerge
// ---------------------------------------------------------------------------

describe('processMerge', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('OPEN PR (리뷰 없음)을 squash merge하고 매핑을 삭제한다', async () => {
    const { execFile } = await import('node:child_process')
    const { sendThreadMessage } = await import('../discordClient.js')
    const { removePrThreadMapping } = await import('../prThreadStore.js')
    const { processMerge } = await import('../mergeProcessor.js')

    mockExecSequence(vi.mocked(execFile), [
      ...openPrNoReviewSequence(),
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

  it('리뷰 코멘트가 있으면 Claude Code CLI로 반영 후 머지한다', async () => {
    const { execFile } = await import('node:child_process')
    const { sendThreadMessage } = await import('../discordClient.js')
    const { removePrThreadMapping } = await import('../prThreadStore.js')
    const { processMerge } = await import('../mergeProcessor.js')

    mockExecSequence(vi.mocked(execFile), [
      // 1. gh pr view — OPEN
      { stdout: JSON.stringify({ state: 'OPEN' }) },
      // 2. gh api (리뷰 코멘트) — 있음
      { stdout: JSON.stringify({ body: 'null check 추가 필요', path: 'src/index.ts', author: { login: 'gemini' }, state: 'COMMENTED' }) },
      // 3. gh pr view --json reviews — CHANGES_REQUESTED
      { stdout: JSON.stringify({ reviews: [{ state: 'CHANGES_REQUESTED', author: { login: 'gemini' }, body: '' }] }) },
      // 4. Claude Code CLI (리뷰 반영) — stdin으로 프롬프트 전달
      { stdout: '' },
      // 5. gh pr merge
      { stdout: '' },
      // 6. gh pr view --json files (fetchMergedFiles — 인프라 반영 대상 없음)
      { stdout: JSON.stringify({ files: [] }) },
      // 7~9. 로컬 브랜치 정리
      { stdout: '' }, // git checkout main
      { stdout: '' }, // git pull
      { stdout: '  main' }, // git branch
    ])

    await processMerge(makeMapping(42))

    // 리뷰 발견 알림
    expect(sendThreadMessage).toHaveBeenCalledWith(
      'thread-42',
      expect.stringContaining('리뷰 발견'),
    )
    // 반영 완료 알림
    expect(sendThreadMessage).toHaveBeenCalledWith(
      'thread-42',
      expect.stringContaining('반영 완료'),
    )
    // 머지 완료
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
      ...openPrNoReviewCheckSequence(),
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
      ...openPrNoReviewSequence(),
      // git checkout main
      { stdout: '' },
      // git pull
      { stdout: '' },
      // git branch — 브랜치 존재
      { stdout: `  main\n  ${branchName}` },
      // git branch -d
      { stdout: '' },
    ])

    await processMerge(makeMapping(42, { branchName }))

    expect(removePrThreadMapping).toHaveBeenCalledWith(42)

    // git branch -d 호출 확인
    const calls = vi.mocked(execFile).mock.calls
    const deleteBranchCall = calls.find((call) => {
      const args = call[1] as string[]
      return args.includes('-d') && args.includes(branchName)
    })
    expect(deleteBranchCall).toBeDefined()
  })

  it('DB 마이그레이션: exit 0 + stderr error: 패턴 → 실패 처리 (매핑 유지)', async () => {
    const { execFile } = await import('node:child_process')
    const { sendThreadMessage } = await import('../discordClient.js')
    const { removePrThreadMapping } = await import('../prThreadStore.js')
    const { processMerge } = await import('../mergeProcessor.js')

    mockExecSequence(vi.mocked(execFile), [
      ...openPrNoReviewCheckSequence(),
      // gh pr merge — 성공
      { stdout: '' },
      // gh pr view --json files — DB 스키마 변경 포함
      { stdout: JSON.stringify({ files: [{ path: 'src/db/schema/users.ts' }] }) },
      // yarn db:push --force — exit 0이지만 stderr에 error: 포함
      { stdout: '', stderr: 'error: relation "users" already exists' },
    ])

    await processMerge(makeMapping(42))

    // 인프라 반영 실패 알림
    expect(sendThreadMessage).toHaveBeenCalledWith(
      'thread-42',
      expect.stringContaining('인프라 반영 실패'),
    )
    // 매핑 삭제하지 않음
    expect(removePrThreadMapping).not.toHaveBeenCalled()
  })

  it('DB 마이그레이션: exit 0 + stdout error: 패턴 → 실패 처리 (매핑 유지)', async () => {
    const { execFile } = await import('node:child_process')
    const { sendThreadMessage } = await import('../discordClient.js')
    const { removePrThreadMapping } = await import('../prThreadStore.js')
    const { processMerge } = await import('../mergeProcessor.js')

    mockExecSequence(vi.mocked(execFile), [
      ...openPrNoReviewCheckSequence(),
      // gh pr merge — 성공
      { stdout: '' },
      // gh pr view --json files — DB 스키마 변경 포함
      { stdout: JSON.stringify({ files: [{ path: 'db/migrations/0001.sql' }] }) },
      // yarn db:push --force — exit 0이지만 stdout에 error: 포함
      { stdout: 'error: type mismatch on column "amount"', stderr: '' },
    ])

    await processMerge(makeMapping(42))

    expect(sendThreadMessage).toHaveBeenCalledWith(
      'thread-42',
      expect.stringContaining('인프라 반영 실패'),
    )
    expect(removePrThreadMapping).not.toHaveBeenCalled()
  })

  it('인프라 반영 실패 시 스레드 알림 후 return — 머지 완료 알림은 보내지 않는다', async () => {
    const { execFile } = await import('node:child_process')
    const { sendThreadMessage } = await import('../discordClient.js')
    const { processMerge } = await import('../mergeProcessor.js')

    mockExecSequence(vi.mocked(execFile), [
      ...openPrNoReviewCheckSequence(),
      // gh pr merge — 성공
      { stdout: '' },
      // gh pr view --json files — DB 스키마 변경 포함
      { stdout: JSON.stringify({ files: [{ path: 'src/db/schema/foo.ts' }] }) },
      // yarn db:push --force — 프로세스 에러 (exit code != 0)
      { error: new Error('Command failed: yarn db:push') },
    ])

    await processMerge(makeMapping(42))

    // 인프라 실패 알림은 있어야 함
    expect(sendThreadMessage).toHaveBeenCalledWith(
      'thread-42',
      expect.stringContaining('인프라 반영 실패'),
    )
    // "머지되었습니다" 완료 알림은 없어야 함 (return으로 중단)
    const allCalls = vi.mocked(sendThreadMessage).mock.calls
    const completionCall = allCalls.find(
      ([, msg]) => typeof msg === 'string' && msg.includes('머지되었습니다'),
    )
    expect(completionCall).toBeUndefined()
  })
})
