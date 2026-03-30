/**
 * Late Bull Gate — LATE_BULL 레짐 진입 감쇠 게이트.
 *
 * LATE_BULL 레짐은 시장 과열 후기로, Phase 2→3 전환이 임박한 시점.
 * 이 시기 진입은 구조적으로 불리하므로 진입 조건을 강화한다.
 *
 * 근거: 90일 추천 14건 중 11건이 LATE_BULL 기간(3/4~3/12) 진입 → 전수 실패 (#508).
 *
 * 통과 조건 (모두 충족해야 통과):
 * 1. RS ≥ 70 — 기본 하한 60보다 강화, "확실한 강세"만 허용
 * 2. SEPA A등급 이상 (S 또는 A) — Bear 예외(S만)보다 1단계 완화
 * 3. Phase 2 지속성 5일 이상 — "방금 Phase 2 진입"이 아닌 "안정적 Phase 2" 확인
 */

import { retryDatabaseOperation } from "@/etl/utils/retry";
import { logger } from "@/lib/logger";
import { findLatestFundamentalGrade } from "@/db/repositories/fundamentalRepository.js";
import { findPhase2PersistenceBySymbol } from "@/db/repositories/stockPhaseRepository.js";

/** Late Bull 감쇠 통과에 필요한 최소 RS 점수 */
export const LATE_BULL_MIN_RS = 70;

/** Late Bull 감쇠 허용 SEPA 최소 등급 (S 또는 A) */
export const LATE_BULL_ALLOWED_GRADES = new Set(["S", "A"]);

/** Late Bull 감쇠 통과에 필요한 Phase 2 지속 최소 일수 */
export const LATE_BULL_PHASE2_PERSISTENCE_DAYS = 5;

/** [Late Bull 감쇠] 태그 — reason 접두사 */
export const LATE_BULL_TAG = "[Late Bull 감쇠]";

export interface LateBullGateInput {
  symbol: string;
  rsScore: number;
  date: string;
}

export interface LateBullGateResult {
  passed: boolean;
  reason: string;
  details: {
    rsScore: number;
    fundamentalGrade: string | null;
    phase2Count: number;
  };
}

/**
 * 개별 종목이 Late Bull 감쇠 조건을 충족하는지 검사한다.
 *
 * 3가지 조건 모두 충족 시 passed: true.
 * DB 조회 실패 시 fail-closed (진입 불허) — LATE_BULL에서는 보수적으로.
 */
export async function evaluateLateBullGate(
  input: LateBullGateInput,
): Promise<LateBullGateResult> {
  const { symbol, rsScore, date } = input;

  const persistenceStart = getDateOffset(date, LATE_BULL_PHASE2_PERSISTENCE_DAYS);

  // 2개 조건 병렬 조회 (RS는 입력값 사용)
  const [gradeResult, persistenceResult] = await Promise.all([
    queryFundamentalGrade(symbol, date),
    queryPhase2Persistence(symbol, persistenceStart, date),
  ]);

  const fundamentalGrade = gradeResult;
  const phase2Count = persistenceResult;

  // 3가지 조건 판정
  const isRsStrong = rsScore >= LATE_BULL_MIN_RS;
  const isGradeAllowed =
    fundamentalGrade != null && LATE_BULL_ALLOWED_GRADES.has(fundamentalGrade);
  const isPhase2Persistent = phase2Count >= LATE_BULL_PHASE2_PERSISTENCE_DAYS;

  const passed = isRsStrong && isGradeAllowed && isPhase2Persistent;

  // 실패 사유 구성
  const failReasons: string[] = [];
  if (!isRsStrong) {
    failReasons.push(`RS ${rsScore} (기준: ≥${LATE_BULL_MIN_RS})`);
  }
  if (!isGradeAllowed) {
    failReasons.push(
      `SEPA ${fundamentalGrade ?? "N/A"} (기준: S 또는 A)`,
    );
  }
  if (!isPhase2Persistent) {
    failReasons.push(
      `Phase2 지속 ${phase2Count}일 (기준: ≥${LATE_BULL_PHASE2_PERSISTENCE_DAYS}일)`,
    );
  }

  const reason = passed
    ? `Late Bull 감쇠 통과: RS ${rsScore}, SEPA ${fundamentalGrade}, Phase2 ${phase2Count}일`
    : `Late Bull 감쇠 미충족: ${failReasons.join(", ")}`;

  if (passed) {
    logger.info("LateBullGate", `${symbol}: ${reason}`);
  }

  return {
    passed,
    reason,
    details: {
      rsScore,
      fundamentalGrade,
      phase2Count,
    },
  };
}

/**
 * Late Bull 감쇠 통과 종목의 reason에 [Late Bull 감쇠] 접두사를 추가한다.
 */
export function tagLateBullReason(
  reason: string | null | undefined,
): string {
  const base = reason ?? "";

  if (base.startsWith(LATE_BULL_TAG)) {
    return base;
  }

  return `${LATE_BULL_TAG} ${base}`.trim();
}

// ─── Internal Helpers ────────────────────────────────────────────────

async function queryFundamentalGrade(
  symbol: string,
  date: string,
): Promise<string | null> {
  try {
    const row = await retryDatabaseOperation(() =>
      findLatestFundamentalGrade(symbol, date),
    );

    return row?.grade ?? null;
  } catch (err) {
    logger.error(
      "LateBullGate",
      `펀더멘탈 등급 조회 실패 (${symbol}): ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}

async function queryPhase2Persistence(
  symbol: string,
  startDate: string,
  endDate: string,
): Promise<number> {
  try {
    const row = await retryDatabaseOperation(() =>
      findPhase2PersistenceBySymbol(symbol, startDate, endDate),
    );

    return Number(row.phase2_count);
  } catch (err) {
    logger.error(
      "LateBullGate",
      `Phase2 지속성 조회 실패 (${symbol}): ${err instanceof Error ? err.message : String(err)}`,
    );
    return 0;
  }
}

function getDateOffset(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}
