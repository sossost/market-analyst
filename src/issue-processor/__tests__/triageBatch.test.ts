/**
 * triageBatch.ts — 배치 트리아지 단위 테스트
 *
 * 미트리아지 이슈 전체를 트리아지하고, 판정에 따라
 * 코멘트 + 라벨을 이슈에 기록하는 흐름을 검증한다.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { GitHubIssue } from '../types.js'

// ---------------------------------------------------------------------------
// 모킹
// ---------------------------------------------------------------------------

vi.mock('dotenv/config', () => ({}))

vi.mock('../githubClient.js', () => ({
  fetchUntriagedIssues: vi.fn(),
  addComment: vi.fn().mockResolvedValue(undefined),
  addLabel: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../triageIssue.js', () => ({
  triageIssue: vi.fn(),
}))

// ---------------------------------------------------------------------------
// 테스트 헬퍼
// ---------------------------------------------------------------------------

function createIssue(overrides: Partial<GitHubIssue> = {}): GitHubIssue {
  return {
    number: 10,
    title: 'feat: 새 기능',
    body: '기능 설명',
    labels: [],
    author: 'sossost',
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// runTriageBatch
// ---------------------------------------------------------------------------

describe('runTriageBatch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('미트리아지 이슈가 없으면 triageIssue를 호출하지 않는다', async () => {
    const { fetchUntriagedIssues } = await import('../githubClient.js')
    const { triageIssue } = await import('../triageIssue.js')

    vi.mocked(fetchUntriagedIssues).mockResolvedValue([])

    const { runTriageBatch } = await import('../triageBatch.js')
    await runTriageBatch()

    expect(triageIssue).not.toHaveBeenCalled()
  })

  it('PROCEED — 코멘트 + triaged 라벨을 부착한다', async () => {
    const { fetchUntriagedIssues, addComment, addLabel } = await import('../githubClient.js')
    const { triageIssue } = await import('../triageIssue.js')

    const issue = createIssue()
    vi.mocked(fetchUntriagedIssues).mockResolvedValue([issue])
    vi.mocked(triageIssue).mockResolvedValue({ verdict: 'PROCEED', comment: '구현 가이드' })

    const { runTriageBatch } = await import('../triageBatch.js')
    await runTriageBatch()

    // 코멘트는 남긴다
    expect(addComment).toHaveBeenCalledOnce()
    expect(vi.mocked(addComment).mock.calls[0][1]).toContain('[사전 트리아지]')
    expect(vi.mocked(addComment).mock.calls[0][1]).toContain('구현 가이드')

    // triaged 라벨을 부착한다
    expect(addLabel).toHaveBeenCalledWith(issue.number, 'triaged')
  })

  it('PROCEED + 빈 comment — addComment 호출하지 않고 triaged 라벨도 부착하지 않는다', async () => {
    const { fetchUntriagedIssues, addComment, addLabel } = await import('../githubClient.js')
    const { triageIssue } = await import('../triageIssue.js')

    vi.mocked(fetchUntriagedIssues).mockResolvedValue([createIssue()])
    vi.mocked(triageIssue).mockResolvedValue({ verdict: 'PROCEED', comment: '' })

    const { runTriageBatch } = await import('../triageBatch.js')
    await runTriageBatch()

    expect(addComment).not.toHaveBeenCalled()
    expect(addLabel).not.toHaveBeenCalled()
  })

  it('SKIP — 코멘트 + auto:blocked + triaged 라벨을 부착한다', async () => {
    const { fetchUntriagedIssues, addComment, addLabel } = await import('../githubClient.js')
    const { triageIssue } = await import('../triageIssue.js')

    const issue = createIssue({ number: 20 })
    vi.mocked(fetchUntriagedIssues).mockResolvedValue([issue])
    vi.mocked(triageIssue).mockResolvedValue({ verdict: 'SKIP', comment: '골 정렬 NEUTRAL' })

    const { runTriageBatch } = await import('../triageBatch.js')
    await runTriageBatch()

    expect(addComment).toHaveBeenCalledOnce()
    expect(vi.mocked(addComment).mock.calls[0][1]).toContain('골 정렬 NEUTRAL')

    expect(addLabel).toHaveBeenCalledWith(20, 'auto:blocked')
    expect(addLabel).toHaveBeenCalledWith(20, 'triaged')
  })

  it('SKIP + 빈 comment — 폴백으로 간주하여 코멘트/라벨 없이 다음 배치에서 재시도', async () => {
    const { fetchUntriagedIssues, addComment, addLabel } = await import('../githubClient.js')
    const { triageIssue } = await import('../triageIssue.js')

    const issue = createIssue({ number: 20 })
    vi.mocked(fetchUntriagedIssues).mockResolvedValue([issue])
    vi.mocked(triageIssue).mockResolvedValue({ verdict: 'SKIP', comment: '' })

    const { runTriageBatch } = await import('../triageBatch.js')
    await runTriageBatch()

    expect(addComment).not.toHaveBeenCalled()
    expect(addLabel).not.toHaveBeenCalled()
  })

  it('ESCALATE — 코멘트 + auto:needs-ceo + triaged 라벨을 부착한다', async () => {
    const { fetchUntriagedIssues, addComment, addLabel } = await import('../githubClient.js')
    const { triageIssue } = await import('../triageIssue.js')

    const issue = createIssue({ number: 30 })
    vi.mocked(fetchUntriagedIssues).mockResolvedValue([issue])
    vi.mocked(triageIssue).mockResolvedValue({ verdict: 'ESCALATE', comment: '판단 불가' })

    const { runTriageBatch } = await import('../triageBatch.js')
    await runTriageBatch()

    expect(addComment).toHaveBeenCalledOnce()
    expect(vi.mocked(addComment).mock.calls[0][1]).toContain('판단 불가')

    expect(addLabel).toHaveBeenCalledWith(30, 'auto:needs-ceo')
    expect(addLabel).toHaveBeenCalledWith(30, 'triaged')
  })

  it('여러 이슈를 순서대로 모두 트리아지한다', async () => {
    const { fetchUntriagedIssues, addLabel } = await import('../githubClient.js')
    const { triageIssue } = await import('../triageIssue.js')

    vi.mocked(fetchUntriagedIssues).mockResolvedValue([
      createIssue({ number: 1 }),
      createIssue({ number: 2 }),
      createIssue({ number: 3 }),
    ])
    vi.mocked(triageIssue)
      .mockResolvedValueOnce({ verdict: 'PROCEED', comment: '가이드1' })
      .mockResolvedValueOnce({ verdict: 'SKIP', comment: '스킵' })
      .mockResolvedValueOnce({ verdict: 'ESCALATE', comment: '에스컬레이트' })

    const { runTriageBatch } = await import('../triageBatch.js')

    // 딜레이를 즉시 처리하기 위해 Promise와 타이머를 함께 진행
    const batchPromise = runTriageBatch()
    await vi.runAllTimersAsync()
    await batchPromise

    expect(triageIssue).toHaveBeenCalledTimes(3)
    // comment가 있는 판정에만 triaged 라벨 부착
    expect(addLabel).toHaveBeenCalledWith(1, 'triaged')    // PROCEED + comment 있음
    expect(addLabel).toHaveBeenCalledWith(2, 'auto:blocked')  // SKIP + comment 있음
    expect(addLabel).toHaveBeenCalledWith(2, 'triaged')
    expect(addLabel).toHaveBeenCalledWith(3, 'auto:needs-ceo') // ESCALATE + comment 있음
    expect(addLabel).toHaveBeenCalledWith(3, 'triaged')
  })

  it('한 이슈 트리아지 실패 시 다음 이슈를 계속 처리한다', async () => {
    const { fetchUntriagedIssues, addLabel } = await import('../githubClient.js')
    const { triageIssue } = await import('../triageIssue.js')

    vi.mocked(fetchUntriagedIssues).mockResolvedValue([
      createIssue({ number: 1 }),
      createIssue({ number: 2 }),
    ])
    vi.mocked(triageIssue)
      .mockRejectedValueOnce(new Error('CLI 실패'))
      .mockResolvedValueOnce({ verdict: 'SKIP', comment: '스킵' })

    const { runTriageBatch } = await import('../triageBatch.js')

    const batchPromise = runTriageBatch()
    await vi.runAllTimersAsync()
    await expect(batchPromise).resolves.toBeUndefined()

    // 첫 이슈 실패해도 두 번째 이슈는 처리됨
    expect(triageIssue).toHaveBeenCalledTimes(2)
    expect(addLabel).toHaveBeenCalledWith(2, 'auto:blocked')
    expect(addLabel).toHaveBeenCalledWith(2, 'triaged')
  })

  it('트리아지 코멘트 헤더 형식이 [사전 트리아지] 마커를 포함한다', async () => {
    const { fetchUntriagedIssues, addComment } = await import('../githubClient.js')
    const { triageIssue } = await import('../triageIssue.js')

    vi.mocked(fetchUntriagedIssues).mockResolvedValue([createIssue()])
    vi.mocked(triageIssue).mockResolvedValue({ verdict: 'PROCEED', comment: '분석 내용' })

    const { runTriageBatch } = await import('../triageBatch.js')
    await runTriageBatch()

    const commentBody = vi.mocked(addComment).mock.calls[0][1] as string
    expect(commentBody).toContain('**[사전 트리아지]**')
    expect(commentBody).toContain('분석 내용')
  })

  it('이슈가 2건 이상이면 마지막 이슈 제외하고 딜레이를 삽입한다', async () => {
    const { fetchUntriagedIssues } = await import('../githubClient.js')
    const { triageIssue } = await import('../triageIssue.js')

    vi.mocked(fetchUntriagedIssues).mockResolvedValue([
      createIssue({ number: 1 }),
      createIssue({ number: 2 }),
    ])
    vi.mocked(triageIssue)
      .mockResolvedValueOnce({ verdict: 'PROCEED', comment: '가이드' })
      .mockResolvedValueOnce({ verdict: 'PROCEED', comment: '가이드' })

    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')

    const { runTriageBatch } = await import('../triageBatch.js')

    const batchPromise = runTriageBatch()
    await vi.runAllTimersAsync()
    await batchPromise

    // 이슈 2건 → 딜레이 1회
    const delayCallCount = setTimeoutSpy.mock.calls.filter(
      ([, delay]) => delay === 10_000,
    ).length
    expect(delayCallCount).toBe(1)
  })

  it('이슈가 1건이면 딜레이를 삽입하지 않는다', async () => {
    const { fetchUntriagedIssues } = await import('../githubClient.js')
    const { triageIssue } = await import('../triageIssue.js')

    vi.mocked(fetchUntriagedIssues).mockResolvedValue([createIssue({ number: 1 })])
    vi.mocked(triageIssue).mockResolvedValue({ verdict: 'PROCEED', comment: '가이드' })

    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')

    const { runTriageBatch } = await import('../triageBatch.js')
    await runTriageBatch()

    const delayCallCount = setTimeoutSpy.mock.calls.filter(
      ([, delay]) => delay === 10_000,
    ).length
    expect(delayCallCount).toBe(0)
  })
})
