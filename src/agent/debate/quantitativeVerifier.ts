/**
 * Quantitative thesis verifier.
 *
 * Parses numeric conditions like "S&P 500 > 5800" and evaluates them
 * against a MarketSnapshot — no LLM needed.
 */

import type { MarketSnapshot } from "./marketDataLoader.js";
import type { Thesis } from "../../types/debate.js";

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
    return null;
  }

  // Both parseable, conditions evaluated, but neither met → no conclusion
  return null;
}
