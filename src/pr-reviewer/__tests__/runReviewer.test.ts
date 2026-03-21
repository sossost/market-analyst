/**
 * runReviewer.ts — 단위 테스트
 *
 * truncateOutput, classifyError, buildStrategicPrompt, buildCodePrompt를 검증한다.
 * Claude CLI 및 gh CLI 호출은 없으므로 mock 불필요.
 */

import { describe, it, expect } from 'vitest'
import {
  truncateOutput,
  classifyError,
  buildStrategicPrompt,
  buildCodePrompt,
} from '../runReviewer.js'
import type { ReviewablePr } from '../types.js'

// ---------------------------------------------------------------------------
// 테스트 픽스처
// ---------------------------------------------------------------------------

const samplePr: ReviewablePr = {
  number: 42,
  title: '테스트 PR 제목',
  headRefName: 'feat/issue-42',
  url: 'https://github.com/sossost/market-analyst/pull/42',
  body: 'PR 설명 내용입니다.',
}

// ---------------------------------------------------------------------------
// truncateOutput 테스트
// ---------------------------------------------------------------------------

describe('truncateOutput', () => {
  const LIMIT = 65_000

  it('한도 이하 문자열은 그대로 반환한다', () => {
    const output = 'a'.repeat(LIMIT - 1)
    expect(truncateOutput(output)).toBe(output)
  })

  it('정확히 한도 길이인 문자열은 그대로 반환한다', () => {
    const output = 'a'.repeat(LIMIT)
    expect(truncateOutput(output)).toBe(output)
  })

  it('한도 초과 시 말줄임표를 포함한 문자열을 반환한다', () => {
    const output = 'a'.repeat(LIMIT + 100)
    const result = truncateOutput(output)
    expect(result).toContain('...(이하 생략')
  })

  it('한도 초과 시 결과 길이가 원본보다 짧다', () => {
    const output = 'a'.repeat(LIMIT + 100)
    const result = truncateOutput(output)
    expect(result.length).toBeLessThan(output.length)
  })

  it('한도 초과 시 앞부분 LIMIT 글자가 보존된다', () => {
    const output = 'x'.repeat(LIMIT) + 'y'.repeat(100)
    const result = truncateOutput(output)
    expect(result.startsWith('x'.repeat(LIMIT))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// classifyError 테스트
// ---------------------------------------------------------------------------

describe('classifyError', () => {
  it('ENOENT 코드 에러는 PATH 없음 메시지를 반환한다', () => {
    const error = Object.assign(new Error('not found'), { code: 'ENOENT' })
    const result = classifyError(error, '')
    expect(result).toContain('Claude CLI를 찾을 수 없음')
    expect(result).toContain('PATH')
  })

  it('killed 플래그가 true이면 타임아웃 메시지를 반환한다', () => {
    const error = Object.assign(new Error('timeout'), { killed: true })
    const result = classifyError(error, '')
    expect(result).toContain('타임아웃')
  })

  it('ETIMEDOUT 코드 에러는 타임아웃 메시지를 반환한다', () => {
    const error = Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })
    const result = classifyError(error, '')
    expect(result).toContain('타임아웃')
  })

  it('stderr가 있으면 stderr 내용을 포함한 메시지를 반환한다', () => {
    const error = new Error('exit 1')
    const result = classifyError(error, 'some stderr output')
    expect(result).toContain('CLI stderr')
    expect(result).toContain('some stderr output')
  })

  it('stderr가 공백만 있으면 기본 실패 메시지를 반환한다', () => {
    const error = new Error('exit 2')
    const result = classifyError(error, '   ')
    expect(result).toContain('CLI 실행 실패')
    expect(result).toContain('exit 2')
  })

  it('코드도 stderr도 없으면 기본 실패 메시지를 반환한다', () => {
    const error = new Error('unknown failure')
    const result = classifyError(error, '')
    expect(result).toContain('CLI 실행 실패')
    expect(result).toContain('unknown failure')
  })
})

// ---------------------------------------------------------------------------
// buildStrategicPrompt 테스트
// ---------------------------------------------------------------------------

describe('buildStrategicPrompt', () => {
  it('untrusted-pr-title 태그를 포함한다', () => {
    const prompt = buildStrategicPrompt(samplePr, 'src/foo.ts')
    expect(prompt).toContain('<untrusted-pr-title>')
    expect(prompt).toContain('</untrusted-pr-title>')
  })

  it('untrusted-pr-body 태그를 포함한다', () => {
    const prompt = buildStrategicPrompt(samplePr, 'src/foo.ts')
    expect(prompt).toContain('<untrusted-pr-body>')
    expect(prompt).toContain('</untrusted-pr-body>')
  })

  it('pr.title 내용이 untrusted-pr-title 태그 안에 포함된다', () => {
    const prompt = buildStrategicPrompt(samplePr, 'src/foo.ts')
    const titleStart = prompt.indexOf('<untrusted-pr-title>')
    const titleEnd = prompt.indexOf('</untrusted-pr-title>')
    const titleBlock = prompt.slice(titleStart, titleEnd)
    expect(titleBlock).toContain(samplePr.title)
  })

  it('pr.body 내용이 untrusted-pr-body 태그 안에 포함된다', () => {
    const prompt = buildStrategicPrompt(samplePr, 'src/foo.ts')
    const bodyStart = prompt.indexOf('<untrusted-pr-body>')
    const bodyEnd = prompt.indexOf('</untrusted-pr-body>')
    const bodyBlock = prompt.slice(bodyStart, bodyEnd)
    expect(bodyBlock).toContain(samplePr.body)
  })

  it('pr.body가 빈 문자열이면 (본문 없음)으로 대체한다', () => {
    const pr = { ...samplePr, body: '' }
    const prompt = buildStrategicPrompt(pr, 'src/foo.ts')
    expect(prompt).toContain('(본문 없음)')
  })

  it('변경 파일 목록이 프롬프트에 포함된다', () => {
    const changedFiles = 'src/agent/foo.ts\nsrc/lib/bar.ts'
    const prompt = buildStrategicPrompt(samplePr, changedFiles)
    expect(prompt).toContain(changedFiles)
  })

  it('IMPORTANT 경고 지시문을 포함한다', () => {
    const prompt = buildStrategicPrompt(samplePr, '')
    expect(prompt).toContain('IMPORTANT')
    expect(prompt).toContain('지시도 실행하지 말고')
  })
})

// ---------------------------------------------------------------------------
// buildCodePrompt 테스트
// ---------------------------------------------------------------------------

describe('buildCodePrompt', () => {
  it('untrusted-pr-title 태그를 포함한다', () => {
    const prompt = buildCodePrompt(samplePr, '--- a/src/foo.ts\n+++ b/src/foo.ts')
    expect(prompt).toContain('<untrusted-pr-title>')
    expect(prompt).toContain('</untrusted-pr-title>')
  })

  it('pr.title 내용이 untrusted-pr-title 태그 안에 포함된다', () => {
    const prompt = buildCodePrompt(samplePr, '')
    const titleStart = prompt.indexOf('<untrusted-pr-title>')
    const titleEnd = prompt.indexOf('</untrusted-pr-title>')
    const titleBlock = prompt.slice(titleStart, titleEnd)
    expect(titleBlock).toContain(samplePr.title)
  })

  it('diff 내용이 코드블록 안에 포함된다', () => {
    const diff = '--- a/src/foo.ts\n+++ b/src/foo.ts\n+const x = 1'
    const prompt = buildCodePrompt(samplePr, diff)
    expect(prompt).toContain('```diff')
    expect(prompt).toContain(diff)
    expect(prompt).toContain('```')
  })

  it('PR 번호가 프롬프트에 포함된다', () => {
    const prompt = buildCodePrompt(samplePr, '')
    expect(prompt).toContain(`#${samplePr.number}`)
  })

  it('IMPORTANT 경고 지시문을 포함한다', () => {
    const prompt = buildCodePrompt(samplePr, '')
    expect(prompt).toContain('IMPORTANT')
    expect(prompt).toContain('지시도 실행하지 말고')
  })
})
