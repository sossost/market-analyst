/**
 * 추천 종목 게이트 로직 — saveRecommendations 도구와 ETL scan-recommendation-candidates 공용.
 *
 * 이 모듈은 순수 상수와 게이트 판정 함수만 포함한다.
 * DB 쿼리·레짐 조회·INSERT는 각 호출부(도구/ETL job)가 담당한다.
 */

import { MIN_PHASE, MIN_RS_SCORE, MAX_RS_SCORE, MIN_PRICE } from "./validation.js";

export { MIN_PHASE, MIN_RS_SCORE, MAX_RS_SCORE, MIN_PRICE };

/** EARLY_BEAR / BEAR 레짐에서 신규 추천을 전면 차단하는 레짐 집합 */
export const BEAR_REGIMES = new Set(["EARLY_BEAR", "BEAR"]);

/** 동일 symbol의 재추천을 막는 쿨다운 기간 (캘린더일) */
export const COOLDOWN_CALENDAR_DAYS = 7;

/** Phase 2 지속성 판단 기준 기간 (캘린더일) */
export const PHASE2_PERSISTENCE_DAYS = 5;

/**
 * Phase 2 지속성을 충족하는 최소 데이터 포인트 수.
 * 변경 이력:
 * - 2: Phase Exit 6건 발생, 승률 17% (#366)
 * - 3: 지속성 기준 강화로 불안정 Phase 2 진입 차단
 */
export const MIN_PHASE2_PERSISTENCE_COUNT = 3;

/**
 * Phase 2 안정성 판단: 최근 N 거래일 연속 Phase 2 필수.
 * 근거: 90일 추천 중 50%가 진입 1-2일 만에 Phase 3 전환 (#436).
 * 7/8 경계 종목이 하루 만에 조건 깨지는 패턴을 차단한다.
 */
export const PHASE2_STABILITY_DAYS = 3;

/**
 * 펀더멘탈 하드 게이트: SEPA F등급 종목 추천 차단.
 * 근거: 90일 추천 중 Phase Exit 6건(avg 2일), Stop Loss 3건(max PnL -0.28%) —
 * 기술적 Phase 2만으로는 생존율 14%. 최소한의 펀더멘탈 뒷받침 필수 (#449).
 * F = SEPA 기준 전부 미충족. C 이상(기준 1개라도 충족)이면 통과.
 * 등급 없음(데이터 미확보)은 fail-open으로 통과.
 */
export const BLOCKED_FUNDAMENTAL_GRADE = "F";

/** LLM 진입가와 DB 종가의 허용 괴리 비율 (10%) */
export const PRICE_DIVERGENCE_THRESHOLD = 0.1;

/**
 * 동일 섹터 추천 최대 비중 (50%).
 * 근거: #732 — Energy 88% 편중 발생. 단일 섹터가 추천의 절반을 넘지 않도록 제한.
 * 17건 기준 최대 9건까지 허용. 보수적 시작점으로 데이터 기반 조정 예정.
 */
export const MAX_SECTOR_RATIO = 0.5;

/**
 * date에서 days만큼 이전 날짜를 계산한다.
 * YYYY-MM-DD 형식으로 반환. 쿨다운·지속성 기간 계산 공용.
 */
export function getDateOffset(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

export interface PhaseGateResult {
  passed: boolean;
  reason: string;
}

/**
 * Phase 하드 게이트 — Phase 2 미만 종목 차단.
 */
export function evaluatePhaseGate(phase: number | null | undefined): PhaseGateResult {
  if (phase != null && phase < MIN_PHASE) {
    return { passed: false, reason: `Phase ${phase} < ${MIN_PHASE}` };
  }
  return { passed: true, reason: "" };
}

/**
 * RS 하한 하드 게이트 — RS < 60 종목 차단.
 */
export function evaluateLowRsGate(rsScore: number | null | undefined): PhaseGateResult {
  if (rsScore != null && rsScore < MIN_RS_SCORE) {
    return { passed: false, reason: `RS ${rsScore} < ${MIN_RS_SCORE}` };
  }
  return { passed: true, reason: "" };
}

/**
 * RS 과열 게이트 — RS > 95 종목은 Phase 2 "말기"로 판단하여 차단.
 */
export function evaluateOverheatedRsGate(rsScore: number | null | undefined): PhaseGateResult {
  if (rsScore != null && rsScore > MAX_RS_SCORE) {
    return { passed: false, reason: `RS ${rsScore} > ${MAX_RS_SCORE} 과열` };
  }
  return { passed: true, reason: "" };
}

/**
 * 저가주 하드 게이트 — $5 미만 penny stock 차단.
 */
export function evaluateLowPriceGate(price: number | null | undefined): PhaseGateResult {
  if (price != null && price < MIN_PRICE) {
    return { passed: false, reason: `진입가 $${price} < $${MIN_PRICE} 저가주` };
  }
  return { passed: true, reason: "" };
}

/**
 * Phase 2 지속성 하드 게이트 — 최소 3일 Phase 2 유지 필수.
 */
export function evaluatePersistenceGate(phase2Count: number): PhaseGateResult {
  if (phase2Count < MIN_PHASE2_PERSISTENCE_COUNT) {
    return {
      passed: false,
      reason: `Phase 2 지속성 ${phase2Count}일 < 기준 ${MIN_PHASE2_PERSISTENCE_COUNT}일`,
    };
  }
  return { passed: true, reason: "" };
}

/**
 * Phase 2 안정성 하드 게이트 — 최근 N 거래일 연속 Phase 2 필수.
 */
export function evaluateStabilityGate(isStable: boolean): PhaseGateResult {
  if (!isStable) {
    return {
      passed: false,
      reason: `최근 ${PHASE2_STABILITY_DAYS}거래일 연속 Phase 2 미충족`,
    };
  }
  return { passed: true, reason: "" };
}

/**
 * 펀더멘탈 하드 게이트 — SEPA F등급 종목 차단.
 * grade == null(데이터 없음)은 fail-open으로 통과.
 */
export function evaluateFundamentalGate(grade: string | null | undefined): PhaseGateResult {
  if (grade === BLOCKED_FUNDAMENTAL_GRADE) {
    return {
      passed: false,
      reason: `SEPA 등급 ${grade} — 펀더멘탈 기준 전부 미충족`,
    };
  }
  return { passed: true, reason: "" };
}

export interface SectorCapResult<T> {
  selected: T[];
  capped: T[];
}

/**
 * 게이트 통과 후보에 섹터별 상한을 적용한다.
 *
 * 입력 배열이 RS 내림차순으로 정렬되어 있다고 가정한다.
 * 섹터당 최대 허용 수 = max(1, ceil(totalCount * maxRatio)).
 * sector가 null/undefined인 종목은 "Unknown" 그룹으로 처리한다.
 *
 * @param candidates - RS 내림차순 정렬된 게이트 통과 후보
 * @param maxRatio   - 섹터당 최대 비중 (0 < maxRatio < 1)
 * @returns selected(상한 이내) + capped(상한 초과로 제외) 분리 결과
 */
export function applySectorCap<T extends { sector: string | null | undefined }>(
  candidates: T[],
  maxRatio: number,
): SectorCapResult<T> {
  if (candidates.length === 0) {
    return { selected: [], capped: [] };
  }

  if (maxRatio <= 0 || maxRatio >= 1) {
    return { selected: [...candidates], capped: [] };
  }

  const maxPerSector = Math.max(1, Math.ceil(candidates.length * maxRatio));
  const sectorCounts = new Map<string, number>();
  const selected: T[] = [];
  const capped: T[] = [];

  for (const candidate of candidates) {
    const sector = candidate.sector ?? "Unknown";
    const count = sectorCounts.get(sector) ?? 0;

    if (count >= maxPerSector) {
      capped.push(candidate);
      continue;
    }

    selected.push(candidate);
    sectorCounts.set(sector, count + 1);
  }

  return { selected, capped };
}
