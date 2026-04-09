import { retryDatabaseOperation } from "@/etl/utils/retry";
import { findVcpCandidates } from "@/db/repositories/index.js";
import { toNum } from "@/etl/utils/common";
import type { AgentTool } from "./types";
import { validateDate, validateNumber } from "./validation";

const DEFAULT_LIMIT = 50;

/**
 * VCP(변동성 수축 패턴) 후보 종목을 조회한다.
 * SEPA 피벗 진입의 최고 품질 신호.
 */
export const getVCPCandidates: AgentTool = {
  definition: {
    name: "get_vcp_candidates",
    description:
      "VCP(Volatility Contraction Pattern) 후보 종목을 조회합니다. 볼린저밴드 폭이 수축 중인 종목으로, Phase 2 초입 피벗 진입의 핵심 신호입니다. BB width, ATR%, 바디 비율, MA 간격 등을 포함합니다.",
    input_schema: {
      type: "object" as const,
      properties: {
        date: {
          type: "string",
          description: "조회 날짜 (YYYY-MM-DD)",
        },
        limit: {
          type: "number",
          description: "최대 반환 수 (기본 50)",
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

    const rows = await retryDatabaseOperation(() =>
      findVcpCandidates({ date, limit }),
    );

    const candidates = rows.map((r) => ({
      symbol: r.symbol,
      bbWidthCurrent: r.bb_width_current != null ? toNum(r.bb_width_current) : null,
      bbWidthAvg60d: r.bb_width_avg_60d != null ? toNum(r.bb_width_avg_60d) : null,
      atr14Percent: r.atr14_percent != null ? toNum(r.atr14_percent) : null,
      bodyRatio: r.body_ratio != null ? toNum(r.body_ratio) : null,
      ma20Ma50DistancePercent:
        r.ma20_ma50_distance_percent != null
          ? toNum(r.ma20_ma50_distance_percent)
          : null,
      sector: r.sector,
      industry: r.industry,
      phase: r.phase,
      rsScore: r.rs_score,
    }));

    return JSON.stringify({
      date,
      totalVcpCandidates: candidates.length,
      candidates,
    });
  },
};
