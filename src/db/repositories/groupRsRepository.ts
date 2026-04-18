import { pool } from "@/db/client";
import { SHELL_COMPANIES_INDUSTRY } from "@/lib/constants";
import type { GroupBy } from "@/types";
import type {
  GroupAvgRow,
  GroupHistoricalRsRow,
  GroupBreadthRow,
  GroupTransitionRow,
  GroupFundamentalRow,
  GroupPrevPhaseRow,
} from "./types.js";

/**
 * group-rs.ts 전용 동적 SQL Repository.
 * groupBy는 ALLOWED_GROUP_COLS 화이트리스트로 보호된다.
 * 재시도 로직은 호출부가 담당한다.
 */

const ALLOWED_GROUP_COLS = {
  sector: {
    col: "s.sector",
    table: "sector_rs_daily",
    colName: "sector",
    joinClause: "",
    notShellFilter: `s.industry IS DISTINCT FROM '${SHELL_COMPANIES_INDUSTRY}'`,
  },
  industry: {
    col: "COALESCE(sio.industry, s.industry)",
    table: "industry_rs_daily",
    colName: "industry",
    joinClause: "LEFT JOIN symbol_industry_overrides sio ON s.symbol = sio.symbol",
    notShellFilter: `COALESCE(sio.industry, s.industry) IS DISTINCT FROM '${SHELL_COMPANIES_INDUSTRY}'`,
  },
} as const satisfies Record<GroupBy, { col: string; table: string; colName: string; joinClause: string; notShellFilter: string }>;

/**
 * 그룹별 RS 평균 + 종목 수를 조회한다 (Step 1).
 */
export async function findGroupAvgs(
  groupBy: GroupBy,
  targetDate: string,
  minStockCount: number,
): Promise<GroupAvgRow[]> {
  const { col: groupCol, joinClause, notShellFilter } = ALLOWED_GROUP_COLS[groupBy];

  const { rows } = await pool.query<GroupAvgRow>(
    `SELECT
      ${groupCol} AS group_name,
      ${groupBy === "industry" ? "s.sector AS parent_group," : "NULL AS parent_group,"}
      AVG(dp.rs_score)::numeric(10,2) AS avg_rs,
      COUNT(*)::text AS stock_count
     FROM symbols s
     ${joinClause}
     JOIN daily_prices dp ON s.symbol = dp.symbol AND dp.date = $1
     WHERE s.is_actively_trading = true
       AND s.is_etf = false
       AND ${notShellFilter}
       AND ${groupCol} IS NOT NULL
       AND ${groupCol} != ''
     GROUP BY ${groupCol}${groupBy === "industry" ? ", s.sector" : ""}
     HAVING COUNT(*) >= $2
     ORDER BY AVG(dp.rs_score) DESC`,
    [targetDate, minStockCount],
  );

  return rows;
}

/**
 * 그룹별 과거 RS (4w/8w/12w) 를 일괄 조회한다 (Step 2).
 */
export async function findGroupHistoricalRs(
  groupBy: GroupBy,
  groupNames: string[],
  targetDate: string,
): Promise<GroupHistoricalRsRow[]> {
  const { table: outputTable, colName: groupColName } = ALLOWED_GROUP_COLS[groupBy];

  const { rows } = await pool.query<GroupHistoricalRsRow>(
    `SELECT ${groupColName} AS group_name, date, avg_rs,
            ROW_NUMBER() OVER (PARTITION BY ${groupColName} ORDER BY date DESC) AS row_num
     FROM ${outputTable}
     WHERE ${groupColName} = ANY($1) AND date < $2
     ORDER BY ${groupColName}, date DESC`,
    [groupNames, targetDate],
  );

  return rows;
}

/**
 * 그룹별 브레드스 지표 (MA 정렬 비율, Phase 2 비율 등)를 일괄 조회한다 (Step 3).
 */
export async function findGroupBreadth(
  groupBy: GroupBy,
  targetDate: string,
  groupNames: string[],
): Promise<GroupBreadthRow[]> {
  const { col: groupCol, joinClause, notShellFilter } = ALLOWED_GROUP_COLS[groupBy];

  const { rows } = await pool.query<GroupBreadthRow>(
    `SELECT
      ${groupCol} AS group_name,
      COALESCE(COUNT(*) FILTER (
        WHERE dm.ma50::numeric > COALESCE(sp.ma150::numeric, dm.ma100::numeric)
          AND COALESCE(sp.ma150::numeric, dm.ma100::numeric) > dm.ma200::numeric
      )::numeric / NULLIF(COUNT(*), 0), 0) AS ma_ordered_ratio,
      COALESCE(COUNT(*) FILTER (WHERE sp.phase = 2)::numeric / NULLIF(COUNT(*), 0), 0) AS phase2_ratio,
      COALESCE(COUNT(*) FILTER (WHERE dp.rs_score > 50)::numeric / NULLIF(COUNT(*), 0), 0) AS rs_above50_ratio,
      COALESCE(COUNT(*) FILTER (
        WHERE dp.close::numeric >= (
          SELECT MAX(dp2.high::numeric)
          FROM daily_prices dp2
          WHERE dp2.symbol = s.symbol
            AND dp2.date > ($1::date - INTERVAL '20 days')::text
            AND dp2.date <= $1
        )
      )::numeric / NULLIF(COUNT(*), 0), 0) AS new_high_ratio
     FROM symbols s
     ${joinClause}
     JOIN daily_prices dp ON s.symbol = dp.symbol AND dp.date = $1
     JOIN daily_ma dm ON s.symbol = dm.symbol AND dm.date = $1
     LEFT JOIN stock_phases sp ON s.symbol = sp.symbol AND sp.date = $1
     WHERE s.is_actively_trading = true
       AND s.is_etf = false
       AND ${notShellFilter}
       AND ${groupCol} = ANY($2)
     GROUP BY ${groupCol}`,
    [targetDate, groupNames],
  );

  return rows;
}

/**
 * 그룹별 Phase 전환 수 (1→2, 2→3) 를 5일 윈도우로 일괄 조회한다 (Step 4).
 */
export async function findGroupTransitions(
  groupBy: GroupBy,
  groupNames: string[],
  targetDate: string,
): Promise<GroupTransitionRow[]> {
  const { col: groupCol, joinClause } = ALLOWED_GROUP_COLS[groupBy];

  const { rows } = await pool.query<GroupTransitionRow>(
    `SELECT
      ${groupCol} AS group_name,
      COUNT(*) FILTER (WHERE sp.prev_phase = 1 AND sp.phase = 2) AS p1to2,
      COUNT(*) FILTER (WHERE sp.prev_phase = 2 AND sp.phase = 3) AS p2to3
     FROM stock_phases sp
     JOIN symbols s ON sp.symbol = s.symbol
     ${joinClause}
     WHERE ${groupCol} = ANY($1)
       AND sp.date > (
         SELECT date FROM (
           SELECT DISTINCT date FROM stock_phases
           WHERE date <= $2 ORDER BY date DESC LIMIT 5
         ) sub ORDER BY date ASC LIMIT 1
       )
       AND sp.date <= $2
       AND sp.prev_phase IS NOT NULL
     GROUP BY ${groupCol}`,
    [groupNames, targetDate],
  );

  return rows;
}

/**
 * 그룹별 펀더멘탈 지표 (매출 가속, 이익 가속, 수익성) 를 일괄 조회한다 (Step 5).
 */
export async function findGroupFundamentals(
  groupBy: GroupBy,
  groupNames: string[],
): Promise<GroupFundamentalRow[]> {
  const { col: groupCol, joinClause, notShellFilter } = ALLOWED_GROUP_COLS[groupBy];

  const { rows } = await pool.query<GroupFundamentalRow>(
    `WITH latest_q AS (
      SELECT ${groupCol} AS group_name,
             qf.symbol, qf.revenue, qf.net_income, qf.eps_diluted,
             ROW_NUMBER() OVER (PARTITION BY qf.symbol ORDER BY qf.period_end_date DESC) as rn
      FROM quarterly_financials qf
      JOIN symbols s ON qf.symbol = s.symbol
      ${joinClause}
      WHERE ${groupCol} = ANY($1)
        AND s.is_actively_trading = true
        AND s.is_etf = false
        AND ${notShellFilter}
    )
    SELECT
      q1.group_name,
      COALESCE(COUNT(*) FILTER (WHERE q1.revenue::numeric > q2.revenue::numeric AND q2.revenue::numeric > 0)::numeric
        / NULLIF(COUNT(*) FILTER (WHERE q2.revenue IS NOT NULL), 0), 0) AS revenue_accel_ratio,
      COALESCE(COUNT(*) FILTER (WHERE q1.net_income::numeric > q2.net_income::numeric AND q2.net_income::numeric > 0)::numeric
        / NULLIF(COUNT(*) FILTER (WHERE q2.net_income IS NOT NULL), 0), 0) AS income_accel_ratio,
      COALESCE(COUNT(*) FILTER (WHERE q1.eps_diluted::numeric > 0)::numeric
        / NULLIF(COUNT(*), 0), 0) AS profitable_ratio
    FROM latest_q q1
    LEFT JOIN latest_q q2 ON q1.symbol = q2.symbol AND q2.rn = q1.rn + 1
    WHERE q1.rn = 1
    GROUP BY q1.group_name`,
    [groupNames],
  );

  return rows;
}

/**
 * 이전 날짜의 그룹 Phase를 조회한다 (Step 6).
 */
export async function findGroupPrevPhases(
  groupBy: GroupBy,
  targetDate: string,
): Promise<GroupPrevPhaseRow[]> {
  const { table: outputTable, colName: groupColName } = ALLOWED_GROUP_COLS[groupBy];

  const { rows } = await pool.query<GroupPrevPhaseRow>(
    `SELECT ${groupColName} AS group_name, group_phase
     FROM ${outputTable}
     WHERE date = (SELECT MAX(date) FROM ${outputTable} WHERE date < $1)`,
    [targetDate],
  );

  return rows;
}
