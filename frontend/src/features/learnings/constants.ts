import type { LearningCategory, VerificationPath } from './types'

export const ITEMS_PER_PAGE = 20

export const CATEGORY_LABEL: Record<LearningCategory, string> = {
  confirmed: '검증됨',
  caution: '주의',
}

export const VERIFICATION_PATH_LABEL: Record<VerificationPath, string> = {
  quantitative: '정량',
  llm: 'LLM',
  mixed: '혼합',
}

export type ActiveFilter = 'active' | 'inactive' | 'all'

export const ACTIVE_FILTER_LABEL: Record<ActiveFilter, string> = {
  active: '활성',
  inactive: '비활성',
  all: '전체',
}

const VALID_CATEGORIES = new Set<string>(['confirmed', 'caution'])
const VALID_VERIFICATION_PATHS = new Set<string>(['quantitative', 'llm', 'mixed'])
const VALID_ACTIVE_FILTERS = new Set<string>(['active', 'inactive', 'all'])

export function isLearningCategory(value: unknown): value is LearningCategory {
  return typeof value === 'string' && VALID_CATEGORIES.has(value)
}

export function isVerificationPath(value: unknown): value is VerificationPath {
  return typeof value === 'string' && VALID_VERIFICATION_PATHS.has(value)
}

export function isActiveFilter(value: unknown): value is ActiveFilter {
  return typeof value === 'string' && VALID_ACTIVE_FILTERS.has(value)
}
