import "dotenv/config";
import { pool } from "@/db/client";
import { assertValidEnvironment } from "@/etl/utils/validation";
import { getLatestPriceDate } from "@/etl/utils/date-helpers";
import { logger } from "@/lib/logger";
import {
  findPhaseCountsByDate,
  countSectorRsByDate,
  countIndustryRsByDate,
  findBreadthCheckByDate,
  countNullIndustrySymbols,
  findTopSectorsByDate,
  findKnownStocksByDate,
} from "@/db/repositories/index.js";

const TAG = "VALIDATE_DATA";

const MIN_EXPECTED_PHASES = 1_000;
const MIN_SECTOR_COUNT = 10;
const MIN_INDUSTRY_COUNT = 50;
const MIN_KNOWN_STOCKS_FOUND = 4;
const TOP_SECTOR_LIMIT = 3;

async function main() {
  assertValidEnvironment();

  const targetDate = await getLatestPriceDate();
  if (targetDate == null) {
    logger.error(TAG, "No trade date found. Exiting.");
    process.exit(1);
  }

  logger.info(TAG, `Validating data for: ${targetDate}`);
  let hasErrors = false;

  // 1. Stock phases count
  const phaseCounts = await findPhaseCountsByDate(targetDate);

  const totalPhases = phaseCounts.reduce((s, r) => s + Number(r.cnt), 0);
  logger.info(TAG, `Stock Phases: ${totalPhases} total`);
  for (const r of phaseCounts) {
    logger.info(TAG, `  Phase ${r.phase}: ${r.cnt}`);
  }

  if (totalPhases < MIN_EXPECTED_PHASES) {
    logger.error(TAG, `  ERROR: Expected at least ${MIN_EXPECTED_PHASES} stock phases`);
    hasErrors = true;
  }

  // 2. Sector RS count
  const sectorCountRow = await countSectorRsByDate(targetDate);
  const sectorCount = Number(sectorCountRow.cnt);
  logger.info(TAG, `Sector RS: ${sectorCount} rows`);

  if (sectorCount < MIN_SECTOR_COUNT) {
    logger.error(TAG, `  ERROR: Expected at least ${MIN_SECTOR_COUNT} sectors`);
    hasErrors = true;
  }

  // 3. Industry RS count
  const industryCountRow = await countIndustryRsByDate(targetDate);
  const industryCount = Number(industryCountRow.cnt);
  logger.info(TAG, `Industry RS: ${industryCount} rows`);

  if (industryCount < MIN_INDUSTRY_COUNT) {
    logger.error(TAG, `  ERROR: Expected at least ${MIN_INDUSTRY_COUNT} industries`);
    hasErrors = true;
  }

  // 4. Breadth values in valid range (0-1)
  const breadthCheck = await findBreadthCheckByDate(targetDate);

  if (breadthCheck != null) {
    const b = breadthCheck;
    const min_p2 = Number(b.min_p2);
    const max_p2 = Number(b.max_p2);
    const min_rs50 = Number(b.min_rs50);
    const max_rs50 = Number(b.max_rs50);

    logger.info(
      TAG,
      `Breadth ranges: phase2=[${min_p2.toFixed(2)}, ${max_p2.toFixed(2)}], rsAbove50=[${min_rs50.toFixed(2)}, ${max_rs50.toFixed(2)}]`,
    );

    if (min_p2 < 0 || max_p2 > 1 || min_rs50 < 0 || max_rs50 > 1) {
      logger.error(TAG, "  ERROR: Breadth values out of [0, 1] range");
      hasErrors = true;
    }
  }

  // 5. Null industry count in symbols
  const nullIndustryRow = await countNullIndustrySymbols();
  logger.info(
    TAG,
    `Symbols with null/empty industry: ${nullIndustryRow.cnt}`,
  );

  // 6. Top sector RS sanity
  const topSectors = await findTopSectorsByDate(targetDate, TOP_SECTOR_LIMIT);
  logger.info(TAG, "Top 3 sectors:");
  for (const s of topSectors) {
    logger.info(
      TAG,
      `  ${s.rs_rank}. ${s.sector}: RS=${Number(s.avg_rs).toFixed(1)}, Phase2=${(Number(s.p2) * 100).toFixed(0)}%`,
    );
  }

  // 7. Known stock check
  const knownStocks = ["AAPL", "NVDA", "MSFT", "TSLA", "META"];
  const knownResults = await findKnownStocksByDate(targetDate, knownStocks);
  logger.info(TAG, "Known stocks:");
  for (const r of knownResults) {
    logger.info(TAG, `  ${r.symbol}: Phase ${r.phase}, RS=${r.rs_score}`);
  }

  if (knownResults.length < MIN_KNOWN_STOCKS_FOUND) {
    logger.error(TAG, `  ERROR: Expected at least ${MIN_KNOWN_STOCKS_FOUND} known stocks`);
    hasErrors = true;
  }

  logger.info(TAG, hasErrors ? "Validation FAILED" : "Validation PASSED");
  await pool.end();

  if (hasErrors) process.exit(1);
}

main().catch((err) => {
  logger.error(TAG, `Validation failed: ${err instanceof Error ? err.message : String(err)}`);
  pool.end();
  process.exit(1);
});
