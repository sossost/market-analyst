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
      topSectors: topSectors.map((s) => ({
        sector: s.sector,
        avgRs: toNum(s.avg_rs),
        groupPhase: s.group_phase,
      })),
    });
  },
};
