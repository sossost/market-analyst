import { pool } from "@/db/client";
import { retryDatabaseOperation } from "@/etl/utils/retry";
import { toNum } from "@/etl/utils/common";
import type { AgentTool } from "./types";
import { validateDate } from "./validation";

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
      },
      required: ["date"],
    },
  },

  async execute(input) {
    const date = validateDate(input.date);
    if (date == null) {
      return JSON.stringify({ error: "Invalid or missing date parameter" });
    }

    // Phase 분포
    const { rows: phaseRows } = await retryDatabaseOperation(() =>
      pool.query<{ phase: number; count: string }>(
        `SELECT phase, COUNT(*)::text AS count
         FROM stock_phases
         WHERE date = $1
         GROUP BY phase
         ORDER BY phase`,
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
           COUNT(*) FILTER (WHERE phase = 2)::text AS phase2_count,
           COUNT(*)::text AS total_count
         FROM stock_phases
         WHERE date = (SELECT MAX(date) FROM stock_phases WHERE date < $1)`,
        [date],
      ),
    );

    const prevTotal = toNum(prevRows[0]?.total_count);
    const prevPhase2Count = toNum(prevRows[0]?.phase2_count);
    const prevPhase2Ratio = prevTotal > 0 ? prevPhase2Count / prevTotal : 0;

    // 시장 평균 RS
    const { rows: rsRows } = await retryDatabaseOperation(() =>
      pool.query<{ avg_rs: string }>(
        `SELECT AVG(rs_score)::numeric(10,2)::text AS avg_rs
         FROM stock_phases WHERE date = $1`,
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
    const adRatio = decliners > 0 ? Number((advancers / decliners).toFixed(2)) : 0;

    // 52주 신고가/신저가
    const { rows: hlRows } = await retryDatabaseOperation(() =>
      pool.query<{ new_highs: string; new_lows: string }>(
        `WITH yearly_range AS (
           SELECT symbol,
             MAX(high::numeric) AS high_52w,
             MIN(low::numeric) AS low_52w
           FROM daily_prices
           WHERE date::date BETWEEN ($1::date - INTERVAL '365 days')::date AND $1::date
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
      phase2Ratio: Number((phase2Ratio * 100).toFixed(1)),
      phase2RatioChange: Number(
        ((phase2Ratio - prevPhase2Ratio) * 100).toFixed(1),
      ),
      marketAvgRs: toNum(rsRows[0]?.avg_rs),
      advanceDecline: { advancers, decliners, unchanged, ratio: adRatio },
      newHighLow: { newHighs, newLows, ratio: newLows > 0 ? Number((newHighs / newLows).toFixed(2)) : 0 },
      topSectors: topSectors.map((s) => ({
        sector: s.sector,
        avgRs: toNum(s.avg_rs),
        groupPhase: s.group_phase,
      })),
    });
  },
};
