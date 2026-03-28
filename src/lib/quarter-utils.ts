/**
 * 분기 문자열 파싱 공유 유틸리티.
 *
 * fundamental-data-loader 와 fundamental-scorer 양쪽에서 사용한다.
 */

/**
 * as_of_q 문자열을 (year, quarter) 쌍으로 파싱.
 * 지원 포맷: "Q4 2025", "2025Q4"
 * 파싱 실패 시 null 반환.
 */
export function parseQuarterStr(asOfQ: string): { quarter: number; year: number } | null {
  // "Q4 2025" format
  const match1 = asOfQ.match(/Q(\d)\s+(\d{4})/);
  if (match1 != null) return { quarter: Number(match1[1]), year: Number(match1[2]) };

  // "2025Q4" format (FMP DB)
  const match2 = asOfQ.match(/(\d{4})Q(\d)/);
  if (match2 != null) return { quarter: Number(match2[2]), year: Number(match2[1]) };

  return null;
}

/**
 * period_end_date ("2025-12-31") → "Q4 2025" 형식의 asOfQ 문자열로 변환.
 * 월 기준: 1~3→Q1, 4~6→Q2, 7~9→Q3, 10~12→Q4
 */
export function periodEndDateToAsOfQ(periodEndDate: string): string {
  const [yearStr, monthStr] = periodEndDate.split("-");
  const month = Number(monthStr);
  const quarter = Math.ceil(month / 3);
  return `Q${quarter} ${yearStr}`;
}
