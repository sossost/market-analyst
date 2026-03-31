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

  // 강세/약세 분류 추출 — 전일 종목 상태 오기재 방지
  const classification = extractBullBearClassification(log.fullContent ?? null);
  const bullSet = new Set(classification.bullish);
  const bearSet = new Set(classification.bearish);

  // fullContent에서 종목별 등락률 추출
  const returnMap = extractStockReturns(log.fullContent ?? null);

  const symbolLines = reportedSymbols
    .map((s) => {
      const tag = bullSet.has(s.symbol)
        ? " [강세]"
        : bearSet.has(s.symbol)
          ? " [약세]"
          : "";
      const returnStr = returnMap.get(s.symbol);
      const returnSuffix = returnStr != null ? ` | 전일 ${returnStr}` : "";
      return `- ${s.symbol} (Phase ${s.phase}, RS ${s.rsScore}, ${s.sector})${tag}${returnSuffix}`;
    })
    .join("\n");

  // reportedSymbols가 비어있으나 fullContent에서 종목 추출 가능 시 fallback
  const fallbackLines =
    reportedSymbols.length === 0
      ? buildFallbackSymbolLines(log.fullContent ?? null)
      : "";

  const effectiveSymbolLines =
    symbolLines !== "" ? symbolLines : fallbackLines;

  // 특이종목 카운트 요약 — LLM이 "없음"으로 할루시네이션하는 것을 방지
  const stockCount = reportedSymbols.length > 0
    ? reportedSymbols.length
    : countFallbackStocks(fallbackLines);
  const bullCount = classification.bullish.length;
  const bearCount = classification.bearish.length;

  const reserveStocks = extractReserveStocks(log.fullContent ?? null);
  const reserveLines =
    reserveStocks.length > 0
      ? reserveStocks.map((s) => `- ${s}`).join("\n")
      : "- 없음";

  const keyInsights = extractKeyInsights(log.fullContent ?? null);
  const insightLines =
    keyInsights.length > 0
      ? keyInsights.map((s) => `- ${s}`).join("\n")
      : "";

  const fearGreedLine =
    marketSummary.fearGreedScore != null
      ? `- ⚠️ 공포탐욕지수 (전일 확정값): ${marketSummary.fearGreedScore} — 이 값을 "전일" 수치로 사용하세요`
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

  lines.push("");

  if (stockCount > 0) {
    const countDetail = bullCount > 0 || bearCount > 0
      ? ` (강세 ${bullCount}, 약세 ${bearCount})`
      : "";
    lines.push(
      `### 직전 리포트 특이종목 — 총 ${stockCount}건${countDetail}`,
      `> ⚠️ 아래 ${stockCount}건의 종목이 전일 리포트에 존재합니다. "전일 특이종목 없음"으로 서술하지 마세요.`,
      effectiveSymbolLines,
    );
  } else {
    lines.push(
      "### 직전 리포트 특이종목",
      "- 없음",
    );
  }

  lines.push(
    "",
    "### 직전 예비군 종목 (🌱)",
    reserveLines,
  );

  if (sectorRsLines !== "") {
    lines.push("", "### 직전 섹터 RS 상위", sectorRsLines);
  }

  if (insightLines !== "") {
    lines.push("", "### 직전 핵심 인사이트 (후속 추적 필수)", insightLines);
  }

  return lines.join("\n");
}

/**
 * fullContent 마크다운에서 각 종목의 등락률을 추출한다.
 * 패턴: "TICKER (Company) — +XX.X%" 또는 "TICKER(+XX.X%)" 등
 * 추출 불가 시 빈 Map 반환 (fail-open).
 */
export function extractStockReturns(
  fullContent: string | null,
): Map<string, string> {
  const returns = new Map<string, string>();
  if (fullContent == null || fullContent === "") return returns;

  const COMMON_WORDS = new Set([
    "RS", "MA", "EPS", "PE", "PB", "ETF", "VIX", "DOW", "QQQ", "SPY",
    "IWM", "WTI", "DXY", "Phase", "ACTIVE", "HIGH", "LOW", "USD",
    "NASDAQ", "HOLD", "BUY", "SELL", "MD", "AI", "CEO", "IPO",
  ]);

  // 패턴 1: TICKER ... ±XX.X% (같은 줄 내에서)
  const linePattern = /\b([A-Z]{2,5})\b[^|\n]*?([+-]\d+\.?\d*%)/g;
  let match: RegExpExecArray | null;
  while ((match = linePattern.exec(fullContent)) !== null) {
    const ticker = match[1];
    const pct = match[2];
    if (!COMMON_WORDS.has(ticker) && !returns.has(ticker)) {
      returns.set(ticker, pct);
    }
  }

  return returns;
}

/**
 * reportedSymbols가 비어있을 때 fullContent에서 특이종목 목록을 fallback 생성한다.
 * 강세/약세 섹션의 종목을 추출하여 간략한 라인으로 구성.
 */
function buildFallbackSymbolLines(fullContent: string | null): string {
  if (fullContent == null || fullContent === "") return "";

  const classification = extractBullBearClassification(fullContent);
  const returnMap = extractStockReturns(fullContent);
  const allTickers = [
    ...classification.bullish.map((t) => ({ symbol: t, tag: " [강세]" })),
    ...classification.bearish.map((t) => ({ symbol: t, tag: " [약세]" })),
  ];

  if (allTickers.length === 0) return "";

  return allTickers
    .map((s) => {
      const returnStr = returnMap.get(s.symbol);
      const returnSuffix = returnStr != null ? ` | 전일 ${returnStr}` : "";
      return `- ${s.symbol}${s.tag}${returnSuffix}`;
    })
    .join("\n");
}

/**
 * fallback 라인에서 종목 수를 카운트한다.
 */
function countFallbackStocks(fallbackLines: string): number {
  if (fallbackLines === "") return 0;
  return fallbackLines.split("\n").filter((line) => line.startsWith("- ")).length;
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
 * 마크다운 본문에서 💡 오늘의 인사이트 섹션의 내용을 추출한다.
 * 추출 불가 시 빈 배열 반환 (fail-open).
 *
 * 전일 핵심 인사이트를 익일 리포트에서 후속 추적하기 위한 데이터 소스.
 */
export function extractKeyInsights(
  fullContent: string | null,
): string[] {
  if (fullContent == null || fullContent === "") return [];

  // 💡 오늘의 인사이트 섹션 시작 ~ 다음 이모지 섹션 또는 ## 또는 EOF
  const sectionMatch = fullContent.match(
    /💡[^\n]*인사이트[^\n]*\n([\s\S]*?)(?=\n(?:##\s|[⭐◎⚠️🔥🏆📊📈😨🌡️🌱👀])|$)/,
  );
  if (sectionMatch == null) return [];

  const section = sectionMatch[1].trim();
  if (section === "") return [];

  // 각 줄에서 의미 있는 텍스트만 추출 (빈 줄, 순수 마크다운 구조 제외)
  const insights = section
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 10 && !line.startsWith("---"));

  return insights;
}

/**
 * 마크다운 본문에서 강세/약세 섹션별 티커를 추출한다.
 * 🔥/⭐ 섹션 → bullish, ⚠️ 섹션 → bearish.
 * 추출 불가 시 양쪽 모두 빈 배열 반환 (fail-open).
 */
export function extractBullBearClassification(
  fullContent: string | null,
): { bullish: string[]; bearish: string[] } {
  const empty = { bullish: [], bearish: [] };
  if (fullContent == null || fullContent === "") return empty;

  const TICKER_RE = /\b([A-Z]{2,5}(?:\.[A-Z]{1,2})?)\b/g;
  const COMMON_WORDS = new Set([
    "RS", "MA", "EPS", "PE", "PB", "ETF", "VIX", "DOW", "QQQ", "SPY",
    "IWM", "WTI", "DXY", "Phase", "ACTIVE", "HIGH", "LOW", "USD",
    "NASDAQ", "HOLD", "BUY", "SELL", "MD", "AI", "CEO", "IPO",
  ]);

  function extractTickers(section: string): string[] {
    const tickers: string[] = [];
    let match: RegExpExecArray | null;
    const re = new RegExp(TICKER_RE.source, "g");
    while ((match = re.exec(section)) !== null) {
      const ticker = match[1];
      if (!COMMON_WORDS.has(ticker) && !tickers.includes(ticker)) {
        tickers.push(ticker);
      }
    }
    return tickers;
  }

  // 강세 섹션: 🔥 또는 ⭐ 로 시작하는 블록
  const bullSectionMatch = fullContent.match(
    /[🔥⭐][^\n]*\n([\s\S]*?)(?=\n(?:##\s|[⚠️🌱💡👀🏆📊📈😨🌡️◎])|$)/,
  );
  const bullish = bullSectionMatch != null ? extractTickers(bullSectionMatch[1]) : [];

  // 약세 섹션: ⚠️ 로 시작하는 블록
  const bearSectionMatch = fullContent.match(
    /⚠️[^\n]*\n([\s\S]*?)(?=\n(?:##\s|[🔥⭐🌱💡👀🏆📊📈😨🌡️◎])|$)/,
  );
  const bearish = bearSectionMatch != null ? extractTickers(bearSectionMatch[1]) : [];

  return { bullish, bearish };
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
