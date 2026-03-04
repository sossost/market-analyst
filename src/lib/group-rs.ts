import { pool } from "@/db/client";
import { retryDatabaseOperation } from "@/etl/utils/retry";
import { toNum } from "@/etl/utils/common";
import { detectGroupPhase } from "@/lib/group-phase";
import type { GroupRsConfig, GroupRsRow, Phase } from "@/types";

/**
 * Build group-level RS data for sectors or industries.
 * Shared logic parameterized by groupBy field.
 */
export async function buildGroupRs(
  config: GroupRsConfig,
): Promise<GroupRsRow[]> {
  const { groupBy, minStockCount, targetDate } = config;
  const groupCol = groupBy === "sector" ? "s.sector" : "s.industry";

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
    console.log("No groups found with sufficient stock count.");
    return [];
  }

  console.log(`  Groups found: ${groupAvgs.length}`);

  // Assign RS rank (1 = highest avg RS)
  const groupNames = groupAvgs.map((g) => g.group_name);

  // Step 2: Fetch historical avg RS for acceleration (4w/8w/12w)
  const tradingDays = { "4w": 20, "8w": 40, "12w": 60 };
  const outputTable =
    groupBy === "sector" ? "sector_rs_daily" : "industry_rs_daily";
  const groupColName = groupBy;

  const historicalRs = new Map<
    string,
    { change4w: number | null; change8w: number | null; change12w: number | null }
  >();

  for (const group of groupNames) {
    const { rows } = await pool.query<{ date: string; avg_rs: string }>(
      `SELECT date, avg_rs FROM ${outputTable}
       WHERE ${groupColName} = $1 AND date < $2
       ORDER BY date DESC LIMIT 60`,
      [group, targetDate],
    );

    const currentAvg = toNum(
      groupAvgs.find((g) => g.group_name === group)?.avg_rs,
    );

    const get = (daysBack: number): number | null => {
      if (rows.length < daysBack) return null;
      return currentAvg - toNum(rows[daysBack - 1]?.avg_rs);
    };

    historicalRs.set(group, {
      change4w: get(tradingDays["4w"]),
      change8w: get(tradingDays["8w"]),
      change12w: get(tradingDays["12w"]),
    });
  }

  // Step 3: Breadth indicators per group
  const breadthByGroup = new Map<
    string,
    {
      maOrderedRatio: number;
      phase2Ratio: number;
      rsAbove50Ratio: number;
      newHighRatio: number;
    }
  >();

  for (const group of groupNames) {
    const { rows } = await pool.query<{
      ma_ordered_ratio: string;
      phase2_ratio: string;
      rs_above50_ratio: string;
      new_high_ratio: string;
    }>(
      `SELECT
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
              AND dp2.date > ($2::date - INTERVAL '20 days')::text
              AND dp2.date <= $2
          )
        )::numeric / NULLIF(COUNT(*), 0), 0) AS new_high_ratio
       FROM symbols s
       JOIN daily_prices dp ON s.symbol = dp.symbol AND dp.date = $2
       JOIN daily_ma dm ON s.symbol = dm.symbol AND dm.date = $2
       LEFT JOIN stock_phases sp ON s.symbol = sp.symbol AND sp.date = $2
       WHERE s.is_actively_trading = true
         AND s.is_etf = false
         AND ${groupCol} = $1`,
      [group, targetDate],
    );

    if (rows.length > 0) {
      breadthByGroup.set(group, {
        maOrderedRatio: toNum(rows[0].ma_ordered_ratio),
        phase2Ratio: toNum(rows[0].phase2_ratio),
        rsAbove50Ratio: toNum(rows[0].rs_above50_ratio),
        newHighRatio: toNum(rows[0].new_high_ratio),
      });
    }
  }

  // Step 4: Phase transition surge (5-day window)
  const transitionByGroup = new Map<
    string,
    { phase1to2: number; phase2to3: number }
  >();

  for (const group of groupNames) {
    const { rows } = await pool.query<{
      p1to2: string;
      p2to3: string;
    }>(
      `SELECT
        COUNT(*) FILTER (WHERE sp.prev_phase = 1 AND sp.phase = 2) AS p1to2,
        COUNT(*) FILTER (WHERE sp.prev_phase = 2 AND sp.phase = 3) AS p2to3
       FROM stock_phases sp
       JOIN symbols s ON sp.symbol = s.symbol
       WHERE ${groupCol} = $1
         AND sp.date > (
           SELECT date FROM (
             SELECT DISTINCT date FROM stock_phases
             WHERE date <= $2 ORDER BY date DESC LIMIT 5
           ) sub ORDER BY date ASC LIMIT 1
         )
         AND sp.date <= $2
         AND sp.prev_phase IS NOT NULL`,
      [group, targetDate],
    );

    if (rows.length > 0) {
      transitionByGroup.set(group, {
        phase1to2: toNum(rows[0].p1to2),
        phase2to3: toNum(rows[0].p2to3),
      });
    }
  }

  // Step 5: Fundamental acceleration per group
  const fundamentalByGroup = new Map<
    string,
    {
      revenueAccelRatio: number;
      incomeAccelRatio: number;
      profitableRatio: number;
    }
  >();

  for (const group of groupNames) {
    const { rows } = await pool.query<{
      revenue_accel_ratio: string;
      income_accel_ratio: string;
      profitable_ratio: string;
    }>(
      `WITH latest_q AS (
        SELECT qf.symbol, qf.revenue, qf.net_income, qf.eps_diluted,
               ROW_NUMBER() OVER (PARTITION BY qf.symbol ORDER BY qf.period_end_date DESC) as rn
        FROM quarterly_financials qf
        JOIN symbols s ON qf.symbol = s.symbol
        WHERE ${groupCol} = $1
          AND s.is_actively_trading = true
          AND s.is_etf = false
      )
      SELECT
        COALESCE(COUNT(*) FILTER (WHERE q1.revenue::numeric > q2.revenue::numeric AND q2.revenue::numeric > 0)::numeric
          / NULLIF(COUNT(*) FILTER (WHERE q2.revenue IS NOT NULL), 0), 0) AS revenue_accel_ratio,
        COALESCE(COUNT(*) FILTER (WHERE q1.net_income::numeric > q2.net_income::numeric AND q2.net_income::numeric > 0)::numeric
          / NULLIF(COUNT(*) FILTER (WHERE q2.net_income IS NOT NULL), 0), 0) AS income_accel_ratio,
        COALESCE(COUNT(*) FILTER (WHERE q1.eps_diluted::numeric > 0)::numeric
          / NULLIF(COUNT(*), 0), 0) AS profitable_ratio
      FROM latest_q q1
      LEFT JOIN latest_q q2 ON q1.symbol = q2.symbol AND q2.rn = q1.rn + 1
      WHERE q1.rn = 1`,
      [group],
    );

    if (rows.length > 0) {
      fundamentalByGroup.set(group, {
        revenueAccelRatio: toNum(rows[0].revenue_accel_ratio),
        incomeAccelRatio: toNum(rows[0].income_accel_ratio),
        profitableRatio: toNum(rows[0].profitable_ratio),
      });
    }
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
