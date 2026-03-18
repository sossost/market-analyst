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
 * Detect Weinstein Phase for a stock.
 *
 * Phase 2 requires ALL 8 conditions:
 *   1. price > MA150
 *   2. price > MA200
 *   3. MA150 > MA200
 *   4. MA50 > MA150
 *   5. MA150 slope > 0
 *   6. RS > 50
 *   7. price > 30% above 52w low
 *   8. price within 25% of 52w high
 *
 * Phase 4: price < MA150, MA150 < MA200, slope negative, RS low (checked BEFORE Phase 1)
 * Phase 1: MA150 flat, price near MA150
 * Phase 3: everything else (distribution/topping)
 *
 * 판정 우선순위: Phase 2 → Phase 4 → Phase 1 → Phase 3(default)
 * Phase 4를 Phase 1보다 먼저 체크하는 이유: Phase 4 초기 종목이 flat slope + 가격 근접을
 * 동시에 충족하여 Phase 1로 오분류되는 케이스를 방지한다.
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
  };

  const phase = determinePhase(input, ma150Slope, conditionsMet.length);

  return { phase, ma150Slope, detail };
}

function determinePhase(
  input: PhaseInput,
  ma150Slope: number,
  phase2ConditionsMet: number,
): Phase {
  // Phase 2: ALL 8 conditions met
  if (phase2ConditionsMet === 8) {
    return 2;
  }

  const { price, ma150, ma200, rsScore } = input;

  // Phase 4: Markdown / Decline (check BEFORE Phase 1)
  // Phase 4 초기 종목이 flat slope + 가격 근접 조건을 동시에 충족하면
  // Phase 1보다 먼저 체크하여 오분류를 방지한다.
  if (price < ma150 && ma150 < ma200 && ma150Slope < 0 && rsScore < 50) {
    return 4;
  }

  // Phase 1: Base / Accumulation
  // MA150 nearly flat, price near MA150
  const slopeFlat = Math.abs(ma150Slope) < MA150_FLAT_THRESHOLD;
  const priceNearMa150 =
    ma150 > 0 && Math.abs(price - ma150) / ma150 < PRICE_NEAR_MA150_THRESHOLD;

  if (slopeFlat && priceNearMa150) {
    return 1;
  }

  // Phase 3: Distribution / Topping (default)
  return 3;
}
