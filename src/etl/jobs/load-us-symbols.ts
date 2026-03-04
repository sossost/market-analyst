import "dotenv/config";
import { db, pool } from "@/db/client";
import { symbols } from "@/db/schema/screener";
import {
  validateEnvironmentVariables,
  validateSymbolData,
} from "@/etl/utils/validation";
import { retryApiCall, DEFAULT_RETRY_OPTIONS } from "@/etl/utils/retry";
import { fetchJson } from "@/etl/utils/common";

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
  console.log("🚀 Starting US symbols ETL (NASDAQ, NYSE, AMEX)...");

  const envValidation = validateEnvironmentVariables();
  if (!envValidation.isValid) {
    console.error("❌ Environment validation failed:", envValidation.errors);
    process.exit(1);
  }

  if (envValidation.warnings.length > 0) {
    console.warn("⚠️ Environment warnings:", envValidation.warnings);
  }

  console.log(`📡 Fetching symbols from ${SUPPORTED_EXCHANGES.join(", ")}...`);

  const results = await Promise.all(
    SUPPORTED_EXCHANGES.map(async (exchange) => {
      const list = await retryApiCall(
        () =>
          fetchJson<SymbolRow[]>(
            `${API}/company-screener?exchange=${exchange}&limit=10000&apikey=${KEY}`,
          ),
        DEFAULT_RETRY_OPTIONS,
      );
      console.log(`  → ${list.length} symbols from ${exchange}`);
      return list;
    }),
  );

  const allSymbols = results.flat();
  console.log(`📊 Fetched ${allSymbols.length} total symbols from API`);

  const validSymbols = allSymbols
    .filter((r) => SUPPORTED_EXCHANGES.includes(r.exchangeShortName ?? ""))
    .filter((r) => {
      const symbol = r.symbol;
      return (
        symbol != null &&
        /^[A-Z]{1,5}$/.test(symbol) &&
        !symbol.endsWith("W") &&
        !symbol.endsWith("X") &&
        !symbol.includes(".") &&
        !symbol.endsWith("U") &&
        !symbol.endsWith("WS") &&
        !r.isEtf &&
        !r.isFund
      );
    });

  console.log(`📈 Filtered to ${validSymbols.length} valid US symbols`);

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
    console.warn(
      `⚠️ ${skippedSymbols.length} items skipped:`,
      skippedSymbols.slice(0, 5),
    );
  }

  if (validatedSymbols.length === 0) {
    console.error("❌ No valid symbols. Aborting.");
    process.exit(1);
  }

  console.log(
    `✅ ${validatedSymbols.length}/${validSymbols.length} symbols validated`,
  );

  const batchSize = 100;
  let processedCount = 0;

  for (let i = 0; i < validatedSymbols.length; i += batchSize) {
    const batch = validatedSymbols.slice(i, i + batchSize);
    console.log(
      `📊 Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(validatedSymbols.length / batchSize)}`,
    );

    for (const r of batch) {
      const row = {
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
        createdAt: new Date(),
      };

      await db
        .insert(symbols)
        .values(row)
        .onConflictDoUpdate({
          target: symbols.symbol,
          set: {
            ...row,
            createdAt: new Date(),
          },
        });

      processedCount++;
    }
  }

  console.log(`✅ Successfully processed ${processedCount} US symbols`);
}

main()
  .then(async () => {
    console.log("✅ US symbols ETL completed successfully!");
    await pool.end();
    process.exit(0);
  })
  .catch(async (error) => {
    console.error("❌ US symbols ETL failed:", error);
    await pool.end();
    process.exit(1);
  });

export { main as loadUSSymbols };
