import "dotenv/config";
import { db, pool } from "@/db/client";
import { sectorRsDaily } from "@/db/schema/analyst";
import { buildGroupRs } from "@/lib/group-rs";
import { assertValidEnvironment } from "@/etl/utils/validation";
import { getLatestPriceDate } from "@/etl/utils/date-helpers";
import { retryDatabaseOperation } from "@/etl/utils/retry";
import { chunk } from "@/etl/utils/common";
import { sql } from "drizzle-orm";
import { logger } from "@/agent/logger";

const TAG = "BUILD_SECTOR_RS";

const MIN_STOCK_COUNT = 10;

async function main() {
  assertValidEnvironment();

  const targetDate = await getLatestPriceDate();
  if (targetDate == null) {
    logger.error(TAG, "No trade date found. Exiting.");
    process.exit(1);
  }

  logger.info(TAG, `build-sector-rs: target date = ${targetDate}`);

  const results = await buildGroupRs({
    groupBy: "sector",
    minStockCount: MIN_STOCK_COUNT,
    targetDate,
  });

  logger.info(TAG, `  Upserting ${results.length} sector rows...`);

  const batches = chunk(results, 20);
  for (const batch of batches) {
    const values = batch.map((r) => ({
      date: r.date,
      sector: r.groupName,
      avgRs: String(r.avgRs),
      rsRank: r.rsRank,
      stockCount: r.stockCount,
      change4w: r.change4w != null ? String(r.change4w) : null,
      change8w: r.change8w != null ? String(r.change8w) : null,
      change12w: r.change12w != null ? String(r.change12w) : null,
      groupPhase: r.groupPhase,
      prevGroupPhase: r.prevGroupPhase,
      maOrderedRatio: String(r.maOrderedRatio),
      phase2Ratio: String(r.phase2Ratio),
      rsAbove50Ratio: String(r.rsAbove50Ratio),
      newHighRatio: String(r.newHighRatio),
      phase1to2Count5d: r.phase1to2Count5d,
      phase2to3Count5d: r.phase2to3Count5d,
      revenueAccelRatio: String(r.revenueAccelRatio),
      incomeAccelRatio: String(r.incomeAccelRatio),
      profitableRatio: String(r.profitableRatio),
    }));

    await retryDatabaseOperation(() =>
      db
        .insert(sectorRsDaily)
        .values(values)
        .onConflictDoUpdate({
          target: [sectorRsDaily.date, sectorRsDaily.sector],
          set: {
            avgRs: sql`EXCLUDED.avg_rs`,
            rsRank: sql`EXCLUDED.rs_rank`,
            stockCount: sql`EXCLUDED.stock_count`,
            change4w: sql`EXCLUDED.change_4w`,
            change8w: sql`EXCLUDED.change_8w`,
            change12w: sql`EXCLUDED.change_12w`,
            groupPhase: sql`EXCLUDED.group_phase`,
            prevGroupPhase: sql`EXCLUDED.prev_group_phase`,
            maOrderedRatio: sql`EXCLUDED.ma_ordered_ratio`,
            phase2Ratio: sql`EXCLUDED.phase2_ratio`,
            rsAbove50Ratio: sql`EXCLUDED.rs_above50_ratio`,
            newHighRatio: sql`EXCLUDED.new_high_ratio`,
            phase1to2Count5d: sql`EXCLUDED.phase1to2_count_5d`,
            phase2to3Count5d: sql`EXCLUDED.phase2to3_count_5d`,
            revenueAccelRatio: sql`EXCLUDED.revenue_accel_ratio`,
            incomeAccelRatio: sql`EXCLUDED.income_accel_ratio`,
            profitableRatio: sql`EXCLUDED.profitable_ratio`,
          },
        }),
    );
  }

  logger.info(TAG, `  Done. Sectors: ${results.length}`);

  // Print top 5 by RS rank
  const top5 = results.slice(0, 5);
  logger.info(TAG, "Top 5 sectors by RS:");
  for (const s of top5) {
    logger.info(
      TAG,
      `  ${s.rsRank}. ${s.groupName}: avgRS=${s.avgRs.toFixed(1)}, phase2=${(s.phase2Ratio * 100).toFixed(0)}%, groupPhase=${s.groupPhase}`,
    );
  }

  await pool.end();
}

main().catch((err) => {
  logger.error(TAG, `build-sector-rs failed: ${err instanceof Error ? err.message : String(err)}`);
  pool.end();
  process.exit(1);
});
