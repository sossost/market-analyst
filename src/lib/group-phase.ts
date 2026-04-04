import type { Phase } from "@/types";

const FLAT_THRESHOLD = 1.5; // ±1.5 RS points considered flat
const PHASE2_RATIO_THRESHOLD = 0.3; // 30%+ of stocks in Phase 2
const DECLINE_THRESHOLD = -2; // RS declining by 2+ points
const MIN_GROUP_STOCKS = 5; // 최소 종목 수 — 소규모 섹터의 noise Phase 2 판정 방지

interface GroupPhaseInput {
  change4w: number | null;
  change8w: number | null;
  phase2Ratio: number;
  /** 섹터/업종 내 총 종목 수. 미전달 시 min stock 게이트 비활성. */
  totalStocks?: number;
}

/**
 * Detect the aggregate Phase for a sector or industry.
 *
 * Phase 2: RS accelerating (both 4w & 8w positive) AND phase2 ratio >= 30%
 * Phase 4: RS declining (both 4w & 8w negative) AND phase2 ratio < 20%
 * Phase 1: RS flat (small changes) — base forming
 * Phase 3: Mixed signals — distribution/topping (default)
 */
export function detectGroupPhase(input: GroupPhaseInput): Phase {
  const { change4w, change8w, phase2Ratio, totalStocks } = input;

  // No historical data → base
  if (change4w == null || change8w == null) {
    return 1;
  }

  // Phase 2: Both periods accelerating + enough Phase 2 stocks + min stock count
  const meetsMinStocks = totalStocks == null || totalStocks >= MIN_GROUP_STOCKS;
  if (
    change4w > FLAT_THRESHOLD &&
    change8w > FLAT_THRESHOLD &&
    phase2Ratio >= PHASE2_RATIO_THRESHOLD &&
    meetsMinStocks
  ) {
    return 2;
  }

  // Phase 4: Both periods declining + few Phase 2 stocks
  if (
    change4w < DECLINE_THRESHOLD &&
    change8w < DECLINE_THRESHOLD &&
    phase2Ratio < 0.2
  ) {
    return 4;
  }

  // Phase 1: Flat (small magnitude in both periods)
  if (
    Math.abs(change4w) <= FLAT_THRESHOLD &&
    Math.abs(change8w) <= FLAT_THRESHOLD
  ) {
    return 1;
  }

  // Phase 3: Everything else (mixed signals, topping, distribution)
  return 3;
}
