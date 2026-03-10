import "dotenv/config";
import { sql } from "drizzle-orm";
import { db, pool } from "@/db/client";
import { dailyNoiseSignals } from "@/db/schema/market";
import { getLatestPriceDate } from "@/etl/utils/date-helpers";
import { validateDatabaseOnlyEnvironment } from "@/etl/utils/validation";

const NOISE_CONFIG = {
  VOLUME_WINDOW_DAYS: 20,
  ATR_WINDOW_DAYS: 14,
  ATR_PERCENT_THRESHOLD: 5.0,
  BB_WINDOW_DAYS: 20,
  BB_AVG_WINDOW_DAYS: 60,
  BB_COMPRESSION_RATIO: 0.8,
} as const;

export async function buildNoiseSignals() {
  console.log("🚀 Building daily noise signals...");

  const envValidation = validateDatabaseOnlyEnvironment();
  if (!envValidation.isValid) {
    console.error("❌ Environment validation failed:", envValidation.errors);
    process.exit(1);
  }

  try {
    const latestDate = await getLatestPriceDate();
    if (latestDate == null) {
      console.warn("⚠️ No latest trade date found");
      return;
    }

    console.log(`📅 latest date: ${latestDate}`);

    const result = await db.execute(sql`
      WITH volume_metrics AS (
        SELECT
          dp.symbol,
          dp.close,
          dp.volume,
          dm.vol_ma30 AS avg_volume_20d,
          dm.vol_ma30 * dp.close AS avg_dollar_volume_20d
        FROM daily_prices dp
        JOIN daily_ma dm ON dm.symbol = dp.symbol AND dm.date = dp.date
        WHERE dp.date = ${latestDate}
          AND dp.close IS NOT NULL
          AND dp.volume IS NOT NULL
          AND dp.volume > 0
          AND dm.vol_ma30 IS NOT NULL
      ),
      atr_recent_dates AS (
        SELECT DISTINCT date
        FROM daily_prices
        WHERE date <= ${latestDate}
          AND date >= ${latestDate}::date - INTERVAL '20 days'
        ORDER BY date DESC
        LIMIT ${NOISE_CONFIG.ATR_WINDOW_DAYS + 1}
      ),
      atr_calc AS (
        SELECT
          dp.symbol,
          dp.date,
          dp.close,
          GREATEST(
            dp.high - dp.low,
            ABS(dp.high - prev.close),
            ABS(dp.low - prev.close)
          ) AS true_range
        FROM daily_prices dp
        JOIN LATERAL (
          SELECT dp2.close
          FROM daily_prices dp2
          WHERE dp2.symbol = dp.symbol
            AND dp2.date < dp.date
          ORDER BY dp2.date DESC
          LIMIT 1
        ) prev ON TRUE
        WHERE dp.date IN (SELECT date FROM atr_recent_dates)
          AND dp.close IS NOT NULL
          AND dp.high IS NOT NULL
          AND dp.low IS NOT NULL
      ),
      atr_values AS (
        SELECT
          symbol,
          CASE WHEN COUNT(*) >= ${NOISE_CONFIG.ATR_WINDOW_DAYS}
               THEN AVG(true_range)
               ELSE NULL
          END AS atr_14,
          MAX(close) FILTER (WHERE date = ${latestDate}) AS close
        FROM atr_calc
        WHERE date <= ${latestDate}
          AND date > (
            SELECT date FROM atr_recent_dates
            ORDER BY date ASC
            LIMIT 1
          )
        GROUP BY symbol
      ),
      bb_dates AS (
        SELECT DISTINCT date
        FROM daily_prices
        WHERE date <= ${latestDate}
          AND date >= ${latestDate}::date - INTERVAL '130 days'
        ORDER BY date DESC
        LIMIT ${NOISE_CONFIG.BB_AVG_WINDOW_DAYS + NOISE_CONFIG.BB_WINDOW_DAYS}
      ),
      bb_calc AS (
        SELECT
          dp.symbol,
          dp.date,
          dp.close,
          AVG(dp.close) OVER (
            PARTITION BY dp.symbol
            ORDER BY dp.date
            ROWS BETWEEN ${NOISE_CONFIG.BB_WINDOW_DAYS - 1} PRECEDING AND CURRENT ROW
          ) AS bb_middle,
          STDDEV(dp.close) OVER (
            PARTITION BY dp.symbol
            ORDER BY dp.date
            ROWS BETWEEN ${NOISE_CONFIG.BB_WINDOW_DAYS - 1} PRECEDING AND CURRENT ROW
          ) AS bb_stddev
        FROM daily_prices dp
        WHERE dp.date IN (SELECT date FROM bb_dates)
          AND dp.close IS NOT NULL
      ),
      bb_width_all AS (
        SELECT
          symbol,
          date,
          close,
          bb_middle,
          CASE
            WHEN bb_middle > 0
            THEN (bb_stddev * 2) / bb_middle
            ELSE NULL
          END AS bb_width_current,
          AVG(
            CASE
              WHEN bb_middle > 0
              THEN (bb_stddev * 2) / bb_middle
              ELSE NULL
            END
          ) OVER (
            PARTITION BY symbol
            ORDER BY date
            ROWS BETWEEN ${NOISE_CONFIG.BB_AVG_WINDOW_DAYS - 1} PRECEDING AND ${NOISE_CONFIG.BB_WINDOW_DAYS} PRECEDING
          ) AS bb_width_avg_60d
        FROM bb_calc
        WHERE bb_middle > 0
          AND bb_stddev IS NOT NULL
      ),
      bb_width AS (
        SELECT symbol, close, bb_middle, bb_width_current, bb_width_avg_60d
        FROM bb_width_all
        WHERE date = ${latestDate}
      ),
      body_ratio AS (
        SELECT
          dp.symbol,
          CASE
            WHEN (dp.high - dp.low) > 0
            THEN ABS(dp.close - dp.open) / (dp.high - dp.low)
            ELSE NULL
          END AS body_ratio
        FROM daily_prices dp
        WHERE dp.date = ${latestDate}
          AND dp.close IS NOT NULL
          AND dp.open IS NOT NULL
          AND dp.high IS NOT NULL
          AND dp.low IS NOT NULL
      ),
      ma_convergence AS (
        SELECT
          dm.symbol,
          dm.ma20,
          dm.ma50,
          CASE
            WHEN dm.ma50 > 0
            THEN ((dm.ma20 - dm.ma50) / dm.ma50) * 100
            ELSE NULL
          END AS ma20_ma50_distance_percent
        FROM daily_ma dm
        WHERE dm.date = ${latestDate}
          AND dm.ma20 IS NOT NULL
          AND dm.ma50 IS NOT NULL
      ),
      merged AS (
        SELECT
          vm.symbol,
          ${latestDate} AS date,
          vm.avg_dollar_volume_20d,
          vm.avg_volume_20d,
          atr.atr_14,
          CASE
            WHEN atr.close > 0
            THEN (atr.atr_14 / atr.close) * 100
            ELSE NULL
          END AS atr14_percent,
          bb.bb_width_current,
          bb.bb_width_avg_60d,
          CASE
            WHEN atr.atr_14 IS NOT NULL
              AND atr.close > 0
              AND (atr.atr_14 / atr.close) < (${NOISE_CONFIG.ATR_PERCENT_THRESHOLD} / 100)
              AND bb.bb_width_current IS NOT NULL
              AND bb.bb_width_avg_60d IS NOT NULL
              AND bb.bb_width_current < (bb.bb_width_avg_60d * ${NOISE_CONFIG.BB_COMPRESSION_RATIO})
            THEN TRUE
            ELSE FALSE
          END AS is_vcp,
          br.body_ratio,
          mc.ma20_ma50_distance_percent
        FROM volume_metrics vm
        LEFT JOIN atr_values atr ON atr.symbol = vm.symbol
        LEFT JOIN bb_width bb ON bb.symbol = vm.symbol
        LEFT JOIN body_ratio br ON br.symbol = vm.symbol
        LEFT JOIN ma_convergence mc ON mc.symbol = vm.symbol
      )
      SELECT
        symbol,
        date,
        avg_dollar_volume_20d,
        avg_volume_20d,
        atr_14,
        atr14_percent,
        bb_width_current,
        bb_width_avg_60d,
        is_vcp,
        body_ratio,
        ma20_ma50_distance_percent
      FROM merged
      WHERE symbol IS NOT NULL;
    `);

    type Row = {
      symbol: string;
      date: string;
      avg_dollar_volume_20d: string | number | null;
      avg_volume_20d: string | number | null;
      atr_14: string | number | null;
      atr14_percent: string | number | null;
      bb_width_current: string | number | null;
      bb_width_avg_60d: string | number | null;
      is_vcp: boolean;
      body_ratio: string | number | null;
      ma20_ma50_distance_percent: string | number | null;
    };

    const rows = result.rows as unknown as Row[];
    console.log(`📊 noise signals found: ${rows.length}`);

    if (rows.length === 0) {
      console.warn("⚠️ No noise signals found");
      return;
    }

    await db
      .insert(dailyNoiseSignals)
      .values(
        rows.map((r) => ({
          symbol: r.symbol,
          date: r.date,
          avgDollarVolume20d:
            r.avg_dollar_volume_20d != null
              ? String(Number(r.avg_dollar_volume_20d))
              : null,
          avgVolume20d:
            r.avg_volume_20d != null
              ? String(Number(r.avg_volume_20d))
              : null,
          atr14: r.atr_14 != null ? String(Number(r.atr_14)) : null,
          atr14Percent:
            r.atr14_percent != null
              ? String(Number(r.atr14_percent))
              : null,
          bbWidthCurrent:
            r.bb_width_current != null
              ? String(Number(r.bb_width_current))
              : null,
          bbWidthAvg60d:
            r.bb_width_avg_60d != null
              ? String(Number(r.bb_width_avg_60d))
              : null,
          isVcp: r.is_vcp,
          bodyRatio:
            r.body_ratio != null ? String(Number(r.body_ratio)) : null,
          ma20Ma50DistancePercent:
            r.ma20_ma50_distance_percent != null
              ? String(Number(r.ma20_ma50_distance_percent))
              : null,
        })),
      )
      .onConflictDoUpdate({
        target: [dailyNoiseSignals.symbol, dailyNoiseSignals.date],
        set: {
          avgDollarVolume20d: sql`EXCLUDED.avg_dollar_volume_20d`,
          avgVolume20d: sql`EXCLUDED.avg_volume_20d`,
          atr14: sql`EXCLUDED.atr14`,
          atr14Percent: sql`EXCLUDED.atr14_percent`,
          bbWidthCurrent: sql`EXCLUDED.bb_width_current`,
          bbWidthAvg60d: sql`EXCLUDED.bb_width_avg_60d`,
          isVcp: sql`EXCLUDED.is_vcp`,
          bodyRatio: sql`EXCLUDED.body_ratio`,
          ma20Ma50DistancePercent: sql`EXCLUDED.ma20_ma50_distance_percent`,
        },
      });

    console.log("✅ Noise signals upserted into daily_noise_signals");
  } catch (error) {
    console.error("❌ Failed to build noise signals:", error);
    throw error;
  }
}

buildNoiseSignals()
  .then(async () => {
    await pool.end();
    process.exit(0);
  })
  .catch(async (error) => {
    console.error("Fatal error in build-noise-signals:", error);
    await pool.end();
    process.exit(1);
  });
