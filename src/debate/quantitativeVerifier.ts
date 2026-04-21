/**
 * Quantitative thesis verifier.
 *
 * Parses numeric conditions like "S&P 500 > 5800" and evaluates them
 * against a MarketSnapshot — no LLM needed.
 */

import type { MarketSnapshot } from "./marketDataLoader.js";
import type { Thesis } from "@/types/debate";
import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ComparisonOperator = ">" | "<" | ">=" | "<=";

export interface ParsedCondition {
  metric: string;
  operator: ComparisonOperator;
  value: number;
}

export interface EvaluationResult {
  result: boolean;
  actualValue: number;
}

export interface QuantitativeResult {
  verdict: "CONFIRMED" | "INVALIDATED";
  reason: string;
  method: "quantitative";
}

// ---------------------------------------------------------------------------
// Index alias mapping
// ---------------------------------------------------------------------------

const INDEX_ALIASES: Record<string, string> = {
  SPX: "S&P 500",
  QQQ: "NASDAQ",
  IWM: "Russell 2000",
};

// ---------------------------------------------------------------------------
// Sector alias mapping
//
// LLM이 생성하는 섹터 이름(약칭·GICS 공식명 포함)을 DB의 실제 섹터 이름으로 매핑.
// DB 실제 섹터 목록 (sector_rs_daily.sector):
//   Basic Materials, Communication Services, Consumer Cyclical,
//   Consumer Defensive, Energy, Financial Services, Healthcare,
//   Industrials, Real Estate, Technology, Utilities
// ---------------------------------------------------------------------------

const SECTOR_ALIASES: Record<string, string> = {
  // Technology
  tech: "Technology",
  it: "Technology",
  "information technology": "Technology",
  "info tech": "Technology",

  // Communication Services
  "comm services": "Communication Services",
  "communication svc": "Communication Services",
  "communications services": "Communication Services",
  communications: "Communication Services",
  telecom: "Communication Services",

  // Consumer Cyclical
  "consumer discretionary": "Consumer Cyclical",
  "cons cyclical": "Consumer Cyclical",
  "consumer cyc": "Consumer Cyclical",
  discretionary: "Consumer Cyclical",

  // Consumer Defensive
  "consumer staples": "Consumer Defensive",
  "cons defensive": "Consumer Defensive",
  staples: "Consumer Defensive",

  // Financial Services
  financials: "Financial Services",
  finance: "Financial Services",
  financial: "Financial Services",

  // Basic Materials
  materials: "Basic Materials",
  "basic material": "Basic Materials",

  // Healthcare
  health: "Healthcare",
  "health care": "Healthcare",

  // Industrials
  industrial: "Industrials",

  // Real Estate
  realestate: "Real Estate",
  reit: "Real Estate",
  reits: "Real Estate",

  // Utilities
  utility: "Utilities",
};

/**
 * Normalize a raw sector name from LLM output to the canonical DB sector name.
 * Returns the canonical name if found, otherwise returns the original name.
 */
function normalizeSectorName(rawSectorName: string): string {
  const lower = rawSectorName.toLowerCase().trim();
  return SECTOR_ALIASES[lower] ?? rawSectorName;
}

// ---------------------------------------------------------------------------
// Credit indicator alias mapping
//
// LLM이 생성하는 신용 지표 이름을 FRED series ID로 매핑.
// DB 실제 series ID: BAMLH0A0HYM2, BAMLH0A3HYC, BAMLC0A4CBBB, STLFSI4
// ---------------------------------------------------------------------------

const CREDIT_INDICATOR_ALIASES: Record<string, string> = {
  // HY OAS Spread (BAMLH0A0HYM2)
  "hy spread": "BAMLH0A0HYM2",
  "hy oas": "BAMLH0A0HYM2",
  "hy oas spread": "BAMLH0A0HYM2",
  "hy 스프레드": "BAMLH0A0HYM2",
  "high yield spread": "BAMLH0A0HYM2",
  "high yield oas": "BAMLH0A0HYM2",
  bamlh0a0hym2: "BAMLH0A0HYM2",

  // CCC Spread (BAMLH0A3HYC)
  "ccc spread": "BAMLH0A3HYC",
  "ccc 스프레드": "BAMLH0A3HYC",
  bamlh0a3hyc: "BAMLH0A3HYC",

  // BBB Spread (BAMLC0A4CBBB)
  "bbb spread": "BAMLC0A4CBBB",
  "bbb 스프레드": "BAMLC0A4CBBB",
  bamlc0a4cbbb: "BAMLC0A4CBBB",

  // Financial Stress (STLFSI4)
  "financial stress": "STLFSI4",
  "금융 스트레스": "STLFSI4",
  stlfsi: "STLFSI4",
  stlfsi4: "STLFSI4",
};

// ---------------------------------------------------------------------------
// Supported metrics — exported for prompt injection
// ---------------------------------------------------------------------------

/**
 * 시스템이 자동 검증할 수 있는 지표 전체 목록.
 * round3-synthesis 프롬프트에 주입되어 LLM이 파싱 가능한 조건을 생성하도록 유도.
 */
export const SUPPORTED_METRICS = {
  indices: ["S&P 500", "NASDAQ", "DOW 30", "Russell 2000", "VIX"],
  indexAliases: INDEX_ALIASES,
  sectorRS: [
    "Technology RS", "Energy RS", "Healthcare RS", "Financial Services RS",
    "Consumer Cyclical RS", "Consumer Defensive RS", "Industrials RS",
    "Communication Services RS", "Basic Materials RS", "Real Estate RS", "Utilities RS",
  ],
  fearGreed: ["Fear & Greed"],
  creditIndicators: [
    { alias: "HY OAS", description: "High Yield OAS 스프레드" },
    { alias: "CCC spread", description: "CCC등급 스프레드" },
    { alias: "BBB spread", description: "BBB등급 스프레드" },
    { alias: "Financial Stress", description: "금융 스트레스 지수 (STLFSI4)" },
  ],
} as const;

/**
 * SUPPORTED_METRICS를 프롬프트 주입용 텍스트로 포맷.
 * 이 함수의 출력을 Round 3 프롬프트에 삽입하여 LLM이 파싱 가능한 조건을 생성하도록 유도.
 */
export function formatSupportedMetricsForPrompt(): string {
  const aliasEntries = Object.entries(SUPPORTED_METRICS.indexAliases)
    .map(([alias, target]) => `${alias} (→ ${target})`)
    .join(", ");

  const creditEntries = SUPPORTED_METRICS.creditIndicators
    .map((ci) => `${ci.alias} (${ci.description})`)
    .join(", ");

  return [
    "**시스템이 자동 검증 가능한 지표 전체 목록:**",
    `- 지수: ${SUPPORTED_METRICS.indices.join(", ")}`,
    `- 지수 별칭: ${aliasEntries}`,
    `- 섹터 RS: ${SUPPORTED_METRICS.sectorRS.join(", ")}`,
    `- 공포탐욕지수: ${SUPPORTED_METRICS.fearGreed.join(", ")}`,
    `- 신용 지표: ${creditEntries}`,
    "",
    "**위 목록 외의 지표를 targetCondition/invalidationCondition에 사용하면 자동 검증이 불가능하여 LLM 주관 판정으로 전락합니다.**",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Sector RS metric pattern
//
// Matches forms like:
//   "Technology RS"
//   "Technology sector RS"
//   "Tech RS"
//   "Information Technology RS"
//   "Technology RS score"
// ---------------------------------------------------------------------------

const SECTOR_RS_PATTERN = /^(.+?)\s*(?:sector\s+)?RS(?:\s+score)?$/i;

// ---------------------------------------------------------------------------
// Condition regex
// ---------------------------------------------------------------------------

const CONDITION_PATTERN = /^(.+?)\s*(>=|<=|>|<)\s*([0-9,._]+)$/;

// ---------------------------------------------------------------------------
// parseQuantitativeCondition
// ---------------------------------------------------------------------------

/**
 * Parse a string like "S&P 500 > 5800" into structured condition.
 * Returns null if the string is not a numeric comparison.
 */
export function parseQuantitativeCondition(
  condition: string | null | undefined,
): ParsedCondition | null {
  if (condition == null || condition === "") {
    return null;
  }

  const trimmed = condition.trim();
  if (trimmed === "") {
    return null;
  }

  const match = CONDITION_PATTERN.exec(trimmed);
  if (match == null) {
    return null;
  }

  const metric = match[1].trim();
  const operator = match[2] as ComparisonOperator;
  const rawValue = match[3].replace(/[,_]/g, "");
  const value = Number(rawValue);

  if (Number.isNaN(value)) {
    return null;
  }

  return { metric, operator, value };
}

// ---------------------------------------------------------------------------
// evaluateQuantitativeCondition
// ---------------------------------------------------------------------------

/**
 * Resolve metric name to an actual value from the snapshot.
 * Returns the numeric value or null if metric not found.
 */
function resolveMetricValue(
  metric: string,
  snapshot: MarketSnapshot,
): number | null {
  // Normalize: resolve aliases
  const normalized = INDEX_ALIASES[metric] ?? metric;

  // Check if it's a sector RS metric
  const sectorRsMatch = SECTOR_RS_PATTERN.exec(normalized);
  if (sectorRsMatch != null) {
    const rawSectorName = sectorRsMatch[1].trim();
    const canonicalName = normalizeSectorName(rawSectorName);
    const sector = snapshot.sectors.find(
      (s) => s.sector.toLowerCase() === canonicalName.toLowerCase(),
    );
    if (sector != null) {
      return sector.avgRs;
    }
    return null;
  }

  // Check indices by name (exact match)
  const index = snapshot.indices.find(
    (idx) => idx.name.toLowerCase() === normalized.toLowerCase(),
  );
  if (index != null) {
    return index.close;
  }

  // Check Fear & Greed Index
  const fearGreedAliases = ["fear & greed", "fear and greed", "fear&greed", "공포탐욕지수"];
  if (fearGreedAliases.includes(normalized.toLowerCase()) && snapshot.fearGreed != null) {
    return snapshot.fearGreed.score;
  }

  // Check VIX (via indices)
  if (normalized.toLowerCase() === "vix") {
    const vix = snapshot.indices.find(
      (idx) => idx.name.toLowerCase() === "vix",
    );
    if (vix != null) {
      return vix.close;
    }
  }

  // Check credit indicators
  const lowerNormalized = normalized.toLowerCase();
  const creditSeriesId = CREDIT_INDICATOR_ALIASES[lowerNormalized];
  if (creditSeriesId != null) {
    return snapshot.creditIndicators.find((c) => c.seriesId === creditSeriesId)?.value ?? null;
  }

  return null;
}

/**
 * Compare an actual value against a parsed condition.
 */
function compare(
  actual: number,
  operator: ComparisonOperator,
  target: number,
): boolean {
  switch (operator) {
    case ">":
      return actual > target;
    case "<":
      return actual < target;
    case ">=":
      return actual >= target;
    case "<=":
      return actual <= target;
    default: {
      const _exhaustive: never = operator;
      throw new Error(`Unhandled operator: ${_exhaustive}`);
    }
  }
}

/**
 * Evaluate a parsed condition against a market snapshot.
 * Returns { result, actualValue } or null if metric not found.
 */
export function evaluateQuantitativeCondition(
  parsed: ParsedCondition,
  snapshot: MarketSnapshot,
): EvaluationResult | null {
  const actualValue = resolveMetricValue(parsed.metric, snapshot);
  if (actualValue == null) {
    return null;
  }

  return {
    result: compare(actualValue, parsed.operator, parsed.value),
    actualValue,
  };
}

// ---------------------------------------------------------------------------
// tryQuantitativeVerification
// ---------------------------------------------------------------------------

/**
 * Attempt quantitative verification of a thesis.
 *
 * - Parses targetCondition and invalidationCondition
 * - If invalidation condition is met → INVALIDATED (safety first)
 * - If target condition is met → CONFIRMED
 * - If both parseable but neither met → null (no conclusion yet)
 * - If unparseable → null (LLM fallback signal)
 */
export function tryQuantitativeVerification(
  thesis: Thesis,
  snapshot: MarketSnapshot,
): QuantitativeResult | null {
  const targetParsed = parseQuantitativeCondition(thesis.targetCondition);
  const invalidationParsed = parseQuantitativeCondition(
    thesis.invalidationCondition,
  );

  // Neither condition is parseable → LLM fallback
  if (targetParsed == null && invalidationParsed == null) {
    logger.info(
      "QuantVerifier",
      `[SKIP] Thesis "${thesis.targetCondition}" — 정량 파싱 불가 (LLM fallback)`,
    );
    return null;
  }

  // Evaluate each condition once
  const invalidationEval = invalidationParsed != null
    ? evaluateQuantitativeCondition(invalidationParsed, snapshot)
    : null;

  // Check invalidation first (safety-first)
  if (invalidationEval?.result) {
    return {
      verdict: "INVALIDATED",
      reason:
        `무효화 조건 충족: ${thesis.invalidationCondition} ` +
        `(실제값: ${invalidationEval.actualValue})`,
      method: "quantitative",
    };
  }

  const targetEval = targetParsed != null
    ? evaluateQuantitativeCondition(targetParsed, snapshot)
    : null;

  // Check target condition
  if (targetEval?.result) {
    return {
      verdict: "CONFIRMED",
      reason:
        `목표 조건 충족: ${thesis.targetCondition} ` +
        `(실제값: ${targetEval.actualValue})`,
      method: "quantitative",
    };
  }

  // If any parseable condition couldn't be evaluated (metric not found) → LLM fallback
  if ((targetParsed != null && targetEval == null) || (invalidationParsed != null && invalidationEval == null)) {
    const unresolvedMetric = targetParsed != null && targetEval == null
      ? targetParsed.metric
      : invalidationParsed!.metric;
    logger.warn(
      "QuantVerifier",
      `[UNRESOLVED] 메트릭 "${unresolvedMetric}" 미발견 — 지원 메트릭: 지수(S&P 500, NASDAQ, VIX 등), 섹터 RS, Fear & Greed`,
    );
    return null;
  }

  // Both parseable, conditions evaluated, but neither met → no conclusion
  return null;
}
