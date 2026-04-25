/**
 * Input validation helpers for Agent tools.
 * All tool inputs come from LLM responses (untrusted).
 */
import { logger } from "@/lib/logger";

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
 * Featured tier 최소 RS — 이 값 미만이면 featured 요청이 와도 standard로 다운그레이드.
 * 근거: #989 데이터에서 RS 60-69 구간 ACTIVE avg +0.79% vs RS 70+ avg +2.32%,
 * EXITED 비율 68%. 광망(RS>=60) 원칙은 유지하되 featured 품질만 제한.
 */
export const FEATURED_MIN_RS_SCORE = 70;

/**
 * 최소 진입가 — 이 가격 미만은 penny stock으로 분류, 추천 차단.
 * 근거: EONR($1.53), DWSN($4.42) 등 $5 미만 소형주는 일일 변동성이 과도하여
 * Phase 2 판정 신뢰 불가. 90일간 추천 중 저가주 전량 Phase Exit (#376).
 */
export const MIN_PRICE = 5;

/**
 * RS 과열 상한 — 이 값을 초과하면 Phase 2 "말기"로 판단하여 추천 차단.
 * 근거: 최근 90일 추천 14건 중 12건이 RS 97~100에서 진입하여 즉시 Phase 3 이탈.
 * RS 95+ 종목은 이미 모멘텀 고점에 도달한 상태로, "초입" 포착 목표와 불일치.
 */
export const MAX_RS_SCORE = 95;

/**
 * 퍼센트 값이 0~100 범위를 벗어나면 처리한다.
 * - 100 초과: 이중 변환 버그 가능성 → error 로그 후 null 반환.
 *   null을 반환하면 comparePhase2Ratio에서 mismatch가 강제 발생하여
 *   QA 경고가 Discord에 삽입된다.
 * - 음수: 비정상 값 → warn 로그 후 0으로 클램핑.
 */
export function clampPercent(value: number, label: string): number | null {
  if (value > MAX_PERCENT) {
    logger.error(
      "clampPercent",
      `${label} = ${value} exceeds ${MAX_PERCENT}%. Possible double conversion (e.g. ×100 applied twice). Returning null to force QA mismatch.`,
    );
    return null;
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
