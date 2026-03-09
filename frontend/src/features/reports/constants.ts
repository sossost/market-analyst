import type { ReportType } from './types'

export const ITEMS_PER_PAGE = 20

export const REPORT_TYPE_LABEL: Record<ReportType, string> = {
  daily: '일간',
  weekly: '주간',
}

const VALID_REPORT_TYPES = new Set<string>(['daily', 'weekly'])

export function isReportType(value: unknown): value is ReportType {
  return typeof value === 'string' && VALID_REPORT_TYPES.has(value)
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

export function isValidDateParam(value: string): boolean {
  return DATE_PATTERN.test(value)
}
