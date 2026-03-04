import "dotenv/config";
import { pool } from "@/db/client";
import { assertValidEnvironment } from "@/etl/utils/validation";
import { getLatestTradeDate } from "@/etl/utils/date-helpers";

async function main() {
  assertValidEnvironment();

  const targetDate = await getLatestTradeDate();
  if (targetDate == null) {
    console.error("No trade date found. Exiting.");
    process.exit(1);
  }

  console.log(`Validating data for: ${targetDate}\n`);
  let hasErrors = false;

  // 1. Stock phases count
  const { rows: phaseCounts } = await pool.query(
    `SELECT phase, COUNT(*) as cnt
     FROM stock_phases WHERE date = $1
     GROUP BY phase ORDER BY phase`,
    [targetDate],
  );

  const totalPhases = phaseCounts.reduce((s, r) => s + Number(r.cnt), 0);
  console.log(`Stock Phases: ${totalPhases} total`);
  for (const r of phaseCounts) {
    console.log(`  Phase ${r.phase}: ${r.cnt}`);
  }

  if (totalPhases < 1000) {
    console.error("  ERROR: Expected at least 1000 stock phases");
    hasErrors = true;
  }

  // 2. Sector RS count
  const { rows: sectorRows } = await pool.query(
    `SELECT COUNT(*) as cnt FROM sector_rs_daily WHERE date = $1`,
    [targetDate],
  );
  const sectorCount = Number(sectorRows[0].cnt);
  console.log(`\nSector RS: ${sectorCount} rows`);

  if (sectorCount < 10) {
    console.error("  ERROR: Expected at least 10 sectors");
    hasErrors = true;
  }

  // 3. Industry RS count
  const { rows: industryRows } = await pool.query(
    `SELECT COUNT(*) as cnt FROM industry_rs_daily WHERE date = $1`,
    [targetDate],
  );
  const industryCount = Number(industryRows[0].cnt);
  console.log(`Industry RS: ${industryCount} rows`);

  if (industryCount < 50) {
    console.error("  ERROR: Expected at least 50 industries");
    hasErrors = true;
  }

  // 4. Breadth values in valid range (0-1)
  const { rows: breadthCheck } = await pool.query(
    `SELECT
      MIN(phase2_ratio::numeric) as min_p2,
      MAX(phase2_ratio::numeric) as max_p2,
      MIN(rs_above50_ratio::numeric) as min_rs50,
      MAX(rs_above50_ratio::numeric) as max_rs50
     FROM sector_rs_daily WHERE date = $1`,
    [targetDate],
  );

  if (breadthCheck.length > 0) {
    const b = breadthCheck[0];
    const min_p2 = Number(b.min_p2);
    const max_p2 = Number(b.max_p2);
    const min_rs50 = Number(b.min_rs50);
    const max_rs50 = Number(b.max_rs50);

    console.log(
      `\nBreadth ranges: phase2=[${min_p2.toFixed(2)}, ${max_p2.toFixed(2)}], rsAbove50=[${min_rs50.toFixed(2)}, ${max_rs50.toFixed(2)}]`,
    );

    if (min_p2 < 0 || max_p2 > 1 || min_rs50 < 0 || max_rs50 > 1) {
      console.error("  ERROR: Breadth values out of [0, 1] range");
      hasErrors = true;
    }
  }

  // 5. Null industry count in symbols
  const { rows: nullIndustry } = await pool.query(
    `SELECT COUNT(*) as cnt FROM symbols
     WHERE is_actively_trading = true AND is_etf = false
       AND (industry IS NULL OR industry = '')`,
  );
  console.log(
    `\nSymbols with null/empty industry: ${nullIndustry[0].cnt}`,
  );

  // 6. Top sector RS sanity
  const { rows: topSectors } = await pool.query(
    `SELECT sector, avg_rs::numeric as avg_rs, rs_rank, phase2_ratio::numeric as p2
     FROM sector_rs_daily WHERE date = $1
     ORDER BY rs_rank LIMIT 3`,
    [targetDate],
  );
  console.log("\nTop 3 sectors:");
  for (const s of topSectors) {
    console.log(
      `  ${s.rs_rank}. ${s.sector}: RS=${Number(s.avg_rs).toFixed(1)}, Phase2=${(Number(s.p2) * 100).toFixed(0)}%`,
    );
  }

  // 7. Known stock check
  const knownStocks = ["AAPL", "NVDA", "MSFT", "TSLA", "META"];
  const { rows: knownResults } = await pool.query(
    `SELECT symbol, phase, rs_score FROM stock_phases
     WHERE date = $1 AND symbol = ANY($2)
     ORDER BY symbol`,
    [targetDate, knownStocks],
  );
  console.log("\nKnown stocks:");
  for (const r of knownResults) {
    console.log(`  ${r.symbol}: Phase ${r.phase}, RS=${r.rs_score}`);
  }

  if (knownResults.length < 4) {
    console.error("  ERROR: Expected at least 4 known stocks");
    hasErrors = true;
  }

  console.log(hasErrors ? "\nValidation FAILED" : "\nValidation PASSED");
  await pool.end();

  if (hasErrors) process.exit(1);
}

main().catch((err) => {
  console.error("Validation failed:", err);
  pool.end();
  process.exit(1);
});
