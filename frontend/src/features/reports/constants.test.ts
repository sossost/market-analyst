import {
  ITEMS_PER_PAGE,
  REPORT_TYPE_LABEL,
  isReportType,
  isValidDateParam,
} from './constants'

describe('isReportType', () => {
  it('"daily"는 유효한 ReportType이다', () => {
    expect(isReportType('daily')).toBe(true)
  })

  it('"weekly"는 유효한 ReportType이다', () => {
    expect(isReportType('weekly')).toBe(true)
  })

  it('"unknown"은 유효하지 않다', () => {
    expect(isReportType('unknown')).toBe(false)
  })

  it('null은 유효하지 않다', () => {
    expect(isReportType(null)).toBe(false)
  })

  it('undefined는 유효하지 않다', () => {
    expect(isReportType(undefined)).toBe(false)
  })

  it('숫자는 유효하지 않다', () => {
    expect(isReportType(123)).toBe(false)
  })
})

describe('isValidDateParam', () => {
  it('YYYY-MM-DD 형식은 유효하다', () => {
    expect(isValidDateParam('2026-03-09')).toBe(true)
  })

  it('날짜 형식이 아닌 문자열은 유효하지 않다', () => {
    expect(isValidDateParam('not-a-date')).toBe(false)
  })

  it('패딩 없는 날짜는 유효하지 않다', () => {
    expect(isValidDateParam('2026-3-9')).toBe(false)
  })

  it('빈 문자열은 유효하지 않다', () => {
    expect(isValidDateParam('')).toBe(false)
  })
})

describe('상수값', () => {
  it('ITEMS_PER_PAGE는 20이다', () => {
    expect(ITEMS_PER_PAGE).toBe(20)
  })

  it('REPORT_TYPE_LABEL.daily는 "일간"이다', () => {
    expect(REPORT_TYPE_LABEL.daily).toBe('일간')
  })
})
