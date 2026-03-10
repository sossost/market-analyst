import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { GitHubIssue } from '@/issue-processor/types'

const mockCreate = vi.hoisted(() => {
  // requireEnv가 모듈 로드 시 호출되므로 env 먼저 설정
  process.env.ANTHROPIC_API_KEY = 'test-key'
  return vi.fn()
})

vi.mock('@anthropic-ai/sdk', () => {
  class MockAnthropic {
    messages = { create: mockCreate }
  }
  return { default: MockAnthropic }
})

import { triageIssue } from '@/issue-processor/triageIssue'

function makeIssue(overrides: Partial<GitHubIssue> = {}): GitHubIssue {
  return {
    number: 42,
    title: 'fix: 타입 에러 수정',
    body: 'src/lib/foo.ts에서 타입 에러가 발생합니다.',
    labels: ['bug'],
    ...overrides,
  }
}

function mockLLMResponse(json: object): void {
  mockCreate.mockResolvedValueOnce({
    content: [{ type: 'text', text: JSON.stringify(json) }],
  })
}

describe('triageIssue', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('자율 처리 가능한 버그 이슈를 auto로 분류한다', async () => {
    mockLLMResponse({
      decision: 'auto',
      reason: '단순 타입 에러 수정으로 기존 패턴 내 수정',
      branchType: 'fix',
    })

    const result = await triageIssue(makeIssue())

    expect(result.decision).toBe('auto')
    expect(result.branchType).toBe('fix')
    expect(result.issueNumber).toBe(42)
    expect(result.reason).toContain('타입 에러')
  })

  it('새 기능 이슈를 needs-ceo로 분류한다', async () => {
    mockLLMResponse({
      decision: 'needs-ceo',
      reason: '새 기능 추가로 CEO 판단 필요',
      branchType: 'feat',
    })

    const result = await triageIssue(
      makeIssue({
        title: 'feat: 새로운 알림 시스템',
        labels: ['feature'],
      }),
    )

    expect(result.decision).toBe('needs-ceo')
  })

  it('LLM 응답이 코드펜스로 감싸져도 파싱한다', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [
        {
          type: 'text',
          text: '```json\n{"decision": "auto", "reason": "간단한 수정", "branchType": "fix"}\n```',
        },
      ],
    })

    const result = await triageIssue(makeIssue())

    expect(result.decision).toBe('auto')
  })

  it('LLM 응답 파싱 실패 시 보수적으로 needs-ceo 반환', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: '이것은 JSON이 아닙니다' }],
    })

    const result = await triageIssue(makeIssue())

    expect(result.decision).toBe('needs-ceo')
    expect(result.reason).toContain('파싱 실패')
  })

  it('유효하지 않은 branchType은 fix로 기본값 설정', async () => {
    mockLLMResponse({
      decision: 'auto',
      reason: '간단한 수정',
      branchType: 'invalid-type',
    })

    const result = await triageIssue(makeIssue())

    expect(result.branchType).toBe('fix')
  })

  it('LLM에 이슈 정보를 올바르게 전달한다', async () => {
    mockLLMResponse({
      decision: 'auto',
      reason: '수정 가능',
      branchType: 'fix',
    })

    const issue = makeIssue({
      number: 99,
      title: 'test issue',
      body: 'test body',
      labels: ['bug', 'P2: medium'],
    })

    await triageIssue(issue)

    const callArgs = mockCreate.mock.calls[0][0]
    expect(callArgs.messages[0].content).toContain('test issue')
    expect(callArgs.messages[0].content).toContain('test body')
    expect(callArgs.messages[0].content).toContain('bug, P2: medium')
  })
})
