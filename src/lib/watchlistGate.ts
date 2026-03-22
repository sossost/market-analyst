/**
 * Watchlist Gate — 5중 교집합 게이트.
 *
 * 관심종목 등록 전 5가지 조건을 모두 통과해야 한다:
 * 1. Phase 2 확인
 * 2. 섹터 RS 상위 (SECTOR_RS_TOP_PERCENTILE 이상)
 * 3. 개별 RS 상위 (MIN_RS_SCORE 이상)
 * 4. 서사적 근거 — thesis_id가 존재하는지 (구조적 전환 포착 여부)
 * 5. SEPA 펀더멘탈 S 또는 A 등급
 *
 * 각 조건 미달 시 실패 사유를 명시적으로 반환한다.
 */

// ─── Constants ────────────────────────────────────────────────────────────────

/** 허용 Phase 최솟값 — Phase 2 이상이어야 등록 허용 */
const REQUIRED_PHASE = 2;

/** 개별 RS 최솟값 — 이 값 이상이어야 등록 허용 */
const MIN_INDIVIDUAL_RS = 60;

/** 섹터 RS 최솟값 — 이 값 이상이어야 섹터 RS 상위로 판정 */
const MIN_SECTOR_RS = 50;

/** 펀더멘탈 등급 허용 집합 — S 또는 A만 통과 */
const ALLOWED_SEPA_GRADES = new Set<string>(["S", "A"]);

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WatchlistGateInput {
  /** 종목 심볼 */
  symbol: string;
  /** 현재 Phase */
  phase: number;
  /** 개별 RS 점수 (0~100) */
  rsScore: number | null;
  /** 섹터 RS 평균 (avg_rs) */
  sectorRs: number | null;
  /** SEPA 펀더멘탈 등급 ('S' | 'A' | 'B' | 'C' | 'F' | null) */
  sepaGrade: string | null;
  /** 연결된 thesis ID (구조적 서사 근거. null이면 서사 근거 없음) */
  thesisId: number | null;
}

export type GateCondition =
  | "phase"
  | "sectorRs"
  | "individualRs"
  | "narrativeBasis"
  | "sepaGrade";

export interface GateFailure {
  condition: GateCondition;
  reason: string;
}

export interface WatchlistGateResult {
  passed: boolean;
  failures: GateFailure[];
}

// ─── Pure Evaluation Logic (testable without DB) ──────────────────────────────

/**
 * Phase 조건 평가.
 * Phase 2 이상이어야 통과.
 */
export function evaluatePhaseCondition(
  phase: number,
): GateFailure | null {
  if (phase < REQUIRED_PHASE) {
    return {
      condition: "phase",
      reason: `Phase ${phase} < ${REQUIRED_PHASE} — Phase 2 이상이어야 등록 가능`,
    };
  }
  return null;
}

/**
 * 섹터 RS 조건 평가.
 * sectorRs가 null이거나 MIN_SECTOR_RS 미만이면 실패.
 */
export function evaluateSectorRsCondition(
  sectorRs: number | null,
): GateFailure | null {
  if (sectorRs == null) {
    return {
      condition: "sectorRs",
      reason: "섹터 RS 데이터 없음 — 섹터 상위 여부 판단 불가",
    };
  }

  if (sectorRs < MIN_SECTOR_RS) {
    return {
      condition: "sectorRs",
      reason: `섹터 RS ${sectorRs.toFixed(1)} < ${MIN_SECTOR_RS} — 섹터 모멘텀 미흡`,
    };
  }

  return null;
}

/**
 * 개별 RS 조건 평가.
 * rsScore가 null이거나 MIN_INDIVIDUAL_RS 미만이면 실패.
 */
export function evaluateIndividualRsCondition(
  rsScore: number | null,
): GateFailure | null {
  if (rsScore == null) {
    return {
      condition: "individualRs",
      reason: "개별 RS 데이터 없음 — RS 상위 여부 판단 불가",
    };
  }

  if (rsScore < MIN_INDIVIDUAL_RS) {
    return {
      condition: "individualRs",
      reason: `개별 RS ${rsScore} < ${MIN_INDIVIDUAL_RS} — RS 상위권 미진입`,
    };
  }

  return null;
}

/**
 * 서사적 근거 조건 평가.
 * thesis_id가 존재하지 않으면 실패.
 * 구조적 서사(thesis)와 연결되지 않은 종목은 단순 모멘텀 플레이로 간주.
 */
export function evaluateNarrativeBasisCondition(
  thesisId: number | null,
): GateFailure | null {
  if (thesisId == null) {
    return {
      condition: "narrativeBasis",
      reason: "연결된 thesis 없음 — 구조적 서사 근거 없이 등록 불가",
    };
  }

  return null;
}

/**
 * SEPA 펀더멘탈 등급 조건 평가.
 * S 또는 A 등급이어야 통과.
 */
export function evaluateSepaGradeCondition(
  sepaGrade: string | null,
): GateFailure | null {
  if (sepaGrade == null) {
    return {
      condition: "sepaGrade",
      reason: "SEPA 등급 데이터 없음 — 펀더멘탈 평가 불가",
    };
  }

  if (!ALLOWED_SEPA_GRADES.has(sepaGrade)) {
    return {
      condition: "sepaGrade",
      reason: `SEPA 등급 ${sepaGrade} — S/A 등급이어야 등록 가능 (현재: ${sepaGrade})`,
    };
  }

  return null;
}

/**
 * 5중 교집합 게이트 평가.
 * 5가지 조건을 모두 평가하여 통과/실패 여부와 실패 사유 목록을 반환한다.
 * 순수 함수 — DB 접근 없음.
 */
export function evaluateWatchlistGate(
  input: WatchlistGateInput,
): WatchlistGateResult {
  const failures: GateFailure[] = [];

  const phaseFailure = evaluatePhaseCondition(input.phase);
  if (phaseFailure != null) {
    failures.push(phaseFailure);
  }

  const sectorRsFailure = evaluateSectorRsCondition(input.sectorRs);
  if (sectorRsFailure != null) {
    failures.push(sectorRsFailure);
  }

  const individualRsFailure = evaluateIndividualRsCondition(input.rsScore);
  if (individualRsFailure != null) {
    failures.push(individualRsFailure);
  }

  const narrativeFailure = evaluateNarrativeBasisCondition(input.thesisId);
  if (narrativeFailure != null) {
    failures.push(narrativeFailure);
  }

  const sepaFailure = evaluateSepaGradeCondition(input.sepaGrade);
  if (sepaFailure != null) {
    failures.push(sepaFailure);
  }

  return {
    passed: failures.length === 0,
    failures,
  };
}

// ─── Exports ──────────────────────────────────────────────────────────────────

export { REQUIRED_PHASE, MIN_INDIVIDUAL_RS, MIN_SECTOR_RS, ALLOWED_SEPA_GRADES };
