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
import {
  findPhase1To2Count1d,
  findPhase2To3Count1d,
} from "@/db/repositories/index.js";

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

interface PctAboveMa50Result {
  pctAboveMa50: number | null;
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

/**
 * @deprecated v2로 교체됨. `Window252DataV2`를 사용하라.
 */
interface Window252Data {
  phase2Ratios:    (number | null)[];
  adRatios:        (number | null)[];
  hlRatios:        (number | null)[];
  marketAvgRs:     (number | null)[];
  fearGreedScores: (number | null)[];
  breadthScores:   (number | null)[];
}

/**
 * @deprecated v2로 교체됨. `BreadthScoreV2Input`을 사용하라.
 */
interface BreadthScoreInput {
  phase2Ratio:    number;
  adRatio:        number | null;
  hlRatio:        number | null;
  marketAvgRs:    number | null;
  fearGreedScore: number | null;
}

interface Window252DataV2 {
  phase2Ratios:     (number | null)[]; // 기존 유지
  phase2Momentum5d: (number | null)[]; // (오늘 P2비율 - 5일전 P2비율) 시계열
  netPhaseFlow5d:   (number | null)[]; // 5일 누적 순유입 시계열
  adNet5d:          (number | null)[]; // 5일 누적 A/D 순 시계열
  vixClosePrices:   (number | null)[]; // VIX 종가 시계열
  breadthScores:    (number | null)[]; // 기존 유지 (divergence 계산용)
}

interface BreadthScoreV2Input {
  phase2Ratio:      number;        // 오늘 Phase2 비율
  phase2Ratio5dAgo: number | null; // 5거래일 전 Phase2 비율
  netPhaseFlow5d:   number | null; // 5일 누적 (1→2 진입 - 2→3 이탈)
  adNet5d:          number | null; // 5일 누적 (advancers - decliners)
  vixClose:         number | null; // 오늘 VIX 종가
}

interface Prev5DaysBreadthRow {
  phase2Ratio:       number | null;
  phase1To2Count1d:  number | null;
  phase2To3Count1d:  number | null;
  advancers:         number | null;
  decliners:         number | null;
  pctAboveMa50:      number | null;
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
 * @deprecated `computeBreadthScoreV2()`를 사용하라.
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

const PHASE2_RATIO_WEIGHT       = 0.30;
const PHASE2_MOMENTUM_WEIGHT    = 0.20;
const NET_PHASE_FLOW_WEIGHT     = 0.20;
const AD_NET_5D_WEIGHT          = 0.15;
const VIX_WEIGHT                = 0.15;

// VIX 제외 시 나머지 가중치를 합이 1.0이 되도록 재정규화
const NO_VIX_TOTAL = PHASE2_RATIO_WEIGHT + PHASE2_MOMENTUM_WEIGHT + NET_PHASE_FLOW_WEIGHT + AD_NET_5D_WEIGHT;
const PHASE2_RATIO_WEIGHT_NO_VIX    = PHASE2_RATIO_WEIGHT    / NO_VIX_TOTAL;
const PHASE2_MOMENTUM_WEIGHT_NO_VIX = PHASE2_MOMENTUM_WEIGHT / NO_VIX_TOTAL;
const NET_PHASE_FLOW_WEIGHT_NO_VIX  = NET_PHASE_FLOW_WEIGHT  / NO_VIX_TOTAL;
const AD_NET_5D_WEIGHT_NO_VIX       = AD_NET_5D_WEIGHT       / NO_VIX_TOTAL;

const WINDOW_DAYS     = 252;
const PREV_DAYS_COUNT = 5;
const MOMENTUM_LOOKBACK = 5; // DESC 배열에서 i+5 = 5거래일 전 (오늘-5일전 갭과 일치)
const FLOW_WINDOW       = 5;

// EMA 평활 계수: α = 0.2 → 반감기 약 3거래일
const EMA_ALPHA = 0.2;

// Phase 2 ratio vs pct_above_ma50 다이버전스 탐지 임계값 (#915, 초기값 — #628 백테스트 인프라로 조정 예정)
const PHASE2_DIVERGENCE_RATIO_THRESHOLD_PCT = 35;       // Phase 2 ratio 최소 기준 (%p)
const PHASE2_DIVERGENCE_MA50_DROP_THRESHOLD_PCT = 10;   // pct_above_ma50 하락폭 기준 (%p)
const PHASE2_DIVERGENCE_LOOKBACK_DAYS = 5;               // 롤링 윈도우 (거래일)

/**
 * 5개 지표의 퍼센타일 순위를 가중합산하여 BreadthScore v2(0~100)를 계산한다.
 * VIX가 null인 경우 나머지 4개 가중치를 합이 1이 되도록 재정규화한다.
 * phase2Ratio5dAgo, netPhaseFlow5d, adNet5d 중 null인 항목은 50으로 대체한다.
 */
export function computeBreadthScoreV2(
  current: BreadthScoreV2Input,
  window252: Window252DataV2,
): number {
  const phase2Pct = computePercentileRank(current.phase2Ratio, window252.phase2Ratios);

  const momentum = current.phase2Ratio5dAgo != null
    ? current.phase2Ratio - current.phase2Ratio5dAgo
    : null;
  const momentumPct = momentum != null
    ? computePercentileRank(momentum, window252.phase2Momentum5d)
    : 50;

  const netFlowPct = current.netPhaseFlow5d != null
    ? computePercentileRank(current.netPhaseFlow5d, window252.netPhaseFlow5d)
    : 50;

  const adNetPct = current.adNet5d != null
    ? computePercentileRank(current.adNet5d, window252.adNet5d)
    : 50;

  const raw = current.vixClose != null
    ? (() => {
        const vixPct = 100 - computePercentileRank(current.vixClose, window252.vixClosePrices);
        return (
          phase2Pct   * PHASE2_RATIO_WEIGHT    +
          momentumPct * PHASE2_MOMENTUM_WEIGHT  +
          netFlowPct  * NET_PHASE_FLOW_WEIGHT   +
          adNetPct    * AD_NET_5D_WEIGHT        +
          vixPct      * VIX_WEIGHT
        );
      })()
    : (
        phase2Pct   * PHASE2_RATIO_WEIGHT_NO_VIX    +
        momentumPct * PHASE2_MOMENTUM_WEIGHT_NO_VIX +
        netFlowPct  * NET_PHASE_FLOW_WEIGHT_NO_VIX  +
        adNetPct    * AD_NET_5D_WEIGHT_NO_VIX
      );

  const clamped = Math.max(0, Math.min(100, raw));
  return Math.round(clamped * 100) / 100;
}

/**
 * market_breadth_daily에서 targetDate 이전 직전 5거래일 데이터를 조회한다.
 * DESC 정렬 (index 0 = 가장 최신, index 4 = 가장 오래된).
 * 5행 미만이면 있는 만큼 반환한다.
 */
async function fetchPrev5Days(targetDate: string): Promise<Prev5DaysBreadthRow[]> {
  const { rows } = await pool.query<{
    phase2_ratio:        string | null;
    phase1_to2_count_1d: string | null;
    phase2_to3_count_1d: string | null;
    advancers:           string | null;
    decliners:           string | null;
    pct_above_ma50:      string | null;
  }>(
    `SELECT phase2_ratio::text,
            phase1_to2_count_1d::text,
            phase2_to3_count_1d::text,
            advancers::text,
            decliners::text,
            pct_above_ma50::text
     FROM market_breadth_daily
     WHERE date < $1
     ORDER BY date DESC
     LIMIT $2`,
    [targetDate, PREV_DAYS_COUNT],
  );

  return rows.map(r => ({
    phase2Ratio:      r.phase2_ratio        != null ? toNum(r.phase2_ratio)        : null,
    phase1To2Count1d: r.phase1_to2_count_1d != null ? toNum(r.phase1_to2_count_1d) : null,
    phase2To3Count1d: r.phase2_to3_count_1d != null ? toNum(r.phase2_to3_count_1d) : null,
    advancers:        r.advancers            != null ? toNum(r.advancers)            : null,
    decliners:        r.decliners            != null ? toNum(r.decliners)            : null,
    pctAboveMa50:     r.pct_above_ma50      != null ? toNum(r.pct_above_ma50)      : null,
  }));
}

/**
 * market_breadth_daily에서 targetDate 직전 행의 breadth_score_ema를 조회한다.
 * EMA 연속 계산용 시드값. 데이터가 없으면 null 반환.
 */
async function fetchPrevBreadthScoreEma(targetDate: string): Promise<number | null> {
  const { rows } = await pool.query<{ breadth_score_ema: string | null }>(
    `SELECT breadth_score_ema::text
     FROM market_breadth_daily
     WHERE date < $1
     ORDER BY date DESC
     LIMIT 1`,
    [targetDate],
  );

  const row = rows[0];
  if (row == null || row.breadth_score_ema == null) return null;
  return toNum(row.breadth_score_ema);
}

/**
 * BreadthScore EMA를 계산한다.
 * α × rawScore + (1-α) × prevEma.
 * prevEma가 null(최초 행)이면 rawScore를 그대로 반환.
 */
export function computeBreadthScoreEma(
  rawScore: number,
  prevEma: number | null,
): number {
  const ema = prevEma == null
    ? rawScore
    : EMA_ALPHA * rawScore + (1 - EMA_ALPHA) * prevEma;
  return Math.round(ema * 100) / 100;
}

/**
 * market_breadth_daily에서 targetDate 이전 최대 252거래일 데이터를 조회한다.
 * 날짜 내림차순(최신 → 과거) 순서로 반환된다.
 * 클라이언트 측에서 phase2Momentum5d, netPhaseFlow5d, adNet5d를 파생 계산한다.
 */
async function fetchWindow252V2(targetDate: string): Promise<Window252DataV2> {
  const { rows } = await pool.query<{
    phase2_ratio:        string | null;
    phase1_to2_count_1d: string | null;
    phase2_to3_count_1d: string | null;
    advancers:           string | null;
    decliners:           string | null;
    vix_close:           string | null;
    breadth_score:       string | null;
  }>(
    `SELECT phase2_ratio,
            phase1_to2_count_1d,
            phase2_to3_count_1d,
            advancers,
            decliners,
            vix_close,
            breadth_score
     FROM market_breadth_daily
     WHERE date < $1
     ORDER BY date DESC
     LIMIT $2`,
    [targetDate, WINDOW_DAYS],
  );

  const phase2Ratios = rows.map(r =>
    r.phase2_ratio != null ? toNum(r.phase2_ratio) : null,
  );

  // phase2Momentum5d[i] = phase2Ratios[i] - phase2Ratios[i + MOMENTUM_LOOKBACK]
  // DESC 배열이므로 i+5 = 5거래일 전. 배열 끝 MOMENTUM_LOOKBACK개는 null.
  const phase2Momentum5d: (number | null)[] = phase2Ratios.map((ratio, i) => {
    if (ratio == null) return null;
    if (i + MOMENTUM_LOOKBACK >= phase2Ratios.length) return null;
    const ratio5dAgo = phase2Ratios[i + MOMENTUM_LOOKBACK];
    if (ratio5dAgo == null) return null;
    return ratio - ratio5dAgo;
  });

  // netPhaseFlow5d[i] = SUM(phase1_to2 - phase2_to3) for rows[i..i+FLOW_WINDOW-1]
  // 배열 끝 (FLOW_WINDOW-1)개는 참조 불가 → null
  const netPhaseFlow5d: (number | null)[] = rows.map((_, i) => {
    if (i + FLOW_WINDOW > rows.length) return null;
    let sum = 0;
    for (let j = i; j < i + FLOW_WINDOW; j++) {
      const p1to2 = rows[j].phase1_to2_count_1d != null ? toNum(rows[j].phase1_to2_count_1d!) : 0;
      const p2to3 = rows[j].phase2_to3_count_1d != null ? toNum(rows[j].phase2_to3_count_1d!) : 0;
      sum += p1to2 - p2to3;
    }
    return sum;
  });

  // adNet5d[i] = SUM(advancers - decliners) for rows[i..i+FLOW_WINDOW-1]
  // 배열 끝 (FLOW_WINDOW-1)개는 참조 불가 → null
  const adNet5d: (number | null)[] = rows.map((_, i) => {
    if (i + FLOW_WINDOW > rows.length) return null;
    let sum = 0;
    for (let j = i; j < i + FLOW_WINDOW; j++) {
      const adv = rows[j].advancers != null ? toNum(rows[j].advancers!) : 0;
      const dec = rows[j].decliners != null ? toNum(rows[j].decliners!) : 0;
      sum += adv - dec;
    }
    return sum;
  });

  return {
    phase2Ratios,
    phase2Momentum5d,
    netPhaseFlow5d,
    adNet5d,
    vixClosePrices: rows.map(r => r.vix_close    != null ? toNum(r.vix_close)    : null),
    breadthScores:  rows.map(r => r.breadth_score != null ? toNum(r.breadth_score) : null),
  };
}

/**
 * market_breadth_daily에서 targetDate 이전 최대 252거래일 데이터를 조회한다.
 * 날짜 내림차순(최신 → 과거) 순서로 반환된다.
 * @deprecated `fetchWindow252V2()`를 사용하라.
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

/**
 * Phase 2 ratio vs pct_above_ma50 다이버전스를 탐지한다.
 * Phase 2 ratio가 임계값 이상 유지되면서 pct_above_ma50이 급락하면 true.
 * 데이터 부족 시 null, 조건 미충족 시 false.
 *
 * @param phase2Ratio      오늘 Phase 2 비율 (%)
 * @param todayPctAboveMa50 오늘 pct_above_ma50 (%)
 * @param pastPctAboveMa50  최신→과거 DESC 정렬 배열 (직전 N일의 pct_above_ma50)
 */
export function computePhase2Ma50Divergence(
  phase2Ratio: number,
  todayPctAboveMa50: number | null,
  pastPctAboveMa50: (number | null)[],
): boolean | null {
  if (todayPctAboveMa50 == null) return null;
  if (phase2Ratio < PHASE2_DIVERGENCE_RATIO_THRESHOLD_PCT) return false;

  // 직전 N일 중 non-null 값만 추출
  const validPast = pastPctAboveMa50
    .slice(0, PHASE2_DIVERGENCE_LOOKBACK_DAYS)
    .filter((v): v is number => v != null);

  if (validPast.length < PHASE2_DIVERGENCE_LOOKBACK_DAYS) return null;

  const recentMax = validPast.reduce((max, v) => (v > max ? v : max), validPast[0]);
  const drop = recentMax - todayPctAboveMa50;

  return drop >= PHASE2_DIVERGENCE_MA50_DROP_THRESHOLD_PCT;
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

/**
 * ma50 대비 종가가 위에 있는 종목 비율(%)을 계산한다.
 * total이 0이면 null 반환. 결과는 소수점 2자리 반올림.
 */
export function computePctAboveMa50(above: number, total: number): number | null {
  if (total === 0) return null;
  return Number(((above / total) * 100).toFixed(2));
}

/**
 * daily_prices.close > daily_ma.ma50 인 종목 비율(%)을 계산한다.
 * ma50이 NULL인 종목(상장 50일 미만)은 분모에서 제외한다.
 * symbols 필터는 fetchPhaseDistribution과 동일: is_actively_trading, !is_etf, !is_fund.
 */
async function fetchPctAboveMa50(date: string): Promise<PctAboveMa50Result> {
  const { rows } = await pool.query<{
    total: string;
    above: string;
  }>(
    `SELECT
       COUNT(*)::text AS total,
       COUNT(*) FILTER (WHERE dp.close::numeric > dm.ma50::numeric)::text AS above
     FROM daily_prices dp
     JOIN daily_ma dm ON dp.symbol = dm.symbol AND dp.date = dm.date
     JOIN symbols s ON dp.symbol = s.symbol
     WHERE dp.date = $1
       AND dm.ma50 IS NOT NULL
       AND dp.close IS NOT NULL
       AND s.is_actively_trading = true
       AND s.is_etf = false
       AND s.is_fund = false`,
    [date],
  );

  const row = rows[0];
  if (row == null) return { pctAboveMa50: null };

  const total = toNum(row.total);
  const above = toNum(row.above);
  return { pctAboveMa50: computePctAboveMa50(above, total) };
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

  // 3-1. 당일 Phase 1→2 신규 진입 수
  const p1to2Count1dData = await retryDatabaseOperation(() =>
    findPhase1To2Count1d(targetDate),
  );

  // 3-2. 당일 Phase 2→3 이탈 수
  const p2to3Count1dData = await retryDatabaseOperation(() =>
    findPhase2To3Count1d(targetDate),
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

  // 7. Fear & Greed (CNN 비공식 API — 실패 시 null, DB 기록 유지용)
  const fearGreedData = await fetchFearGreed();

  // 7-1. % above MA50 (중기 브레드스 지표)
  const pctAboveMa50Data = await retryDatabaseOperation(() =>
    fetchPctAboveMa50(targetDate),
  ).catch(() => ({ pctAboveMa50: null }));

  // 8. BreadthScore v2 입력 계산
  // 오늘 당일 값은 이미 집계된 변수를 사용, 직전 4일은 DB 조회
  const prev5Days = await retryDatabaseOperation(() => fetchPrev5Days(targetDate));

  // 5일 전 phase2Ratio (index 4 = 가장 오래된 날)
  const phase2Ratio5dAgo = prev5Days.length >= PREV_DAYS_COUNT
    ? prev5Days[PREV_DAYS_COUNT - 1].phase2Ratio
    : null;

  // netPhaseFlow5d = 직전4일 합산 + 오늘 당일
  const todayPhase1To2 = toNum(p1to2Count1dData.count);
  const todayPhase2To3 = toNum(p2to3Count1dData.count);
  const prev4NetFlow = prev5Days.slice(0, PREV_DAYS_COUNT - 1).reduce((sum, row) => {
    const p1to2 = row.phase1To2Count1d ?? 0;
    const p2to3 = row.phase2To3Count1d ?? 0;
    return sum + (p1to2 - p2to3);
  }, 0);
  const netPhaseFlow5d = prev4NetFlow + (todayPhase1To2 - todayPhase2To3);

  // adNet5d = 직전4일 합산 + 오늘 당일
  // adData가 실패(.catch 경로)하면 advancers/decliners가 null → adNet5d도 null로 전파
  const adNet5d: number | null = adData.advancers == null || adData.decliners == null
    ? null
    : (() => {
        const todayAdNet = adData.advancers - adData.decliners;
        const prev4AdNet = prev5Days.slice(0, PREV_DAYS_COUNT - 1).reduce((sum, row) => {
          const adv = row.advancers ?? 0;
          const dec = row.decliners ?? 0;
          return sum + (adv - dec);
        }, 0);
        return prev4AdNet + todayAdNet;
      })();

  // 9. BreadthScore v2 + 다이버전스 신호
  const window252V2 = await retryDatabaseOperation(() => fetchWindow252V2(targetDate));

  const breadthScore = computeBreadthScoreV2(
    {
      phase2Ratio:      phaseData.phase2Ratio,
      phase2Ratio5dAgo: phase2Ratio5dAgo,
      netPhaseFlow5d:   netPhaseFlow5d,
      adNet5d:          adNet5d,
      vixClose:         vixData.close,
    },
    window252V2,
  );

  const spx5dChange = await fetchSpx5dChange(targetDate).catch(() => null);

  const divergenceSignal = computeDivergenceSignal(
    breadthScore,
    window252V2.breadthScores,
    spx5dChange,
  );

  // 9-1. Phase 2 ratio vs pct_above_ma50 다이버전스 탐지
  const pastPctAboveMa50 = prev5Days.map(r => r.pctAboveMa50);
  const phase2Ma50Divergence = computePhase2Ma50Divergence(
    phaseData.phase2Ratio,
    pctAboveMa50Data.pctAboveMa50,
    pastPctAboveMa50,
  );

  // 10. BreadthScore EMA 계산
  const prevEma = await retryDatabaseOperation(() => fetchPrevBreadthScoreEma(targetDate));
  const breadthScoreEma = computeBreadthScoreEma(breadthScore, prevEma);

  // 11. Upsert
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
    phase1To2Count1d: toNum(p1to2Count1dData.count),
    phase2To3Count1d: toNum(p2to3Count1dData.count),
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
    pctAboveMa50: pctAboveMa50Data.pctAboveMa50 != null ? String(pctAboveMa50Data.pctAboveMa50) : null,
    breadthScore: String(breadthScore),
    breadthScoreEma: String(breadthScoreEma),
    divergenceSignal: divergenceSignal,
    phase2Ma50Divergence: phase2Ma50Divergence,
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
          phase1To2Count1d: sql`EXCLUDED.phase1_to2_count_1d`,
          phase2To3Count1d: sql`EXCLUDED.phase2_to3_count_1d`,
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
          pctAboveMa50: sql`EXCLUDED.pct_above_ma50`,
          breadthScore: sql`EXCLUDED.breadth_score`,
          breadthScoreEma: sql`EXCLUDED.breadth_score_ema`,
          divergenceSignal: sql`EXCLUDED.divergence_signal`,
          phase2Ma50Divergence: sql`EXCLUDED.phase2_ma50_divergence`,
        },
      }),
  );

  logger.info(
    TAG,
    `Done: ${targetDate} | total=${phaseData.total} phase2Ratio=${phaseData.phase2Ratio}% pctAboveMa50=${pctAboveMa50Data.pctAboveMa50 ?? "null"}% phase2Ma50Div=${phase2Ma50Divergence ?? "null"} vixClose=${vixData.close ?? "null"} vixHigh=${vixData.high ?? "null"} fg=${fearGreedData.score ?? "null"} breadthScore=${breadthScore} breadthScoreEma=${breadthScoreEma}`,
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
