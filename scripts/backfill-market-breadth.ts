/**
 * market_breadth_daily 백필 스크립트.
 *
 * stock_phases에는 데이터가 있지만 market_breadth_daily에 없는 날짜를 찾아
 * build-market-breadth ETL job을 순차 실행한다.
 *
 * 날짜 순 오름차순 처리 (phase2_ratio_change 계산이 전일 행에 의존).
 *
 * Usage:
 *   npx tsx scripts/backfill-market-breadth.ts                   # 누락된 모든 날짜 백필
 *   npx tsx scripts/backfill-market-breadth.ts --from 2025-12-01 # 특정 날짜부터
 *   npx tsx scripts/backfill-market-breadth.ts --limit 10        # 최대 10일만
 *   npx tsx scripts/backfill-market-breadth.ts --dry-run          # 대상 날짜만 출력
 */
import "dotenv/config";
import { pool } from "../src/db/client.js";
import { buildMarketBreadth } from "../src/etl/jobs/build-market-breadth.js";

interface Args {
  from: string | null;
  limit: number;
  dryRun: boolean;
}

const DATE_FORMAT_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_BACKFILL_LIMIT = 9_999;

function parseArgs(): Args {
  const args = process.argv.slice(2);
  let from: string | null = null;
  let limit = DEFAULT_BACKFILL_LIMIT;
  let dryRun = false;

  for (let i = 0; i < args.length; i++) {
    const nextArg = args[i + 1];
    if (args[i] === "--from" && nextArg != null && !nextArg.startsWith("--")) {
      from = args[++i];
    } else if (args[i] === "--limit" && nextArg != null && !nextArg.startsWith("--")) {
      const num = parseInt(args[++i], 10);
      if (!Number.isNaN(num)) limit = num;
    } else if (args[i] === "--dry-run") {
      dryRun = true;
    }
  }

  if (from != null && !DATE_FORMAT_REGEX.test(from)) {
    console.error(`ERROR: --from 값은 YYYY-MM-DD 형식이어야 합니다. 받은 값: "${from}"`);
    process.exit(1);
  }

  if (limit != null && (isNaN(limit) || limit <= 0)) {
    console.error(`ERROR: --limit 값은 양의 정수여야 합니다.`);
    process.exit(1);
  }

  return { from, limit, dryRun };
}

async function getMissingDates(from: string | null, limit: number): Promise<string[]> {
  const fromDate = from ?? '1970-01-01';
  const { rows } = await pool.query<{ date: string }>(
    `SELECT DISTINCT sp.date::text AS date
     FROM stock_phases sp
     WHERE sp.date >= $1
       AND NOT EXISTS (
         SELECT 1 FROM market_breadth_daily mbd WHERE mbd.date = sp.date
       )
     ORDER BY date ASC
     LIMIT $2`,
    [fromDate, limit],
  );

  return rows.map((r) => r.date);
}

async function main() {
  const args = parseArgs();

  console.log("=== Market Breadth Backfill ===");
  console.log(`From: ${args.from ?? "(all missing)"}`);
  console.log(`Limit: ${args.limit}`);
  console.log(`Dry run: ${args.dryRun}`);

  const targetDates = await getMissingDates(args.from, args.limit);

  console.log(`\nProcessing ${targetDates.length} missing dates (limit: ${args.limit})`);

  if (targetDates.length === 0) {
    console.log("Nothing to backfill.");
    await pool.end();
    return;
  }

  console.log(`Dates: ${targetDates[0]} ~ ${targetDates[targetDates.length - 1]}`);

  if (args.dryRun) {
    for (const date of targetDates) {
      console.log(`  ${date}`);
    }
    await pool.end();
    return;
  }

  let completed = 0;
  let failed = 0;
  const startTime = Date.now();

  for (const date of targetDates) {
    try {
      await buildMarketBreadth(date);
      completed++;
    } catch (err) {
      failed++;
      console.error(
        `  [${date}] FAILED: ${err instanceof Error ? err.message : String(err)} — skipping`,
      );
    }

    const elapsed = (Date.now() - startTime) / 1000;
    const processed = completed + failed;
    const avg = elapsed / processed;
    const remaining = (targetDates.length - processed) * avg;
    console.log(
      `  Progress: ${processed}/${targetDates.length} (ok=${completed} fail=${failed} ETA: ${(remaining / 60).toFixed(1)}min)`,
    );
  }

  console.log(`\n=== Backfill Complete ===`);
  console.log(`Completed: ${completed}, Failed: ${failed}`);

  await pool.end();
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
