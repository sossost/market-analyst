import { pool } from "@/db/client";
import { MIN_MARKET_CAP } from "@/lib/constants";
import type { SectorClusterRow } from "./types.js";

/**
 * 업종 클러스터 조회 Repository.
 * Phase 2 비율이 높은 섹터와 해당 섹터의 고RS 종목을 반환한다.
 */

const DEFAULT_MIN_PHASE2_RATIO = 0.4;
const DEFAULT_MIN_RS = 80;
const DEFAULT_MAX_STOCKS_PER_SECTOR = 5;
const DEFAULT_MAX_SECTORS = 5;

/**
 * Phase 2 비율이 높은 섹터와 해당 섹터의 고RS Phase 2 종목을 조회한다.
 *
 * - 섹터: phase2_ratio >= minPhase2Ratio AND group_phase = 2
 * - 종목: Phase 2 AND RS >= minRs (RS 상한 없음 — 가시성 목적)
 * - 섹터당 최대 maxStocksPerSector 종목, 최대 maxSectors 섹터
 */
export async function findSectorClusters(params?: {
  date: string;
  minPhase2Ratio?: number;
  minRs?: number;
  maxStocksPerSector?: number;
  maxSectors?: number;
}): Promise<SectorClusterRow[]> {
  const date = params?.date;
  if (date == null) return [];

  const minPhase2Ratio = params?.minPhase2Ratio ?? DEFAULT_MIN_PHASE2_RATIO;
  const minRs = params?.minRs ?? DEFAULT_MIN_RS;
  const maxStocksPerSector = params?.maxStocksPerSector ?? DEFAULT_MAX_STOCKS_PER_SECTOR;
  const maxSectors = params?.maxSectors ?? DEFAULT_MAX_SECTORS;

  const { rows } = await pool.query<SectorClusterRow>(
    `WITH high_p2_sectors AS (
       SELECT sector, avg_rs::text AS sector_avg_rs,
              phase2_ratio::text, group_phase
       FROM sector_rs_daily
       WHERE date = $1
         AND phase2_ratio::numeric >= $2
         AND group_phase = 2
       ORDER BY phase2_ratio::numeric DESC
       LIMIT $5
     ),
     sector_stocks AS (
       SELECT sp.symbol, sp.rs_score, s.sector, COALESCE(sio.industry, s.industry) AS industry,
              ROW_NUMBER() OVER (PARTITION BY s.sector ORDER BY sp.rs_score DESC) AS rn
       FROM stock_phases sp
       JOIN symbols s ON sp.symbol = s.symbol
       LEFT JOIN symbol_industry_overrides sio ON s.symbol = sio.symbol
       WHERE sp.date = $1
         AND sp.phase = 2
         AND sp.rs_score >= $3
         AND s.sector IN (SELECT sector FROM high_p2_sectors)
         AND (s.market_cap IS NULL OR s.market_cap::numeric >= $6)
     )
     SELECT hs.sector, hs.sector_avg_rs, hs.phase2_ratio, hs.group_phase,
            ss.symbol, ss.rs_score, ss.industry
     FROM high_p2_sectors hs
     LEFT JOIN sector_stocks ss ON hs.sector = ss.sector AND ss.rn <= $4
     ORDER BY hs.phase2_ratio::numeric DESC, ss.rs_score DESC NULLS LAST`,
    [date, minPhase2Ratio, minRs, maxStocksPerSector, maxSectors, MIN_MARKET_CAP],
  );

  return rows;
}
