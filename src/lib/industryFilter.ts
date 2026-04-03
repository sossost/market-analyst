/**
 * 업종 RS 목록에 섹터당 상한을 적용하여 상위 N개를 반환한다.
 *
 * 입력 배열이 RS 내림차순으로 정렬되어 있다고 가정한다.
 * 섹터별 카운터 Map으로 O(n) 처리하며, topN개가 채워지면 조기 종료한다.
 *
 * @param industries - RS 내림차순 정렬된 업종 배열 (sector 필드 필수)
 * @param sectorCap  - 섹터당 최대 허용 개수
 * @param topN       - 최종 반환할 최대 개수
 * @returns 섹터당 제한이 적용된 상위 topN개 배열
 */
export function applyIndustrySectorCap<T extends { sector: string }>(
  industries: T[],
  sectorCap: number,
  topN: number,
): T[] {
  const sectorCounts = new Map<string, number>();
  const result: T[] = [];

  for (const industry of industries) {
    if (result.length >= topN) break;

    const count = sectorCounts.get(industry.sector) ?? 0;
    if (count >= sectorCap) continue;

    result.push(industry);
    sectorCounts.set(industry.sector, count + 1);
  }

  return result;
}
