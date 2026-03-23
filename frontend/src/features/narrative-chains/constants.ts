import type { NarrativeChainStatus } from './types'

export const ITEMS_PER_PAGE = 20

export const CHAIN_STATUS_LABEL: Record<NarrativeChainStatus, string> = {
  ACTIVE: '활성',
  RESOLVING: '해소 중',
  RESOLVED: '해소됨',
  OVERSUPPLY: '공급 과잉',
  INVALIDATED: '무효',
}

export const CHAIN_STATUS_VARIANT: Record<
  NarrativeChainStatus,
  'default' | 'secondary' | 'destructive' | 'outline'
> = {
  ACTIVE: 'default',
  RESOLVING: 'outline',
  RESOLVED: 'secondary',
  OVERSUPPLY: 'destructive',
  INVALIDATED: 'secondary',
}

const VALID_STATUSES = new Set<string>([
  'ACTIVE',
  'RESOLVING',
  'RESOLVED',
  'OVERSUPPLY',
  'INVALIDATED',
])

export function isNarrativeChainStatus(
  value: unknown,
): value is NarrativeChainStatus {
  return typeof value === 'string' && VALID_STATUSES.has(value)
}
