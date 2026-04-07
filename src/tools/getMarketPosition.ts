/**
 * getMarketPosition — 일간 리포트 시장 환경 멀티게이트 도구
 *
 * index_prices에서 ^GSPC 가격을 런타임으로 조회하여 MA50/MA200 계산.
 * market_breadth_daily에서 신고가/신저가, A/D 비율 조회.
 * 4개 게이트 충족 여부 + 수치를 반환한다.
 *
 * 아키텍처 결정:
 * - daily_ma 테이블은 symbols FK로 인해 지수 심볼(^GSPC) 삽입 불가 → 런타임 계산 방식 채택.
 * - MA 계산 로직은 build-daily-ma.ts의 calculateMA와 동일 패턴.
 */

import { pool } from "@/db/client";
import type { MarketPositionData, MarketPositionGate } from "@/tools/schemas/dailyReportSchema.js";

// ─── 상수 ─────────────────────────────────────────────────────────────────────

const SP500_SYMBOL = "^GSPC";
const MA_LONG_PERIOD = 200;
const MA_SHORT_PERIOD = 50;
const PRICE_FETCH_LIMIT = 250;
const AD_RATIO_THRESHOLD = 1.0;

// ─── MA 계산 ──────────────────────────────────────────────────────────────────

interface PriceRow {
  date: string;
  close: string;
}

/**
 * prices 배열에서 지정 기간 단순 이동평균을 계산한다.
 * prices는 오래된 순(asc)으로 정렬되어야 한다.
 * 데이터 부족 시 null 반환.
 */
function calculateMA(prices: number[], period: number): number | null {
  if (prices.length < period) return null;
  const recentPrices = prices.slice(-period);
  const sum = recentPrices.reduce((acc, p) => acc + p, 0);
  return sum / period;
}

/**
 * 퍼센트 차이 문자열 생성.
 * e.g. 현재가 5300, MA 5133 → "+3.2%"
 */
function formatPctDiff(current: number, ma: number): string {
  const diff = ((current - ma) / ma) * 100;
  const sign = diff >= 0 ? "+" : "";
  return `${sign}${diff.toFixed(1)}%`;
}

// ─── 쿼리 ─────────────────────────────────────────────────────────────────────

/**
 * index_prices에서 ^GSPC 종가를 최근 250일치 조회하고, 오래된 순으로 정렬하여 반환.
 * targetDate 이하 날짜만 조회한다 (미래 데이터 방지).
 */
async function fetchSP500Prices(targetDate: string): Promise<number[]> {
  const { rows } = await pool.query<PriceRow>(
    `SELECT date::text, close::text
     FROM index_prices
     WHERE symbol = $1
       AND date <= $2
       AND close IS NOT NULL
     ORDER BY date DESC
     LIMIT $3`,
    [SP500_SYMBOL, targetDate, PRICE_FETCH_LIMIT],
  );

  // DESC 조회를 역순으로 정렬 → 오래된 순(asc)
  return rows.reverse().map((r) => Number(r.close));
}

interface BreadthRow {
  ad_ratio: string | null;
  new_highs: number | null;
  new_lows: number | null;
  date: string;
}

/**
 * market_breadth_daily에서 targetDate 이하 가장 최근 행 조회.
 * 리스크 3 대응: ETL 실패 시 가장 최근 데이터(최대 1영업일 이전) 사용.
 */
async function fetchBreadthData(targetDate: string): Promise<BreadthRow | null> {
  const { rows } = await pool.query<BreadthRow>(
    `SELECT date::text,
            ad_ratio::text,
            new_highs,
            new_lows
     FROM market_breadth_daily
     WHERE date <= $1
       AND (ad_ratio IS NOT NULL OR new_highs IS NOT NULL)
     ORDER BY date DESC
     LIMIT 1`,
    [targetDate],
  );

  return rows[0] ?? null;
}

// ─── 게이트 빌더 ──────────────────────────────────────────────────────────────

/**
 * 게이트 1, 2: S&P 500 vs MA200, MA50
 */
function buildMaGates(prices: number[]): [MarketPositionGate, MarketPositionGate] {
  const latestPrice = prices[prices.length - 1];

  const ma200 = calculateMA(prices, MA_LONG_PERIOD);
  const ma50 = calculateMA(prices, MA_SHORT_PERIOD);

  const gate200: MarketPositionGate =
    ma200 == null
      ? { label: "S&P 500 > 200MA", passed: false, detail: "데이터 부족" }
      : {
          label: "S&P 500 > 200MA",
          passed: latestPrice > ma200,
          detail: formatPctDiff(latestPrice, ma200),
        };

  const gate50: MarketPositionGate =
    ma50 == null
      ? { label: "S&P 500 > 50MA", passed: false, detail: "데이터 부족" }
      : {
          label: "S&P 500 > 50MA",
          passed: latestPrice > ma50,
          detail: formatPctDiff(latestPrice, ma50),
        };

  return [gate200, gate50];
}

/**
 * 게이트 3: 신고가 > 신저가
 */
function buildNewHighLowGate(breadth: BreadthRow | null): MarketPositionGate {
  if (breadth == null) {
    return { label: "신고가 > 신저가", passed: false, detail: "—" };
  }

  const newHighs = breadth.new_highs ?? 0;
  const newLows = breadth.new_lows ?? 0;

  return {
    label: "신고가 > 신저가",
    passed: newHighs > newLows,
    detail: `${newHighs} vs ${newLows}`,
  };
}

/**
 * 게이트 4: A/D 비율 > 1.0
 */
function buildAdGate(breadth: BreadthRow | null): MarketPositionGate {
  if (breadth == null) {
    return { label: "A/D > 1.0", passed: false, detail: "—" };
  }

  if (breadth.ad_ratio == null) {
    return { label: "A/D > 1.0", passed: false, detail: "—" };
  }

  const adRatio = Number(breadth.ad_ratio);

  return {
    label: "A/D > 1.0",
    passed: adRatio > AD_RATIO_THRESHOLD,
    detail: adRatio.toFixed(2),
  };
}

// ─── 메인 함수 ────────────────────────────────────────────────────────────────

/**
 * 4개 시장 환경 게이트를 계산하여 반환한다.
 *
 * 에러 처리:
 * - index_prices 데이터 부족(< 200): 해당 MA 게이트 passed=false, detail="데이터 부족"
 * - market_breadth_daily 미조회: 게이트 passed=false, detail="—"
 * - 예외 발생 시: null 반환 (호출측에서 폴백 처리)
 */
export async function getMarketPosition(
  targetDate: string,
): Promise<MarketPositionData | null> {
  try {
    const [prices, breadth] = await Promise.all([
      fetchSP500Prices(targetDate),
      fetchBreadthData(targetDate),
    ]);

    if (prices.length === 0) {
      return null;
    }

    const [gate200, gate50] = buildMaGates(prices);
    const gateHl = buildNewHighLowGate(breadth);
    const gateAd = buildAdGate(breadth);

    const gates: MarketPositionGate[] = [gate200, gate50, gateHl, gateAd];
    const passCount = gates.filter((g) => g.passed).length;

    return {
      gates,
      passCount,
      totalCount: gates.length,
      date: targetDate,
    };
  } catch {
    return null;
  }
}
