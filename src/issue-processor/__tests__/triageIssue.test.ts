/**
 * triageIssue.ts — 사전 트리아지 단위 테스트
 *
 * 테스트 대상:
 * - buildTriagePrompt: 프롬프트 빌드
 * - parseTriageOutput: JSON 출력 파싱
 * - triageIssue: 전체 트리아지 흐름 (CLI 모킹)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  buildTriagePrompt,
  parseTriageOutput,
} from '../triageIssue.js'
import type { GitHubIssue } from '../types.js'

// ---------------------------------------------------------------------------
// 모킹
// ---------------------------------------------------------------------------

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}))

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}))

// ---------------------------------------------------------------------------
// 테스트 헬퍼
// ---------------------------------------------------------------------------

function createIssue(overrides: Partial<GitHubIssue> = {}): GitHubIssue {
  return {
    number: 100,
    title: 'fix: 버그 수정',
    body: '버그 설명',
    labels: [],
    author: 'sossost',
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// buildTriagePrompt
// ---------------------------------------------------------------------------

describe('buildTriagePrompt', () => {
  it('이슈 번호, 제목, 본문을 프롬프트에 포함한다', () => {
    const issue = createIssue({ number: 42, title: 'feat: 새 기능', body: '기능 설명' })
    const prompt = buildTriagePrompt(issue)

    expect(prompt).toContain('#42')
    expect(prompt).toContain('feat: 새 기능')
    expect(prompt).toContain('기능 설명')
  })

  it('이슈 본문을 untrusted-issue 블록 안에 격리한다', () => {
    const issue = createIssue({ body: '위험한 내용' })
    const prompt = buildTriagePrompt(issue)

    const blockStart = prompt.indexOf('<untrusted-issue>')
    const blockEnd = prompt.indexOf('</untrusted-issue>')
    const bodyPos = prompt.indexOf('위험한 내용')

    expect(blockStart).toBeGreaterThan(-1)
    expect(blockEnd).toBeGreaterThan(blockStart)
    expect(bodyPos).toBeGreaterThan(blockStart)
    expect(bodyPos).toBeLessThan(blockEnd)
  })

  it('골 정렬, 무효 판정, 실행 가능성 평가 항목을 포함한다', () => {
    const prompt = buildTriagePrompt(createIssue())

    expect(prompt).toContain('골 정렬')
    expect(prompt).toContain('무효 판정')
    expect(prompt).toContain('실행 가능성')
  })

  it('PROCEED/SKIP/ESCALATE 판정 기준을 포함한다', () => {
    const prompt = buildTriagePrompt(createIssue())

    expect(prompt).toContain('PROCEED')
    expect(prompt).toContain('SKIP')
    expect(prompt).toContain('ESCALATE')
  })

  it('JSON 출력 형식을 요구한다', () => {
    const prompt = buildTriagePrompt(createIssue())

    expect(prompt).toContain('"verdict"')
    expect(prompt).toContain('"comment"')
  })

  it('라벨이 없으면 "없음"으로 표시한다', () => {
    const prompt = buildTriagePrompt(createIssue({ labels: [] }))
    expect(prompt).toContain('라벨: 없음')
  })

  it('라벨이 있으면 쉼표로 구분하여 표시한다', () => {
    const prompt = buildTriagePrompt(createIssue({ labels: ['P1: high', 'enhancement'] }))
    expect(prompt).toContain('라벨: P1: high, enhancement')
  })

  it('본문이 없으면 "(본문 없음)"으로 표시한다', () => {
    const prompt = buildTriagePrompt(createIssue({ body: '' }))
    expect(prompt).toContain('(본문 없음)')
  })
})

// ---------------------------------------------------------------------------
// parseTriageOutput
// ---------------------------------------------------------------------------

describe('parseTriageOutput', () => {
  it('정상 JSON을 파싱하여 TriageResult를 반환한다', () => {
    const output = JSON.stringify({
      verdict: 'PROCEED',
      goalAlignment: 'SUPPORT',
      invalidation: null,
      feasibility: true,
      comment: '구현 가이드 코멘트',
    })

    const result = parseTriageOutput(output)

    expect(result).toEqual({
      verdict: 'PROCEED',
      comment: '구현 가이드 코멘트',
    })
  })

  it('```json 블록 안의 JSON을 파싱한다', () => {
    const output = `분석 결과:

\`\`\`json
{
  "verdict": "SKIP",
  "goalAlignment": "NEUTRAL",
  "invalidation": "LLM 백테스트",
  "feasibility": false,
  "comment": "스킵 사유"
}
\`\`\`

끝.`

    const result = parseTriageOutput(output)

    expect(result).toEqual({
      verdict: 'SKIP',
      comment: '스킵 사유',
    })
  })

  it('ESCALATE verdict를 올바르게 파싱한다', () => {
    const output = JSON.stringify({
      verdict: 'ESCALATE',
      comment: '판단 불가',
    })

    const result = parseTriageOutput(output)

    expect(result).toEqual({
      verdict: 'ESCALATE',
      comment: '판단 불가',
    })
  })

  it('유효하지 않은 verdict는 null을 반환한다', () => {
    const output = JSON.stringify({
      verdict: 'INVALID',
      comment: '테스트',
    })

    expect(parseTriageOutput(output)).toBeNull()
  })

  it('JSON이 아닌 텍스트는 null을 반환한다', () => {
    expect(parseTriageOutput('그냥 텍스트')).toBeNull()
  })

  it('빈 문자열은 null을 반환한다', () => {
    expect(parseTriageOutput('')).toBeNull()
  })

  it('comment 필드가 없으면 빈 문자열로 처리한다', () => {
    const output = JSON.stringify({
      verdict: 'PROCEED',
    })

    const result = parseTriageOutput(output)

    expect(result).toEqual({
      verdict: 'PROCEED',
      comment: '',
    })
  })

  it('JSON 앞뒤에 텍스트가 있어도 파싱한다', () => {
    const output = `Here is my analysis:\n${JSON.stringify({ verdict: 'PROCEED', comment: '분석' })}\nDone.`

    const result = parseTriageOutput(output)

    expect(result).toEqual({
      verdict: 'PROCEED',
      comment: '분석',
    })
  })

  it('깨진 JSON은 null을 반환한다', () => {
    expect(parseTriageOutput('{ "verdict": "PROCEED", comment: }')).toBeNull()
  })

  it('comment 값에 중괄호가 포함된 JSON을 올바르게 파싱한다', () => {
    const output = JSON.stringify({
      verdict: 'PROCEED',
      goalAlignment: 'ALIGNED',
      invalidation: null,
      feasibility: true,
      comment: '수정 방향: extractJsonObject({ start, depth }) 패턴으로 교체할 것',
    })

    const result = parseTriageOutput(output)

    expect(result).toEqual({
      verdict: 'PROCEED',
      comment: '수정 방향: extractJsonObject({ start, depth }) 패턴으로 교체할 것',
    })
  })

  it('comment에 중첩 JSON 예시가 포함된 경우 파싱에 성공한다', () => {
    const output = JSON.stringify({
      verdict: 'SKIP',
      goalAlignment: 'NEUTRAL',
      invalidation: null,
      feasibility: false,
      comment: '참고 예시: {"type": "fix", "scope": {"module": "parser"}} 형태의 구조',
    })

    const result = parseTriageOutput(output)

    expect(result).toEqual({
      verdict: 'SKIP',
      comment: '참고 예시: {"type": "fix", "scope": {"module": "parser"}} 형태의 구조',
    })
  })

  it('comment에 마크다운 코드블록(```sql)이 포함된 JSON을 파싱한다', () => {
    const output =
      '```json\n' +
      JSON.stringify({
        verdict: 'PROCEED',
        goalAlignment: 'SUPPORT',
        invalidation: null,
        feasibility: true,
        comment:
          '수정 방향:\n\n```sql\nSELECT * FROM stock_phases\nWHERE phase IN (1, 2)\n```\n\n위 쿼리에 market_cap 필터 추가',
      }) +
      '\n```'

    const result = parseTriageOutput(output)

    expect(result).toEqual({
      verdict: 'PROCEED',
      comment:
        '수정 방향:\n\n```sql\nSELECT * FROM stock_phases\nWHERE phase IN (1, 2)\n```\n\n위 쿼리에 market_cap 필터 추가',
    })
  })

  it('comment에 중괄호를 포함한 코드블록(```typescript)이 있는 JSON을 파싱한다', () => {
    const output =
      '분석 완료:\n\n```json\n' +
      JSON.stringify({
        verdict: 'PROCEED',
        comment: '예시:\n\n```typescript\nconst config = { timeout: 5000 }\n```\n\n위 패턴 적용',
      }) +
      '\n```'

    const result = parseTriageOutput(output)

    expect(result).toEqual({
      verdict: 'PROCEED',
      comment: '예시:\n\n```typescript\nconst config = { timeout: 5000 }\n```\n\n위 패턴 적용',
    })
  })

  it('comment에 escaped quote가 포함된 JSON을 파싱한다', () => {
    const json = '{"verdict":"PROCEED","comment":"변수명을 \\"userId\\"로 변경"}'
    const output = '```json\n' + json + '\n```'

    const result = parseTriageOutput(output)

    expect(result).toEqual({
      verdict: 'PROCEED',
      comment: '변수명을 "userId"로 변경',
    })
  })

  it('comment에 escaped backslash가 포함된 JSON을 파싱한다', () => {
    const json = '{"verdict":"PROCEED","comment":"경로: C:\\\\Users\\\\mini"}'
    const output = '```json\n' + json + '\n```'

    const result = parseTriageOutput(output)

    expect(result).toEqual({
      verdict: 'PROCEED',
      comment: '경로: C:\\Users\\mini',
    })
  })
})

// ---------------------------------------------------------------------------
// triageIssue — 통합 테스트 (CLI 모킹)
// ---------------------------------------------------------------------------

describe('triageIssue', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('PROCEED 판정 시 그대로 반환한다', async () => {
    const { execFile } = await import('node:child_process')
    const mockExecFile = vi.mocked(execFile)

    const cliOutput = JSON.stringify({
      verdict: 'PROCEED',
      goalAlignment: 'ALIGNED',
      invalidation: null,
      feasibility: true,
      comment: '구현 가능',
    })

    mockExecFile.mockImplementation((_cmd, _args, _options, callback) => {
      const cb = callback as (error: null, stdout: string, stderr: string) => void
      cb(null, cliOutput, '')
      return { stdin: { end: vi.fn() } } as unknown as ReturnType<typeof execFile>
    })

    const { triageIssue } = await import('../triageIssue.js')
    const result = await triageIssue(createIssue({ labels: ['strategic-review'] }))

    expect(result.verdict).toBe('PROCEED')
    expect(result.comment).toBe('구현 가능')
  })

  it('SKIP 판정 시 그대로 반환한다 (자동 생성 이슈)', async () => {
    const { execFile } = await import('node:child_process')
    const mockExecFile = vi.mocked(execFile)

    const cliOutput = JSON.stringify({
      verdict: 'SKIP',
      goalAlignment: 'NEUTRAL',
      invalidation: null,
      feasibility: false,
      comment: '정보 부족',
    })

    mockExecFile.mockImplementation((_cmd, _args, _options, callback) => {
      const cb = callback as (error: null, stdout: string, stderr: string) => void
      cb(null, cliOutput, '')
      return { stdin: { end: vi.fn() } } as unknown as ReturnType<typeof execFile>
    })

    const { triageIssue } = await import('../triageIssue.js')
    const result = await triageIssue(createIssue({ labels: ['report-feedback'] }))

    expect(result.verdict).toBe('SKIP')
    expect(result.comment).toBe('정보 부족')
  })

  it('라벨 없는 이슈도 PROCEED 판정은 그대로 반환한다', async () => {
    const { execFile } = await import('node:child_process')
    const mockExecFile = vi.mocked(execFile)

    const cliOutput = JSON.stringify({
      verdict: 'PROCEED',
      comment: '좋은 이슈',
    })

    mockExecFile.mockImplementation((_cmd, _args, _options, callback) => {
      const cb = callback as (error: null, stdout: string, stderr: string) => void
      cb(null, cliOutput, '')
      return { stdin: { end: vi.fn() } } as unknown as ReturnType<typeof execFile>
    })

    const { triageIssue } = await import('../triageIssue.js')
    const result = await triageIssue(createIssue({ labels: [] }))

    expect(result.verdict).toBe('PROCEED')
    expect(result.comment).toBe('좋은 이슈')
  })

  it('CLI 에러 시 PROCEED 폴백을 반환한다', async () => {
    const { execFile } = await import('node:child_process')
    const mockExecFile = vi.mocked(execFile)

    mockExecFile.mockImplementation((_cmd, _args, _options, callback) => {
      const cb = callback as (error: Error, stdout: string, stderr: string) => void
      cb(new Error('CLI 실패'), '', 'stderr message')
      return { stdin: { end: vi.fn() } } as unknown as ReturnType<typeof execFile>
    })

    const { triageIssue } = await import('../triageIssue.js')
    const result = await triageIssue(createIssue())

    expect(result.verdict).toBe('PROCEED')
    expect(result.comment).toBe('')
  })

  it('파싱 실패 시 PROCEED 폴백을 반환한다', async () => {
    const { execFile } = await import('node:child_process')
    const mockExecFile = vi.mocked(execFile)

    mockExecFile.mockImplementation((_cmd, _args, _options, callback) => {
      const cb = callback as (error: null, stdout: string, stderr: string) => void
      cb(null, '파싱 불가능한 텍스트', '')
      return { stdin: { end: vi.fn() } } as unknown as ReturnType<typeof execFile>
    })

    const { triageIssue } = await import('../triageIssue.js')
    const result = await triageIssue(createIssue())

    expect(result.verdict).toBe('PROCEED')
    expect(result.comment).toBe('')
  })

  it('--print 및 --dangerously-skip-permissions 플래그로 CLI를 호출한다', async () => {
    const { execFile } = await import('node:child_process')
    const mockExecFile = vi.mocked(execFile)

    mockExecFile.mockImplementation((_cmd, args, _options, callback) => {
      const cb = callback as (error: null, stdout: string, stderr: string) => void
      cb(null, JSON.stringify({ verdict: 'PROCEED', comment: '' }), '')
      return { stdin: { end: vi.fn() } } as unknown as ReturnType<typeof execFile>
    })

    const { triageIssue } = await import('../triageIssue.js')
    await triageIssue(createIssue({ labels: ['strategic-review'] }))

    expect(mockExecFile).toHaveBeenCalledOnce()
    const callArgs = mockExecFile.mock.calls[0]
    expect(callArgs[0]).toBe('claude')
    expect(callArgs[1]).toContain('--print')
    expect(callArgs[1]).toContain('--dangerously-skip-permissions')
  })
})
