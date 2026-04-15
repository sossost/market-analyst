import { describe, it, expect } from 'vitest'
import { AUTO_LABELS, MAX_ISSUES_PER_CYCLE } from '@/issue-processor/types'

describe('types', () => {
  it('AUTO_LABELS에 5개 라벨이 정의되어 있다', () => {
    expect(AUTO_LABELS).toHaveLength(5)
    expect(AUTO_LABELS).toContain('auto:in-progress')
    expect(AUTO_LABELS).toContain('auto:done')
    expect(AUTO_LABELS).toContain('auto:blocked')
    expect(AUTO_LABELS).toContain('auto:needs-ceo')
    expect(AUTO_LABELS).toContain('auto:queued')
  })

  it('MAX_ISSUES_PER_CYCLE은 1이다', () => {
    expect(MAX_ISSUES_PER_CYCLE).toBe(1)
  })
})
