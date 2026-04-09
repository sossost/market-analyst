import { pool } from "@/db/client";
import { MIN_MARKET_CAP } from "@/lib/constants";
import type {
  VcpCandidateRow,
  ConfirmedBreakoutRow,
  SectorLagPatternRow,
} from "./types.js";

/**
 * Phase 2 조기포착 신호 테이블 조회 Repository.
 * daily_noise_signals, daily_breakout_signals, sector_lag_patterns.
 */

/**
 * VCP(변동성 수축 패턴) 후보 종목을 조회한다.
 * daily_noise_signals에서 is_vcp = true인 종목을 BB width 순으로 반환.
 */
export async function findVcpCandidates(params: {
  date: string;
  limit: number;
}): Promise<VcpCandidateRow[]> {
  const { date, limit } = params;

  const { rows } = await pool.query<VcpCandidateRow>(
    `SELECT
       dns.symbol,
       dns.date,
       dns.bb_width_current::text,
       dns.bb_width_avg_60d::text,
       dns.atr14_percent::text,
       dns.body_ratio::text,
       dns.ma20_ma50_distance_percent::text,
       s.sector,
       s.industry,
       sp.phase,
       sp.rs_score
     FROM daily_noise_signals dns
     JOIN symbols s ON s.symbol = dns.symbol
     LEFT JOIN stock_phases sp ON sp.symbol = dns.symbol AND sp.date = dns.date
     WHERE dns.date = $1
       AND dns.is_vcp = true
       AND s.market_cap >= $2
     ORDER BY dns.bb_width_current ASC NULLS LAST
     LIMIT $3`,
    [date, MIN_MARKET_CAP, limit],
  );

  return rows;
}

/**
 * 거래량 확인된 돌파 종목을 조회한다.
 * daily_breakout_signals에서 is_confirmed_breakout = true, volumeRatio DESC 정렬.
 */
export async function findConfirmedBreakouts(params: {
  date: string;
  limit: number;
}): Promise<ConfirmedBreakoutRow[]> {
  const { date, limit } = params;

  const { rows } = await pool.query<ConfirmedBreakoutRow>(
    `SELECT
       dbs.symbol,
       dbs.date,
       dbs.breakout_percent::text,
       dbs.volume_ratio::text,
       dbs.is_perfect_retest,
       dbs.ma20_distance_percent::text,
       s.sector,
       s.industry,
       sp.phase,
       sp.rs_score
     FROM daily_breakout_signals dbs
     JOIN symbols s ON s.symbol = dbs.symbol
     LEFT JOIN stock_phases sp ON sp.symbol = dbs.symbol AND sp.date = dbs.date
     WHERE dbs.date = $1
       AND dbs.is_confirmed_breakout = true
       AND s.market_cap >= $2
     ORDER BY dbs.volume_ratio DESC NULLS LAST
     LIMIT $3`,
    [date, MIN_MARKET_CAP, limit],
  );

  return rows;
}

type PhaseTransition = "1to2" | "3to4";
type LagEntityType = "sector" | "industry";

/**
 * 신뢰할 수 있는 섹터 래그 패턴을 조회한다.
 * is_reliable = true, avgLagDays 기준 정렬.
 */
export async function findReliableSectorLagPatterns(params: {
  transition: PhaseTransition;
  entityType: LagEntityType;
  limit: number;
}): Promise<SectorLagPatternRow[]> {
  const { transition, entityType, limit } = params;

  const { rows } = await pool.query<SectorLagPatternRow>(
    `SELECT
       entity_type,
       leader_entity,
       follower_entity,
       transition,
       sample_count,
       avg_lag_days::text,
       median_lag_days::text,
       stddev_lag_days::text,
       p_value::text,
       last_observed_at,
       last_lag_days
     FROM sector_lag_patterns
     WHERE is_reliable = true
       AND transition = $1
       AND entity_type = $2
     ORDER BY avg_lag_days ASC NULLS LAST
     LIMIT $3`,
    [transition, entityType, limit],
  );

  return rows;
}
