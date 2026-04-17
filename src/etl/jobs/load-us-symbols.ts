import "dotenv/config";
import { db, pool } from "@/db/client";
import { sql } from "drizzle-orm";
import { symbols } from "@/db/schema/market";
import {
  validateEnvironmentVariables,
  validateSymbolData,
} from "@/etl/utils/validation";
import { retryApiCall, DEFAULT_RETRY_OPTIONS } from "@/etl/utils/retry";
import { fetchJson, isValidTicker } from "@/etl/utils/common";
import { logger } from "@/lib/logger";
import { SHELL_COMPANIES_INDUSTRY } from "@/lib/constants";

const TAG = "LOAD_US_SYMBOLS";
const EXCLUDED_INDUSTRIES = [SHELL_COMPANIES_INDUSTRY];

const API = process.env.DATA_API! + "/stable";
const KEY = process.env.FMP_API_KEY!;

type SymbolRow = {
  symbol: string;
  companyName?: string;
  marketCap?: number;
  sector?: string;
  industry?: string;
  beta?: number;
  price?: number;
  lastAnnualDividend?: number;
  volume?: number;
  exchange?: string;
  exchangeShortName?: string;
  country?: string;
  isEtf?: boolean;
  isFund?: boolean;
  isActivelyTrading?: boolean;
};

const SUPPORTED_EXCHANGES = ["NASDAQ", "NYSE", "AMEX"];

async function main() {
  logger.info(TAG, "Starting US symbols ETL (NASDAQ, NYSE, AMEX)...");

  const envValidation = validateEnvironmentVariables();
  if (!envValidation.isValid) {
    logger.error(TAG, `Environment validation failed: ${JSON.stringify(envValidation.errors)}`);
    process.exit(1);
  }

  if (envValidation.warnings.length > 0) {
    logger.warn(TAG, `Environment warnings: ${JSON.stringify(envValidation.warnings)}`);
  }

  logger.info(TAG, `Fetching symbols from ${SUPPORTED_EXCHANGES.join(", ")}...`);

  const results = await Promise.all(
    SUPPORTED_EXCHANGES.map(async (exchange) => {
      const list = await retryApiCall(
        () =>
          fetchJson<SymbolRow[]>(
            `${API}/company-screener?exchange=${exchange}&limit=10000&apikey=${KEY}`,
          ),
        DEFAULT_RETRY_OPTIONS,
      );
      logger.info(TAG, `  → ${list.length} symbols from ${exchange}`);
      return list;
    }),
  );

  const allSymbols = results.flat();
  logger.info(TAG, `Fetched ${allSymbols.length} total symbols from API`);

  const validSymbols = allSymbols
    .filter((r) => SUPPORTED_EXCHANGES.includes(r.exchangeShortName ?? ""))
    .filter((r) => {
      return (
        r.symbol != null &&
        isValidTicker(r.symbol) &&
        !r.isEtf &&
        !r.isFund &&
        !EXCLUDED_INDUSTRIES.includes(r.industry ?? "")
      );
    });

  logger.info(TAG, `Filtered to ${validSymbols.length} valid US symbols`);

  const validatedSymbols: SymbolRow[] = [];
  const skippedSymbols: string[] = [];

  for (const symbol of validSymbols) {
    const result = validateSymbolData(symbol as unknown as Record<string, unknown>);
    if (result.isValid) {
      validatedSymbols.push(symbol);
    } else {
      skippedSymbols.push(`${symbol.symbol}: ${result.errors.join(", ")}`);
    }
  }

  if (skippedSymbols.length > 0) {
    logger.warn(
      TAG,
      `${skippedSymbols.length} items skipped: ${JSON.stringify(skippedSymbols.slice(0, 5))}`,
    );
  }

  if (validatedSymbols.length === 0) {
    logger.error(TAG, "No valid symbols. Aborting.");
    process.exit(1);
  }

  logger.info(
    TAG,
    `${validatedSymbols.length}/${validSymbols.length} symbols validated`,
  );

  const batchSize = 100;
  let processedCount = 0;

  for (let i = 0; i < validatedSymbols.length; i += batchSize) {
    const batch = validatedSymbols.slice(i, i + batchSize);
    logger.info(
      TAG,
      `Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(validatedSymbols.length / batchSize)}`,
    );

    const insertValues = batch.map((r) => ({
      symbol: r.symbol,
      companyName: r.companyName ?? null,
      marketCap: r.marketCap?.toString() ?? null,
      sector: r.sector ?? null,
      industry: r.industry ?? null,
      beta: r.beta?.toString() ?? null,
      price: r.price?.toString() ?? null,
      lastAnnualDividend: r.lastAnnualDividend?.toString() ?? null,
      volume: r.volume?.toString() ?? null,
      exchange: r.exchange ?? null,
      exchangeShortName: r.exchangeShortName ?? null,
      country: r.country ?? null,
      isEtf: r.isEtf ?? false,
      isFund: r.isFund ?? false,
      isActivelyTrading: r.isActivelyTrading ?? true,
    }));

    await db
      .insert(symbols)
      .values(insertValues)
      .onConflictDoUpdate({
        target: symbols.symbol,
        set: {
          companyName: sql`EXCLUDED.company_name`,
          marketCap: sql`EXCLUDED.market_cap`,
          sector: sql`EXCLUDED.sector`,
          industry: sql`EXCLUDED.industry`,
          beta: sql`EXCLUDED.beta`,
          price: sql`EXCLUDED.price`,
          lastAnnualDividend: sql`EXCLUDED.last_annual_dividend`,
          volume: sql`EXCLUDED.volume`,
          exchange: sql`EXCLUDED.exchange`,
          exchangeShortName: sql`EXCLUDED.exchange_short_name`,
          country: sql`EXCLUDED.country`,
          isEtf: sql`EXCLUDED.is_etf`,
          isFund: sql`EXCLUDED.is_fund`,
          isActivelyTrading: sql`EXCLUDED.is_actively_trading`,
        },
      });

    processedCount += batch.length;
  }

  logger.info(TAG, `Successfully processed ${processedCount} US symbols`);
}

main()
  .then(async () => {
    logger.info(TAG, "US symbols ETL completed successfully!");
    await pool.end();
    process.exit(0);
  })
  .catch(async (error) => {
    logger.error(TAG, `US symbols ETL failed: ${error instanceof Error ? error.message : String(error)}`);
    await pool.end();
    process.exit(1);
  });

export { main as loadUSSymbols };
