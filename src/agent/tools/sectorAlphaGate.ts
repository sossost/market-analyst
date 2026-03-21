/**
 * Sector Alpha Gate — 병목 서사의 수혜 섹터 SEPA 적합성 필터.
 *
 * 토론 엔진이 병목을 식별한 후, 해당 수혜 섹터/산업이 실제로
 * SEPA 기준 알파 포착이 가능한 구조인지 자동 검증한다.
 *
 * 현재 모드: "경고" — 차단하지 않고 alpha_compatible 태그만 부여.
 * SEPA 데이터 3개월+ 축적 후 Gate 기준값 확정 예정.
 *
 * 체크 항목:
 * 1. S/A급 비율 — 해당 산업 내 S/A급 종목이 존재하는가
 * 2. 평균 SEPA 스코어 — 20 미만이면 경고
 * 3. 비즈니스 모델 플래그 — 규제 산업/유틸리티 등 구조적 부적합 업종
 */

import { pool } from "@/db/client";
import { retryDatabaseOperation } from "@/etl/utils/retry";
import { logger } from "@/agent/logger";

// ─── Constants ───────────────────────────────────────────────────────────────

/** S/A급 비율이 이 값 이하이면 알파 부적합 (현재: 0% = 한 건도 없음) */
export const MIN_SA_GRADE_RATIO = 0;

/** 평균 SEPA 스코어가 이 값 미만이면 경고 */
export const MIN_AVG_SEPA_SCORE = 20;

/** 구조적으로 SEPA 알파 포착이 어려운 규제/유틸리티 산업 */
export const REGULATED_INDUSTRIES = new Set([
  "Regulated Electric",
  "Electric Utilities",
  "Gas Utilities",
  "Multi-Utilities",
  "Water Utilities",
  "Regulated Water",
  "Diversified Utilities",
]);

/** [구조적 관찰] 태그 — alpha_compatible: false 시 부여 */
export const STRUCTURAL_OBSERVATION_TAG = "[구조적 관찰]";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SectorSepaStats {
  sector: string;
  totalStocks: number;
  saGradeCount: number;
  saGradeRatio: number;
  avgScore: number;
  isRegulated: boolean;
}

export interface AlphaGateResult {
  alphaCompatible: boolean;
  reason: string;
  sectorStats: SectorSepaStats[];
}

// ─── Pure Evaluation Logic (testable without DB) ─────────────────────────────

/**
 * 단일 섹터의 SEPA 통계를 기반으로 알파 적합성을 판정한다.
 * 순수 함수 — DB 접근 없음.
 */
export function evaluateSectorAlpha(stats: SectorSepaStats): {
  compatible: boolean;
  reason: string;
} {
  // 데이터 부족 — 평가 불가, 보수적으로 compatible 처리 (경고 모드)
  if (stats.totalStocks === 0) {
    return {
      compatible: true,
      reason: `${stats.sector}: SEPA 데이터 없음 (평가 보류)`,
    };
  }

  // 규제 산업 플래그
  if (stats.isRegulated) {
    return {
      compatible: false,
      reason: `${stats.sector}: 규제 산업 — 실적 가속 구조적으로 어려움`,
    };
  }

  // S/A급 0건 + 평균 스코어 미달
  if (stats.saGradeCount === 0 && stats.avgScore < MIN_AVG_SEPA_SCORE) {
    return {
      compatible: false,
      reason: `${stats.sector}: S/A급 0건, 평균 SEPA ${stats.avgScore.toFixed(1)} (기준: ≥${MIN_AVG_SEPA_SCORE})`,
    };
  }

  // S/A급 존재하지만 평균 스코어 미달
  if (stats.avgScore < MIN_AVG_SEPA_SCORE) {
    return {
      compatible: true,
      reason: `${stats.sector}: S/A급 ${stats.saGradeCount}건 존재, 평균 SEPA ${stats.avgScore.toFixed(1)} (경고: 기준 미달)`,
    };
  }

  return {
    compatible: true,
    reason: `${stats.sector}: S/A급 ${stats.saGradeCount}/${stats.totalStocks}건 (${(stats.saGradeRatio * 100).toFixed(0)}%), 평균 SEPA ${stats.avgScore.toFixed(1)}`,
  };
}

/**
 * 복수 섹터의 평가 결과를 종합하여 최종 alpha_compatible을 판정한다.
 * 하나라도 부적합이면 전체 false (보수적 판정).
 */
export function evaluateAlphaGate(
  sectorStats: SectorSepaStats[],
): AlphaGateResult {
  if (sectorStats.length === 0) {
    return {
      alphaCompatible: true,
      reason: "수혜 섹터 미지정 — 평가 생략",
      sectorStats: [],
    };
  }

  const evaluations = sectorStats.map(evaluateSectorAlpha);
  const incompatible = evaluations.filter((e) => !e.compatible);

  if (incompatible.length > 0) {
    return {
      alphaCompatible: false,
      reason: incompatible.map((e) => e.reason).join("; "),
      sectorStats,
    };
  }

  return {
    alphaCompatible: true,
    reason: evaluations.map((e) => e.reason).join("; "),
    sectorStats,
  };
}

// ─── DB Query ────────────────────────────────────────────────────────────────

/**
 * 지정된 섹터/산업의 SEPA 통계를 조회한다.
 * company_profiles → fundamental_scores 조인으로 산업별 등급 분포를 구한다.
 *
 * @param sectors - beneficiarySectors 배열 (GICS 산업명)
 */
export async function querySectorSepaStats(
  sectors: string[],
): Promise<SectorSepaStats[]> {
  if (sectors.length === 0) return [];

  try {
    const { rows } = await retryDatabaseOperation(() =>
      pool.query<{
        industry: string;
        total_stocks: string;
        sa_grade_count: string;
        avg_score: string;
      }>(
        `WITH latest_scores AS (
           SELECT DISTINCT ON (fs.symbol)
             fs.symbol,
             fs.grade,
             fs.total_score,
             COALESCE(cp.industry, cp.sector) AS industry
           FROM fundamental_scores fs
           JOIN company_profiles cp ON cp.symbol = fs.symbol
           WHERE COALESCE(cp.industry, cp.sector) = ANY($1)
           ORDER BY fs.symbol, fs.scored_date DESC
         )
         SELECT
           industry,
           COUNT(*)::text AS total_stocks,
           COUNT(*) FILTER (WHERE grade IN ('S', 'A'))::text AS sa_grade_count,
           COALESCE(AVG(total_score), 0)::text AS avg_score
         FROM latest_scores
         GROUP BY industry`,
        [sectors],
      ),
    );

    return sectors.map((sector) => {
      const row = rows.find((r) => r.industry === sector);
      const totalStocks = row != null ? Number(row.total_stocks) : 0;
      const saGradeCount = row != null ? Number(row.sa_grade_count) : 0;
      const avgScore = row != null ? Number(row.avg_score) : 0;

      return {
        sector,
        totalStocks,
        saGradeCount,
        saGradeRatio: totalStocks > 0 ? saGradeCount / totalStocks : 0,
        avgScore,
        isRegulated: REGULATED_INDUSTRIES.has(sector),
      };
    });
  } catch (err) {
    logger.error(
      "SectorAlphaGate",
      `SEPA 통계 조회 실패: ${err instanceof Error ? err.message : String(err)}`,
    );
    // fail-open in warning mode — 조회 실패 시 compatible로 처리
    return sectors.map((sector) => ({
      sector,
      totalStocks: 0,
      saGradeCount: 0,
      saGradeRatio: 0,
      avgScore: 0,
      isRegulated: REGULATED_INDUSTRIES.has(sector),
    }));
  }
}

// ─── Main Gate Function ──────────────────────────────────────────────────────

/**
 * Sector Alpha Gate 실행.
 * 병목 서사의 수혜 섹터를 평가하여 alpha_compatible 판정을 반환한다.
 *
 * 현재 "경고" 모드: 결과를 태그로만 기록하고 종목 발굴을 차단하지 않는다.
 */
export async function runSectorAlphaGate(
  beneficiarySectors: string[],
): Promise<AlphaGateResult> {
  const stats = await querySectorSepaStats(beneficiarySectors);
  const result = evaluateAlphaGate(stats);

  const level = result.alphaCompatible ? "info" : "warn";
  logger[level](
    "SectorAlphaGate",
    `판정: ${result.alphaCompatible ? "통과" : "구조적 관찰"} — ${result.reason}`,
  );

  return result;
}
