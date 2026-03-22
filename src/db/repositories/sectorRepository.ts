import { pool } from "@/db/client";
import type {
  SectorRsRow,
  SectorRsCompactRow,
  SectorPhaseTransitionRow,
  SectorRsNewEntrantRow,
  SectorPhase1to2SurgeRow,
  IndustryRsRow,
  MarketRegimeRow,
  SectorSepaStatsRow,
  PrevWeekDateRow,
  SectorRsContextRow,
  SectorRsDetailContextRow,
  SectorRsRankWithTotalRow,
  EtlSectorPhaseTransitionRow,
} from "./types.js";

/**
 * sector_rs_daily, industry_rs_daily, market_regimes 조회 Repository.
 * 재시도 로직은 호출부가 담당한다.
 */

/**
 * 섹터 RS 랭킹 상위 N개를 조회한다.
 */
export async function findTopSectors(
  date: string,
  limit: number,
): Promise<SectorRsRow[]> {
  const { rows } = await pool.query<SectorRsRow>(
    `SELECT sector, avg_rs::text, rs_rank, stock_count,
            change_4w::text, change_8w::text, change_12w::text,
            group_phase, prev_group_phase,
            phase2_ratio::text, ma_ordered_ratio::text,
            phase1to2_count_5d
     FROM sector_rs_daily
     WHERE date = $1
     ORDER BY avg_rs::numeric DESC
     LIMIT $2`,
    [date, limit],
  );

  return rows;
}

/**
 * 섹터 필터 기준으로 상위 업종 목록을 조회한다.
 */
export async function findTopIndustries(
  date: string,
  sectors: string[],
): Promise<IndustryRsRow[]> {
  const { rows } = await pool.query<IndustryRsRow>(
    `SELECT sector, industry, avg_rs::text, rs_rank, group_phase, phase2_ratio::text
     FROM industry_rs_daily
     WHERE date = $1 AND sector = ANY($2)
     ORDER BY sector, avg_rs::numeric DESC`,
    [date, sectors],
  );

  return rows;
}

/**
 * 지정 날짜 기준 5일 이전의 최근 날짜를 조회한다 (전주 비교용).
 */
export async function findPrevWeekDate(
  date: string,
): Promise<PrevWeekDateRow> {
  const { rows } = await pool.query<PrevWeekDateRow>(
    `SELECT MAX(date) AS prev_week_date
     FROM sector_rs_daily
     WHERE date < ($1::date - INTERVAL '5 days')`,
    [date],
  );

  return rows[0] ?? { prev_week_date: null };
}

/**
 * 지정 날짜의 섹터 RS 랭킹(compact)을 조회한다 (전주 비교용).
 */
export async function findSectorsByDate(
  date: string,
  limit: number,
): Promise<SectorRsCompactRow[]> {
  const { rows } = await pool.query<SectorRsCompactRow>(
    `SELECT sector, avg_rs::text, rs_rank
     FROM sector_rs_daily
     WHERE date = $1
     ORDER BY avg_rs::numeric DESC
     LIMIT $2`,
    [date, limit],
  );

  return rows;
}

/**
 * 지정 날짜 기준 group_phase 1→2 전환 섹터 목록을 조회한다.
 */
export async function findSectorsWithPhaseTransition(
  date: string,
): Promise<SectorPhaseTransitionRow[]> {
  const { rows } = await pool.query<SectorPhaseTransitionRow>(
    `SELECT sector FROM sector_rs_daily
     WHERE date = $1 AND group_phase = 2 AND prev_group_phase = 1`,
    [date],
  );

  return rows;
}

/**
 * change_4w 상위 3위에 신규 진입한 섹터 목록을 조회한다.
 */
export async function findRsNewEntrants(
  date: string,
): Promise<SectorRsNewEntrantRow[]> {
  const { rows } = await pool.query<SectorRsNewEntrantRow>(
    `WITH today AS (
       SELECT sector, change_4w::numeric AS c4w,
              ROW_NUMBER() OVER (ORDER BY change_4w::numeric DESC) AS rn
       FROM sector_rs_daily WHERE date = $1
     ),
     prev AS (
       SELECT sector, change_4w::numeric AS c4w,
              ROW_NUMBER() OVER (ORDER BY change_4w::numeric DESC) AS rn
       FROM sector_rs_daily WHERE date = (
         SELECT MAX(date) FROM sector_rs_daily WHERE date < $1
       )
     )
     SELECT t.sector, NOT EXISTS (
       SELECT 1 FROM prev p WHERE p.sector = t.sector AND p.rn <= 3
     ) AS is_new
     FROM today t WHERE t.rn <= 3`,
    [date],
  );

  return rows;
}

/**
 * phase1to2_count_5d 상위 2개 섹터의 합산을 조회한다.
 */
export async function findPhase1to2SurgeSectors(
  date: string,
): Promise<SectorPhase1to2SurgeRow> {
  const { rows } = await pool.query<SectorPhase1to2SurgeRow>(
    `SELECT COALESCE(SUM(phase1to2_count_5d), 0)::text AS total
     FROM (
       SELECT phase1to2_count_5d FROM sector_rs_daily
       WHERE date = $1
       ORDER BY phase1to2_count_5d DESC
       LIMIT 2
     ) sub`,
    [date],
  );

  return rows[0] ?? { total: "0" };
}

/**
 * 최근 레짐 기록을 조회한다 (레짐 변경 감지용).
 */
export async function findRecentRegimes(
  date: string,
  limit: number,
): Promise<MarketRegimeRow[]> {
  const { rows } = await pool.query<MarketRegimeRow>(
    `SELECT regime FROM market_regimes
     WHERE regime_date <= $1
     ORDER BY regime_date DESC LIMIT $2`,
    [date, limit],
  );

  return rows;
}

/**
 * 단일 섹터의 avg_rs, group_phase를 조회한다 (saveRecommendations 팩터 저장용).
 */
export async function findSectorRsByName(
  sector: string,
  date: string,
): Promise<SectorRsContextRow | null> {
  const { rows } = await pool.query<SectorRsContextRow>(
    `SELECT avg_rs, group_phase FROM sector_rs_daily
     WHERE sector = $1 AND date = $2`,
    [sector, date],
  );

  return rows[0] ?? null;
}

/**
 * 단일 업종의 avg_rs, group_phase를 조회한다 (saveRecommendations 팩터 저장용).
 */
export async function findIndustryRsByName(
  industry: string,
  date: string,
): Promise<SectorRsContextRow | null> {
  const { rows } = await pool.query<SectorRsContextRow>(
    `SELECT avg_rs, group_phase FROM industry_rs_daily
     WHERE industry = $1 AND date = $2`,
    [industry, date],
  );

  return rows[0] ?? null;
}

/**
 * 단일 섹터의 RS 랭크 + 전체 섹터 수를 조회한다 (bearExceptionGate 전용).
 */
export async function findSectorRsRankWithTotal(
  sector: string,
  date: string,
): Promise<SectorRsRankWithTotalRow | null> {
  const { rows } = await pool.query<SectorRsRankWithTotalRow>(
    `SELECT
       srd.rs_rank,
       (SELECT COUNT(*) FROM sector_rs_daily WHERE date = $2) AS total_sectors
     FROM sector_rs_daily srd
     WHERE srd.sector = $1 AND srd.date = $2`,
    [sector, date],
  );

  return rows[0] ?? null;
}

/**
 * 단일 섹터의 avg_rs, rs_rank, group_phase를 조회한다 (getStockDetail 컨텍스트용).
 */
export async function findSectorRsDetail(
  sector: string,
  date: string,
): Promise<SectorRsDetailContextRow | null> {
  const { rows } = await pool.query<SectorRsDetailContextRow>(
    `SELECT avg_rs::text, rs_rank, group_phase
     FROM sector_rs_daily
     WHERE date = $1 AND sector = $2`,
    [date, sector],
  );

  return rows[0] ?? null;
}

/**
 * 단일 업종의 avg_rs, rs_rank, group_phase를 조회한다 (getStockDetail 컨텍스트용).
 */
export async function findIndustryRsDetail(
  industry: string,
  date: string,
): Promise<SectorRsDetailContextRow | null> {
  const { rows } = await pool.query<SectorRsDetailContextRow>(
    `SELECT avg_rs::text, rs_rank, group_phase
     FROM industry_rs_daily
     WHERE date = $1 AND industry = $2`,
    [date, industry],
  );

  return rows[0] ?? null;
}

/**
 * 지정된 섹터/산업의 SEPA 통계를 조회한다.
 * company_profiles → fundamental_scores 조인으로 산업별 등급 분포를 구한다.
 */
export async function findSectorSepaStats(
  sectors: string[],
): Promise<SectorSepaStatsRow[]> {
  const { rows } = await pool.query<SectorSepaStatsRow>(
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
  );

  return rows;
}

// ─── detect-sector-phase-events 전용 ─────────────────────────────────────────

/**
 * sector_rs_daily에서 Phase 전이 이벤트를 조회한다 (detect-sector-phase-events 전용).
 */
export async function findSectorPhaseTransitions(
  mode: "backfill" | "incremental",
  targetDate?: string,
): Promise<EtlSectorPhaseTransitionRow[]> {
  const baseQuery = `SELECT date, sector AS entity_name,
              prev_group_phase AS from_phase, group_phase AS to_phase,
              avg_rs::text, phase2_ratio::text
       FROM sector_rs_daily
       WHERE prev_group_phase IS NOT NULL
         AND group_phase != prev_group_phase`;

  if (mode === "incremental" && targetDate != null) {
    const { rows } = await pool.query<EtlSectorPhaseTransitionRow>(
      `${baseQuery} AND date = $1 ORDER BY date`,
      [targetDate],
    );
    return rows;
  }

  const { rows } = await pool.query<EtlSectorPhaseTransitionRow>(
    `${baseQuery} ORDER BY date`,
  );
  return rows;
}

/**
 * industry_rs_daily에서 Phase 전이 이벤트를 조회한다 (detect-sector-phase-events 전용).
 */
export async function findIndustryPhaseTransitions(
  mode: "backfill" | "incremental",
  targetDate?: string,
): Promise<EtlSectorPhaseTransitionRow[]> {
  const baseQuery = `SELECT date, industry AS entity_name,
              prev_group_phase AS from_phase, group_phase AS to_phase,
              avg_rs::text, phase2_ratio::text
       FROM industry_rs_daily
       WHERE prev_group_phase IS NOT NULL
         AND group_phase != prev_group_phase`;

  if (mode === "incremental" && targetDate != null) {
    const { rows } = await pool.query<EtlSectorPhaseTransitionRow>(
      `${baseQuery} AND date = $1 ORDER BY date`,
      [targetDate],
    );
    return rows;
  }

  const { rows } = await pool.query<EtlSectorPhaseTransitionRow>(
    `${baseQuery} ORDER BY date`,
  );
  return rows;
}
