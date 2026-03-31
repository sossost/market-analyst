import { describe, it, expect } from 'vitest'
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

// ---------------------------------------------------------------------------
// fetchUnprocessedIssues / fetchUntriagedIssues 필터 로직 검증
//
// gh CLI는 promisify.custom 바인딩 문제로 직접 모킹이 복잡하다.
// 두 함수의 핵심은 fetchCandidateIssues() 결과에 적용하는 필터이므로,
// 동일한 필터 조건을 인라인으로 검증한다.
// ---------------------------------------------------------------------------

import { AUTO_LABELS, TRIAGED_LABEL } from '../types.js'

/** fetchUnprocessedIssues 내부 필터와 동일한 조건 */
function isUnprocessed(issue: GitHubIssue): boolean {
  const hasAutoLabel = issue.labels.some((name) =>
    AUTO_LABELS.includes(name as never),
  )
  return !hasAutoLabel && issue.labels.includes(TRIAGED_LABEL)
}

/** fetchUntriagedIssues 내부 필터와 동일한 조건 */
function isUntriaged(issue: GitHubIssue): boolean {
  const hasAutoLabel = issue.labels.some((name) =>
    AUTO_LABELS.includes(name as never),
  )
  return !hasAutoLabel && !issue.labels.includes(TRIAGED_LABEL)
}

describe('fetchUnprocessedIssues 필터 — triaged 필수 게이트', () => {
  it('triaged 있고 auto: 없는 이슈만 통과한다', () => {
    const issues: GitHubIssue[] = [
      { number: 1, title: '', body: '', labels: [], author: 'sossost' },
      { number: 2, title: '', body: '', labels: ['triaged'], author: 'sossost' },
      { number: 3, title: '', body: '', labels: ['triaged', 'auto:blocked'], author: 'sossost' },
    ]
    const result = issues.filter(isUnprocessed)
    expect(result).toHaveLength(1)
    expect(result[0].number).toBe(2)
  })

  it('triaged 없는 이슈는 triage 대기 중으로 간주해 제외한다', () => {
    const issue: GitHubIssue = { number: 10, title: '', body: '', labels: [], author: 'sossost' }
    expect(isUnprocessed(issue)).toBe(false)
  })
})

describe('fetchUntriagedIssues 필터 — triageBatch 전용', () => {
  it('triaged 없고 auto: 없는 이슈만 반환한다', () => {
    const issues: GitHubIssue[] = [
      { number: 1, title: '', body: '', labels: [], author: 'sossost' },
      { number: 2, title: '', body: '', labels: ['triaged'], author: 'sossost' },
      { number: 3, title: '', body: '', labels: ['auto:blocked'], author: 'sossost' },
    ]
    const result = issues.filter(isUntriaged)
    expect(result).toHaveLength(1)
    expect(result[0].number).toBe(1)
  })
})

describe('상수 검증', () => {
  it('triaged는 AUTO_LABELS에 포함되지 않는다', () => {
    expect(AUTO_LABELS).not.toContain('triaged')
  })

  it('TRIAGED_LABEL 상수는 triaged 문자열이다', () => {
    expect(TRIAGED_LABEL).toBe('triaged')
  })
})
