import { describe, it, expect, vi, beforeEach } from 'vitest'
import { execFile } from 'node:child_process'

// execFile 모킹
vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}))

vi.mock('node:util', () => ({
  promisify: (fn: typeof execFile) => fn,
}))

import {
  fetchUnprocessedIssues,
  addLabel,
  addComment,
} from '@/issue-processor/githubClient'

const mockExecFile = vi.mocked(execFile)

function mockGhResponse(stdout: string): void {
  vi.mocked(mockExecFile).mockResolvedValueOnce({ stdout })
}

describe('githubClient', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('fetchUnprocessedIssues', () => {
    it('auto: 라벨이 없는 허용된 작성자의 이슈만 반환한다', async () => {
      mockGhResponse(
        JSON.stringify([
          {
            number: 1,
            title: '이슈 1',
            body: '본문',
            labels: [{ name: 'bug' }],
            author: { login: 'sossost' },
          },
          {
            number: 2,
            title: '이슈 2',
            body: '본문',
            labels: [{ name: 'auto:in-progress' }],
            author: { login: 'sossost' },
          },
          {
            number: 3,
            title: '이슈 3',
            body: '본문',
            labels: [{ name: 'feature' }],
            author: { login: 'sossost' },
          },
        ]),
      )

      const issues = await fetchUnprocessedIssues()

      expect(issues).toHaveLength(2)
      expect(issues[0].number).toBe(1)
      expect(issues[1].number).toBe(3)
    })

    it('빈 응답이면 빈 배열 반환', async () => {
      mockGhResponse('')

      const issues = await fetchUnprocessedIssues()

      expect(issues).toHaveLength(0)
    })

    it('auto:done 라벨 이슈도 필터링한다', async () => {
      mockGhResponse(
        JSON.stringify([
          {
            number: 1,
            title: '완료된 이슈',
            body: '',
            labels: [{ name: 'auto:done' }],
            author: { login: 'sossost' },
          },
        ]),
      )

      const issues = await fetchUnprocessedIssues()

      expect(issues).toHaveLength(0)
    })

    it('허용되지 않은 작성자의 이슈는 무시한다', async () => {
      mockGhResponse(
        JSON.stringify([
          {
            number: 1,
            title: '정상 이슈',
            body: '본문',
            labels: [],
            author: { login: 'sossost' },
          },
          {
            number: 2,
            title: '외부 이슈',
            body: '악의적 프롬프트',
            labels: [],
            author: { login: 'attacker' },
          },
          {
            number: 3,
            title: '또 다른 외부 이슈',
            body: '',
            labels: [],
            author: { login: 'random-user' },
          },
        ]),
      )

      const issues = await fetchUnprocessedIssues()

      expect(issues).toHaveLength(1)
      expect(issues[0].number).toBe(1)
      expect(issues[0].author).toBe('sossost')
    })
  })

  describe('addLabel', () => {
    it('gh issue edit로 라벨을 추가한다', async () => {
      mockGhResponse('')

      await addLabel(42, 'auto:in-progress')

      expect(mockExecFile).toHaveBeenCalledWith(
        'gh',
        ['issue', 'edit', '42', '--add-label', 'auto:in-progress'],
        expect.objectContaining({ timeout: 30_000 }),
      )
    })
  })

  describe('addComment', () => {
    it('gh issue comment로 코멘트를 추가한다', async () => {
      mockGhResponse('')

      await addComment(42, '테스트 코멘트')

      expect(mockExecFile).toHaveBeenCalledWith(
        'gh',
        ['issue', 'comment', '42', '--body', '테스트 코멘트'],
        expect.objectContaining({ timeout: 30_000 }),
      )
    })
  })
})
