import { pool } from "@/db/client";
import { retryDatabaseOperation } from "@/etl/utils/retry";
import { toNum } from "@/etl/utils/common";
import type { AgentTool } from "./types";
import { validateDate, validateNumber, MAX_RS_SCORE } from "./validation";

const DEFAULT_MIN_RS = 60;
const DEFAULT_MAX_RS = MAX_RS_SCORE;
const DEFAULT_LIMIT = 30;

/**
 * Phase 2 초입 종목 리스트를 조회한다.
 * RS 필터링 + Phase 전환 정보 포함.
 */
export const getPhase2Stocks: AgentTool = {
  definition: {
    name: "get_phase2_stocks",
    description:
      "Phase 2 초입(Phase 1→2 전환 또는 Phase 2 유지) 종목 리스트를 조회합니다. RS 점수 하한과 최대 수를 지정할 수 있습니다. 각 종목의 Phase, 이전 Phase, RS, 섹터/업종, MA150 기울기, 52주 고가/저가 대비 등을 포함합니다.",
    input_schema: {
      type: "object" as const,
      properties: {
        date: {
          type: "string",
          description: "조회 날짜 (YYYY-MM-DD)",
        },
        min_rs: {
          type: "number",
          description: "최소 RS 점수 (기본 60)",
        },
        max_rs: {
          type: "number",
          description: "최대 RS 점수 (기본 95). RS 과열 종목 필터링용.",
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
    const minRs = validateNumber(input.min_rs, DEFAULT_MIN_RS);
    const maxRs = validateNumber(input.max_rs, DEFAULT_MAX_RS);
    const limit = validateNumber(input.limit, DEFAULT_LIMIT);

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
        volume_confirmed: boolean | null;
        sector: string | null;
        industry: string | null;
      }>(
        `SELECT
           sp.symbol, sp.phase, sp.prev_phase, sp.rs_score,
           sp.ma150_slope::text, sp.pct_from_high_52w::text, sp.pct_from_low_52w::text,
           sp.conditions_met,
           sp.vol_ratio::text, sp.volume_confirmed,
           s.sector, s.industry
         FROM stock_phases sp
         JOIN symbols s ON sp.symbol = s.symbol
         WHERE sp.date = $1
           AND sp.phase = 2
           AND sp.rs_score >= $2
           AND sp.rs_score <= $4
         ORDER BY sp.rs_score DESC
         LIMIT $3`,
        [date, minRs, limit, maxRs],
      ),
    );

    const stocks = rows.map((r) => {
      const pctFromLowRaw =
        r.pct_from_low_52w != null ? toNum(r.pct_from_low_52w) * 100 : null;

      return {
      symbol: r.symbol,
      phase: r.phase,
      prevPhase: r.prev_phase,
      isNewPhase2: r.prev_phase != null && r.prev_phase !== 2,
      rsScore: r.rs_score,
      ma150Slope: r.ma150_slope != null ? toNum(r.ma150_slope) : null,
      pctFromHigh52w:
        r.pct_from_high_52w != null
          ? Number((toNum(r.pct_from_high_52w) * 100).toFixed(1))
          : null,
      pctFromLow52w:
        pctFromLowRaw != null ? Number(pctFromLowRaw.toFixed(1)) : null,
      isExtremePctFromLow: pctFromLowRaw != null ? pctFromLowRaw > 500 : false,
      conditionsMet: r.conditions_met != null ? JSON.parse(r.conditions_met) : [],
      volRatio: r.vol_ratio != null ? toNum(r.vol_ratio) : null,
      volumeConfirmed: r.volume_confirmed ?? false,
      sector: r.sector,
      industry: r.industry,
    };
    });

    return JSON.stringify({
      date,
      minRs,
      maxRs,
      totalPhase2: stocks.length,
      newPhase2Count: stocks.filter((s) => s.isNewPhase2).length,
      stocks,
    });
  },
};
