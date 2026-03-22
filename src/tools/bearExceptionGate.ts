/**
 * Bear Exception Gate — 하락 레짐 내 섹터 역행 알파 종목 예외 진입.
 *
 * EARLY_BEAR / BEAR 레짐에서도 구조적으로 강한 종목에 대해
 * 조건부 예외 진입을 허용하는 게이트.
 *
 * 예외 조건 (모두 충족해야 통과):
 * 1. 섹터 RS 상위 5% — 시장 대비 상대강도 최상위
 * 2. 펀더멘탈 SEPA S등급 — 실적 최강 종목
 * 3. Phase 2 지속성 5일 이상 — 일반 기준(2일)보다 엄격
 */

import { retryDatabaseOperation } from "@/etl/utils/retry";
import { logger } from "@/lib/logger";
import { findSectorRsRankWithTotal } from "@/db/repositories/sectorRepository.js";
import { findLatestFundamentalGrade } from "@/db/repositories/fundamentalRepository.js";
import { findPhase2PersistenceBySymbol } from "@/db/repositories/stockPhaseRepository.js";

/** Bear 예외 통과에 필요한 Phase 2 지속 최소 일수 (일반 기준 2일보다 엄격) */
export const BEAR_EXCEPTION_PHASE2_PERSISTENCE_DAYS = 5;

/** 섹터 RS 상위 N% 이내만 예외 허용 */
export const BEAR_EXCEPTION_SECTOR_RS_PERCENTILE = 5;

/** Bear 예외 허용 SEPA 최소 등급 */
export const BEAR_EXCEPTION_MIN_GRADE = "S";

/** [Bear 예외] 태그 — reason 접두사 */
export const BEAR_EXCEPTION_TAG = "[Bear 예외]";

export interface BearExceptionInput {
  symbol: string;
  sector: string;
  date: string;
}

export interface BearExceptionResult {
  passed: boolean;
  reason: string;
  details: {
    sectorRsRank: number | null;
    totalSectors: number | null;
    sectorRsPercentile: number | null;
    fundamentalGrade: string | null;
    phase2Count: number;
  };
}

/**
 * 개별 종목이 Bear 예외 조건을 충족하는지 검사한다.
 *
 * 3가지 조건 모두 충족 시 passed: true.
 * DB 조회 실패 시 fail-closed (예외 불허) — Bear 레짐에서는 보수적으로.
 */
export async function evaluateBearException(
  input: BearExceptionInput,
): Promise<BearExceptionResult> {
  const { symbol, sector, date } = input;

  const persistenceStart = getDateOffset(date, BEAR_EXCEPTION_PHASE2_PERSISTENCE_DAYS);

  // 3개 조건 병렬 조회
  const [sectorResult, gradeResult, persistenceResult] = await Promise.all([
    querySectorRsRank(sector, date),
    queryFundamentalGrade(symbol, date),
    queryPhase2Persistence(symbol, persistenceStart, date),
  ]);

  const { rank: sectorRsRank, totalSectors } = sectorResult;
  const fundamentalGrade = gradeResult;
  const phase2Count = persistenceResult;

  // 섹터 RS 퍼센타일 계산 (rank 1 = 최상위, 낮을수록 좋음)
  const sectorRsPercentile =
    sectorRsRank != null && totalSectors != null && totalSectors > 0
      ? Math.round((sectorRsRank / totalSectors) * 100)
      : null;

  // 3가지 조건 판정
  const isSectorRsTop =
    sectorRsPercentile != null &&
    sectorRsPercentile <= BEAR_EXCEPTION_SECTOR_RS_PERCENTILE;

  const isFundamentalS = fundamentalGrade === BEAR_EXCEPTION_MIN_GRADE;

  const isPhase2Persistent =
    phase2Count >= BEAR_EXCEPTION_PHASE2_PERSISTENCE_DAYS;

  const passed = isSectorRsTop && isFundamentalS && isPhase2Persistent;

  // 실패 사유 구성
  const failReasons: string[] = [];
  if (!isSectorRsTop) {
    failReasons.push(
      `섹터RS ${sectorRsPercentile ?? "N/A"}% (기준: ≤${BEAR_EXCEPTION_SECTOR_RS_PERCENTILE}%)`,
    );
  }
  if (!isFundamentalS) {
    failReasons.push(
      `SEPA ${fundamentalGrade ?? "N/A"} (기준: ${BEAR_EXCEPTION_MIN_GRADE})`,
    );
  }
  if (!isPhase2Persistent) {
    failReasons.push(
      `Phase2 지속 ${phase2Count}일 (기준: ≥${BEAR_EXCEPTION_PHASE2_PERSISTENCE_DAYS}일)`,
    );
  }

  const reason = passed
    ? `Bear 예외 통과: 섹터RS 상위${sectorRsPercentile}%, SEPA ${fundamentalGrade}, Phase2 ${phase2Count}일`
    : `Bear 예외 미충족: ${failReasons.join(", ")}`;

  if (passed) {
    logger.info(
      "BearExceptionGate",
      `${symbol}: ${reason}`,
    );
  }

  return {
    passed,
    reason,
    details: {
      sectorRsRank,
      totalSectors,
      sectorRsPercentile,
      fundamentalGrade,
      phase2Count,
    },
  };
}

/**
 * Bear 예외 통과 종목의 reason에 [Bear 예외] 접두사를 추가한다.
 */
export function tagBearExceptionReason(
  reason: string | null | undefined,
): string {
  const base = reason ?? "";

  if (base.startsWith(BEAR_EXCEPTION_TAG)) {
    return base;
  }

  return `${BEAR_EXCEPTION_TAG} ${base}`.trim();
}

// ─── Internal Helpers ────────────────────────────────────────────────

async function querySectorRsRank(
  sector: string,
  date: string,
): Promise<{ rank: number | null; totalSectors: number | null }> {
  try {
    const row = await retryDatabaseOperation(() =>
      findSectorRsRankWithTotal(sector, date),
    );

    if (row == null) {
      return { rank: null, totalSectors: null };
    }

    return {
      rank: Number(row.rs_rank),
      totalSectors: Number(row.total_sectors),
    };
  } catch (err) {
    logger.error(
      "BearExceptionGate",
      `섹터 RS 조회 실패 (${sector}): ${err instanceof Error ? err.message : String(err)}`,
    );
    return { rank: null, totalSectors: null };
  }
}

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
      "BearExceptionGate",
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
      "BearExceptionGate",
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
