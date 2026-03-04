import { asQuarter } from "./date";

/**
 * 같은 분기(asOfQ)에 대해 가장 최신 날짜만 유지하는 함수.
 */
export function deduplicateByQuarter<T extends { date: string }>(
  rows: Map<string, T>,
): Map<string, T> {
  if (rows.size === 0) {
    return new Map<string, T>();
  }

  const quarterMap = new Map<string, T>();

  for (const [, row] of rows) {
    if (
      row?.date == null ||
      typeof row.date !== "string" ||
      row.date.trim() === ""
    ) {
      continue;
    }

    const asQ = asQuarter(row.date);
    const existing = quarterMap.get(asQ);

    if (existing == null || row.date > existing.date) {
      quarterMap.set(asQ, row);
    }
  }

  return quarterMap;
}
