/**
 * Smart Flow Signal — 옵션 플로우 + 다크풀 복합 시그널 생성.
 *
 * 기존 Phase/RS 시그널을 대체하지 않고, 확인/강화하는 보조 레이어.
 * 옵션 이상 거래(스마트머니)와 다크풀 블록 거래를 종합하여
 * 기관 매집 선행 신호를 포착한다.
 */
import type {
  OptionsFlowDailyAgg,
  DarkPoolDailyAgg,
  SmartFlowSignal,
  SmartFlowSignalType,
  SmartFlowStrength,
} from "@/types/unusual-whales";

// ─── Thresholds ─────────────────────────────────────────────────────────────

/** Minimum sweep count to flag as bullish sweep signal. */
const MIN_SWEEP_COUNT = 3;
/** Minimum total premium ($) to consider options flow significant. */
const MIN_TOTAL_PREMIUM = 100_000;
/** Minimum dark pool notional ($) to consider accumulation. */
const MIN_DARK_NOTIONAL = 500_000;
/** Minimum dark pool trade count for signal consideration. */
const MIN_DARK_TRADE_COUNT = 5;
/** Sentiment score threshold for bullish bias. */
const BULLISH_SENTIMENT_THRESHOLD = 30;
/** Call/put ratio threshold for strong bullish signal. */
const STRONG_CALL_PUT_RATIO = 3.0;

// ─── Score Weights ──────────────────────────────────────────────────────────

const WEIGHT_SENTIMENT = 0.3;
const WEIGHT_SWEEP = 0.25;
const WEIGHT_DARK_NOTIONAL = 0.25;
const WEIGHT_CALL_PUT = 0.2;

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Generate a SmartFlowSignal from daily aggregated options flow and dark pool data.
 * Returns null if neither data source meets minimum thresholds.
 */
export function generateSmartFlowSignal(
  symbol: string,
  date: string,
  optionsFlow: OptionsFlowDailyAgg | null,
  darkPool: DarkPoolDailyAgg | null,
): SmartFlowSignal | null {
  const hasOptions = optionsFlow != null && optionsFlow.totalPremium >= MIN_TOTAL_PREMIUM;
  const hasDarkPool =
    darkPool != null &&
    darkPool.totalNotional >= MIN_DARK_NOTIONAL &&
    darkPool.tradeCount >= MIN_DARK_TRADE_COUNT;

  if (!hasOptions && !hasDarkPool) {
    return null;
  }

  const signalType = determineSignalType(
    hasOptions ? optionsFlow : null,
    hasDarkPool ? darkPool : null,
  );
  const compositeScore = calculateCompositeScore(
    hasOptions ? optionsFlow : null,
    hasDarkPool ? darkPool : null,
  );
  const strength = determineStrength(compositeScore);

  return {
    symbol,
    date,
    signalType,
    strength,
    compositeScore,
    confirmsExisting: false, // set by caller after cross-referencing Phase/RS
    details: {
      optionsFlow: hasOptions ? optionsFlow : null,
      darkPool: hasDarkPool ? darkPool : null,
    },
  };
}

/**
 * Mark a signal as confirming existing Phase 2 / RS signals.
 * Pure function — returns a new signal object.
 */
export function markAsConfirming(signal: SmartFlowSignal): SmartFlowSignal {
  return { ...signal, confirmsExisting: true };
}

// ─── Internal Logic ─────────────────────────────────────────────────────────

function determineSignalType(
  optionsFlow: OptionsFlowDailyAgg | null,
  darkPool: DarkPoolDailyAgg | null,
): SmartFlowSignalType {
  const hasBullishSweeps =
    optionsFlow != null && optionsFlow.sweepCount >= MIN_SWEEP_COUNT;
  const hasDarkAccumulation = darkPool != null;

  if (hasBullishSweeps && hasDarkAccumulation) {
    return "MIXED";
  }
  if (hasBullishSweeps) {
    return "BULLISH_SWEEP";
  }
  if (hasDarkAccumulation) {
    return "DARK_ACCUMULATION";
  }

  // Options flow present but no sweeps → general surge
  return "OPTIONS_SURGE";
}

function calculateCompositeScore(
  optionsFlow: OptionsFlowDailyAgg | null,
  darkPool: DarkPoolDailyAgg | null,
): number {
  let score = 0;

  if (optionsFlow != null) {
    // Sentiment component: -100 to +100 → weighted
    const sentimentComponent = optionsFlow.sentimentScore * WEIGHT_SENTIMENT;

    // Sweep component: 0 to 100 based on sweep ratio
    const sweepRatio =
      optionsFlow.totalContracts > 0
        ? optionsFlow.sweepCount / optionsFlow.totalContracts
        : 0;
    const sweepComponent = Math.min(sweepRatio * 500, 100) * WEIGHT_SWEEP;

    // Call/put ratio component: 0 to 100
    const cpRatio = Math.min(optionsFlow.callPutRatio, 10);
    const cpComponent = (cpRatio / 10) * 100 * WEIGHT_CALL_PUT;

    score += sentimentComponent + sweepComponent + cpComponent;
  }

  if (darkPool != null) {
    // Dark pool notional component: normalized 0-100
    // $500K = 0, $10M+ = 100
    const notionalNorm = Math.min(
      (darkPool.totalNotional - MIN_DARK_NOTIONAL) / (10_000_000 - MIN_DARK_NOTIONAL),
      1,
    );
    const darkComponent = Math.max(notionalNorm * 100, 0) * WEIGHT_DARK_NOTIONAL;
    score += darkComponent;
  }

  return Math.round(Math.max(-100, Math.min(100, score)));
}

function determineStrength(compositeScore: number): SmartFlowStrength {
  const absScore = Math.abs(compositeScore);

  if (absScore >= 60) return "STRONG";
  if (absScore >= 30) return "MODERATE";
  return "WEAK";
}

/**
 * Check if an options flow record suggests institutional accumulation.
 * Utility for quick screening before full signal generation.
 */
export function isInstitutionalFlow(
  optionsFlow: OptionsFlowDailyAgg,
): boolean {
  return (
    optionsFlow.totalPremium >= MIN_TOTAL_PREMIUM &&
    optionsFlow.sentimentScore >= BULLISH_SENTIMENT_THRESHOLD &&
    (optionsFlow.sweepCount >= MIN_SWEEP_COUNT ||
      optionsFlow.callPutRatio >= STRONG_CALL_PUT_RATIO)
  );
}
