/**
 * Pure logic for signal recording and return tracking.
 * No DB dependencies — designed for easy testing.
 */

// ── Types ──

export interface SignalParams {
  rsThreshold: number;
  volumeRequired: boolean;
  sectorFilter: boolean;
}

export const DEFAULT_SIGNAL_PARAMS: SignalParams = {
  rsThreshold: 70,
  volumeRequired: true,
  sectorFilter: false,
};

export interface RawSignal {
  symbol: string;
  date: string;
  price: number;
  rsScore: number | null;
  volumeConfirmed: boolean | null;
  sectorGroupPhase: number | null;
  sector: string | null;
  industry: string | null;
}

export interface SignalReturnUpdate {
  daysHeld: number;
  currentReturn: number;
  maxReturn: number;
  return5d: number | null;
  return10d: number | null;
  return20d: number | null;
  return60d: number | null;
  shouldClose: boolean;
  closeReason: string | null;
}

// ── Pure Functions ──

const MAX_TRACKING_DAYS = 60;

/**
 * Filter raw Phase 1→2 signals by the current parameter set.
 */
export function filterSignalsByParams(
  signals: RawSignal[],
  params: SignalParams,
): RawSignal[] {
  return signals.filter((signal) => {
    // RS threshold check
    if (signal.rsScore == null || signal.rsScore < params.rsThreshold) {
      return false;
    }

    // Volume confirmation check
    if (params.volumeRequired && signal.volumeConfirmed !== true) {
      return false;
    }

    // Sector group phase filter (only accept sector in Phase 2)
    if (params.sectorFilter && signal.sectorGroupPhase !== 2) {
      return false;
    }

    return true;
  });
}

/**
 * Calculate percentage return from entry price to current price.
 */
export function calculateReturn(
  entryPrice: number,
  currentPrice: number,
): number {
  if (entryPrice === 0) return 0;
  return ((currentPrice - entryPrice) / entryPrice) * 100;
}

/**
 * Determine whether a signal should be closed.
 */
export function shouldCloseSignal(
  daysHeld: number,
  currentPhase: number | null,
  maxDays: number = MAX_TRACKING_DAYS,
): { shouldClose: boolean; reason: string | null } {
  // Phase 2 exit
  if (currentPhase != null && currentPhase !== 2) {
    return {
      shouldClose: true,
      reason: `Phase ${currentPhase} 이탈`,
    };
  }

  // Max tracking period exceeded while still in Phase 2
  if (daysHeld >= maxDays) {
    return {
      shouldClose: true,
      reason: `최대 추적 기간 ${maxDays}일 도달`,
    };
  }

  return { shouldClose: false, reason: null };
}

/**
 * Compute all return fields for a signal based on current state.
 */
export function computeSignalReturns(opts: {
  entryPrice: number;
  currentPrice: number;
  daysHeld: number;
  currentPhase: number | null;
  prevMaxReturn: number;
  prevReturn5d: number | null;
  prevReturn10d: number | null;
  prevReturn20d: number | null;
  prevReturn60d: number | null;
}): SignalReturnUpdate {
  const currentReturn = calculateReturn(opts.entryPrice, opts.currentPrice);
  const maxReturn = Math.max(opts.prevMaxReturn, currentReturn);

  const return5d =
    opts.daysHeld >= 5 ? (opts.prevReturn5d ?? currentReturn) : null;
  const return10d =
    opts.daysHeld >= 10 ? (opts.prevReturn10d ?? currentReturn) : null;
  const return20d =
    opts.daysHeld >= 20 ? (opts.prevReturn20d ?? currentReturn) : null;
  const return60d =
    opts.daysHeld >= 60 ? (opts.prevReturn60d ?? currentReturn) : null;

  const closeCheck = shouldCloseSignal(opts.daysHeld, opts.currentPhase);

  return {
    daysHeld: opts.daysHeld,
    currentReturn,
    maxReturn,
    return5d,
    return10d,
    return20d,
    return60d,
    shouldClose: closeCheck.shouldClose,
    closeReason: closeCheck.reason,
  };
}

/**
 * Parse signal params from DB rows into a SignalParams object.
 * Falls back to defaults for any missing param.
 */
export function parseSignalParams(
  rows: { paramName: string; currentValue: string }[],
): SignalParams {
  const params = { ...DEFAULT_SIGNAL_PARAMS };

  for (const row of rows) {
    switch (row.paramName) {
      case "rs_threshold":
        params.rsThreshold = Number(row.currentValue);
        break;
      case "volume_required":
        params.volumeRequired = row.currentValue === "true";
        break;
      case "sector_filter":
        params.sectorFilter = row.currentValue === "true";
        break;
    }
  }

  return params;
}
