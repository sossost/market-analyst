import type { RoundOutput } from './types'

type Persona = RoundOutput['persona']

export const PERSONA_LABELS: Record<Persona, string> = {
  macro: '거시경제',
  tech: '기술분석',
  geopolitics: '지정학',
  sentiment: '심리분석',
}

export function getPersonaLabel(persona: string): string {
  if (persona in PERSONA_LABELS) {
    return PERSONA_LABELS[persona as Persona]
  }
  return persona
}
