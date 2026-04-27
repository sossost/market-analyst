/**
 * exitPatternAnalysis.ts — EXITED 종목 패턴 분석 순수 함수.
 *
 * DB 의존 없는 순수 함수만 포함한다.
 * scripts/analyze-exit-patterns.ts에서 DB 조회 후 이 함수들을 호출한다.
 *
 * Issue #997 — RS 필터 외 근본 원인 탐색
 */

// ─── 타입 ─────────────────────────────────────────────────────────────────────

export interface ExitedPosition {
  symbol: string;
  entryDate: string;
  exitDate: string | null;
  holdingDays: number;
  entryRsScore: number | null;
  pnlPercent: number | null;
  maxPnlPercent: number | null;
  exitReason: string | null;
  source: string;
  tier: string;
  marketRegime: string | null;
}

export type HoldingDuration = "flash" | "short" | "medium" | "long";

export interface RsBandStats {
  band: string;
  count: number;
  winnerCount: number;
  winRate: number;
  avgPnl: number;
  avgMaxPnl: number;
}

export interface HoldingDurationStats {
  duration: HoldingDuration;
  count: number;
  winnerCount: number;
  winRate: number;
  avgPnl: number;
}

export interface ExitReasonStats {
  reason: string;
  count: number;
  winnerCount: number;
  winRate: number;
  avgPnl: number;
  avgHoldingDays: number;
}

export interface RegimeTransitionStats {
  withinTransition: number;
  outsideTransition: number;
  withinTransitionWinRate: number;
  outsideTransitionWinRate: number;
  withinTransitionAvgPnl: number;
  outsideTransitionAvgPnl: number;
}

export interface StabilitySimulationResult {
  originalCount: number;
  filteredCount: number;
  additionallyBlockedCount: number;
  /** Phase 히스토리 부족으로 시뮬레이션에서 제외된 종목 수 */
  insufficientDataCount: number;
  /** 추가 차단 종목들의 평균 PnL — 음수면 차단이 유효 */
  blockedAvgPnl: number | null;
  blockedWinRate: number | null;
  remainingWinRate: number | null;
  remainingAvgPnl: number | null;
}

export interface WinnerLoserProfile {
  winners: {
    count: number;
    avgHoldingDays: number;
    avgRsScore: number | null;
    avgPnl: number;
    avgMaxPnl: number;
  };
  losers: {
    count: number;
    avgHoldingDays: number;
    avgRsScore: number | null;
    avgPnl: number;
    avgMaxPnl: number;
  };
}

export interface ExitPatternReport {
  totalExited: number;
  overallWinRate: number;
  overallAvgPnl: number;
  overallAvgHoldingDays: number;
  byRsBand: RsBandStats[];
  byHoldingDuration: HoldingDurationStats[];
  byExitReason: ExitReasonStats[];
  regimeTransition: RegimeTransitionStats;
  winnerLoserProfile: WinnerLoserProfile;
}

// ─── 상수 ─────────────────────────────────────────────────────────────────────

const RS_BANDS: Array<{ label: string; min: number; max: number }> = [
  { label: "RS 60-69", min: 60, max: 69 },
  { label: "RS 70-79", min: 70, max: 79 },
  { label: "RS 80+", min: 80, max: Infinity },
];

const HOLDING_DURATION_THRESHOLDS: Array<{
  duration: HoldingDuration;
  min: number;
  max: number;
}> = [
  { duration: "flash", min: 0, max: 2 },
  { duration: "short", min: 3, max: 7 },
  { duration: "medium", min: 8, max: 30 },
  { duration: "long", min: 31, max: Infinity },
];

// ─── 순수 함수 ────────────────────────────────────────────────────────────────

/**
 * 보유 기간을 flash/short/medium/long으로 분류한다.
 */
export function classifyHoldingDuration(days: number): HoldingDuration {
  for (const t of HOLDING_DURATION_THRESHOLDS) {
    if (days >= t.min && days <= t.max) return t.duration;
  }
  return "long";
}

/**
 * RS 점수를 대역 라벨로 분류한다.
 * 60 미만이면 "RS <60"으로 분류.
 */
export function classifyRsBand(rsScore: number | null): string {
  if (rsScore == null) return "N/A";
  for (const band of RS_BANDS) {
    if (rsScore >= band.min && rsScore <= band.max) return band.label;
  }
  if (rsScore < 60) return "RS <60";
  return "N/A";
}

/**
 * 날짜가 특정 범위 내에 있는지 판정한다. (inclusive)
 */
export function isWithinDateRange(
  date: string,
  rangeStart: string,
  rangeEnd: string,
): boolean {
  return date >= rangeStart && date <= rangeEnd;
}

/**
 * 승률을 계산한다. PnL > 0인 비율 (0~100).
 */
export function calculateWinRate(pnls: Array<number | null>): number {
  const valid = pnls.filter((p): p is number => p != null);
  if (valid.length === 0) return 0;
  const winners = valid.filter((p) => p > 0);
  return (winners.length / valid.length) * 100;
}

/**
 * exit_reason을 정규화한다.
 * "phase_exit: 2 → 1" → "phase_exit"
 */
export function normalizeExitReason(reason: string | null): string {
  if (reason == null) return "unknown";
  if (reason.startsWith("phase_exit")) return "phase_exit";
  if (reason.startsWith("tracking_window_expired")) return "tracking_window_expired";
  return reason;
}

/**
 * 숫자 배열의 평균을 계산한다.
 */
function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * RS 대역별 통계를 집계한다.
 */
export function buildRsBandStats(positions: ExitedPosition[]): RsBandStats[] {
  const bands = [...RS_BANDS.map((b) => b.label), "RS <60", "N/A"];
  const groups = new Map<string, ExitedPosition[]>();

  for (const band of bands) {
    groups.set(band, []);
  }

  for (const pos of positions) {
    const band = classifyRsBand(pos.entryRsScore);
    const arr = groups.get(band);
    if (arr != null) {
      arr.push(pos);
    }
  }

  return bands
    .map((band) => {
      const grp = groups.get(band) ?? [];
      if (grp.length === 0) return null;
      const pnls = grp.map((p) => p.pnlPercent).filter((p): p is number => p != null);
      const maxPnls = grp.map((p) => p.maxPnlPercent).filter((p): p is number => p != null);
      const winners = pnls.filter((p) => p > 0);
      return {
        band,
        count: grp.length,
        winnerCount: winners.length,
        winRate: pnls.length > 0 ? (winners.length / pnls.length) * 100 : 0,
        avgPnl: avg(pnls),
        avgMaxPnl: avg(maxPnls),
      };
    })
    .filter((s): s is RsBandStats => s != null);
}

/**
 * 보유 기간별 통계를 집계한다.
 */
export function buildHoldingDurationStats(
  positions: ExitedPosition[],
): HoldingDurationStats[] {
  const groups = new Map<HoldingDuration, ExitedPosition[]>();
  for (const t of HOLDING_DURATION_THRESHOLDS) {
    groups.set(t.duration, []);
  }

  for (const pos of positions) {
    const dur = classifyHoldingDuration(pos.holdingDays);
    groups.get(dur)?.push(pos);
  }

  return HOLDING_DURATION_THRESHOLDS.map((t) => {
    const grp = groups.get(t.duration) ?? [];
    const pnls = grp.map((p) => p.pnlPercent).filter((p): p is number => p != null);
    const winners = pnls.filter((p) => p > 0);
    return {
      duration: t.duration,
      count: grp.length,
      winnerCount: winners.length,
      winRate: pnls.length > 0 ? (winners.length / pnls.length) * 100 : 0,
      avgPnl: avg(pnls),
    };
  }).filter((s) => s.count > 0);
}

/**
 * exit_reason별 통계를 집계한다.
 */
export function buildExitReasonStats(
  positions: ExitedPosition[],
): ExitReasonStats[] {
  const groups = new Map<string, ExitedPosition[]>();

  for (const pos of positions) {
    const reason = normalizeExitReason(pos.exitReason);
    const arr = groups.get(reason) ?? [];
    arr.push(pos);
    groups.set(reason, arr);
  }

  return [...groups.entries()]
    .map(([reason, grp]) => {
      const pnls = grp.map((p) => p.pnlPercent).filter((p): p is number => p != null);
      const winners = pnls.filter((p) => p > 0);
      const holdingDays = grp.map((p) => p.holdingDays);
      return {
        reason,
        count: grp.length,
        winnerCount: winners.length,
        winRate: pnls.length > 0 ? (winners.length / pnls.length) * 100 : 0,
        avgPnl: avg(pnls),
        avgHoldingDays: avg(holdingDays),
      };
    })
    .sort((a, b) => b.count - a.count);
}

/**
 * 레짐 전환기(regimeTransitionStart~End) 진입 여부별 통계.
 */
export function buildRegimeTransitionStats(
  positions: ExitedPosition[],
  transitionStart: string,
  transitionEnd: string,
): RegimeTransitionStats {
  const within: ExitedPosition[] = [];
  const outside: ExitedPosition[] = [];

  for (const pos of positions) {
    if (isWithinDateRange(pos.entryDate, transitionStart, transitionEnd)) {
      within.push(pos);
    } else {
      outside.push(pos);
    }
  }

  const withinPnls = within.map((p) => p.pnlPercent).filter((p): p is number => p != null);
  const outsidePnls = outside.map((p) => p.pnlPercent).filter((p): p is number => p != null);

  return {
    withinTransition: within.length,
    outsideTransition: outside.length,
    withinTransitionWinRate: calculateWinRate(within.map((p) => p.pnlPercent)),
    outsideTransitionWinRate: calculateWinRate(outside.map((p) => p.pnlPercent)),
    withinTransitionAvgPnl: avg(withinPnls),
    outsideTransitionAvgPnl: avg(outsidePnls),
  };
}

/**
 * 승자/패자 프로파일 비교.
 */
export function buildWinnerLoserProfile(
  positions: ExitedPosition[],
): WinnerLoserProfile {
  const winners = positions.filter((p) => p.pnlPercent != null && p.pnlPercent > 0);
  const losers = positions.filter((p) => p.pnlPercent != null && p.pnlPercent <= 0);

  function profileGroup(group: ExitedPosition[]) {
    const pnls = group.map((p) => p.pnlPercent).filter((p): p is number => p != null);
    const maxPnls = group.map((p) => p.maxPnlPercent).filter((p): p is number => p != null);
    const rsScores = group
      .map((p) => p.entryRsScore)
      .filter((r): r is number => r != null);
    return {
      count: group.length,
      avgHoldingDays: avg(group.map((p) => p.holdingDays)),
      avgRsScore: rsScores.length > 0 ? avg(rsScores) : null,
      avgPnl: avg(pnls),
      avgMaxPnl: avg(maxPnls),
    };
  }

  return {
    winners: profileGroup(winners),
    losers: profileGroup(losers),
  };
}

/**
 * STABILITY_DAYS 시뮬레이션.
 *
 * 각 EXITED 종목의 entry_date 직전 N거래일이 모두 Phase 2였는지 확인한다.
 * phaseHistory: symbol → 날짜순 {date, phase} 배열.
 * currentStabilityDays: 현재 안정성 기준 (3).
 * simulatedDays: 시뮬레이션 안정성 기준 (5 등).
 *
 * 분류:
 * - "추가 차단" = 현재 기준 통과 + 시뮬레이션 기준 미통과
 * - "데이터 부족" = simulatedDays만큼의 Phase 히스토리가 없어 판정 불가
 * - "나머지" = 시뮬레이션 기준도 통과
 *
 * 데이터 부족 종목은 시뮬레이션 통계에서 ��외한다.
 */
export function simulateStabilityFilter(
  positions: ExitedPosition[],
  phaseHistory: Map<string, Array<{ date: string; phase: number }>>,
  currentStabilityDays: number,
  simulatedDays: number,
): StabilitySimulationResult {
  const additionallyBlocked: ExitedPosition[] = [];
  const remaining: ExitedPosition[] = [];
  let insufficientDataCount = 0;

  for (const pos of positions) {
    const phases = phaseHistory.get(pos.symbol) ?? [];
    const beforeEntry = phases
      .filter((p) => p.date < pos.entryDate)
      .sort((a, b) => b.date.localeCompare(a.date)); // 최신 순

    // 시뮬레이션에 필요한 Phase 히스토리 부족 — 판정 불가, 제외
    if (beforeEntry.length < simulatedDays) {
      insufficientDataCount++;
      continue;
    }

    const passesCurrentGate = checkStability(beforeEntry, currentStabilityDays);
    const passesSimulatedGate = checkStability(beforeEntry, simulatedDays);

    if (passesCurrentGate && !passesSimulatedGate) {
      additionallyBlocked.push(pos);
    } else {
      remaining.push(pos);
    }
  }

  const blockedPnls = additionallyBlocked
    .map((p) => p.pnlPercent)
    .filter((p): p is number => p != null);
  const remainingPnls = remaining
    .map((p) => p.pnlPercent)
    .filter((p): p is number => p != null);

  return {
    originalCount: positions.length,
    filteredCount: remaining.length,
    additionallyBlockedCount: additionallyBlocked.length,
    insufficientDataCount,
    blockedAvgPnl: blockedPnls.length > 0 ? avg(blockedPnls) : null,
    blockedWinRate: blockedPnls.length > 0 ? calculateWinRate(blockedPnls) : null,
    remainingWinRate: remainingPnls.length > 0 ? calculateWinRate(remainingPnls) : null,
    remainingAvgPnl: remainingPnls.length > 0 ? avg(remainingPnls) : null,
  };
}

function checkStability(
  beforeEntry: Array<{ date: string; phase: number }>,
  requiredDays: number,
): boolean {
  const recentDays = beforeEntry.slice(0, requiredDays);
  return recentDays.every((p) => p.phase === 2);
}

/**
 * 전체 분석 리포트를 생성한다.
 */
export function buildExitPatternReport(
  positions: ExitedPosition[],
  regimeTransitionStart: string,
  regimeTransitionEnd: string,
): ExitPatternReport {
  const pnls = positions.map((p) => p.pnlPercent).filter((p): p is number => p != null);
  const holdingDays = positions.map((p) => p.holdingDays);

  return {
    totalExited: positions.length,
    overallWinRate: calculateWinRate(positions.map((p) => p.pnlPercent)),
    overallAvgPnl: avg(pnls),
    overallAvgHoldingDays: avg(holdingDays),
    byRsBand: buildRsBandStats(positions),
    byHoldingDuration: buildHoldingDurationStats(positions),
    byExitReason: buildExitReasonStats(positions),
    regimeTransition: buildRegimeTransitionStats(
      positions,
      regimeTransitionStart,
      regimeTransitionEnd,
    ),
    winnerLoserProfile: buildWinnerLoserProfile(positions),
  };
}
