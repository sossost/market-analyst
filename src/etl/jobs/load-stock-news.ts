import "dotenv/config";
import pLimit from "p-limit";
import { db, pool } from "@/db/client";
import { sql } from "drizzle-orm";
import { fetchJson, getFmpV3Config, sleep } from "@/etl/utils/common";
import { stockNews } from "@/db/schema/analyst";
import { validateEnvironmentVariables } from "@/etl/utils/validation";
import {
  retryApiCall,
  retryDatabaseOperation,
  DEFAULT_RETRY_OPTIONS,
} from "@/etl/utils/retry";
import { logger } from "@/lib/logger";

const TAG = "LOAD_STOCK_NEWS";

const CONCURRENCY = 8;
const PAUSE_MS = 100;
const NEWS_LIMIT_PER_SYMBOL = 5;
const CLEANUP_DAYS = 90;
const MIN_RS_SCORE = 70;
const MIN_VOL_RATIO = 1.5;

interface FmpStockNewsRow {
  symbol?: string;
  publishedDate?: string;
  title?: string;
  text?: string;
  image?: string;
  site?: string;
  url?: string;
}

/**
 * 대상 종목 조회:
 * - Phase 2 종목 중 RS >= 70 OR vol_ratio >= 1.5
 * - watchlist_stocks ACTIVE 종목 (무조건 포함)
 */
async function fetchTargetSymbols(): Promise<string[]> {
  const result = await db.execute(sql`
    SELECT DISTINCT symbol FROM (
      SELECT sp.symbol
      FROM stock_phases sp
      WHERE sp.date = (SELECT MAX(date) FROM stock_phases)
        AND sp.phase = 2
        AND (
          sp.rs_score >= ${MIN_RS_SCORE}
          OR (sp.vol_ratio IS NOT NULL AND CAST(sp.vol_ratio AS float) >= ${MIN_VOL_RATIO})
        )
      UNION
      SELECT symbol
      FROM watchlist_stocks
      WHERE status = 'ACTIVE'
    ) t
    ORDER BY symbol
  `);

  return (result.rows as Record<string, unknown>[]).map((r) => r.symbol as string);
}

async function fetchNewsForSymbol(
  symbol: string,
  baseUrl: string,
  key: string,
): Promise<FmpStockNewsRow[]> {
  const url = `${baseUrl}/api/v3/stock_news?tickers=${symbol}&limit=${NEWS_LIMIT_PER_SYMBOL}&apikey=${key}`;
  return retryApiCall(
    () => fetchJson<FmpStockNewsRow[]>(url),
    DEFAULT_RETRY_OPTIONS,
  );
}

async function upsertNews(rows: FmpStockNewsRow[]): Promise<number> {
  const validRows = rows.filter(
    (r) =>
      r.symbol != null &&
      r.symbol !== "" &&
      r.url != null &&
      r.url !== "" &&
      r.title != null &&
      r.title !== "" &&
      r.publishedDate != null &&
      r.publishedDate !== "",
  );

  if (validRows.length === 0) {
    return 0;
  }

  const insertValues = validRows.map((r) => ({
    symbol: r.symbol as string,
    publishedDate: r.publishedDate as string,
    title: r.title as string,
    text: r.text ?? null,
    image: r.image ?? null,
    site: r.site ?? null,
    url: r.url as string,
  }));

  await retryDatabaseOperation(
    () =>
      db
        .insert(stockNews)
        .values(insertValues)
        .onConflictDoNothing({ target: stockNews.url }),
    DEFAULT_RETRY_OPTIONS,
  );

  return insertValues.length;
}

/**
 * 90일 초과 뉴스 삭제.
 * 종목 뉴스는 촉매 설명용이므로 90일이면 충분.
 */
async function cleanupOldNews(): Promise<number> {
  const result = await db.execute(sql`
    DELETE FROM stock_news
    WHERE collected_at < NOW() - (${String(CLEANUP_DAYS)} || ' days')::INTERVAL
    RETURNING id
  `);
  return result.rows.length;
}

async function main() {
  logger.info(TAG, "Starting Stock News ETL...");

  const envValidation = validateEnvironmentVariables();
  if (!envValidation.isValid) {
    logger.error(
      TAG,
      `Environment validation failed: ${JSON.stringify(envValidation.errors)}`,
    );
    process.exit(1);
  }

  const { baseUrl, key } = getFmpV3Config();

  // 90일 초과 뉴스 정리
  const deletedCount = await cleanupOldNews();
  if (deletedCount > 0) {
    logger.info(TAG, `Cleaned up ${deletedCount} news records older than ${CLEANUP_DAYS} days`);
  }

  const symbols = await fetchTargetSymbols();

  if (symbols.length === 0) {
    logger.warn(TAG, "No target symbols found. Skipping.");
    return;
  }

  logger.info(
    TAG,
    `Processing ${symbols.length} symbols (Phase 2 RS>=${MIN_RS_SCORE}/vol>=${MIN_VOL_RATIO} + watchlist ACTIVE)`,
  );

  const limit = pLimit(CONCURRENCY);
  const startTime = Date.now();

  const results = await Promise.all(
    symbols.map((symbol) =>
      limit(async () => {
        try {
          const rows = await fetchNewsForSymbol(symbol, baseUrl, key);
          const inserted = await upsertNews(rows);
          return { ok: true, inserted } as const;
        } catch (e: unknown) {
          const message = e instanceof Error ? e.message : String(e);
          logger.warn(TAG, `Skipped ${symbol}: ${message}`);
          return { ok: false, inserted: 0 } as const;
        } finally {
          await sleep(PAUSE_MS);
        }
      }),
    ),
  );

  const done = results.filter((r) => r.ok).length;
  const skip = results.filter((r) => !r.ok).length;
  const totalInserted = results.reduce((sum, r) => sum + r.inserted, 0);
  const totalTime = Date.now() - startTime;
  logger.info(
    TAG,
    `Stock News ETL completed! ${done} ok, ${skip} skipped, ${totalInserted} news inserted (${Math.round(totalTime / 1000)}s)`,
  );
}

main()
  .then(async () => {
    await pool.end();
    process.exit(0);
  })
  .catch(async (error) => {
    logger.error(
      TAG,
      `Stock News ETL failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    await pool.end();
    process.exit(1);
  });

export { main as loadStockNews };
