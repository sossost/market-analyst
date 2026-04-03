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
import { CNN_FEAR_GREED_URL, CNN_FEAR_GREED_REFERER } from "@/lib/constants";

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
  high: number | null;
}

interface FearGreedResult {
  score: number | null;
  rating: string | null;
}

interface Window252Data {
  phase2Ratios:    (number | null)[];
  adRatios:        (number | null)[];
  hlRatios:        (number | null)[];
  marketAvgRs:     (number | null)[];
  fearGreedScores: (number | null)[];
  breadthScores:   (number | null)[];
}

interface BreadthScoreInput {
  phase2Ratio:    number;
  adRatio:        number | null;
  hlRatio:        number | null;
  marketAvgRs:    number | null;
  fearGreedScore: number | null;
}

/**
 * value가 window 배열에서 몇 번째 퍼센타일인지 계산 (0~100).
 * window에서 null을 제거한 뒤 value 이하인 원소 수 / 전체 수 × 100.
 * 빈 배열이면 중립값 50 반환.
 */
export function computePercentileRank(value: number, window: (number | null)[]): number {
  const valid = window.filter((v): v is number => v != null);
  if (valid.length === 0) return 50;
  const belowOrEqual = valid.filter(v => v <= value).length;
  return (belowOrEqual / valid.length) * 100;
}

/**
 * 5개 지표의 퍼센타일 순위를 가중합산하여 BreadthScore(0~100)를 계산한다.
 * Fear & Greed가 null인 경우 나머지 4개 가중치를 합이 1이 되도록 재정규화한다.
 */
export function computeBreadthScore(
  current: BreadthScoreInput,
  window252: Window252Data,
): number {
  const phase2Pct = computePercentileRank(current.phase2Ratio, window252.phase2Ratios);
  const adPct     = current.adRatio != null
    ? computePercentileRank(current.adRatio, window252.adRatios)
    : 50;
  const hlPct     = current.hlRatio != null
    ? computePercentileRank(current.hlRatio, window252.hlRatios)
    : 50;
  const rsPct     = current.marketAvgRs != null
    ? computePercentileRank(current.marketAvgRs, window252.marketAvgRs)
    : 50;
  const fgRaw     = current.fearGreedScore;

  const raw = fgRaw != null
    ? phase2Pct * 0.35 + fgRaw * 0.20 + adPct * 0.20 + hlPct * 0.15 + rsPct * 0.10
    : phase2Pct * 0.4375 + adPct * 0.25 + hlPct * 0.1875 + rsPct * 0.125;

  const clamped = Math.max(0, Math.min(100, raw));
  return Math.round(clamped * 100) / 100;
}

/**
 * market_breadth_daily에서 targetDate 이전 최대 252거래일 데이터를 조회한다.
 * 날짜 내림차순(최신 → 과거) 순서로 반환된다.
 */
async function fetchWindow252(targetDate: string): Promise<Window252Data> {
  const { rows } = await pool.query<{
    phase2_ratio:    string | null;
    ad_ratio:        string | null;
    hl_ratio:        string | null;
    market_avg_rs:   string | null;
    fear_greed_score: string | null;
    breadth_score:   string | null;
  }>(
    `SELECT phase2_ratio, ad_ratio, hl_ratio, market_avg_rs, fear_greed_score, breadth_score
     FROM market_breadth_daily
     WHERE date < $1
     ORDER BY date DESC
     LIMIT 252`,
    [targetDate],
  );

  return {
    phase2Ratios:    rows.map(r => r.phase2_ratio    != null ? toNum(r.phase2_ratio)    : null),
    adRatios:        rows.map(r => r.ad_ratio         != null ? toNum(r.ad_ratio)         : null),
    hlRatios:        rows.map(r => r.hl_ratio         != null ? toNum(r.hl_ratio)         : null),
    marketAvgRs:     rows.map(r => r.market_avg_rs    != null ? toNum(r.market_avg_rs)    : null),
    fearGreedScores: rows.map(r => r.fear_greed_score != null ? toNum(r.fear_greed_score) : null),
    breadthScores:   rows.map(r => r.breadth_score    != null ? toNum(r.breadth_score)    : null),
  };
}

/**
 * ^GSPC의 5거래일 변화율(%)을 계산한다.
 * 직전 6거래일 데이터가 부족하면 null 반환.
 */
async function fetchSpx5dChange(targetDate: string): Promise<number | null> {
  const { rows } = await pool.query<{ date: string; close: string | null }>(
    `SELECT date, close::text
     FROM index_prices
     WHERE symbol = '^GSPC' AND date <= $1
     ORDER BY date DESC
     LIMIT 6`,
    [targetDate],
  );

  if (rows.length < 6) return null;

  const today  = rows[0];
  const day5Ago = rows[5];

  if (today.close == null || day5Ago.close == null) return null;

  const todayClose  = toNum(today.close);
  const day5Close   = toNum(day5Ago.close);

  if (day5Close === 0) return null;

  return ((todayClose - day5Close) / day5Close) * 100;
}

/**
 * 가격-브레드스 다이버전스를 감지한다.
 * positive: SPX 5일 하락(< -1%) 중 BreadthScore 5일 개선(> +3)
 * negative: SPX 5일 상승(> +1%) 중 BreadthScore 5일 악화(< -3)
 */
/**
 * @param pastBreadthScores 최신→과거 DESC 정렬 배열 (index 0 = 어제, index 4 = 5일 전).
 *                          fetchWindow252의 breadthScores 순서와 동일.
 */
export function computeDivergenceSignal(
  todayScore: number,
  pastBreadthScores: (number | null)[],
  spx5dChange: number | null,
): 'positive' | 'negative' | null {
  if (spx5dChange == null) return null;
  if (pastBreadthScores.length < 5) return null;

  const score5dAgo = pastBreadthScores[4];
  if (score5dAgo == null) return null;

  const breadthScore5dChange = todayScore - score5dAgo;

  if (spx5dChange < -1 && breadthScore5dChange > 3)  return 'positive';
  if (spx5dChange >  1 && breadthScore5dChange < -3) return 'negative';

  return null;
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

async function fetchVixData(date: string): Promise<VixResult> {
  const { rows } = await pool.query<{ close: string | null; high: string | null }>(
    `SELECT close::text, high::text FROM index_prices WHERE symbol = '^VIX' AND date = $1 LIMIT 1`,
    [date],
  );

  const row = rows[0];
  if (row == null) {
    return { close: null, high: null };
  }

  return {
    close: row.close != null ? toNum(row.close) : null,
    high: row.high != null ? toNum(row.high) : null,
  };
}

const FEAR_GREED_FETCH_TIMEOUT_MS = 10_000;

async function fetchFearGreed(): Promise<FearGreedResult> {
  try {
    const response = await fetch(CNN_FEAR_GREED_URL, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
        Referer: CNN_FEAR_GREED_REFERER,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(FEAR_GREED_FETCH_TIMEOUT_MS),
    });

    if (response.ok === false) return { score: null, rating: null };

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

  // 6. VIX 종가 + 고가 (index_prices에서 조회 — 주말/공휴일이면 null)
  const vixData = await retryDatabaseOperation(() =>
    fetchVixData(targetDate),
  ).catch(() => ({ close: null, high: null }));

  // 7. Fear & Greed (CNN 비공식 API — 실패 시 null)
  const fearGreedData = await fetchFearGreed();

  // 8. BreadthScore + 다이버전스 신호
  const window252 = await retryDatabaseOperation(() => fetchWindow252(targetDate));

  const breadthScore = computeBreadthScore(
    {
      phase2Ratio:    phaseData.phase2Ratio,
      adRatio:        adRatio,
      hlRatio:        hlRatio,
      marketAvgRs:    phaseData.marketAvgRs,
      fearGreedScore: fearGreedData.score,
    },
    window252,
  );

  const spx5dChange = await fetchSpx5dChange(targetDate).catch(() => null);

  const divergenceSignal = computeDivergenceSignal(
    breadthScore,
    window252.breadthScores,
    spx5dChange,
  );

  // 9. Upsert
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
    vixHigh: vixData.high != null ? String(vixData.high) : null,
    fearGreedScore: fearGreedData.score,
    fearGreedRating: fearGreedData.rating,
    breadthScore: String(breadthScore),
    divergenceSignal: divergenceSignal,
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
          vixHigh: sql`EXCLUDED.vix_high`,
          fearGreedScore: sql`EXCLUDED.fear_greed_score`,
          fearGreedRating: sql`EXCLUDED.fear_greed_rating`,
          breadthScore: sql`EXCLUDED.breadth_score`,
          divergenceSignal: sql`EXCLUDED.divergence_signal`,
        },
      }),
  );

  logger.info(
    TAG,
    `Done: ${targetDate} | total=${phaseData.total} phase2Ratio=${phaseData.phase2Ratio}% vixClose=${vixData.close ?? "null"} vixHigh=${vixData.high ?? "null"} fg=${fearGreedData.score ?? "null"} breadthScore=${breadthScore}`,
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
