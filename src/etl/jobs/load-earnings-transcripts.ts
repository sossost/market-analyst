import "dotenv/config";
import pLimit from "p-limit";
import { db, pool } from "@/db/client";
import { sql } from "drizzle-orm";
import { fetchJson, sleep } from "@/etl/utils/common";
import { earningCallTranscripts } from "@/db/schema/analyst";
import {
  validateEnvironmentVariables,
} from "@/etl/utils/validation";
import {
  retryApiCall,
  retryDatabaseOperation,
  DEFAULT_RETRY_OPTIONS,
} from "@/etl/utils/retry";
import { logger } from "@/agent/logger";

const TAG = "LOAD_EARNINGS_TRANSCRIPTS";

// 응답 크기가 크므로 낮은 동시성 사용 (기획서 지시: CONCURRENCY = 2)
const CONCURRENCY = 2;
const PAUSE_MS = 150;

// 최근 2분기만 저장 (토큰 비용 통제)
const MAX_TRANSCRIPTS = 2;

function getApiConfig(): { api: string; key: string } {
  const dataApi = process.env.DATA_API;
  const fmpKey = process.env.FMP_API_KEY;
  if (dataApi == null || dataApi === "") {
    throw new Error("Missing required environment variable: DATA_API");
  }
  if (fmpKey == null || fmpKey === "") {
    throw new Error("Missing required environment variable: FMP_API_KEY");
  }
  return { api: `${dataApi}/stable`, key: fmpKey };
}

interface FmpTranscriptRow {
  symbol?: string;
  quarter?: number | string;
  year?: number | string;
  date?: string; // YYYY-MM-DD
  content?: string; // 원문 전체
}

async function upsertTranscript(sym: string, row: FmpTranscriptRow) {
  const quarter = row.quarter != null ? Number(row.quarter) : null;
  const year = row.year != null ? Number(row.year) : null;

  if (quarter == null || !Number.isFinite(quarter)) {
    throw new Error(`Invalid quarter for ${sym}: ${row.quarter}`);
  }
  if (year == null || !Number.isFinite(year)) {
    throw new Error(`Invalid year for ${sym}: ${row.year}`);
  }

  await retryDatabaseOperation(
    () =>
      db
        .insert(earningCallTranscripts)
        .values({
          symbol: sym,
          quarter,
          year,
          date: row.date ?? null,
          transcript: row.content ?? null,
        })
        .onConflictDoUpdate({
          target: [
            earningCallTranscripts.symbol,
            earningCallTranscripts.quarter,
            earningCallTranscripts.year,
          ],
          set: {
            date: row.date ?? null,
            transcript: row.content ?? null,
            updatedAt: new Date(),
          },
        }),
    DEFAULT_RETRY_OPTIONS,
  );
}

async function loadOne(symbol: string, api: string, key: string) {
  const rows = await retryApiCall(
    () =>
      fetchJson<FmpTranscriptRow[]>(
        `${api}/earning-call-transcript?symbol=${symbol}&apikey=${key}`,
      ),
    DEFAULT_RETRY_OPTIONS,
  ).catch((e) => {
    logger.error(
      TAG,
      `Failed to fetch transcripts for ${symbol}: ${e instanceof Error ? e.message : String(e)}`,
    );
    return [] as FmpTranscriptRow[];
  });

  if (rows.length === 0) {
    throw new Error(`No transcript data available for ${symbol}`);
  }

  // 최근 2분기만 저장 — FMP API는 최신순 반환
  const recentRows = rows.slice(0, MAX_TRANSCRIPTS);

  for (const row of recentRows) {
    await upsertTranscript(symbol, row);
  }

  logger.info(TAG, `Loaded ${recentRows.length} transcript(s) for ${symbol}`);
}

async function fetchRecommendedSymbols(): Promise<string[]> {
  const rs = await db.execute(
    sql`SELECT DISTINCT symbol FROM recommendations WHERE status IN ('ACTIVE', 'CLOSED') ORDER BY symbol`,
  );
  return (rs.rows as Record<string, unknown>[]).map((r) => r.symbol as string);
}

async function main() {
  logger.info(TAG, "Starting Earnings Transcripts ETL...");

  const envValidation = validateEnvironmentVariables();
  if (!envValidation.isValid) {
    logger.error(
      TAG,
      `Environment validation failed: ${JSON.stringify(envValidation.errors)}`,
    );
    process.exit(1);
  }

  const { api, key } = getApiConfig();

  const syms = await fetchRecommendedSymbols();

  if (syms.length === 0) {
    logger.warn(TAG, "No recommended symbols found. Skipping.");
    return;
  }

  logger.info(TAG, `Processing ${syms.length} recommended symbols (CONCURRENCY=${CONCURRENCY} — large response size)`);

  const limit = pLimit(CONCURRENCY);
  let done = 0;
  let skip = 0;
  const startTime = Date.now();

  await Promise.all(
    syms.map((sym) =>
      limit(async () => {
        try {
          await loadOne(sym, api, key);
          done++;
          if (done % 20 === 0) {
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
  logger.info(
    TAG,
    `Earnings Transcripts ETL completed! ${done} ok, ${skip} skipped (${Math.round(totalTime / 1000)}s)`,
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
      `Earnings Transcripts ETL failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    await pool.end();
    process.exit(1);
  });

export { main as loadEarningsTranscripts };
