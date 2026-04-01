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

/**
 * 어닝 발표일(actualDate) → 보고 분기(asOfQ) 매핑.
 *
 * 어닝은 분기 종료 후 1~2개월 뒤에 발표되므로,
 * 발표월이 속한 분기의 **직전 분기**가 보고 대상이다.
 *
 * 발표월 → 보고 분기:
 *   1~3월 → Q4 전년도
 *   4~6월 → Q1 당해
 *   7~9월 → Q2 당해
 *  10~12월 → Q3 당해
 */
export function reportDateToAsOfQ(actualDate: string): string | null {
  const [yearStr, monthStr] = actualDate.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);

  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    return null;
  }

  if (month <= 3) return `Q4 ${year - 1}`;
  if (month <= 6) return `Q1 ${year}`;
  if (month <= 9) return `Q2 ${year}`;
  return `Q3 ${year}`;
}
