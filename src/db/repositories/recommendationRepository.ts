import { pool } from "@/db/client";
import type {
  ActiveRecommendationRow,
  RecentlyClosedRow,
  Phase2PersistenceRow,
  Phase2StabilityRow,
} from "./types.js";

/**
 * recommendations 테이블 조회 Repository.
 * 재시도 로직은 호출부가 담당한다.
 */

/**
 * ACTIVE 상태인 recommendations에서 지정 symbols 중복 여부를 조회한다.
 */
export async function findActiveRecommendations(
  symbols: string[],
): Promise<ActiveRecommendationRow[]> {
  if (symbols.length === 0) {
    return [];
  }

  const { rows } = await pool.query<ActiveRecommendationRow>(
    `SELECT symbol FROM recommendations WHERE status = 'ACTIVE' AND symbol = ANY($1)`,
    [symbols],
  );

  return rows;
}

/**
 * 쿨다운 기간 내에 CLOSED된 recommendations를 조회한다.
 * status != 'ACTIVE' 이고 close_date >= cooldownStart인 레코드.
 */
export async function findRecentlyClosed(
  cooldownStart: string,
  symbols: string[],
): Promise<RecentlyClosedRow[]> {
  if (symbols.length === 0) {
    return [];
  }

  const { rows } = await pool.query<RecentlyClosedRow>(
    `SELECT DISTINCT symbol FROM recommendations
     WHERE status <> 'ACTIVE'
       AND close_date >= $1
       AND symbol = ANY($2)`,
    [cooldownStart, symbols],
  );

  return rows;
}

/**
 * 지정 기간 동안 Phase 2를 유지한 종목별 카운트를 조회한다.
 * saveRecommendations의 Phase 2 지속성 검사용.
 *
 * 변경 이력:
 * - phase >= 2: Phase 3/4도 카운트되어 지속성 검사 무력화 (#436)
 * - phase = 2: Phase 2만 정확히 카운트
 */
export async function findPhase2Persistence(
  symbols: string[],
  startDate: string,
  endDate: string,
): Promise<Phase2PersistenceRow[]> {
  if (symbols.length === 0) {
    return [];
  }

  const { rows } = await pool.query<Phase2PersistenceRow>(
    `SELECT symbol, COUNT(*) AS phase2_count
     FROM stock_phases
     WHERE symbol = ANY($1)
       AND date >= $2
       AND date <= $3
       AND phase = 2
     GROUP BY symbol`,
    [symbols, startDate, endDate],
  );

  return rows;
}

/**
 * 최근 N 거래일이 모두 Phase 2인 종목만 반환한다.
 * saveRecommendations의 Phase 2 안정성 게이트용.
 *
 * 동작: 각 symbol의 endDate 이하 최근 requiredDays 개 거래일을 추출하고,
 * 전부 phase = 2인 symbol만 결과에 포함한다.
 */
export async function findPhase2Stability(
  symbols: string[],
  endDate: string,
  requiredDays: number,
): Promise<Phase2StabilityRow[]> {
  if (symbols.length === 0) {
    return [];
  }

  const { rows } = await pool.query<Phase2StabilityRow>(
    `SELECT symbol
     FROM (
       SELECT symbol, phase,
         ROW_NUMBER() OVER (PARTITION BY symbol ORDER BY date DESC) AS rn
       FROM stock_phases
       WHERE symbol = ANY($1) AND date <= $2
     ) sub
     WHERE rn <= $3
     GROUP BY symbol
     HAVING COUNT(*) = $3
        AND COUNT(*) FILTER (WHERE phase = 2) = $3`,
    [symbols, endDate, requiredDays],
  );

  return rows;
}
