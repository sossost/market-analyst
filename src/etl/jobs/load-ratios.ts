import "dotenv/config";
import pLimit from "p-limit";
import { db, pool } from "@/db/client";
import { eq } from "drizzle-orm";
import { fetchJson, sleep, toStrNum } from "@/etl/utils/common";
import { asQuarter } from "@/etl/utils/date";
import { quarterlyRatios, symbols } from "@/db/schema/market";
import {
  validateEnvironmentVariables,
  validateRatioData,
} from "@/etl/utils/validation";
import {
  retryApiCall,
  retryDatabaseOperation,
  DEFAULT_RETRY_OPTIONS,
} from "@/etl/utils/retry";
import { logger } from "@/lib/logger";

const TAG = "LOAD_RATIOS";

const API = process.env.DATA_API! + "/stable";
const KEY = process.env.FMP_API_KEY!;
const CONCURRENCY = 4;
const PAUSE_MS = 200;
const LIMIT_Q = 12;

async function upsertRatios(sym: string, row: Record<string, unknown>) {
  const date = row.date as string;
  const asQ = asQuarter(date);

  const ratioData = {
    symbol: sym,
    periodEndDate: date,
    asOfQ: asQ,

    peRatio: toStrNum(row.priceToEarningsRatio),
    pegRatio: toStrNum(row.priceToEarningsGrowthRatio),
    fwdPegRatio: toStrNum(row.forwardPriceToEarningsGrowthRatio),
    psRatio: toStrNum(row.priceToSalesRatio),
    pbRatio: toStrNum(row.priceToBookRatio),
    evEbitda: toStrNum(row.enterpriseValueMultiple),

    grossMargin: toStrNum(row.grossProfitMargin),
    opMargin: toStrNum(row.operatingProfitMargin),
    netMargin: toStrNum(row.netProfitMargin),

    debtEquity: toStrNum(row.debtToEquityRatio),
    debtAssets: toStrNum(row.debtToAssetsRatio),
    debtMktCap: toStrNum(row.debtToMarketCap),
    intCoverage: toStrNum(row.interestCoverageRatio),

    pOCFRatio: toStrNum(row.priceToOperatingCashFlowRatio),
    pFCFRatio: toStrNum(row.priceToFreeCashFlowRatio),
    ocfRatio: toStrNum(row.operatingCashFlowRatio),
    fcfPerShare: toStrNum(row.freeCashFlowPerShare),

    divYield: toStrNum(row.dividendYield),
    payoutRatio: toStrNum(row.dividendPayoutRatio),
  };

  const validationResult = validateRatioData(ratioData);
  if (!validationResult.isValid) {
    logger.warn(
      TAG,
      `Ratio validation warnings for ${sym} (${date}): ${JSON.stringify(validationResult.errors)}`,
    );
  }

  await retryDatabaseOperation(
    () =>
      db
        .insert(quarterlyRatios)
        .values(ratioData)
        .onConflictDoUpdate({
          target: [quarterlyRatios.symbol, quarterlyRatios.periodEndDate],
          set: {
            peRatio: ratioData.peRatio,
            pegRatio: ratioData.pegRatio,
            fwdPegRatio: ratioData.fwdPegRatio,
            psRatio: ratioData.psRatio,
            pbRatio: ratioData.pbRatio,
            evEbitda: ratioData.evEbitda,
            grossMargin: ratioData.grossMargin,
            opMargin: ratioData.opMargin,
            netMargin: ratioData.netMargin,
            debtEquity: ratioData.debtEquity,
            debtAssets: ratioData.debtAssets,
            debtMktCap: ratioData.debtMktCap,
            intCoverage: ratioData.intCoverage,
            pOCFRatio: ratioData.pOCFRatio,
            pFCFRatio: ratioData.pFCFRatio,
            ocfRatio: ratioData.ocfRatio,
            fcfPerShare: ratioData.fcfPerShare,
            divYield: ratioData.divYield,
            payoutRatio: ratioData.payoutRatio,
          },
        }),
    DEFAULT_RETRY_OPTIONS,
  );
}

async function loadOne(symbol: string) {
  logger.info(TAG, `Loading ratios for ${symbol}`);

  const rows: Record<string, unknown>[] = await retryApiCall(
    () =>
      fetchJson<Record<string, unknown>[]>(
        `${API}/ratios?symbol=${symbol}&period=quarter&limit=${LIMIT_Q}&apikey=${KEY}`,
      ),
    DEFAULT_RETRY_OPTIONS,
  ).catch((e) => {
    logger.error(TAG, `Failed to fetch ratios for ${symbol}: ${e instanceof Error ? e.message : String(e)}`);
    return [] as Record<string, unknown>[];
  });

  if (rows.length === 0) {
    throw new Error(`No ratio data available for ${symbol}`);
  }

  rows.sort((a, b) => ((a.date as string) < (b.date as string) ? 1 : -1));

  for (const r of rows) {
    await upsertRatios(symbol, r);
  }

  logger.info(TAG, `Loaded ${rows.length} ratio records for ${symbol}`);
}

async function main() {
  logger.info(TAG, "Starting Financial Ratios ETL...");

  const envValidation = validateEnvironmentVariables();
  if (!envValidation.isValid) {
    logger.error(TAG, `Environment validation failed: ${JSON.stringify(envValidation.errors)}`);
    process.exit(1);
  }

  const activeSymbols = await db
    .select({ symbol: symbols.symbol })
    .from(symbols)
    .where(eq(symbols.isActivelyTrading, true));

  const syms: string[] = activeSymbols.map((s) => s.symbol);

  if (syms.length === 0) {
    throw new Error("No active symbols found. Run 'symbols' job first.");
  }

  logger.info(TAG, `Processing ${syms.length} active symbols`);

  const limit = pLimit(CONCURRENCY);
  let done = 0;
  let skip = 0;
  const startTime = Date.now();

  await Promise.all(
    syms.map((sym) =>
      limit(async () => {
        try {
          await loadOne(sym);
          done++;
          if (done % 50 === 0) {
            logger.info(TAG, `Progress: ${done}/${syms.length} (${sym})`);
          }
        } catch (e: unknown) {
          skip++;
          const message = e instanceof Error ? e.message : String(e);
          logger.warn(TAG, `Skipped ${sym}: ${message}`);
        } finally {
          await sleep(PAUSE_MS);
        }
      }),
    ),
  );

  const totalTime = Date.now() - startTime;
  logger.info(TAG, `Financial Ratios ETL completed! ${done} ok, ${skip} skipped (${Math.round(totalTime / 1000)}s)`);
}

main()
  .then(async () => {
    await pool.end();
    process.exit(0);
  })
  .catch(async (error) => {
    logger.error(TAG, `Financial Ratios ETL failed: ${error instanceof Error ? error.message : String(error)}`);
    await pool.end();
    process.exit(1);
  });

export { main as loadRatios };
