import { pool } from "@/db/client";
import { retryDatabaseOperation } from "@/etl/utils/retry";
import { toNum } from "@/etl/utils/common";
import type { AgentTool } from "./types";
import { validateDate, validateNumber } from "./validation";

const DEFAULT_LIMIT = 30;

/**
 * Phase 1 후기 종목을 조회한다.
 * Phase 2 진입 직전 — MA150 기울기 양전환 조짐 + 거래량 증가 종목.
 */
export const getPhase1LateStocks: AgentTool = {
  definition: {
    name: "get_phase1_late_stocks",
    description:
      "Phase 1 후기(Phase 2 진입 직전) 종목을 조회합니다. MA150 기울기가 양전환 조짐을 보이고, 거래량이 증가하는 종목을 반환합니다. Phase 2 전환 1~3개월 선행 포착 목적.",
    input_schema: {
      type: "object" as const,
      properties: {
        date: {
          type: "string",
          description: "조회 날짜 (YYYY-MM-DD)",
        },
        limit: {
          type: "number",
          description: "최대 반환 종목 수 (기본 30)",
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
    const limit = validateNumber(input.limit, DEFAULT_LIMIT);

    // Phase 1 종목 중 MA150 기울기가 양전환 조짐 (기울기 > -0.001, 즉 거의 0이거나 양수)
    // + 거래량 비율 1.2x 이상 (평균 대비 거래량 증가)
    // + RS 20 이상 (바닥 탈출 시작)
    const { rows } = await retryDatabaseOperation(() =>
      pool.query<{
        symbol: string;
        phase: number;
        prev_phase: number | null;
        rs_score: number;
        ma150_slope: string | null;
        pct_from_high_52w: string | null;
        pct_from_low_52w: string | null;
        conditions_met: string | null;
        vol_ratio: string | null;
        sector: string | null;
        industry: string | null;
        sector_group_phase: number | null;
        sector_avg_rs: string | null;
      }>(
        `SELECT
           sp.symbol, sp.phase, sp.prev_phase, sp.rs_score,
           sp.ma150_slope::text, sp.pct_from_high_52w::text, sp.pct_from_low_52w::text,
           sp.conditions_met, sp.vol_ratio::text,
           s.sector, s.industry,
           srd.group_phase AS sector_group_phase,
           srd.avg_rs::text AS sector_avg_rs
         FROM stock_phases sp
         JOIN symbols s ON sp.symbol = s.symbol
         LEFT JOIN sector_rs_daily srd ON srd.date = sp.date AND srd.sector = s.sector
         WHERE sp.date = $1
           AND sp.phase = 1
           AND (sp.prev_phase IS NULL OR sp.prev_phase = 1)
           AND sp.ma150_slope::numeric > -0.001
           AND sp.rs_score >= 20
           AND COALESCE(sp.vol_ratio::numeric, 0) >= 1.2
         ORDER BY sp.ma150_slope::numeric DESC, sp.rs_score DESC
         LIMIT $2`,
        [date, limit],
      ),
    );

    const stocks = rows.map((r) => ({
      symbol: r.symbol,
      phase: r.phase,
      prevPhase: r.prev_phase,
      rsScore: r.rs_score,
      ma150Slope: r.ma150_slope != null ? toNum(r.ma150_slope) : null,
      pctFromHigh52w:
        r.pct_from_high_52w != null
          ? Number((toNum(r.pct_from_high_52w) * 100).toFixed(1))
          : null,
      pctFromLow52w:
        r.pct_from_low_52w != null
          ? Number((toNum(r.pct_from_low_52w) * 100).toFixed(1))
          : null,
      conditionsMet: r.conditions_met != null ? JSON.parse(r.conditions_met) : [],
      volRatio: r.vol_ratio != null ? toNum(r.vol_ratio) : null,
      sector: r.sector,
      industry: r.industry,
      sectorGroupPhase: r.sector_group_phase,
      sectorAvgRs: r.sector_avg_rs != null ? toNum(r.sector_avg_rs) : null,
    }));

    return JSON.stringify({
      date,
      totalFound: stocks.length,
      description: "Phase 1 후기 — MA150 기울기 양전환 조짐 + 거래량 증가 + RS 20+",
      stocks,
    });
  },
};
