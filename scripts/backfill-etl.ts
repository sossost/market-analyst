/**
 * ETL 백필 스크립트.
 *
 * daily_prices에 데이터가 있지만 stock_phases에 없는 날짜를 찾아
 * ETL 3단계(stock-phases → sector-rs → industry-rs)를 순서대로 실행.
 *
 * Usage:
 *   npx tsx scripts/backfill-etl.ts                    # 누락된 모든 날짜 백필
 *   npx tsx scripts/backfill-etl.ts --from 2025-12-01  # 특정 날짜부터
 *   npx tsx scripts/backfill-etl.ts --limit 10         # 최대 10일만
 *   npx tsx scripts/backfill-etl.ts --dry-run           # 실행 없이 날짜만 출력
 */
import "dotenv/config";
import { execSync } from "child_process";
import { pool } from "../src/db/client.js";

interface Args {
  from: string | null;
  limit: number;
  dryRun: boolean;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  let from: string | null = null;
  let limit = 999;
  let dryRun = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--from" && args[i + 1] != null) {
      from = args[++i];
    } else if (args[i] === "--limit" && args[i + 1] != null) {
      limit = parseInt(args[++i], 10);
    } else if (args[i] === "--dry-run") {
      dryRun = true;
    }
  }

  return { from, limit, dryRun };
}

async function getMissingDates(from: string | null): Promise<string[]> {
  // daily_ma가 있는 날짜만 대상 (MA 없으면 Phase 계산 불가)
  const fromClause = from != null ? `AND dp.date >= '${from}'` : "";

  const { rows } = await pool.query<{ date: string }>(`
    SELECT DISTINCT dp.date::text AS date
    FROM daily_prices dp
    INNER JOIN daily_ma dm ON dm.date = dp.date AND dm.symbol = dp.symbol
    WHERE NOT EXISTS (
      SELECT 1 FROM stock_phases sp WHERE sp.date = dp.date
    )
    ${fromClause}
    ORDER BY dp.date ASC
  `);

  return rows.map((r) => r.date);
}

function runETLForDate(date: string): void {
  const env = { ...process.env, TARGET_DATE: date };
  const opts = { stdio: "inherit" as const, env };

  console.log(`\n${"=".repeat(60)}`);
  console.log(`[${date}] Running ETL...`);
  console.log(`${"=".repeat(60)}`);

  try {
    console.log(`  [1/3] stock-phases...`);
    execSync("npx tsx src/etl/jobs/build-stock-phases.ts", opts);

    console.log(`  [2/3] sector-rs...`);
    execSync("npx tsx src/etl/jobs/build-sector-rs.ts", opts);

    console.log(`  [3/3] industry-rs...`);
    execSync("npx tsx src/etl/jobs/build-industry-rs.ts", opts);

    console.log(`  [${date}] Done`);
  } catch (err) {
    console.error(`  [${date}] FAILED: ${err instanceof Error ? err.message : String(err)}`);
    throw err;
  }
}

async function main() {
  const args = parseArgs();

  console.log("=== ETL Backfill ===");
  console.log(`From: ${args.from ?? "(all missing)"}`);
  console.log(`Limit: ${args.limit}`);
  console.log(`Dry run: ${args.dryRun}`);

  const missingDates = await getMissingDates(args.from);
  const targetDates = missingDates.slice(0, args.limit);

  console.log(`\nMissing dates: ${missingDates.length} total, processing ${targetDates.length}`);

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

  // 백필 시작 전 pool 해제 (자식 프로세스가 자체 connection 사용)
  await pool.end();

  let completed = 0;
  const startTime = Date.now();

  for (const date of targetDates) {
    runETLForDate(date);
    completed++;
    const elapsed = (Date.now() - startTime) / 1000;
    const avg = elapsed / completed;
    const remaining = (targetDates.length - completed) * avg;
    console.log(`  Progress: ${completed}/${targetDates.length} (ETA: ${(remaining / 60).toFixed(1)}min)`);
  }

  const totalMin = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  console.log(`\n=== Backfill complete: ${completed} dates in ${totalMin}min ===`);
}

main().catch((err) => {
  console.error("Backfill failed:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
