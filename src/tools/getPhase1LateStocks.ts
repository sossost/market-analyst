import { retryDatabaseOperation } from "@/etl/utils/retry";
import { toNum } from "@/etl/utils/common";
import type { AgentTool } from "./types";
import { validateDate, validateNumber } from "./validation";
import { findPhase1LateStocks } from "@/db/repositories/stockPhaseRepository.js";

const DEFAULT_LIMIT = 30;

/**
 * Phase 1 후기 종목을 조회한다.
 * Phase 2 진입 직전 — MA150 기울기 양전환 조짐 + 거래량 증가 종목.
 */
export const getPhase1LateStocks: AgentTool = {
  definition: {
    name: "get_phase1_late_stocks",
    description:
      "Phase 1 후기(Phase 2 진입 직전) 종목을 조회합니다. MA150 기울기 양전환 + 거래량 증가 + 최근 20거래일 내 Volume Dry-Up(VDU ratio ≤ 0.5) 3일+ 조건. dry-up→surge 패턴으로 Phase 2 전환 1~3개월 선행 포착.",
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

    // Phase 1 종목 중 MA150 기울기가 안정화/양전환 (기울기 >= 0)
    // + 거래량 비율 1.0x 이상 (VDU dry-up 필터 도입으로 임계값 완화)
    // + 최근 20거래일 내 VDU ratio ≤ 0.5 (dry-up) 3일 이상
    // + RS 30 이상 (false positive 감소: 20은 너무 관대)
    const rows = await retryDatabaseOperation(() =>
      findPhase1LateStocks(date, limit),
    );

    const stocks = rows.map((r) => {
      const pctFromLowRaw =
        r.pct_from_low_52w != null ? toNum(r.pct_from_low_52w) * 100 : null;

      return {
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
          pctFromLowRaw != null ? Number(pctFromLowRaw.toFixed(1)) : null,
        isExtremePctFromLow: pctFromLowRaw != null ? pctFromLowRaw > 500 : false,
        conditionsMet: r.conditions_met != null ? JSON.parse(r.conditions_met) : [],
        volRatio: r.vol_ratio != null ? toNum(r.vol_ratio) : null,
        vduRatio: r.vdu_ratio != null ? Number(toNum(r.vdu_ratio).toFixed(2)) : null,
        sector: r.sector,
        industry: r.industry,
        sectorGroupPhase: r.sector_group_phase,
        sectorAvgRs: r.sector_avg_rs != null ? toNum(r.sector_avg_rs) : null,
        sepaGrade: r.sepa_grade,
      };
    });

    return JSON.stringify({
      date,
      totalFound: stocks.length,
      description: "Phase 1 후기 — MA150 기울기 안정화/양전환(>=0) + 거래량 증가(1.0x+) + 최근 20일 내 VDU dry-up(≤0.5) 3일+ + RS 30+",
      stocks,
    });
  },
};
