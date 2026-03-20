import { describe, it, expect } from 'vitest'
import { getPriorityScore } from '../githubClient.js'

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
