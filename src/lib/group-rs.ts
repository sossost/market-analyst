import { pool } from "@/db/client";
import { retryDatabaseOperation } from "@/etl/utils/retry";
import { toNum } from "@/etl/utils/common";
import { detectGroupPhase } from "@/lib/group-phase";
import type { GroupBy, GroupRsConfig, GroupRsRow, Phase } from "@/types";
import { logger } from "@/agent/logger";

const TAG = "GROUP_RS";

const ALLOWED_GROUP_COLS = {
  sector: { col: "s.sector", table: "sector_rs_daily", colName: "sector" },
  industry: { col: "s.industry", table: "industry_rs_daily", colName: "industry" },
} as const satisfies Record<GroupBy, { col: string; table: string; colName: string }>;

/**
 * Build group-level RS data for sectors or industries.
 * Shared logic parameterized by groupBy field.
 */
export async function buildGroupRs(
  config: GroupRsConfig,
): Promise<GroupRsRow[]> {
  const { groupBy, minStockCount, targetDate } = config;
  const { col: groupCol, table: outputTable, colName: groupColName } =
    ALLOWED_GROUP_COLS[groupBy];

  // Step 1: RS average + ranking per group
  const { rows: groupAvgs } = await retryDatabaseOperation(() =>
    pool.query<{
      group_name: string;
      parent_group: string | null;
      avg_rs: string;
      stock_count: string;
    }>(
      `SELECT
        ${groupCol} AS group_name,
        ${groupBy === "industry" ? "s.sector AS parent_group," : "NULL AS parent_group,"}
        AVG(dp.rs_score)::numeric(10,2) AS avg_rs,
        COUNT(*)::text AS stock_count
       FROM symbols s
       JOIN daily_prices dp ON s.symbol = dp.symbol AND dp.date = $1
       WHERE s.is_actively_trading = true
         AND s.is_etf = false
         AND ${groupCol} IS NOT NULL
         AND ${groupCol} != ''
       GROUP BY ${groupCol}${groupBy === "industry" ? ", s.sector" : ""}
       HAVING COUNT(*) >= $2
       ORDER BY AVG(dp.rs_score) DESC`,
      [targetDate, minStockCount],
    ),
  );

  if (groupAvgs.length === 0) {
    logger.info(TAG, "No groups found with sufficient stock count.");
    return [];
  }

  logger.info(TAG, `Groups found: ${groupAvgs.length}`);

  // Assign RS rank (1 = highest avg RS)
  const groupNames = groupAvgs.map((g) => g.group_name);

  // Step 2: Fetch historical avg RS for acceleration (4w/8w/12w) — single batch query
  const TRADING_DAYS_4W = 20;
  const TRADING_DAYS_8W = 40;
  const TRADING_DAYS_12W = 60;

  const { rows: histRows } = await retryDatabaseOperation(() =>
    pool.query<{
      group_name: string;
      date: string;
      avg_rs: string;
      row_num: string;
    }>(
      `SELECT ${groupColName} AS group_name, date, avg_rs,
              ROW_NUMBER() OVER (PARTITION BY ${groupColName} ORDER BY date DESC) AS row_num
       FROM ${outputTable}
       WHERE ${groupColName} = ANY($1) AND date < $2
       ORDER BY ${groupColName}, date DESC`,
      [groupNames, targetDate],
    ),
  );

  const historicalRs = new Map<
    string,
    { change4w: number | null; change8w: number | null; change12w: number | null }
  >();

  // Group historical rows by group_name
  const histByGroup = new Map<string, Map<number, number>>();
  for (const row of histRows) {
    const rowNum = Number(row.row_num);
    if (rowNum > TRADING_DAYS_12W) continue;
    let m = histByGroup.get(row.group_name);
    if (m == null) {
      m = new Map();
      histByGroup.set(row.group_name, m);
    }
    m.set(rowNum, toNum(row.avg_rs));
  }

  for (const group of groupNames) {
    const currentAvg = toNum(
      groupAvgs.find((g) => g.group_name === group)?.avg_rs,
    );
    const hist = histByGroup.get(group);

    const get = (daysBack: number): number | null => {
      const val = hist?.get(daysBack);
      if (val == null) return null;
      return currentAvg - val;
    };

    historicalRs.set(group, {
      change4w: get(TRADING_DAYS_4W),
      change8w: get(TRADING_DAYS_8W),
      change12w: get(TRADING_DAYS_12W),
    });
  }

  // Step 3: Breadth indicators — single batch query with GROUP BY
  const { rows: breadthRows } = await retryDatabaseOperation(() =>
    pool.query<{
      group_name: string;
      ma_ordered_ratio: string;
      phase2_ratio: string;
      rs_above50_ratio: string;
      new_high_ratio: string;
    }>(
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
       JOIN daily_prices dp ON s.symbol = dp.symbol AND dp.date = $1
       JOIN daily_ma dm ON s.symbol = dm.symbol AND dm.date = $1
       LEFT JOIN stock_phases sp ON s.symbol = sp.symbol AND sp.date = $1
       WHERE s.is_actively_trading = true
         AND s.is_etf = false
         AND ${groupCol} = ANY($2)
       GROUP BY ${groupCol}`,
      [targetDate, groupNames],
    ),
  );

  const breadthByGroup = new Map<
    string,
    { maOrderedRatio: number; phase2Ratio: number; rsAbove50Ratio: number; newHighRatio: number }
  >();
  for (const row of breadthRows) {
    breadthByGroup.set(row.group_name, {
      maOrderedRatio: toNum(row.ma_ordered_ratio),
      phase2Ratio: toNum(row.phase2_ratio),
      rsAbove50Ratio: toNum(row.rs_above50_ratio),
      newHighRatio: toNum(row.new_high_ratio),
    });
  }

  // Step 4: Phase transition surge (5-day window) — single batch query
  const { rows: transitionRows } = await retryDatabaseOperation(() =>
    pool.query<{
      group_name: string;
      p1to2: string;
      p2to3: string;
    }>(
      `SELECT
        ${groupCol} AS group_name,
        COUNT(*) FILTER (WHERE sp.prev_phase = 1 AND sp.phase = 2) AS p1to2,
        COUNT(*) FILTER (WHERE sp.prev_phase = 2 AND sp.phase = 3) AS p2to3
       FROM stock_phases sp
       JOIN symbols s ON sp.symbol = s.symbol
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
    ),
  );

  const transitionByGroup = new Map<
    string,
    { phase1to2: number; phase2to3: number }
  >();
  for (const row of transitionRows) {
    transitionByGroup.set(row.group_name, {
      phase1to2: toNum(row.p1to2),
      phase2to3: toNum(row.p2to3),
    });
  }

  // Step 5: Fundamental acceleration — single batch query
  const { rows: fundamentalRows } = await retryDatabaseOperation(() =>
    pool.query<{
      group_name: string;
      revenue_accel_ratio: string;
      income_accel_ratio: string;
      profitable_ratio: string;
    }>(
      `WITH latest_q AS (
        SELECT ${groupCol} AS group_name,
               qf.symbol, qf.revenue, qf.net_income, qf.eps_diluted,
               ROW_NUMBER() OVER (PARTITION BY qf.symbol ORDER BY qf.period_end_date DESC) as rn
        FROM quarterly_financials qf
        JOIN symbols s ON qf.symbol = s.symbol
        WHERE ${groupCol} = ANY($1)
          AND s.is_actively_trading = true
          AND s.is_etf = false
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
    ),
  );

  const fundamentalByGroup = new Map<
    string,
    { revenueAccelRatio: number; incomeAccelRatio: number; profitableRatio: number }
  >();
  for (const row of fundamentalRows) {
    fundamentalByGroup.set(row.group_name, {
      revenueAccelRatio: toNum(row.revenue_accel_ratio),
      incomeAccelRatio: toNum(row.income_accel_ratio),
      profitableRatio: toNum(row.profitable_ratio),
    });
  }

  // Step 6: Fetch previous group phases
  const prevGroupPhaseMap = new Map<string, Phase>();
  const { rows: prevRows } = await pool.query<{
    group_name: string;
    group_phase: number;
  }>(
    `SELECT ${groupColName} AS group_name, group_phase
     FROM ${outputTable}
     WHERE date = (SELECT MAX(date) FROM ${outputTable} WHERE date < $1)`,
    [targetDate],
  );
  for (const r of prevRows) {
    prevGroupPhaseMap.set(r.group_name, r.group_phase as Phase);
  }

  // Step 7: Assemble results
  const results: GroupRsRow[] = groupAvgs.map((g, idx) => {
    const hist = historicalRs.get(g.group_name) ?? {
      change4w: null,
      change8w: null,
      change12w: null,
    };
    const breadth = breadthByGroup.get(g.group_name) ?? {
      maOrderedRatio: 0,
      phase2Ratio: 0,
      rsAbove50Ratio: 0,
      newHighRatio: 0,
    };
    const transitions = transitionByGroup.get(g.group_name) ?? {
      phase1to2: 0,
      phase2to3: 0,
    };
    const fundamentals = fundamentalByGroup.get(g.group_name) ?? {
      revenueAccelRatio: 0,
      incomeAccelRatio: 0,
      profitableRatio: 0,
    };

    const groupPhase = detectGroupPhase({
      change4w: hist.change4w,
      change8w: hist.change8w,
      phase2Ratio: breadth.phase2Ratio,
    });

    return {
      date: targetDate,
      groupName: g.group_name,
      parentGroup: g.parent_group ?? undefined,
      avgRs: toNum(g.avg_rs),
      rsRank: idx + 1,
      stockCount: toNum(g.stock_count),
      ...hist,
      groupPhase,
      prevGroupPhase: prevGroupPhaseMap.get(g.group_name) ?? null,
      ...breadth,
      ...fundamentals,
      phase1to2Count5d: transitions.phase1to2,
      phase2to3Count5d: transitions.phase2to3,
    };
  });

  return results;
}
