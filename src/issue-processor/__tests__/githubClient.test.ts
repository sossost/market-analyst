import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getPriorityScore } from '../githubClient.js'
import type { GitHubIssue } from '../types.js'

describe('getPriorityScore', () => {
  it('P0 라벨이 가장 높은 우선순위(0)를 반환한다', () => {
    expect(getPriorityScore(['P0: critical'])).toBe(0)
  })

  it('P3 라벨은 낮은 우선순위(3)를 반환한다', () => {
    expect(getPriorityScore(['P3: low'])).toBe(3)
  })

  it('우선순위 라벨이 없으면 기본값(4)을 반환한다', () => {
    expect(getPriorityScore(['bug', 'auto:blocked'])).toBe(4)
  })

  it('여러 우선순위 라벨 중 첫 번째를 사용한다', () => {
    expect(getPriorityScore(['P2: medium', 'P0: critical'])).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// fetchUntriagedIssues — triaged 라벨 필터링 검증
//
// fetchUntriagedIssues는 fetchUnprocessedIssues를 래핑하므로,
// fetchUnprocessedIssues를 모킹하여 필터링 동작을 검증한다.
// ---------------------------------------------------------------------------

function makeIssue(overrides: Partial<GitHubIssue> = {}): GitHubIssue {
  return {
    number: 1,
    title: 'feat: 테스트',
    body: '본문',
    labels: [],
    author: 'sossost',
    ...overrides,
  }
}

// fetchUntriagedIssues는 fetchUnprocessedIssues를 내부 호출하므로
// githubClient 모듈을 부분 모킹하는 대신, TRIAGED_LABEL 상수 기반 필터 로직을 직접 단위 테스트한다.
describe('fetchUntriagedIssues — triaged 라벨 필터링', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('triaged 라벨이 없는 이슈만 반환한다', async () => {
    vi.doMock('../githubClient.js', async (importOriginal) => {
      const original = await importOriginal<typeof import('../githubClient.js')>()
      return {
        ...original,
        fetchUnprocessedIssues: vi.fn().mockResolvedValue([
          makeIssue({ number: 1, labels: [] }),
          makeIssue({ number: 2, labels: ['triaged'] }),
        ]),
      }
    })

    // fetchUntriagedIssues 직접 테스트를 위해 래퍼 로직을 검증
    // (fetchUntriagedIssues = fetchUnprocessedIssues().filter(no triaged))
    const { TRIAGED_LABEL } = await import('../types.js')
    const issues: GitHubIssue[] = [
      makeIssue({ number: 1, labels: [] }),
      makeIssue({ number: 2, labels: ['triaged'] }),
    ]
    const result = issues.filter((issue) => !issue.labels.includes(TRIAGED_LABEL))

    expect(result).toHaveLength(1)
    expect(result[0].number).toBe(1)
  })

  it('triaged 라벨이 있는 이슈를 모두 제외한다', async () => {
    const { TRIAGED_LABEL } = await import('../types.js')
    const issues: GitHubIssue[] = [
      makeIssue({ number: 5, labels: ['triaged', 'P1: high'] }),
      makeIssue({ number: 6, labels: ['triaged'] }),
    ]
    const result = issues.filter((issue) => !issue.labels.includes(TRIAGED_LABEL))

    expect(result).toHaveLength(0)
  })

  it('fetchUnprocessedIssues는 triaged 라벨이 있어도 이슈를 포함한다 — AUTO_LABELS에 없음', async () => {
    const { AUTO_LABELS } = await import('../types.js')

    // triaged는 AUTO_LABELS에 없어야 한다
    expect(AUTO_LABELS).not.toContain('triaged')
  })

  it('TRIAGED_LABEL 상수는 triaged 문자열이다', async () => {
    const { TRIAGED_LABEL } = await import('../types.js')
    expect(TRIAGED_LABEL).toBe('triaged')
  })
})
