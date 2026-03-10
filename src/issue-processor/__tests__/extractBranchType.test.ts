import { describe, it, expect } from 'vitest'
import { extractBranchType } from '../executeIssue.js'

describe('extractBranchType', () => {
  it('feat: 접두사 → feat 반환', () => {
    expect(extractBranchType('feat: 자율 이슈 처리 시스템')).toBe('feat')
  })

  it('fix: 접두사 → fix 반환', () => {
    expect(extractBranchType('fix: 버그 수정')).toBe('fix')
  })

  it('refactor: 접두사 → refactor 반환', () => {
    expect(extractBranchType('refactor: 코드 정리')).toBe('refactor')
  })

  it('chore: 접두사 → chore 반환', () => {
    expect(extractBranchType('chore: 패키지 업데이트')).toBe('chore')
  })

  it('대문자 FEAT: 접두사도 feat 반환 (case-insensitive)', () => {
    expect(extractBranchType('FEAT: 대문자 테스트')).toBe('feat')
  })

  it('접두사 없는 일반 제목 → 기본값 fix 반환', () => {
    expect(extractBranchType('일반 이슈 제목')).toBe('fix')
  })

  it('빈 문자열 → 기본값 fix 반환', () => {
    expect(extractBranchType('')).toBe('fix')
  })

  it('접두사가 중간에 있는 경우 → 기본값 fix 반환', () => {
    expect(extractBranchType('이슈: feat: 이건 접두사 아님')).toBe('fix')
  })

  it('feat: 뒤에 공백 없어도 인식', () => {
    expect(extractBranchType('feat:공백없음')).toBe('feat')
  })
})
