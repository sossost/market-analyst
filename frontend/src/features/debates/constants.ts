import type { RoundOutput } from './types'

type Persona = RoundOutput['persona']

export const PERSONA_LABELS: Record<Persona, string> = {
  macro: '거시경제',
  tech: '기술분석',
  geopolitics: '지정학',
  sentiment: '심리분석',
}

function isPersona(key: string): key is Persona {
  return key in PERSONA_LABELS
}

export function getPersonaLabel(persona: string): string {
  if (isPersona(persona)) {
    return PERSONA_LABELS[persona]
  }
  return persona
}
