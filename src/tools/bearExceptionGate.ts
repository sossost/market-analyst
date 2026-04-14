/**
 * Bear Exception Gate — 하락 레짐 내 섹터 역행 알파 종목 예외 진입.
 *
 * EARLY_BEAR / BEAR 레짐에서도 구조적으로 강한 종목에 대해
 * 조건부 예외 진입을 허용하는 게이트.
 *
 * 레짐별 차등 기준 (#711, #785):
 *   EARLY_BEAR: (섹터 OR 업종) RS 상위 25%, SEPA S/A/B 등급, Phase 2 지속성 3일
 *   BEAR:       (섹터 OR 업종) RS 상위 15%, SEPA S/A 등급,   Phase 2 지속성 3일
 *
 * 모든 조건을 충족해야 통과. DB 조회 실패 시 fail-closed.
 */

import { retryDatabaseOperation } from "@/etl/utils/retry";
import { logger } from "@/lib/logger";
import { findSectorRsRankWithTotal, findIndustryRsRankWithTotal } from "@/db/repositories/sectorRepository.js";
import { findLatestFundamentalGrade } from "@/db/repositories/fundamentalRepository.js";
import { findPhase2PersistenceBySymbol } from "@/db/repositories/stockPhaseRepository.js";

/** Bear 예외 통과에 필요한 Phase 2 지속 최소 일수 (일반 게이트와 동일 기준) */
export const BEAR_EXCEPTION_PHASE2_PERSISTENCE_DAYS = 3;

/** 섹터 RS 상위 N% 이내만 예외 허용 (BEAR 레짐) */
export const BEAR_EXCEPTION_SECTOR_RS_PERCENTILE = 15;

/**
 * EARLY_BEAR 섹터 RS 상위 N% 이내 예외 허용.
 * 근거: EARLY_BEAR는 하락 초기로 BEAR보다 위험도가 낮다.
 * 15%에서는 ~1,500 Phase 2 종목 중 일 0-2건만 통과하여
 * 알파 형성 검증이 불가능했다 (#711). 25%로 완화하되
 * 나머지 게이트(SEPA, 가격, 안정성 등)가 품질을 보장.
 */
export const EARLY_BEAR_SECTOR_RS_PERCENTILE = 25;

/**
 * Bear 예외 허용 SEPA 등급 집합 (BEAR 레짐).
 * S(최상) + A(우수) — Bear 장에서도 펀더멘탈이 검증된 종목만 허용.
 * 근거: S 단독 조건은 1,441건 중 0건 통과 (#619). S+A로 완화하되
 * 나머지 게이트(RS, 가격, 안정성 등)가 품질을 보장.
 */
export const BEAR_EXCEPTION_ALLOWED_GRADES: ReadonlySet<string> = new Set(["S", "A"]);
export const BEAR_EXCEPTION_ALLOWED_GRADES_TEXT = Array.from(BEAR_EXCEPTION_ALLOWED_GRADES).join("/");

/**
 * EARLY_BEAR 예외 허용 SEPA 등급 집합.
 * S/A/B — 하락 초기에는 B등급(기준 일부 충족)까지 허용.
 * 근거: S/A만 허용 시 EARLY_BEAR에서도 일 0-2건에 불과하여
 * 알파 형성 검증 불가 (#711). B등급 추가로 후보 풀 확대.
 * C(미약)/F(전부 미충족)는 여전히 차단.
 */
export const EARLY_BEAR_ALLOWED_GRADES: ReadonlySet<string> = new Set(["S", "A", "B"]);
export const EARLY_BEAR_ALLOWED_GRADES_TEXT = Array.from(EARLY_BEAR_ALLOWED_GRADES).join("/");

/**
 * RS 최상위 경로 — Bear 예외 2차 경로.
 * 섹터/SEPA 무관, 시장 전체 상대 강도 최상위 종목만 통과.
 * RS 과열 게이트(>95)가 이후 별도 적용되므로 실질 윈도우는 90~95.
 * 근거: 3중 AND 게이트(섹터RS + SEPA + 지속성) 단일 경로에서
 * 1,510건 중 0건 통과 (#777). RS 최상위 종목은 Bear에서도 추적 가치 있음.
 */
export const BEAR_EXCEPTION_RS_TOP_TIER_THRESHOLD = 90;

/** [Bear 예외] 태그 — reason 접두사 */
export const BEAR_EXCEPTION_TAG = "[Bear 예외]";

export interface BearExceptionInput {
  symbol: string;
  sector: string;
  /** 종목의 업종. 업종 RS 대안 경로 판정용. null/빈 문자열이면 업종 경로 비활성. */
  industry?: string | null;
  date: string;
  /** 현재 확정 레짐. EARLY_BEAR와 BEAR에 따라 게이트 엄격도가 달라진다. */
  regime?: string;
  /** 종목 RS 스코어 (RS 최상위 경로 판정용). null이면 RS 최상위 경로 비활성. */
  rsScore?: number | null;
  /** Phase 2 안정성 여부 — 최근 N 거래일 연속 Phase 2 (RS 최상위 경로용). */
  isStable?: boolean;
}

export interface BearExceptionResult {
  passed: boolean;
  /** 통과 경로. "defensive_sector" = 기존 방어섹터 경로, "rs_top_tier" = RS 최상위 경로 */
  path?: "defensive_sector" | "rs_top_tier";
  reason: string;
  details: {
    sectorRsRank: number | null;
    totalSectors: number | null;
    sectorRsPercentile: number | null;
    industryRsRank: number | null;
    totalIndustries: number | null;
    industryRsPercentile: number | null;
    fundamentalGrade: string | null;
    phase2Count: number;
  };
}

/**
 * 개별 종목이 Bear 예외 조건을 충족하는지 검사한다.
 *
 * 2개 경로 중 하나만 충족하면 passed: true (OR):
 *   1. 방어 섹터/업종 경로: (섹터RS OR 업종RS) 상위 N% + SEPA S/A(/B) + Phase 2 지속 3일 (#785)
 *   2. RS 최상위 경로: RS >= 90 + Phase 2 지속 3일 + 안정성 3일 (#777)
 *
 * DB 조회 실패 시 fail-closed (예외 불허) — Bear 레짐에서는 보수적으로.
 */
export async function evaluateBearException(
  input: BearExceptionInput,
): Promise<BearExceptionResult> {
  const { symbol, sector, industry, date, regime, rsScore, isStable } = input;

  // EARLY_BEAR는 BEAR보다 완화된 기준 적용 (#711)
  const isEarlyBear = regime === "EARLY_BEAR";
  const sectorRsThreshold = isEarlyBear
    ? EARLY_BEAR_SECTOR_RS_PERCENTILE
    : BEAR_EXCEPTION_SECTOR_RS_PERCENTILE;
  const allowedGrades = isEarlyBear
    ? EARLY_BEAR_ALLOWED_GRADES
    : BEAR_EXCEPTION_ALLOWED_GRADES;
  const allowedGradesText = isEarlyBear
    ? EARLY_BEAR_ALLOWED_GRADES_TEXT
    : BEAR_EXCEPTION_ALLOWED_GRADES_TEXT;

  const persistenceStart = getDateOffset(date, BEAR_EXCEPTION_PHASE2_PERSISTENCE_DAYS);

  // 4개 조건 병렬 조회 (방어 섹터/업종 경로용)
  const hasIndustry = industry != null && industry !== "";
  const [sectorResult, industryResult, gradeResult, persistenceResult] = await Promise.all([
    querySectorRsRank(sector, date),
    hasIndustry ? queryIndustryRsRank(industry, date) : Promise.resolve({ rank: null, totalIndustries: null }),
    queryFundamentalGrade(symbol, date),
    queryPhase2Persistence(symbol, persistenceStart, date),
  ]);

  const { rank: sectorRsRank, totalSectors } = sectorResult;
  const { rank: industryRsRank, totalIndustries } = industryResult;
  const fundamentalGrade = gradeResult;
  const phase2Count = persistenceResult;

  // 섹터 RS 퍼센타일 계산 (rank 1 = 최상위, 낮을수록 좋음)
  const sectorRsPercentile =
    sectorRsRank != null && totalSectors != null && totalSectors > 0
      ? Math.round((sectorRsRank / totalSectors) * 100)
      : null;

  // 업종 RS 퍼센타일 계산 (#785)
  const industryRsPercentile =
    industryRsRank != null && totalIndustries != null && totalIndustries > 0
      ? Math.round((industryRsRank / totalIndustries) * 100)
      : null;

  // ── 경로 1: 방어 섹터/업종 경로 (#785: 업종 RS 대안 경로 추가) ──
  const isSectorRsTop =
    sectorRsPercentile != null &&
    sectorRsPercentile <= sectorRsThreshold;

  const isIndustryRsTop =
    industryRsPercentile != null &&
    industryRsPercentile <= sectorRsThreshold;

  const isGroupRsTop = isSectorRsTop || isIndustryRsTop;

  const isFundamentalQualified = fundamentalGrade != null && allowedGrades.has(fundamentalGrade);

  const isPhase2Persistent =
    phase2Count >= BEAR_EXCEPTION_PHASE2_PERSISTENCE_DAYS;

  const defensiveSectorPassed = isGroupRsTop && isFundamentalQualified && isPhase2Persistent;

  // ── 경로 2: RS 최상위 경로 (#777) ──
  // RS >= 90 + Phase 2 지속 3일 + 안정성 3일. 섹터/SEPA 무관.
  const isRsTopTier = rsScore != null && rsScore >= BEAR_EXCEPTION_RS_TOP_TIER_THRESHOLD;
  const isStablePhase2 = isStable === true;
  const rsTopTierPassed = isRsTopTier && isPhase2Persistent && isStablePhase2;

  const passed = defensiveSectorPassed || rsTopTierPassed;

  // 통과 경로 식별
  const path: BearExceptionResult["path"] = passed
    ? (defensiveSectorPassed ? "defensive_sector" : "rs_top_tier")
    : undefined;

  // 실패 사유 구성
  const regimeLabel = isEarlyBear ? "Early Bear 예외" : "Bear 예외";
  let reason: string;

  if (defensiveSectorPassed) {
    // 업종 RS로 통과했는지 섹터 RS로 통과했는지 명시
    const rsPassedVia = isSectorRsTop
      ? `섹터RS 상위${sectorRsPercentile}%`
      : `업종RS 상위${industryRsPercentile}% (${industry})`;
    reason = `${regimeLabel} 통과 [방어섹터]: ${rsPassedVia}, SEPA ${fundamentalGrade}, Phase2 ${phase2Count}일`;
  } else if (rsTopTierPassed) {
    reason = `${regimeLabel} 통과 [RS최상위]: RS ${rsScore}, Phase2 ${phase2Count}일, 안정성 충족`;
  } else {
    // 두 경로 모두 실패 — 각 경로의 실패 사유 나열
    const defensiveReasons: string[] = [];
    if (!isGroupRsTop) {
      defensiveReasons.push(
        "섹터RS " + (sectorRsPercentile ?? "N/A") + "%" + (hasIndustry ? "/업종RS " + (industryRsPercentile ?? "N/A") + "%" : "") + " (기준: ≤" + sectorRsThreshold + "%)",
      );
    }
    if (!isFundamentalQualified) {
      defensiveReasons.push(
        `SEPA ${fundamentalGrade ?? "N/A"} (기준: ${allowedGradesText})`,
      );
    }
    if (!isPhase2Persistent) {
      defensiveReasons.push(
        `Phase2 지속 ${phase2Count}일 (기준: ≥${BEAR_EXCEPTION_PHASE2_PERSISTENCE_DAYS}일)`,
      );
    }

    const rsReasons: string[] = [];
    if (!isRsTopTier) {
      rsReasons.push(`RS ${rsScore ?? "N/A"} (기준: ≥${BEAR_EXCEPTION_RS_TOP_TIER_THRESHOLD})`);
    }
    if (!isPhase2Persistent) {
      rsReasons.push(`Phase2 지속 ${phase2Count}일 (기준: ≥${BEAR_EXCEPTION_PHASE2_PERSISTENCE_DAYS}일)`);
    }
    if (!isStablePhase2) {
      rsReasons.push("안정성 미충족");
    }

    reason = `${regimeLabel} 미충족 — 방어섹터: ${defensiveReasons.join(", ")}; RS최상위: ${rsReasons.join(", ")}`;
  }

  if (passed) {
    logger.info(
      "BearExceptionGate",
      `${symbol}: ${reason}`,
    );
  }

  return {
    passed,
    path,
    reason,
    details: {
      sectorRsRank,
      totalSectors,
      sectorRsPercentile,
      industryRsRank,
      totalIndustries,
      industryRsPercentile,
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

async function queryIndustryRsRank(
  industry: string,
  date: string,
): Promise<{ rank: number | null; totalIndustries: number | null }> {
  try {
    const row = await retryDatabaseOperation(() =>
      findIndustryRsRankWithTotal(industry, date),
    );

    if (row == null) {
      return { rank: null, totalIndustries: null };
    }

    return {
      rank: Number(row.rs_rank),
      totalIndustries: Number(row.total_industries),
    };
  } catch (err) {
    logger.error(
      "BearExceptionGate",
      `업종 RS 조회 실패 (${industry}): ${err instanceof Error ? err.message : String(err)}`,
    );
    return { rank: null, totalIndustries: null };
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
