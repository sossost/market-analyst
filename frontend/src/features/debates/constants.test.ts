import { PERSONA_LABELS, getPersonaLabel } from './constants'

describe('getPersonaLabel', () => {
  it('"macro"는 "거시경제"를 반환한다', () => {
    expect(getPersonaLabel('macro')).toBe('거시경제')
  })

  it('"tech"는 "기술분석"을 반환한다', () => {
    expect(getPersonaLabel('tech')).toBe('기술분석')
  })

  it('"geopolitics"는 "지정학"을 반환한다', () => {
    expect(getPersonaLabel('geopolitics')).toBe('지정학')
  })

  it('"sentiment"는 "심리분석"을 반환한다', () => {
    expect(getPersonaLabel('sentiment')).toBe('심리분석')
  })

  it('알 수 없는 페르소나는 원본 문자열을 그대로 반환한다', () => {
    expect(getPersonaLabel('unknown')).toBe('unknown')
  })
})

describe('PERSONA_LABELS', () => {
  it('4개의 페르소나 키를 가진다', () => {
    expect(Object.keys(PERSONA_LABELS)).toHaveLength(4)
  })
})
