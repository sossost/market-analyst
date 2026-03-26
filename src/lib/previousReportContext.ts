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

  const reserveStocks = extractReserveStocks(log.fullContent ?? null);
  const reserveLines =
    reserveStocks.length > 0
      ? reserveStocks.map((s) => `- ${s}`).join("\n")
      : "- 없음";

  const fearGreedLine =
    marketSummary.fearGreedScore != null
      ? `- 공포탐욕지수: ${marketSummary.fearGreedScore}`
      : "";

  const sectorRsLines = formatSectorRsLines(marketSummary.topSectorRs ?? []);

  const lines = [
    `## 직전 리포트 요약 (${date})`,
    "",
    `- Phase 2 비율: ${marketSummary.phase2Ratio}%`,
    `- 주도 섹터: ${leadingSectors}`,
    `- 분석 종목수: ${marketSummary.totalAnalyzed}`,
  ];

  if (fearGreedLine !== "") {
    lines.push(fearGreedLine);
  }

  lines.push(
    "",
    "### 직전 리포트 특이종목",
    symbolLines === "" ? "- 없음" : symbolLines,
    "",
    "### 직전 예비군 종목 (🌱)",
    reserveLines,
  );

  if (sectorRsLines !== "") {
    lines.push("", "### 직전 섹터 RS 상위", sectorRsLines);
  }

  return lines.join("\n");
}

/**
 * 섹터 RS 목록을 마크다운 리스트 문자열로 변환한다.
 */
export function formatSectorRsLines(
  topSectorRs: { sector: string; avgRs: number }[],
): string {
  if (topSectorRs.length === 0) return "";
  return topSectorRs
    .map((s) => `- ${s.sector} (RS ${s.avgRs})`)
    .join("\n");
}

/**
 * 마크다운 본문에서 🌱 주도주 예비군 섹션의 종목 티커를 추출한다.
 * 추출 불가 시 빈 배열 반환 (fail-open).
 */
export function extractReserveStocks(
  fullContent: string | null,
): string[] {
  if (fullContent == null || fullContent === "") return [];

  // 🌱 섹션 시작 ~ 다음 이모지 섹션 또는 ## 또는 EOF
  const sectionMatch = fullContent.match(
    /🌱[^\n]*\n([\s\S]*?)(?=\n(?:##\s|[⭐◎⚠️💡👀🔥🏆📊📈😨🌡️])|$)/,
  );
  if (sectionMatch == null) return [];

  const section = sectionMatch[1];
  const tickerPattern = /\b([A-Z]{2,5}(?:\.[A-Z]{1,2})?)\b/g;
  const COMMON_WORDS = new Set([
    "RS", "MA", "EPS", "PE", "PB", "ETF", "VIX", "DOW", "QQQ", "SPY",
    "IWM", "WTI", "DXY", "Phase", "ACTIVE", "HIGH", "LOW", "USD",
  ]);

  const tickers: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = tickerPattern.exec(section)) !== null) {
    const ticker = match[1];
    if (!COMMON_WORDS.has(ticker) && !tickers.includes(ticker)) {
      tickers.push(ticker);
    }
  }

  return tickers;
}
