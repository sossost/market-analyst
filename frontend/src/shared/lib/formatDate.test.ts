import { formatDate } from './formatDate'

describe('formatDate', () => {
  it('정상 날짜를 한글 형식으로 변환한다', () => {
    expect(formatDate('2026-03-09')).toBe('2026년 3월 9일')
  })

  it('월/일 앞의 0을 제거한다', () => {
    expect(formatDate('2026-01-05')).toBe('2026년 1월 5일')
  })

  it('두 자리 월/일을 그대로 표시한다', () => {
    expect(formatDate('2026-12-25')).toBe('2026년 12월 25일')
  })
})
