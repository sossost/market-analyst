import type { PhaseInput, PhaseResult, PhaseDetail, Phase } from "@/types";

/**
 * Calculate MA150 slope as percentage change over 20 trading days.
 */
export function calculateMa150Slope(
  ma150Today: number,
  ma150_20dAgo: number,
): number {
  if (ma150_20dAgo === 0) return 0;
  return (ma150Today - ma150_20dAgo) / ma150_20dAgo;
}

// Phase 1 (Base): MA150 nearly flat, price oscillating near MA150
const MA150_FLAT_THRESHOLD = 0.02; // ±2% considered flat
const PRICE_NEAR_MA150_THRESHOLD = 0.05; // within 5% of MA150

/**
 * Minimum Phase 2 conditions required (out of 8).
 * Core conditions (must ALL be met): price > MA150, MA150 > MA200, MA150 slope > 0.
 *
 * 변경 이력:
 * - 6/8: 소형주에서 하루만에 조건 깨지는 false positive 양산 (승률 0%, #376)
 * - 7/8: 초입 포착 유지하면서 최소 안정성 확보
 */
const PHASE_2_MIN_CONDITIONS = 7;

/**
 * Detect Weinstein Phase for a stock.
 *
 * Phase 2 conditions (8 total):
 *   1. price > MA150
 *   2. price > MA200
 *   3. MA150 > MA200
 *   4. MA50 > MA150
 *   5. MA150 slope > 0
 *   6. RS > 50
 *   7. price > 30% above 52w low
 *   8. price within 25% of 52w high
 *
 * Phase 2 판정: Core 3개 조건 충족 + 총 6/8 이상 → Phase 2.
 *   Core: price > MA150, MA150 > MA200, MA150 slope > 0
 *   이전 8/8 이진 판정에서 6/8 최소로 완화하여 전환 초입 포착.
 *
 * Phase 4: price < MA150, MA150 < MA200, slope negative, RS < 50
 * Phase 3 (distribution): price ≤ MA150 AND MA150 > MA200 (topping after Phase 2 run)
 * Phase 1: MA150 flat, price near MA150
 * Phase 3: everything else (default)
 *
 * 판정 우선순위: Phase 2 → Phase 4 → Phase 3(distribution) → Phase 1 → Phase 3(default)
 */
export function detectPhase(input: PhaseInput): PhaseResult {
  const { price, ma50, ma150, ma200, ma150_20dAgo, rsScore, high52w, low52w } =
    input;

  const ma150Slope = calculateMa150Slope(ma150, ma150_20dAgo);

  // Evaluate all 8 Phase 2 conditions
  const priceAboveMa150 = price > ma150;
  const priceAboveMa200 = price > ma200;
  const ma150AboveMa200 = ma150 > ma200;
  const ma50AboveMa150 = ma50 > ma150;
  const ma150SlopePositive = ma150Slope > 0;
  const rsAbove50 = rsScore > 50;
  const priceAbove30PctFromLow = low52w > 0 && price > low52w * 1.3;
  const priceWithin25PctOfHigh = high52w > 0 && price >= high52w * 0.75;

  const conditionsMet: string[] = [];
  if (priceAboveMa150) conditionsMet.push("price > MA150");
  if (priceAboveMa200) conditionsMet.push("price > MA200");
  if (ma150AboveMa200) conditionsMet.push("MA150 > MA200");
  if (ma50AboveMa150) conditionsMet.push("MA50 > MA150");
  if (ma150SlopePositive) conditionsMet.push("MA150 slope > 0");
  if (rsAbove50) conditionsMet.push("RS > 50");
  if (priceAbove30PctFromLow) conditionsMet.push("price > 30% from 52w low");
  if (priceWithin25PctOfHigh)
    conditionsMet.push("price within 25% of 52w high");

  const detail: PhaseDetail = {
    priceAboveMa150,
    priceAboveMa200,
    ma150AboveMa200,
    ma50AboveMa150,
    ma150SlopePositive,
    rsAbove50,
    priceAbove30PctFromLow,
    priceWithin25PctOfHigh,
    conditionsMet,
    phase2ConditionsMet: conditionsMet.length,
  };

  const phase = determinePhase(input, ma150Slope, detail);

  return { phase, ma150Slope, detail };
}

function determinePhase(
  input: PhaseInput,
  ma150Slope: number,
  detail: PhaseDetail,
): Phase {
  const { priceAboveMa150, ma150AboveMa200, ma150SlopePositive } = detail;
  const totalConditions = detail.phase2ConditionsMet;

  // Phase 2: Core conditions (price > MA150, MA150 > MA200, slope positive)
  // + at least 6/8 total conditions met.
  // Previously required 8/8 — relaxed to 6/8 to capture Phase 2 early/transitioning stocks.
  if (
    priceAboveMa150 &&
    ma150AboveMa200 &&
    ma150SlopePositive &&
    totalConditions >= PHASE_2_MIN_CONDITIONS
  ) {
    return 2;
  }

  const { price, ma150, ma200, rsScore } = input;

  const slopeNegative = ma150Slope < 0;
  const slopeFlat = Math.abs(ma150Slope) < MA150_FLAT_THRESHOLD;

  // Phase 4: Markdown / Decline (check BEFORE Phase 1)
  // Phase 4 초기 종목이 flat slope + 가격 근접 조건을 동시에 충족하면
  // Phase 1보다 먼저 체크하여 오분류를 방지한다.
  if (price < ma150 && ma150 < ma200 && slopeNegative && rsScore < 50) {
    return 4;
  }

  // Phase 3 (distribution): price dropped below (or at) MA150 while MA150 still above MA200.
  // This catches topping/distribution after a Phase 2 run.
  // MUST be checked BEFORE Phase 1 to prevent Phase 3 → Phase 1 misclassification
  // when slope is flat and price is near MA150.
  if (!priceAboveMa150 && ma150AboveMa200) {
    return 3;
  }

  // Phase 1: Base / Accumulation
  // MA150 nearly flat, price near MA150
  const priceNearMa150 =
    ma150 > 0 && Math.abs(price - ma150) / ma150 < PRICE_NEAR_MA150_THRESHOLD;

  if (slopeFlat && priceNearMa150) {
    return 1;
  }

  // Phase 3: Distribution / Topping (default)
  return 3;
}
