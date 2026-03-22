import { retryDatabaseOperation } from "@/etl/utils/retry";
import { toNum } from "@/etl/utils/common";
import { detectGroupPhase } from "@/lib/group-phase";
import type { GroupBy, GroupRsConfig, GroupRsRow, Phase } from "@/types";
import { logger } from "@/lib/logger";
import {
  findGroupAvgs,
  findGroupHistoricalRs,
  findGroupBreadth,
  findGroupTransitions,
  findGroupFundamentals,
  findGroupPrevPhases,
} from "@/db/repositories/index.js";

const TAG = "GROUP_RS";

/**
 * Build group-level RS data for sectors or industries.
 * Shared logic parameterized by groupBy field.
 */
export async function buildGroupRs(
  config: GroupRsConfig,
): Promise<GroupRsRow[]> {
  const { groupBy, minStockCount, targetDate } = config;

  // Step 1: RS average + ranking per group
  const groupAvgs = await retryDatabaseOperation(() =>
    findGroupAvgs(groupBy, targetDate, minStockCount),
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

  const histRows = await retryDatabaseOperation(() =>
    findGroupHistoricalRs(groupBy, groupNames, targetDate),
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
  const breadthRows = await retryDatabaseOperation(() =>
    findGroupBreadth(groupBy, targetDate, groupNames),
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
  const transitionRows = await retryDatabaseOperation(() =>
    findGroupTransitions(groupBy, groupNames, targetDate),
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
  const fundamentalRows = await retryDatabaseOperation(() =>
    findGroupFundamentals(groupBy, groupNames),
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
  const prevRows = await findGroupPrevPhases(groupBy, targetDate);
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
