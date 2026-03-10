import "dotenv/config";
import { sql } from "drizzle-orm";
import { db, pool } from "@/db/client";
import { dailyBreakoutSignals } from "@/db/schema/market";
import { getLatestPriceDate, getPreviousTradeDate } from "@/etl/utils/date-helpers";
import { validateDatabaseOnlyEnvironment } from "@/etl/utils/validation";

const BREAKOUT_CONFIG = {
  WINDOW_DAYS: 20,
  VOLUME_MULTIPLIER: 2.0,
  /** avg_volume는 daily_ma.vol_ma30 (30일 이동평균) 재활용. 20일 vs 30일 차이 허용 (성능 우선). */
  UPPER_SHADOW_MAX_RATIO: 0.2,
  RETEST_LOOKBACK_MIN_DAYS: 3,
  RETEST_LOOKBACK_MAX_DAYS: 10,
  MA20_DISTANCE_MIN: 0.98,
  MA20_DISTANCE_MAX: 1.05,
} as const;

export async function buildBreakoutSignals() {
  console.log("🚀 Building daily breakout signals...");

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

    const previousDate = await getPreviousTradeDate(latestDate);
    if (previousDate == null) {
      console.warn("⚠️ No previous trade date found");
      return;
    }

    console.log(
      `📅 latest date: ${latestDate}, previous date: ${previousDate}`,
    );

    const result = await db.execute(sql`
      WITH yesterday_data AS (
        SELECT
          dp.symbol,
          dp.close,
          dp.open,
          dp.low,
          dp.high,
          dp.volume,
          dm.ma20,
          dm.ma50,
          dm.ma200,
          dm.vol_ma30
        FROM daily_prices dp
        JOIN daily_ma dm ON dp.symbol = dm.symbol AND dp.date = dm.date
        WHERE dp.date = ${previousDate}
          AND dp.close IS NOT NULL
          AND dp.open IS NOT NULL
          AND dp.low IS NOT NULL
          AND dp.high IS NOT NULL
          AND dp.volume IS NOT NULL
          AND dp.volume > 0
          AND dm.ma20 IS NOT NULL
          AND dm.ma50 IS NOT NULL
          AND dm.ma200 IS NOT NULL
          AND dm.ma20 > 0
          AND dm.ma50 > 0
          AND dm.ma200 > 0
      ),
      -- 당일 제외: "전일까지 20거래일 고가"를 돌파했는지 판정
      trading_dates_20 AS (
        SELECT DISTINCT date
        FROM daily_prices
        WHERE date < ${previousDate}
        ORDER BY date DESC
        LIMIT ${BREAKOUT_CONFIG.WINDOW_DAYS}
      ),
      high_20d_agg AS (
        SELECT
          dp.symbol,
          MAX(dp.high) AS high_20d
        FROM daily_prices dp
        JOIN trading_dates_20 td ON dp.date = td.date
        WHERE dp.high IS NOT NULL
        GROUP BY dp.symbol
      ),
      confirmed_breakout AS (
        SELECT
          yd.symbol,
          TRUE AS is_confirmed_breakout,
          (yd.close / h.high_20d - 1) * 100 AS breakout_percent,
          (yd.volume / yd.vol_ma30) AS volume_ratio
        FROM yesterday_data yd
        JOIN high_20d_agg h ON h.symbol = yd.symbol
        WHERE
          h.high_20d IS NOT NULL
          AND yd.vol_ma30 IS NOT NULL
          AND yd.vol_ma30 > 0
          AND yd.close >= h.high_20d
          AND yd.volume >= (yd.vol_ma30 * ${BREAKOUT_CONFIG.VOLUME_MULTIPLIER})
          AND (yd.high - yd.low) > 0
          AND (yd.high - yd.close) < ((yd.high - yd.low) * ${BREAKOUT_CONFIG.UPPER_SHADOW_MAX_RATIO})
      ),
      retest_trading_dates AS (
        SELECT date, ROW_NUMBER() OVER (ORDER BY date DESC) AS rn
        FROM (
          SELECT DISTINCT date
          FROM daily_prices
          WHERE date < ${latestDate}
          ORDER BY date DESC
          LIMIT ${BREAKOUT_CONFIG.RETEST_LOOKBACK_MAX_DAYS}
        ) sub
      ),
      retest_range_dates AS (
        SELECT date
        FROM retest_trading_dates
        WHERE rn >= ${BREAKOUT_CONFIG.RETEST_LOOKBACK_MIN_DAYS}
          AND rn <= ${BREAKOUT_CONFIG.RETEST_LOOKBACK_MAX_DAYS}
      ),
      -- retest 날짜별 20거래일 범위를 사전 집계 (상관 서브쿼리 제거)
      retest_window_dates AS (
        SELECT
          rd.date AS retest_date,
          td.date AS window_date
        FROM retest_range_dates rd
        JOIN LATERAL (
          SELECT DISTINCT date
          FROM daily_prices
          WHERE date <= rd.date
          ORDER BY date DESC
          LIMIT ${BREAKOUT_CONFIG.WINDOW_DAYS}
        ) td ON TRUE
      ),
      retest_high_20d AS (
        SELECT
          rw.retest_date,
          dp.symbol,
          MAX(dp.high) AS high_20d_at_date
        FROM retest_window_dates rw
        JOIN daily_prices dp ON dp.date = rw.window_date
        WHERE dp.high IS NOT NULL
        GROUP BY rw.retest_date, dp.symbol
      ),
      past_breakouts_retest AS (
        SELECT DISTINCT dp.symbol
        FROM daily_prices dp
        JOIN retest_range_dates rd ON dp.date = rd.date
        JOIN retest_high_20d rh ON rh.retest_date = rd.date AND rh.symbol = dp.symbol
        WHERE dp.close IS NOT NULL
          AND dp.close >= rh.high_20d_at_date
      ),
      perfect_retest AS (
        SELECT
          yd.symbol,
          TRUE AS is_perfect_retest,
          (yd.close / yd.ma20 - 1) * 100 AS ma20_distance_percent
        FROM yesterday_data yd
        JOIN past_breakouts_retest pb ON pb.symbol = yd.symbol
        WHERE
          yd.ma20 IS NOT NULL
          AND yd.ma20 > 0
          AND yd.close >= (yd.ma20 * ${BREAKOUT_CONFIG.MA20_DISTANCE_MIN})
          AND yd.close <= (yd.ma20 * ${BREAKOUT_CONFIG.MA20_DISTANCE_MAX})
          AND (
            yd.close >= yd.open OR
            (yd.open - yd.low) > (yd.close - yd.open)
          )
      ),
      merged AS (
        SELECT
          yd.symbol,
          ${previousDate} AS date,
          COALESCE(cb.is_confirmed_breakout, FALSE) AS is_confirmed_breakout,
          cb.breakout_percent,
          cb.volume_ratio,
          COALESCE(pr.is_perfect_retest, FALSE) AS is_perfect_retest,
          pr.ma20_distance_percent
        FROM yesterday_data yd
        LEFT JOIN confirmed_breakout cb ON cb.symbol = yd.symbol
        LEFT JOIN perfect_retest pr ON pr.symbol = yd.symbol
      )
      SELECT
        symbol,
        date,
        is_confirmed_breakout,
        breakout_percent,
        volume_ratio,
        is_perfect_retest,
        ma20_distance_percent
      FROM merged
      WHERE
        is_confirmed_breakout IS TRUE
        OR is_perfect_retest IS TRUE;
    `);

    type Row = {
      symbol: string;
      date: string;
      is_confirmed_breakout: boolean;
      breakout_percent: string | number | null;
      volume_ratio: string | number | null;
      is_perfect_retest: boolean;
      ma20_distance_percent: string | number | null;
    };

    const rows = result.rows as unknown as Row[];
    console.log(`📊 breakout/retest signals found: ${rows.length}`);

    if (rows.length === 0) {
      return;
    }

    await db
      .insert(dailyBreakoutSignals)
      .values(
        rows.map((r) => ({
          symbol: r.symbol,
          date: r.date,
          isConfirmedBreakout: r.is_confirmed_breakout,
          breakoutPercent:
            r.breakout_percent != null
              ? String(Number(r.breakout_percent))
              : null,
          volumeRatio:
            r.volume_ratio != null ? String(Number(r.volume_ratio)) : null,
          isPerfectRetest: r.is_perfect_retest,
          ma20DistancePercent:
            r.ma20_distance_percent != null
              ? String(Number(r.ma20_distance_percent))
              : null,
        })),
      )
      .onConflictDoUpdate({
        target: [dailyBreakoutSignals.symbol, dailyBreakoutSignals.date],
        set: {
          isConfirmedBreakout: sql`EXCLUDED.is_confirmed_breakout`,
          breakoutPercent: sql`EXCLUDED.breakout_percent`,
          volumeRatio: sql`EXCLUDED.volume_ratio`,
          isPerfectRetest: sql`EXCLUDED.is_perfect_retest`,
          ma20DistancePercent: sql`EXCLUDED.ma20_distance_percent`,
        },
      });

    console.log("✅ Breakout signals upserted into daily_breakout_signals");
  } catch (error) {
    console.error("❌ Failed to build breakout signals:", error);
    throw error;
  }
}

buildBreakoutSignals()
  .then(async () => {
    await pool.end();
    process.exit(0);
  })
  .catch(async (error) => {
    console.error("Fatal error in build-breakout-signals:", error);
    await pool.end();
    process.exit(1);
  });
