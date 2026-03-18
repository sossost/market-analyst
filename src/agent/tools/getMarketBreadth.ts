import { pool } from "@/db/client";
import { retryDatabaseOperation } from "@/etl/utils/retry";
import { toNum } from "@/etl/utils/common";
import type { AgentTool } from "./types";
import { clampPercent, validateDate } from "./validation";

/**
 * 전체 시장 브레드스 지표를 조회한다.
 * Phase 분포, Phase 2 비율, 전일 대비 변화, 시장 RS 평균.
 */
export const getMarketBreadth: AgentTool = {
  definition: {
    name: "get_market_breadth",
    description:
      "전체 시장 브레드스 지표를 조회합니다. Phase별 종목 분포, Phase 2 비율 및 전일 대비 변화, 시장 평균 RS 등을 반환합니다.",
    input_schema: {
      type: "object" as const,
      properties: {
        date: {
          type: "string",
          description: "조회 날짜 (YYYY-MM-DD)",
        },
        mode: {
          type: "string",
          enum: ["daily", "weekly"],
          description:
            "조회 모드. daily(기본): 단일 날짜, weekly: 5거래일 추이",
        },
      },
      required: ["date"],
    },
  },

  async execute(input) {
    const date = validateDate(input.date);
    if (date == null) {
      return JSON.stringify({ error: "Invalid or missing date parameter" });
    }

    const mode = input.mode === "weekly" ? "weekly" : "daily";

    if (mode === "weekly") {
      // 5거래일 날짜 목록 조회
      const { rows: dateRows } = await retryDatabaseOperation(() =>
        pool.query<{ date: string }>(
          `SELECT DISTINCT date::text FROM stock_phases
           WHERE date <= $1
           ORDER BY date DESC
           LIMIT 5`,
          [date],
        ),
      );

      const dates = dateRows.map((r) => r.date).reverse();

      if (dates.length === 0) {
        return JSON.stringify({ error: "No data available for the given date" });
      }

      // 각 날짜의 Phase 2 비율 + 시장 RS 일괄 조회
      const { rows: trendRows } = await retryDatabaseOperation(() =>
        pool.query<{
          date: string;
          total: string;
          phase2_count: string;
          avg_rs: string;
        }>(
          `SELECT
             sp.date::text,
             COUNT(*)::text AS total,
             COUNT(*) FILTER (WHERE sp.phase = 2)::text AS phase2_count,
             AVG(sp.rs_score)::numeric(10,2)::text AS avg_rs
           FROM stock_phases sp
           JOIN symbols s ON sp.symbol = s.symbol
           WHERE sp.date = ANY($1::date[])
             AND s.is_actively_trading = true
             AND s.is_etf = false
             AND s.is_fund = false
           GROUP BY sp.date
           ORDER BY sp.date ASC`,
          [dates],
        ),
      );

      const weeklyTrend = trendRows.map((r) => {
        const t = toNum(r.total);
        const p2 = toNum(r.phase2_count);
        return {
          date: r.date,
          phase2Ratio: t > 0
            ? clampPercent(Number(((p2 / t) * 100).toFixed(1)), "weeklyTrend:phase2Ratio")
            : 0,
          marketAvgRs: toNum(r.avg_rs),
        };
      });

      // 주간 Phase 1→2 전환 종목 수 합계
      const { rows: transRows } = await retryDatabaseOperation(() =>
        pool.query<{ transitions: string }>(
          `SELECT COUNT(*)::text AS transitions
           FROM stock_phases sp
           JOIN symbols s ON sp.symbol = s.symbol
           WHERE sp.date = ANY($1::date[])
             AND sp.phase = 2
             AND sp.prev_phase = 1
             AND s.is_actively_trading = true
             AND s.is_etf = false
             AND s.is_fund = false`,
          [dates],
        ),
      );

      const phase1to2Transitions = toNum(transRows[0]?.transitions);

      // 가장 최근 날짜 기준으로 daily 상세 데이터 조회
      const latestDate = dates[dates.length - 1];

      // Phase 분포
      const { rows: phaseRows } = await retryDatabaseOperation(() =>
        pool.query<{ phase: number; count: string }>(
          `SELECT sp.phase, COUNT(*)::text AS count
           FROM stock_phases sp
           JOIN symbols s ON sp.symbol = s.symbol
           WHERE sp.date = $1
             AND s.is_actively_trading = true
             AND s.is_etf = false
             AND s.is_fund = false
           GROUP BY sp.phase
           ORDER BY sp.phase`,
          [latestDate],
        ),
      );

      const total = phaseRows.reduce((sum, r) => sum + toNum(r.count), 0);
      const phaseDistribution = Object.fromEntries(
        phaseRows.map((r) => [`phase${r.phase}`, toNum(r.count)]),
      );

      // 시장 평균 RS (최신 날짜)
      const latestTrend = weeklyTrend[weeklyTrend.length - 1];
      const firstTrend = weeklyTrend[0];

      // phase2RatioChange: 주초 대비 변화 (null은 이중변환 감지 시 발생 — NaN으로 처리)
      const phase2RatioChange =
        latestTrend != null &&
        firstTrend != null &&
        latestTrend.phase2Ratio != null &&
        firstTrend.phase2Ratio != null
          ? Number((latestTrend.phase2Ratio - firstTrend.phase2Ratio).toFixed(1))
          : 0;

      // A/D ratio (최신 날짜)
      const { rows: adRows } = await retryDatabaseOperation(() =>
        pool.query<{ advancers: string; decliners: string; unchanged: string }>(
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
          [latestDate],
        ),
      );

      const advancers = toNum(adRows[0]?.advancers);
      const decliners = toNum(adRows[0]?.decliners);
      const unchanged = toNum(adRows[0]?.unchanged);
      const adRatio =
        decliners > 0
          ? Number((advancers / decliners).toFixed(2))
          : null;

      // 52주 신고가/신저가 (최신 날짜)
      const { rows: hlRows } = await retryDatabaseOperation(() =>
        pool.query<{ new_highs: string; new_lows: string }>(
          `WITH yearly_range AS (
             SELECT symbol,
               MAX(high::numeric) AS high_52w,
               MIN(low::numeric) AS low_52w
             FROM daily_prices
             WHERE date::date BETWEEN ($1::date - INTERVAL '365 days')::date AND ($1::date - INTERVAL '1 day')::date
             GROUP BY symbol
           )
           SELECT
             COUNT(*) FILTER (WHERE dp.close::numeric >= yr.high_52w)::text AS new_highs,
             COUNT(*) FILTER (WHERE dp.close::numeric <= yr.low_52w)::text AS new_lows
           FROM daily_prices dp
           JOIN yearly_range yr ON dp.symbol = yr.symbol
           JOIN symbols s ON dp.symbol = s.symbol
           WHERE dp.date = $1
             AND s.is_actively_trading = true
             AND s.is_etf = false
             AND s.is_fund = false`,
          [latestDate],
        ),
      );

      const newHighs = toNum(hlRows[0]?.new_highs);
      const newLows = toNum(hlRows[0]?.new_lows);

      // 상위 섹터 요약 (최신 날짜)
      const { rows: topSectors } = await retryDatabaseOperation(() =>
        pool.query<{ sector: string; avg_rs: string; group_phase: number }>(
          `SELECT sector, avg_rs::text, group_phase
           FROM sector_rs_daily
           WHERE date = $1
           ORDER BY avg_rs::numeric DESC
           LIMIT 5`,
          [latestDate],
        ),
      );

      return JSON.stringify({
        mode: "weekly",
        dates,
        weeklyTrend,
        phase1to2Transitions,
        latestSnapshot: {
          date: latestDate,
          totalStocks: total,
          phaseDistribution,
          phase2Ratio: latestTrend?.phase2Ratio ?? 0,
          phase2RatioChange,
          marketAvgRs: latestTrend?.marketAvgRs ?? 0,
          advanceDecline: { advancers, decliners, unchanged, ratio: adRatio },
          newHighLow: {
            newHighs,
            newLows,
            ratio:
              newLows > 0
                ? Number((newHighs / newLows).toFixed(2))
                : null,
          },
          topSectors: topSectors.map((s) => ({
            sector: s.sector,
            avgRs: toNum(s.avg_rs),
            groupPhase: s.group_phase,
          })),
        },
      });
    }

    // daily 모드 (기존 로직)

    // Phase 분포
    const { rows: phaseRows } = await retryDatabaseOperation(() =>
      pool.query<{ phase: number; count: string }>(
        `SELECT sp.phase, COUNT(*)::text AS count
         FROM stock_phases sp
         JOIN symbols s ON sp.symbol = s.symbol
         WHERE sp.date = $1
           AND s.is_actively_trading = true
           AND s.is_etf = false
           AND s.is_fund = false
         GROUP BY sp.phase
         ORDER BY sp.phase`,
        [date],
      ),
    );

    const total = phaseRows.reduce((sum, r) => sum + toNum(r.count), 0);
    const phaseDistribution = Object.fromEntries(
      phaseRows.map((r) => [`phase${r.phase}`, toNum(r.count)]),
    );
    const phase2Count = phaseDistribution.phase2 ?? 0;
    const phase2Ratio = total > 0 ? phase2Count / total : 0;

    // 전일 Phase 2 비율 (변화 계산용)
    const { rows: prevRows } = await retryDatabaseOperation(() =>
      pool.query<{ phase2_count: string; total_count: string }>(
        `SELECT
           COUNT(*) FILTER (WHERE sp.phase = 2)::text AS phase2_count,
           COUNT(*)::text AS total_count
         FROM stock_phases sp
         JOIN symbols s ON sp.symbol = s.symbol
         WHERE sp.date = (SELECT MAX(date) FROM stock_phases WHERE date < $1)
           AND s.is_actively_trading = true
           AND s.is_etf = false
           AND s.is_fund = false`,
        [date],
      ),
    );

    const prevTotal = toNum(prevRows[0]?.total_count);
    const prevPhase2Count = toNum(prevRows[0]?.phase2_count);
    const prevPhase2Ratio = prevTotal > 0 ? prevPhase2Count / prevTotal : 0;

    // 시장 평균 RS
    const { rows: rsRows } = await retryDatabaseOperation(() =>
      pool.query<{ avg_rs: string }>(
        `SELECT AVG(sp.rs_score)::numeric(10,2)::text AS avg_rs
         FROM stock_phases sp
         JOIN symbols s ON sp.symbol = s.symbol
         WHERE sp.date = $1
           AND s.is_actively_trading = true
           AND s.is_etf = false
           AND s.is_fund = false`,
        [date],
      ),
    );

    // 상승/하락/보합 종목수 (Advance/Decline)
    const { rows: adRows } = await retryDatabaseOperation(() =>
      pool.query<{ advancers: string; decliners: string; unchanged: string }>(
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
      ),
    );

    const advancers = toNum(adRows[0]?.advancers);
    const decliners = toNum(adRows[0]?.decliners);
    const unchanged = toNum(adRows[0]?.unchanged);
    const adRatio = decliners > 0 ? Number((advancers / decliners).toFixed(2)) : null;

    // 52주 신고가/신저가
    const { rows: hlRows } = await retryDatabaseOperation(() =>
      pool.query<{ new_highs: string; new_lows: string }>(
        `WITH yearly_range AS (
           SELECT symbol,
             MAX(high::numeric) AS high_52w,
             MIN(low::numeric) AS low_52w
           FROM daily_prices
           WHERE date::date BETWEEN ($1::date - INTERVAL '365 days')::date AND ($1::date - INTERVAL '1 day')::date
           GROUP BY symbol
         )
         SELECT
           COUNT(*) FILTER (WHERE dp.close::numeric >= yr.high_52w)::text AS new_highs,
           COUNT(*) FILTER (WHERE dp.close::numeric <= yr.low_52w)::text AS new_lows
         FROM daily_prices dp
         JOIN yearly_range yr ON dp.symbol = yr.symbol
         JOIN symbols s ON dp.symbol = s.symbol
         WHERE dp.date = $1
           AND s.is_actively_trading = true
           AND s.is_etf = false
           AND s.is_fund = false`,
        [date],
      ),
    );

    const newHighs = toNum(hlRows[0]?.new_highs);
    const newLows = toNum(hlRows[0]?.new_lows);

    // 상위 섹터 요약
    const { rows: topSectors } = await retryDatabaseOperation(() =>
      pool.query<{ sector: string; avg_rs: string; group_phase: number }>(
        `SELECT sector, avg_rs::text, group_phase
         FROM sector_rs_daily
         WHERE date = $1
         ORDER BY avg_rs::numeric DESC
         LIMIT 5`,
        [date],
      ),
    );

    return JSON.stringify({
      date,
      totalStocks: total,
      phaseDistribution,
      phase2Ratio: clampPercent(
        Number((phase2Ratio * 100).toFixed(1)),
        "daily:phase2Ratio",
      ) ?? 0,
      phase2RatioChange: Number(
        ((phase2Ratio - prevPhase2Ratio) * 100).toFixed(1),
      ),
      marketAvgRs: toNum(rsRows[0]?.avg_rs),
      advanceDecline: { advancers, decliners, unchanged, ratio: adRatio },
      newHighLow: { newHighs, newLows, ratio: newLows > 0 ? Number((newHighs / newLows).toFixed(2)) : null },
      topSectors: topSectors.map((s) => ({
        sector: s.sector,
        avgRs: toNum(s.avg_rs),
        groupPhase: s.group_phase,
      })),
    });
  },
};
