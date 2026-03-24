import { readPreviousDailyReport } from "@/lib/reportLog";
import type { DailyReportLog } from "@/types";
import { logger } from "@/lib/logger";

/**
 * DB에서 직전 daily 리포트를 조회하여 시스템 프롬프트에 주입할
 * structured context string을 생성한다.
 *
 * fail-open: DB 오류 시 빈 문자열 반환 (기존 동작과 동일).
 */
export async function loadPreviousReportContext(
  targetDate: string,
): Promise<string> {
  try {
    const previousDaily = await readPreviousDailyReport(targetDate);

    if (previousDaily == null) {
      logger.info("PreviousReport", "직전 daily 리포트 없음");
      return "";
    }

    return formatPreviousReportContext(previousDaily);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.warn("PreviousReport", `직전 리포트 로드 실패 (계속 진행): ${reason}`);
    return "";
  }
}

/**
 * DailyReportLog를 시스템 프롬프트 삽입용 문자열로 변환한다.
 */
export function formatPreviousReportContext(log: DailyReportLog): string {
  const { date, reportedSymbols, marketSummary } = log;

  const leadingSectors = marketSummary.leadingSectors.join(", ");
  const symbolLines = reportedSymbols
    .map(
      (s) =>
        `- ${s.symbol} (Phase ${s.phase}, RS ${s.rsScore}, ${s.sector})`,
    )
    .join("\n");

  return [
    `## 직전 리포트 요약 (${date})`,
    "",
    `- Phase 2 비율: ${marketSummary.phase2Ratio}%`,
    `- 주도 섹터: ${leadingSectors}`,
    `- 분석 종목수: ${marketSummary.totalAnalyzed}`,
    "",
    "### 직전 리포트 특이종목",
    symbolLines === "" ? "- 없음" : symbolLines,
  ].join("\n");
}
