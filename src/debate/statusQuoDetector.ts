/**
 * Status quo thesis detector (#733).
 *
 * 생성 시점에 targetCondition이 이미 충족된 thesis를 감지한다.
 * "Energy RS > 65" thesis인데 현재 RS가 70이면 → 현상유지 예측 (status_quo).
 *
 * 순수 함수 — DB/네트워크 의존 없음.
 */

import type { MarketSnapshot } from "./marketDataLoader.js";
import {
  parseQuantitativeCondition,
  evaluateQuantitativeCondition,
} from "./quantitativeVerifier.js";

/**
 * targetCondition이 현재 스냅샷에서 이미 충족되는지 판별한다.
 *
 * - 조건이 이미 충족 → true (status_quo: 현상유지 예측)
 * - 조건이 미충족 → false (변화를 예측하는 thesis)
 * - 파싱 불가 / 메트릭 미발견 → false (보수적: 알 수 없으면 non-status_quo 간주)
 */
export function detectStatusQuo(
  targetCondition: string,
  snapshot: MarketSnapshot,
): boolean {
  const parsed = parseQuantitativeCondition(targetCondition);
  if (parsed == null) {
    return false;
  }

  const result = evaluateQuantitativeCondition(parsed, snapshot);
  if (result == null) {
    return false;
  }

  return result.result;
}
