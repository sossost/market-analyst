import { parseRoundOutputs } from './parse-round-outputs'

describe('parseRoundOutputs', () => {
  it('유효한 JSON 배열을 RoundOutput[]로 반환한다', () => {
    const raw = JSON.stringify([
      { persona: 'macro', content: '거시 분석 내용' },
      { persona: 'tech', content: '기술 분석 내용' },
    ])

    const result = parseRoundOutputs(raw)

    expect(result).toEqual([
      { persona: 'macro', content: '거시 분석 내용' },
      { persona: 'tech', content: '기술 분석 내용' },
    ])
  })

  it('배열이 아닌 JSON 객체는 null을 반환한다', () => {
    const raw = JSON.stringify({ persona: 'macro', content: '내용' })

    expect(parseRoundOutputs(raw)).toBeNull()
  })

  it('잘못된 JSON 문자열은 null을 반환한다', () => {
    expect(parseRoundOutputs('not-json')).toBeNull()
  })

  it('persona가 없는 객체는 필터되어 유효 항목이 0이면 null을 반환한다', () => {
    const raw = JSON.stringify([{ content: '내용만 있음' }])

    expect(parseRoundOutputs(raw)).toBeNull()
  })

  it('유효/무효 혼합 시 유효 항목만 반환한다', () => {
    const raw = JSON.stringify([
      { persona: 'macro', content: '유효' },
      { persona: 'invalid', content: '무효 페르소나' },
      { content: '페르소나 없음' },
    ])

    const result = parseRoundOutputs(raw)

    expect(result).toEqual([{ persona: 'macro', content: '유효' }])
  })

  it('빈 배열은 null을 반환한다', () => {
    expect(parseRoundOutputs('[]')).toBeNull()
  })

  it('content가 없는 객체는 필터된다', () => {
    const raw = JSON.stringify([{ persona: 'macro' }])

    expect(parseRoundOutputs(raw)).toBeNull()
  })

  it('유효하지 않은 persona는 필터된다', () => {
    const raw = JSON.stringify([
      { persona: 'unknown', content: '내용' },
    ])

    expect(parseRoundOutputs(raw)).toBeNull()
  })
})
