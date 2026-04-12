/**
 * 키워드 기반 뉴스 분류기.
 * LLM 호출 없이 키워드 매칭으로 카테고리 + 감성을 판정한다.
 * 정확도 ~70% — 대량 처리에 충분한 수준.
 */

export type NewsCategory =
  | "POLICY"
  | "TECHNOLOGY"
  | "GEOPOLITICAL"
  | "CAPEX"
  | "CREDIT"
  | "MARKET"
  | "OTHER";

export type NewsSentiment = "POS" | "NEU" | "NEG";

/**
 * 키워드를 RegExp로 변환한다.
 * 시작에만 word boundary를 적용하여:
 * - "ai"가 "chain", "taiwan" 내부에서 매칭되지 않도록 방지
 * - "geopolit"이 "geopolitical"에 매칭되도록 허용 (prefix 패턴)
 * - "beat"이 "beats"에 매칭되도록 허용 (어미 변화)
 */
function buildKeywordPattern(keyword: string): RegExp {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}`, "i");
}

/**
 * 카테고리별 키워드 패턴.
 * 배열 순서 = 우선순위. 앞 카테고리 매칭 시 즉시 반환.
 */
const CATEGORY_PATTERNS: readonly { category: NewsCategory; patterns: RegExp[] }[] = [
  {
    category: "POLICY",
    patterns: [
      "federal reserve",
      "fed",
      "rate",
      "tariff",
      "regulation",
      "legislation",
      "subsidy",
      "executive order",
      "treasury",
      "fiscal",
    ].map(buildKeywordPattern),
  },
  {
    category: "TECHNOLOGY",
    patterns: [
      "ai",
      "artificial intelligence",
      "semiconductor",
      "chip",
      "gpu",
      "cloud",
      "data center",
      "software",
      "tech earnings",
    ].map(buildKeywordPattern),
  },
  {
    category: "GEOPOLITICAL",
    patterns: [
      "china",
      "taiwan",
      "russia",
      "ukraine",
      "trade war",
      "sanctions",
      "nato",
      "supply chain",
      "geopolit",
    ].map(buildKeywordPattern),
  },
  {
    category: "CAPEX",
    patterns: [
      "capex",
      "capital expenditure",
      "investment",
      "spending",
      "infrastructure",
      "hyperscaler",
    ].map(buildKeywordPattern),
  },
  {
    category: "CREDIT",
    patterns: [
      "private equity",
      "private credit",
      "clo",
      "leveraged loan",
      "high yield",
      "credit spread",
      "credit stress",
      "credit default",
      "junk bond",
      "debt crisis",
      "nav lending",
    ].map(buildKeywordPattern),
  },
  {
    category: "MARKET",
    patterns: [
      "market",
      "stocks",
      "earnings",
      "vix",
      "sentiment",
      "fund flow",
      "etf",
      "institutional",
    ].map(buildKeywordPattern),
  },
] as const;

const POSITIVE_PATTERNS = [
  "surge",
  "rally",
  "beat",
  "record",
  "growth",
  "upside",
  "outperform",
  "bullish",
  "strong",
  "gain",
].map(buildKeywordPattern);

const NEGATIVE_PATTERNS = [
  "fall",
  "drop",
  "miss",
  "recession",
  "decline",
  "bearish",
  "weak",
  "risk",
  "concern",
  "warning",
  "cut",
].map(buildKeywordPattern);

/**
 * 텍스트에서 키워드 기반으로 뉴스 카테고리를 분류한다.
 * 우선순위: POLICY > TECHNOLOGY > GEOPOLITICAL > CAPEX > CREDIT > MARKET > OTHER
 */
export function classifyCategory(text: string): NewsCategory {
  for (const { category, patterns } of CATEGORY_PATTERNS) {
    const hasMatch = patterns.some((pattern) => pattern.test(text));
    if (hasMatch) {
      return category;
    }
  }

  return "OTHER";
}

/**
 * 텍스트에서 키워드 기반으로 감성을 분류한다.
 * POS/NEG 키워드가 모두 있으면 더 많은 쪽을 반환.
 * 동일하거나 없으면 NEU.
 */
export function classifySentiment(text: string): NewsSentiment {
  const posCount = POSITIVE_PATTERNS.filter((pattern) => pattern.test(text)).length;
  const negCount = NEGATIVE_PATTERNS.filter((pattern) => pattern.test(text)).length;

  if (posCount > negCount) return "POS";
  if (negCount > posCount) return "NEG";
  return "NEU";
}
