/**
 * Generic utils (sleep, toNum, chunk) are now in "@/lib/utils".
 * This file re-exports them for backward compatibility and retains
 * ETL-specific utilities that are not candidates for promotion.
 */
export { sleep, toNum, chunk } from "@/lib/utils";

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
 * - No warrants (W suffix), units (U suffix), special classes (X suffix)
 * - No dots (foreign listings like BRK.B)
 */
export function isValidTicker(symbol: string): boolean {
  return (
    /^[A-Z]{1,5}$/.test(symbol) &&
    !symbol.endsWith("W") &&
    !symbol.endsWith("X") &&
    !symbol.includes(".") &&
    !symbol.endsWith("U") &&
    !symbol.endsWith("WS")
  );
}

const VOLUME_BREAKOUT_THRESHOLD = 2.0;

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
