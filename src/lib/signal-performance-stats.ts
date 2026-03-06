/**
 * 시그널 성과 집계.
 * 순수 로직 — DB 의존 없이 테스트 가능.
 */

// ── Types ──

export interface SignalLogRow {
  status: string; // 'ACTIVE' | 'CLOSED'
  return5d: string | null;
  return10d: string | null;
  return20d: string | null;
  return60d: string | null;
  maxReturn: string | null;
  phaseExitReturn: string | null;
  phaseExitDate: string | null;
}

export interface SignalStats {
  total: number;
  active: number;
  closed: number;
  avgReturn20d: number | null;
  winRate20d: number | null; // return_20d > 0인 비율
  avgMaxReturn: number | null;
  phaseExitWinRate: number | null;
}

// ── Pure Functions ──

function toNumber(value: string | null): number | null {
  if (value == null) return null;
  const num = Number(value);
  return Number.isNaN(num) ? null : num;
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * signal_log 데이터를 받아서 통계 생성.
 */
export function calculateSignalStats(signals: SignalLogRow[]): SignalStats {
  if (signals.length === 0) {
    return {
      total: 0,
      active: 0,
      closed: 0,
      avgReturn20d: null,
      winRate20d: null,
      avgMaxReturn: null,
      phaseExitWinRate: null,
    };
  }

  const active = signals.filter((s) => s.status === "ACTIVE").length;
  const closed = signals.filter((s) => s.status === "CLOSED").length;

  // 20일 수익률 통계
  const return20dValues = signals
    .map((s) => toNumber(s.return20d))
    .filter((v): v is number => v != null);

  const avgReturn20d = average(return20dValues);
  const winRate20d =
    return20dValues.length > 0
      ? return20dValues.filter((v) => v > 0).length / return20dValues.length
      : null;

  // 최대 수익 평균
  const maxReturnValues = signals
    .map((s) => toNumber(s.maxReturn))
    .filter((v): v is number => v != null);

  const avgMaxReturn = average(maxReturnValues);

  // Phase 종료 승률
  const phaseExitReturns = signals
    .filter((s) => s.phaseExitDate != null)
    .map((s) => toNumber(s.phaseExitReturn))
    .filter((v): v is number => v != null);

  const phaseExitWinRate =
    phaseExitReturns.length > 0
      ? phaseExitReturns.filter((v) => v > 0).length / phaseExitReturns.length
      : null;

  return {
    total: signals.length,
    active,
    closed,
    avgReturn20d,
    winRate20d,
    avgMaxReturn,
    phaseExitWinRate,
  };
}

/**
 * 요약 텍스트 (2-3줄).
 */
export function summarizeSignalStats(stats: SignalStats): string {
  if (stats.total === 0) return "기록된 시그널 없음";

  const lines: string[] = [];

  lines.push(`총 ${stats.total}건 (활성: ${stats.active}, 종료: ${stats.closed})`);

  const parts: string[] = [];
  if (stats.winRate20d != null) {
    parts.push(`20일 승률 ${(stats.winRate20d * 100).toFixed(0)}%`);
  }
  if (stats.avgReturn20d != null) {
    const sign = stats.avgReturn20d >= 0 ? "+" : "";
    parts.push(`평균 수익률 ${sign}${stats.avgReturn20d.toFixed(1)}%`);
  }
  if (parts.length > 0) {
    lines.push(parts.join(", "));
  }

  if (stats.phaseExitWinRate != null) {
    lines.push(
      `Phase 종료 승률 ${(stats.phaseExitWinRate * 100).toFixed(0)}%`,
    );
  }

  return lines.join("\n");
}
