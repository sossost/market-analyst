import "dotenv/config";
import { fileURLToPath } from "url";
import { db, pool } from "@/db/client";
import { marketBreadthDaily } from "@/db/schema/analyst";
import { assertValidEnvironment } from "@/etl/utils/validation";
import { getLatestPriceDate } from "@/etl/utils/date-helpers";
import { retryDatabaseOperation } from "@/etl/utils/retry";
import { toNum } from "@/etl/utils/common";
import { sql } from "drizzle-orm";
import { logger } from "@/lib/logger";

const TAG = "BUILD_MARKET_BREADTH";

/**
 * stock_phases + symbols JOIN 버전으로 시장 브레드스 스냅샷을 집계한다.
 * getMarketBreadth.ts daily 모드의 symbols JOIN 버전과 동일한 필터 사용.
 */

interface PhaseDistributionResult {
  total: number;
  phase1: number;
  phase2: number;
  phase3: number;
  phase4: number;
  phase2Ratio: number;
  marketAvgRs: number | null;
}

interface Phase1To2Count5dResult {
  count: number;
}

interface PrevPhase2RatioResult {
  phase2Ratio: number | null;
}


interface AdvanceDeclineResult {
  advancers: number | null;
  decliners: number | null;
  unchanged: number | null;
}

interface NewHighLowResult {
  newHighs: number | null;
  newLows: number | null;
}

interface VixResult {
  close: number | null;
}

interface FearGreedResult {
  score: number | null;
  rating: string | null;
}

async function fetchPhaseDistribution(
  date: string,
): Promise<PhaseDistributionResult> {
  const { rows } = await pool.query<{
    phase: number;
    count: string;
    avg_rs: string | null;
  }>(
    `SELECT
       sp.phase,
       COUNT(*)::text AS count,
       AVG(sp.rs_score)::numeric(10,2)::text AS avg_rs
     FROM stock_phases sp
     JOIN symbols s ON sp.symbol = s.symbol
     WHERE sp.date = $1
       AND s.is_actively_trading = true
       AND s.is_etf = false
       AND s.is_fund = false
     GROUP BY sp.phase
     ORDER BY sp.phase`,
    [date],
  );

  const phaseCounts: Record<number, number> = {};
  let total = 0;
  let avgRsSum = 0;
  let avgRsCount = 0;

  for (const row of rows) {
    const count = toNum(row.count);
    phaseCounts[row.phase] = count;
    total += count;
    if (row.avg_rs != null) {
      avgRsSum += toNum(row.avg_rs) * count;
      avgRsCount += count;
    }
  }

  const phase2 = phaseCounts[2] ?? 0;
  const phase2Ratio = total > 0 ? Number(((phase2 / total) * 100).toFixed(2)) : 0;
  const marketAvgRs = avgRsCount > 0
    ? Number((avgRsSum / avgRsCount).toFixed(2))
    : null;

  return {
    total,
    phase1: phaseCounts[1] ?? 0,
    phase2,
    phase3: phaseCounts[3] ?? 0,
    phase4: phaseCounts[4] ?? 0,
    phase2Ratio,
    marketAvgRs,
  };
}

async function fetchPrevPhase2Ratio(date: string): Promise<PrevPhase2RatioResult> {
  const { rows } = await pool.query<{ phase2_ratio: string | null }>(
    `SELECT phase2_ratio::text
     FROM market_breadth_daily
     WHERE date = (
       SELECT MAX(date) FROM market_breadth_daily WHERE date < $1
     )`,
    [date],
  );

  const row = rows[0];
  if (row == null || row.phase2_ratio == null) {
    return { phase2Ratio: null };
  }

  return { phase2Ratio: toNum(row.phase2_ratio) };
}

async function fetchPhase1To2Count5d(date: string): Promise<Phase1To2Count5dResult> {
  const { rows } = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM stock_phases sp
     JOIN symbols s ON sp.symbol = s.symbol
     WHERE sp.date IN (
       SELECT DISTINCT date FROM stock_phases
       WHERE date <= $1
       ORDER BY date DESC
       LIMIT 5
     )
       AND sp.prev_phase = 1
       AND sp.phase = 2
       AND s.is_actively_trading = true
       AND s.is_etf = false
       AND s.is_fund = false`,
    [date],
  );

  return { count: toNum(rows[0]?.count ?? "0") };
}

async function fetchAdvanceDecline(date: string): Promise<AdvanceDeclineResult> {
  const { rows } = await pool.query<{
    advancers: string;
    decliners: string;
    unchanged: string;
  }>(
    `SELECT
       COUNT(*) FILTER (WHERE dp.close::numeric > dp_prev.close::numeric)::text AS advancers,
       COUNT(*) FILTER (WHERE dp.close::numeric < dp_prev.close::numeric)::text AS decliners,
       COUNT(*) FILTER (WHERE dp.close::numeric = dp_prev.close::numeric)::text AS unchanged
     FROM daily_prices dp
     JOIN daily_prices dp_prev
       ON dp.symbol = dp_prev.symbol
       AND dp_prev.date = (SELECT MAX(date) FROM daily_prices WHERE date < $1)
     JOIN symbols s ON dp.symbol = s.symbol
     WHERE dp.date = $1
       AND s.is_actively_trading = true
       AND s.is_etf = false
       AND s.is_fund = false`,
    [date],
  );

  const row = rows[0];
  if (row == null) {
    return { advancers: null, decliners: null, unchanged: null };
  }

  return {
    advancers: toNum(row.advancers),
    decliners: toNum(row.decliners),
    unchanged: toNum(row.unchanged),
  };
}

async function fetchNewHighLow(date: string): Promise<NewHighLowResult> {
  const { rows } = await pool.query<{
    new_highs: string;
    new_lows: string;
  }>(
    `WITH yearly_range AS (
       SELECT symbol,
         MAX(high::numeric) AS high_52w,
         MIN(low::numeric) AS low_52w
       FROM daily_prices
       WHERE date::date BETWEEN ($1::date - INTERVAL '365 days')::date
                             AND ($1::date - INTERVAL '1 day')::date
       GROUP BY symbol
     )
     SELECT
       COUNT(*) FILTER (WHERE dp.close::numeric >= yr.high_52w)::text AS new_highs,
       COUNT(*) FILTER (WHERE dp.close::numeric <= yr.low_52w)::text AS new_lows
     FROM daily_prices dp
     JOIN yearly_range yr ON dp.symbol = yr.symbol
     JOIN symbols s ON dp.symbol = s.symbol
     WHERE dp.date = $1::text
       AND s.is_actively_trading = true
       AND s.is_etf = false
       AND s.is_fund = false`,
    [date],
  );

  const row = rows[0];
  if (row == null) {
    return { newHighs: null, newLows: null };
  }

  return {
    newHighs: toNum(row.new_highs),
    newLows: toNum(row.new_lows),
  };
}

async function fetchVixClose(date: string): Promise<VixResult> {
  const { rows } = await pool.query<{ close: string | null }>(
    `SELECT close::text FROM index_prices WHERE symbol = '^VIX' AND date = $1 LIMIT 1`,
    [date],
  );

  const row = rows[0];
  if (row == null || row.close == null) {
    return { close: null };
  }

  return { close: toNum(row.close) };
}

const CNN_FEAR_GREED_URL = "https://production.dataviz.cnn.io/index/fearandgreed/graphdata";
const FEAR_GREED_FETCH_TIMEOUT_MS = 10_000;

async function fetchFearGreed(): Promise<FearGreedResult> {
  try {
    const response = await fetch(CNN_FEAR_GREED_URL, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
        Referer: "https://edition.cnn.com/markets/fear-and-greed",
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(FEAR_GREED_FETCH_TIMEOUT_MS),
    });

    if (!response.ok) return { score: null, rating: null };

    const data = await response.json();
    const fg = data?.fear_and_greed;
    if (fg == null || typeof fg.score !== "number") return { score: null, rating: null };

    return {
      score: Math.round(fg.score),
      rating: typeof fg.rating === "string" ? fg.rating : null,
    };
  } catch {
    return { score: null, rating: null };
  }
}

export async function buildMarketBreadth(targetDate: string): Promise<void> {
  logger.info(TAG, `Building market breadth for ${targetDate}`);

  // 1. Phase 분포 + 시장 평균 RS
  const phaseData = await retryDatabaseOperation(() =>
    fetchPhaseDistribution(targetDate),
  );

  if (phaseData.total === 0) {
    throw new Error(`No stock_phases data found for ${targetDate}`);
  }

  // 2. 전일 Phase 2 비율 (market_breadth_daily에서 조회 — 재집계 아님)
  const prevRatioData = await retryDatabaseOperation(() =>
    fetchPrevPhase2Ratio(targetDate),
  );

  const phase2RatioChange =
    prevRatioData.phase2Ratio != null
      ? Number((phaseData.phase2Ratio - prevRatioData.phase2Ratio).toFixed(2))
      : null;

  // 3. 최근 5거래일 Phase 1→2 전환 수
  const p1to2Data = await retryDatabaseOperation(() =>
    fetchPhase1To2Count5d(targetDate),
  );

  // 4. Advance/Decline
  const adData = await retryDatabaseOperation(() =>
    fetchAdvanceDecline(targetDate),
  ).catch(() => ({ advancers: null, decliners: null, unchanged: null }));

  const adRatio =
    adData.decliners != null && adData.decliners > 0 && adData.advancers != null
      ? Number((adData.advancers / adData.decliners).toFixed(2))
      : null;

  // 5. 52주 신고가/신저가
  const hlData = await retryDatabaseOperation(() =>
    fetchNewHighLow(targetDate),
  ).catch(() => ({ newHighs: null, newLows: null }));

  const hlRatio =
    hlData.newLows != null && hlData.newLows > 0 && hlData.newHighs != null
      ? Number((hlData.newHighs / hlData.newLows).toFixed(2))
      : null;

  // 6. VIX 종가 (index_prices에서 조회 — 주말/공휴일이면 null)
  const vixData = await retryDatabaseOperation(() =>
    fetchVixClose(targetDate),
  ).catch(() => ({ close: null }));

  // 7. Fear & Greed (CNN 비공식 API — 실패 시 null)
  const fearGreedData = await fetchFearGreed();

  // 8. Upsert
  const row = {
    date: targetDate,
    totalStocks: phaseData.total,
    phase1Count: phaseData.phase1,
    phase2Count: phaseData.phase2,
    phase3Count: phaseData.phase3,
    phase4Count: phaseData.phase4,
    phase2Ratio: String(phaseData.phase2Ratio),
    phase2RatioChange: phase2RatioChange != null ? String(phase2RatioChange) : null,
    phase1To2Count5d: p1to2Data.count,
    marketAvgRs: phaseData.marketAvgRs != null ? String(phaseData.marketAvgRs) : null,
    advancers: adData.advancers,
    decliners: adData.decliners,
    unchanged: adData.unchanged,
    adRatio: adRatio != null ? String(adRatio) : null,
    newHighs: hlData.newHighs,
    newLows: hlData.newLows,
    hlRatio: hlRatio != null ? String(hlRatio) : null,
    vixClose: vixData.close != null ? String(vixData.close) : null,
    fearGreedScore: fearGreedData.score,
    fearGreedRating: fearGreedData.rating,
  };

  await retryDatabaseOperation(() =>
    db
      .insert(marketBreadthDaily)
      .values(row)
      .onConflictDoUpdate({
        target: [marketBreadthDaily.date],
        set: {
          totalStocks: sql`EXCLUDED.total_stocks`,
          phase1Count: sql`EXCLUDED.phase1_count`,
          phase2Count: sql`EXCLUDED.phase2_count`,
          phase3Count: sql`EXCLUDED.phase3_count`,
          phase4Count: sql`EXCLUDED.phase4_count`,
          phase2Ratio: sql`EXCLUDED.phase2_ratio`,
          phase2RatioChange: sql`EXCLUDED.phase2_ratio_change`,
          phase1To2Count5d: sql`EXCLUDED.phase1_to2_count_5d`,
          marketAvgRs: sql`EXCLUDED.market_avg_rs`,
          advancers: sql`EXCLUDED.advancers`,
          decliners: sql`EXCLUDED.decliners`,
          unchanged: sql`EXCLUDED.unchanged`,
          adRatio: sql`EXCLUDED.ad_ratio`,
          newHighs: sql`EXCLUDED.new_highs`,
          newLows: sql`EXCLUDED.new_lows`,
          hlRatio: sql`EXCLUDED.hl_ratio`,
          vixClose: sql`EXCLUDED.vix_close`,
          fearGreedScore: sql`EXCLUDED.fear_greed_score`,
          fearGreedRating: sql`EXCLUDED.fear_greed_rating`,
        },
      }),
  );

  logger.info(
    TAG,
    `Done: ${targetDate} | total=${phaseData.total} phase2Ratio=${phaseData.phase2Ratio}% vix=${vixData.close ?? "null"} fg=${fearGreedData.score ?? "null"}`,
  );
}

async function main() {
  assertValidEnvironment();

  const targetDate = await getLatestPriceDate();
  if (targetDate == null) {
    logger.error(TAG, "No trade date found in daily_prices. Exiting.");
    process.exit(1);
  }

  try {
    await buildMarketBreadth(targetDate);
  } catch (err) {
    logger.error(TAG, `Failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  } finally {
    await db.$client.end().catch(() => {});
    await pool.end().catch(() => {});
  }
}

// 직접 실행 시에만 main() 호출 (백필 스크립트 import 시 자동 실행 방지)
const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] === __filename || process.argv[1]?.endsWith("build-market-breadth.ts")) {
  main();
}
