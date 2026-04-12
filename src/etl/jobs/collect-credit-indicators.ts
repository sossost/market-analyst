import "dotenv/config";
import { db, pool } from "@/db/client";
import { sql } from "drizzle-orm";
import { fetchJson, toStrNum } from "@/etl/utils/common";
import { creditIndicators } from "@/db/schema/market";
import { validateFredEnvironment } from "@/etl/utils/validation";
import {
  retryApiCall,
  retryDatabaseOperation,
  DEFAULT_RETRY_OPTIONS,
} from "@/etl/utils/retry";
import { logger } from "@/lib/logger";

const TAG = "COLLECT_CREDIT_INDICATORS";

const FRED_BASE_URL = "https://api.stlouisfed.org/fred/series/observations";

/** 수집 대상 FRED 시리즈 */
const FRED_SERIES = [
  { id: "BAMLH0A0HYM2", label: "HY Credit Spread (OAS)" },
  { id: "BAMLH0A3HYC", label: "CCC Spread" },
  { id: "BAMLC0A4CBBB", label: "BBB Spread" },
  { id: "STLFSI4", label: "Financial Stress Index" },
] as const;

/**
 * z-score 계산 기간 (캘린더 일 기준).
 * STLFSI4는 주간 갱신이므로 row count가 아닌 날짜 범위로 윈도우를 잡는다.
 */
const Z_SCORE_LOOKBACK_DAYS = 180;

/** z-score 계산에 필요한 최소 데이터 포인트 수 */
const Z_SCORE_MIN_POINTS = 30;

/** 백필 모드 시 과거 기간 (일) */
const BACKFILL_DAYS = 180;

/** 일반 모드 시 최근 기간 (일) */
const DEFAULT_DAYS = 14;

interface FredObservation {
  date: string;
  value: string;
}

interface FredApiResponse {
  observations?: FredObservation[];
}

/**
 * FRED API에서 시리즈 데이터를 가져온다.
 */
async function fetchSeries(
  seriesId: string,
  apiKey: string,
  startDate: string,
): Promise<FredObservation[]> {
  const params = new URLSearchParams({
    series_id: seriesId,
    api_key: apiKey,
    file_type: "json",
    observation_start: startDate,
    sort_order: "asc",
  });
  const url = `${FRED_BASE_URL}?${params.toString()}`;

  const data = await retryApiCall(
    () => fetchJson<FredApiResponse>(url),
    DEFAULT_RETRY_OPTIONS,
  );

  return (data?.observations ?? []).filter(
    (obs) => obs.value !== "." && obs.value !== "",
  );
}

/**
 * 단일 시리즈 수집: batch upsert + single SQL z-score update.
 */
async function collectOne(
  seriesId: string,
  label: string,
  apiKey: string,
  startDate: string,
): Promise<number> {
  logger.info(TAG, `Fetching ${label} (${seriesId}) from ${startDate}`);

  const observations = await fetchSeries(seriesId, apiKey, startDate);

  if (observations.length === 0) {
    logger.warn(TAG, `No observations for ${seriesId}`);
    return 0;
  }

  logger.info(TAG, `Found ${observations.length} observations for ${seriesId}`);

  // 유효한 값만 필터링
  const validRows = observations
    .map((obs) => ({ date: obs.date, value: Number(obs.value) }))
    .filter((row) => Number.isFinite(row.value));

  if (validRows.length === 0) return 0;

  // Batch upsert (z_score_90d는 null로 먼저 삽입)
  const insertValues = validRows.map((row) => ({
    date: row.date,
    seriesId,
    value: toStrNum(row.value)!,
    zScore90d: null as string | null,
  }));

  await retryDatabaseOperation(
    () =>
      db
        .insert(creditIndicators)
        .values(insertValues)
        .onConflictDoUpdate({
          target: [creditIndicators.date, creditIndicators.seriesId],
          set: {
            value: sql`EXCLUDED.value`,
          },
        }),
    DEFAULT_RETRY_OPTIONS,
  );

  // Single SQL z-score update: 캘린더 일 기준 lookback window
  const minDate = validRows[0].date;
  await pool.query(
    `UPDATE credit_indicators ci
     SET z_score_90d = sub.z_score
     FROM (
       SELECT
         ci2.date,
         CASE
           WHEN hist.cnt >= $4 THEN
             (ci2.value::double precision - hist.avg_val) / NULLIF(hist.stddev_val, 0)
           ELSE NULL
         END AS z_score
       FROM credit_indicators ci2
       CROSS JOIN LATERAL (
         SELECT
           AVG(h.value::double precision) AS avg_val,
           STDDEV_POP(h.value::double precision) AS stddev_val,
           COUNT(*) AS cnt
         FROM credit_indicators h
         WHERE h.series_id = ci2.series_id
           AND h.date < ci2.date
           AND h.date >= (ci2.date::date - $3::int)::text
       ) hist
       WHERE ci2.series_id = $1
         AND ci2.date >= $2
     ) sub
     WHERE ci.series_id = $1
       AND ci.date = sub.date`,
    [seriesId, minDate, Z_SCORE_LOOKBACK_DAYS, Z_SCORE_MIN_POINTS],
  );

  logger.info(TAG, `Upserted ${validRows.length} rows for ${seriesId}`);
  return validRows.length;
}

/**
 * 시작 날짜를 계산한다.
 */
function getStartDate(isBackfill: boolean): string {
  const now = new Date();
  const daysBack = isBackfill ? BACKFILL_DAYS : DEFAULT_DAYS;
  now.setDate(now.getDate() - daysBack);
  return now.toISOString().split("T")[0];
}

export async function collectCreditIndicators(): Promise<void> {
  logger.info(TAG, "Starting Credit Indicators ETL...");

  const envResult = validateFredEnvironment();
  if (!envResult.isValid) {
    for (const error of envResult.errors) {
      logger.error(TAG, `Error: ${error}`);
    }
    process.exit(1);
  }
  for (const warning of envResult.warnings) {
    logger.warn(TAG, `Warning: ${warning}`);
  }

  const apiKey = process.env.FRED_API_KEY!;

  const isBackfill = process.argv.slice(2).includes("backfill");
  const startDate = getStartDate(isBackfill);

  logger.info(
    TAG,
    `Mode: ${isBackfill ? "BACKFILL" : "INCREMENTAL"}, start_date: ${startDate}`,
  );

  let totalUpserted = 0;
  let failed = 0;

  for (const series of FRED_SERIES) {
    try {
      const count = await collectOne(series.id, series.label, apiKey, startDate);
      totalUpserted += count;
    } catch (e: unknown) {
      failed++;
      const message = e instanceof Error ? e.message : String(e);
      logger.error(TAG, `Failed to collect ${series.id}: ${message}`);
    }
  }

  logger.info(
    TAG,
    `Credit Indicators ETL completed! ${totalUpserted} rows upserted, ${failed} series failed`,
  );
}

collectCreditIndicators()
  .then(async () => {
    await pool.end();
    process.exit(0);
  })
  .catch(async (error) => {
    logger.error(
      TAG,
      `Credit Indicators ETL failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    await pool.end();
    process.exit(1);
  });
