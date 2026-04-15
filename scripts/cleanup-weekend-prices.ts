/**
 * 주말 날짜 데이터 정리 스크립트.
 *
 * daily_prices에서 토/일 레코드를 삭제한다.
 * 파생 테이블(daily_ma, stock_phases 등)은 daily_prices 기반으로
 * 다음 ETL 사이클에서 자연 치유되므로 별도 정리하지 않는다.
 *
 * Usage:
 *   npx tsx scripts/cleanup-weekend-prices.ts --dry-run  # 대상 건수만 출력
 *   npx tsx scripts/cleanup-weekend-prices.ts             # 실제 삭제
 */
import "dotenv/config";
import { db, pool } from "../src/db/client.js";
import { sql } from "drizzle-orm";

const TAG = "CLEANUP_WEEKEND_PRICES";

async function main() {
  const isDryRun = process.argv.slice(2).includes("--dry-run");

  console.log(`[${TAG}] ${isDryRun ? "DRY RUN" : "LIVE"} mode`);

  const countResult = await db.execute(sql`
    SELECT COUNT(*) AS cnt
    FROM daily_prices
    WHERE EXTRACT(DOW FROM date) IN (0, 6)
  `);
  const count = Number((countResult.rows[0] as { cnt: string }).cnt);

  console.log(`[${TAG}] Found ${count} weekend records in daily_prices`);

  if (count === 0) {
    console.log(`[${TAG}] No weekend records to clean up`);
    return;
  }

  if (isDryRun) {
    const sampleResult = await db.execute(sql`
      SELECT date::text, symbol, close
      FROM daily_prices
      WHERE EXTRACT(DOW FROM date) IN (0, 6)
      ORDER BY date DESC
      LIMIT 10
    `);
    console.log(`[${TAG}] Sample weekend records:`);
    for (const row of sampleResult.rows) {
      console.log(`  ${JSON.stringify(row)}`);
    }
    return;
  }

  const deleteResult = await db.execute(sql`
    DELETE FROM daily_prices
    WHERE EXTRACT(DOW FROM date) IN (0, 6)
  `);
  console.log(`[${TAG}] Deleted ${deleteResult.rowCount} weekend records from daily_prices`);
}

main()
  .then(async () => {
    await pool.end();
    process.exit(0);
  })
  .catch(async (error) => {
    console.error(`[${TAG}] Failed:`, error);
    await pool.end();
    process.exit(1);
  });
