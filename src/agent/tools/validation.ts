/**
 * Input validation helpers for Agent tools.
 * All tool inputs come from LLM responses (untrusted).
 */
import { logger } from "@/agent/logger";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
// Dot separator for share class tickers: BRK.B, BF.B (NYSE convention)
const SYMBOL_PATTERN = /^[A-Z]{1,5}(\.[A-Z]{1,2})?$/;

export function validateDate(value: unknown): string | null {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) {
    return null;
  }
  const ts = Date.parse(value);
  if (!Number.isFinite(ts)) {
    return null;
  }
  return value;
}

export function validateSymbol(value: unknown): string | null {
  if (typeof value !== "string" || !SYMBOL_PATTERN.test(value)) {
    return null;
  }
  return value;
}

export function validateString(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }
  return value;
}

export function validateNumber(
  value: unknown,
  fallback: number,
  min = 1,
): number {
  if (typeof value === "number" && Number.isFinite(value) && value >= min) {
    return value;
  }
  return fallback;
}

const MAX_PERCENT = 100;

/** 추천 기준 미달 상수 — reportValidator.ts와 공유 */
export const MIN_PHASE = 2;
export const MIN_RS_SCORE = 60;

/**
 * 퍼센트 값이 0~100 범위를 벗어나면 경고 후 클램핑한다.
 * DB에서 0~1 비율을 *100 변환한 뒤 호출하여 이중 변환 방어.
 */
export function clampPercent(value: number, label: string): number {
  if (value > MAX_PERCENT) {
    logger.warn(
      "clampPercent",
      `${label} = ${value} exceeds ${MAX_PERCENT}%. Clamping to ${MAX_PERCENT}. Possible double conversion.`,
    );
    return MAX_PERCENT;
  }
  if (value < 0) {
    logger.warn(
      "clampPercent",
      `${label} = ${value} is negative. Clamping to 0.`,
    );
    return 0;
  }
  return value;
}
