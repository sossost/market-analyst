/**
 * Generic utils (sleep, toNum, chunk) are now in "@/lib/utils".
 * This file re-exports them for backward compatibility and retains
 * ETL-specific utilities that are not candidates for promotion.
 */
export { sleep, toNum, chunk, toDivergenceSignal } from "@/lib/utils";
export type { DivergenceSignal } from "@/lib/utils";

/**
 * FMP v3 API 설정 로드.
 * DATA_API, FMP_API_KEY 환경변수가 없으면 즉시 throw.
 */
export function getFmpV3Config(): { baseUrl: string; key: string } {
  const dataApi = process.env.DATA_API;
  const fmpKey = process.env.FMP_API_KEY;
  if (dataApi == null || dataApi === "") {
    throw new Error("Missing required environment variable: DATA_API");
  }
  if (fmpKey == null || fmpKey === "") {
    throw new Error("Missing required environment variable: FMP_API_KEY");
  }
  return { baseUrl: dataApi, key: fmpKey };
}

function sanitizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.searchParams.delete("apikey");
    return u.toString();
  } catch {
    return url.replace(/apikey=[^&]+/gi, "apikey=***");
  }
}

export async function fetchJson<T = unknown>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${sanitizeUrl(url)}`);
  return res.json() as Promise<T>;
}

export function toStrNum(v: unknown): string | null {
  const n = Number(v);
  return Number.isFinite(n) ? String(n) : null;
}

/**
 * Check if a ticker symbol meets the standard format rules:
 * - 1-5 uppercase letters
 * - No warrants (W/WS suffix, 4+ chars), units (U suffix, 4+ chars), special classes (X suffix)
 * - No dots (foreign listings like BRK.B)
 * - Short tickers like MU, W, AW are allowed (length < 4)
 */
export function isValidTicker(symbol: string): boolean {
  return (
    /^[A-Z]{1,5}$/.test(symbol) &&
    !(symbol.length >= 4 && symbol.endsWith("W")) &&
    !symbol.endsWith("X") &&
    !symbol.includes(".") &&
    !(symbol.length >= 4 && symbol.endsWith("U")) &&
    !symbol.endsWith("WS")
  );
}

const VOLUME_BREAKOUT_THRESHOLD = 2.0;

/** 주간 거래량 돌파 임계값 — 최근 1주 거래량 합이 이전 4주 주간 평균의 1.5배 이상 */
const WEEKLY_VOLUME_BREAKOUT_THRESHOLD = 1.5;

/** 주간 거래량 비교에 사용할 기간 (거래일 기준) */
const WEEKLY_TRADING_DAYS = 5;
const WEEKLY_LOOKBACK_WEEKS = 4;
const WEEKLY_LOOKBACK_DAYS = WEEKLY_TRADING_DAYS * WEEKLY_LOOKBACK_WEEKS; // 20일

/**
 * Determine the sticky volume_confirmed flag for Phase 2 stocks.
 *
 * - Phase != 2 → null (not applicable)
 * - New Phase 2 entry (prev != 2) → true if vol_ratio >= 2.0
 * - Phase 2 continuation (prev == 2) → inherit previous value
 */
export function resolveVolumeConfirmed(
  phase: number,
  prevPhase: number | null,
  volRatio: number | null,
  prevVolumeConfirmed: boolean | null,
): boolean | null {
  if (phase !== 2) return null;

  // New Phase 2 entry
  if (prevPhase !== 2) {
    return volRatio != null && volRatio >= VOLUME_BREAKOUT_THRESHOLD;
  }

  // Phase 2 continuation — keep if already confirmed, upgrade if volume spikes
  if (prevVolumeConfirmed === true) return true;
  return volRatio != null && volRatio >= VOLUME_BREAKOUT_THRESHOLD;
}

export type BreakoutSignal = "confirmed" | "unconfirmed" | null;

/**
 * Calculate weekly volume ratio: recent 1-week total vs prior N-week weekly average.
 *
 * @param volumes - Daily volumes sorted most recent first (index 0 = today)
 * @returns ratio or null if insufficient data
 */
export function calculateWeeklyVolRatio(volumes: number[]): number | null {
  const totalNeeded = WEEKLY_TRADING_DAYS + WEEKLY_LOOKBACK_DAYS;
  if (volumes.length < totalNeeded) return null;

  const recentWeekTotal = volumes
    .slice(0, WEEKLY_TRADING_DAYS)
    .reduce((sum, v) => sum + v, 0);

  const priorTotal = volumes
    .slice(WEEKLY_TRADING_DAYS, totalNeeded)
    .reduce((sum, v) => sum + v, 0);

  // 이전 4주 주간 평균 = 이전 20일 합 / 4주
  const priorWeeklyAvg = priorTotal / WEEKLY_LOOKBACK_WEEKS;

  if (priorWeeklyAvg === 0) return null;
  return recentWeekTotal / priorWeeklyAvg;
}

/**
 * Determine breakout signal for Phase 2 transition stocks.
 *
 * - Phase != 2 → null
 * - Phase 2 continuation (prev == 2) → null (전환 시점에만 판정)
 * - New Phase 2 entry (prev != 2):
 *   - weeklyVolRatio >= 1.5 OR dailyVolRatio >= 2.0 → "confirmed"
 *   - both ratios null (insufficient data) → null
 *   - otherwise → "unconfirmed"
 */
export function resolveBreakoutSignal(
  phase: number,
  prevPhase: number | null,
  dailyVolRatio: number | null,
  weeklyVolRatio: number | null,
): BreakoutSignal {
  if (phase !== 2) return null;

  // Phase 2 continuation — breakout signal only applies at transition
  if (prevPhase === 2) return null;

  // New Phase 2 entry — check weekly first, daily as fallback
  const weeklyConfirmed =
    weeklyVolRatio != null && weeklyVolRatio >= WEEKLY_VOLUME_BREAKOUT_THRESHOLD;
  const dailyConfirmed =
    dailyVolRatio != null && dailyVolRatio >= VOLUME_BREAKOUT_THRESHOLD;

  if (weeklyConfirmed || dailyConfirmed) return "confirmed";
  if (weeklyVolRatio === null && dailyVolRatio === null) return null;

  return "unconfirmed";
}
