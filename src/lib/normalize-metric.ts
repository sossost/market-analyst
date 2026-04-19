/**
 * verificationMetric 정규화 유틸리티.
 *
 * LLM이 같은 지표를 다양한 형태로 생성하므로 (e.g. "Technology RS", "Tech RS",
 * "Information Technology 섹터 RS") 학습 그룹핑 시 정규화가 필요하다.
 *
 * promote-learnings.ts, thesis-dedup.ts 등에서 공유.
 */

export const METRIC_ALIASES: Record<string, string> = {
  spx: "S&P 500", sp500: "S&P 500", "s&p500": "S&P 500", "s&p 500": "S&P 500",
  qqq: "NASDAQ", nasdaq: "NASDAQ",
  iwm: "Russell 2000", "russell 2000": "Russell 2000",
  "dow 30": "DOW 30", dow: "DOW 30", djia: "DOW 30",
  vix: "VIX",
  "fear & greed": "Fear & Greed", "fear and greed": "Fear & Greed", "공포탐욕지수": "Fear & Greed",
  // Commodities (#427)
  wti: "WTI Crude", "wti crude": "WTI Crude", "crude oil": "WTI Crude", "원유": "WTI Crude",
  "brent": "Brent Crude", "brent crude": "Brent Crude", "브렌트유": "Brent Crude",
  gold: "Gold", "금": "Gold", xau: "Gold",
  silver: "Silver", "은": "Silver",
  copper: "Copper", "구리": "Copper",
  // Rates
  "10y": "US 10Y Yield", "10년물": "US 10Y Yield", "us 10y": "US 10Y Yield", "us 10y yield": "US 10Y Yield",
  "2y": "US 2Y Yield", "2년물": "US 2Y Yield", "us 2y": "US 2Y Yield", "us 2y yield": "US 2Y Yield",
  dxy: "DXY", "달러인덱스": "DXY", "dollar index": "DXY",
};

export const SECTOR_METRIC_ALIASES: Record<string, string> = {
  tech: "Technology", it: "Technology", "information technology": "Technology", "info tech": "Technology",
  "comm services": "Communication Services", communications: "Communication Services", telecom: "Communication Services",
  "consumer discretionary": "Consumer Cyclical", "cons cyclical": "Consumer Cyclical", discretionary: "Consumer Cyclical",
  "consumer staples": "Consumer Defensive", "cons defensive": "Consumer Defensive", staples: "Consumer Defensive",
  financials: "Financial Services", finance: "Financial Services", financial: "Financial Services",
  materials: "Basic Materials", "basic material": "Basic Materials",
  health: "Healthcare", "health care": "Healthcare",
  industrial: "Industrials",
  realestate: "Real Estate", reit: "Real Estate", reits: "Real Estate",
  utility: "Utilities",
};

export const SECTOR_RS_NORMALIZE_PATTERN = /^(.+?)\s*(?:섹터\s+|sector\s+)?RS(?:\s+score)?$/i;

/**
 * verificationMetric 문자열을 정규화된 키로 변환.
 *
 * "Tech RS" → "Technology RS"
 * "Information Technology 섹터 RS" → "Technology RS"
 * "SPX" → "S&P 500"
 */
export function normalizeMetricKey(raw: string): string {
  const trimmed = raw.trim();
  const lower = trimmed.toLowerCase();

  // 섹터 RS 패턴 매칭
  const sectorMatch = SECTOR_RS_NORMALIZE_PATTERN.exec(trimmed);
  if (sectorMatch != null) {
    const rawSector = sectorMatch[1].trim().toLowerCase();
    const canonical = SECTOR_METRIC_ALIASES[rawSector] ?? sectorMatch[1].trim();
    return `${canonical} RS`;
  }

  // 지수/기타 지표 별칭
  const aliased = METRIC_ALIASES[lower];
  if (aliased != null) return aliased;

  return trimmed;
}
