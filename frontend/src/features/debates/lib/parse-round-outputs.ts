import type { RoundOutput } from '../types'

const VALID_PERSONAS = new Set(['macro', 'tech', 'geopolitics', 'sentiment'])

function isValidRoundOutput(item: unknown): item is RoundOutput {
  if (typeof item !== 'object' || item == null) {
    return false
  }

  const record = item as Record<string, unknown>

  return (
    typeof record.persona === 'string' &&
    VALID_PERSONAS.has(record.persona) &&
    typeof record.content === 'string'
  )
}

/**
 * JSON 문자열을 RoundOutput[]로 파싱한다.
 * 파싱 실패 또는 유효하지 않은 구조면 null을 반환한다 (throw 금지).
 */
export function parseRoundOutputs(raw: string): RoundOutput[] | null {
  try {
    const parsed: unknown = JSON.parse(raw)

    if (!Array.isArray(parsed)) {
      return null
    }

    const outputs = parsed.filter(isValidRoundOutput)

    if (outputs.length === 0) {
      return null
    }

    return outputs
  } catch {
    return null
  }
}
