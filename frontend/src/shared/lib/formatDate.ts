/**
 * Format a date string to Korean format (YYYY년 M월 D일).
 * Accepts both YYYY-MM-DD and ISO 8601 (e.g. 2026-03-14T10:00:00+00:00).
 */
export function formatDate(dateStr: string): string {
  const datePart = dateStr.includes('T') ? dateStr.split('T')[0] : dateStr
  const parts = (datePart ?? dateStr).split('-')
  const year = parts[0] ?? ''
  const month = parts[1] ?? ''
  const day = parts[2] ?? ''
  return `${year}년 ${Number(month)}월 ${Number(day)}일`
}
