export async function fetchJson<T = unknown>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json() as Promise<T>;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function toNum(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function toStrNum(v: unknown): string | null {
  const n = Number(v);
  return Number.isFinite(n) ? String(n) : null;
}

export function chunk<T>(arr: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size));
  }
  return result;
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

  // Phase 2 continuation — inherit previous value
  return prevVolumeConfirmed ?? false;
}
