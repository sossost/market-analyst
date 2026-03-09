/**
 * Format a date string (YYYY-MM-DD) to Korean format (YYYY년 M월 D일).
 */
export function formatDate(dateStr: string): string {
  const [year, month, day] = dateStr.split('-')
  return `${year}년 ${Number(month)}월 ${Number(day)}일`
}
