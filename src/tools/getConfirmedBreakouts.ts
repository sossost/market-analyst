import { retryDatabaseOperation } from "@/etl/utils/retry";
import { findConfirmedBreakouts } from "@/db/repositories/index.js";
import { toNum } from "@/etl/utils/common";
import type { AgentTool } from "./types";
import { validateDate, validateNumber } from "./validation";

const DEFAULT_LIMIT = 50;

/**
 * 거래량 확인된 돌파(Confirmed Breakout) 종목을 조회한다.
 * Phase 2 진입 스크리닝의 핵심 도구.
 */
export const getConfirmedBreakouts: AgentTool = {
  definition: {
    name: "get_confirmed_breakouts",
    description:
      "거래량 확인된 돌파(Confirmed Breakout) 종목을 조회합니다. 거래량 비율(volumeRatio) 내림차순으로 정렬되며, 돌파 폭, 완벽한 되돌림 여부, MA20 간격 등을 포함합니다.",
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
      findConfirmedBreakouts({ date, limit }),
    );

    const breakouts = rows.map((r) => ({
      symbol: r.symbol,
      breakoutPercent: r.breakout_percent != null ? toNum(r.breakout_percent) : null,
      volumeRatio: r.volume_ratio != null ? toNum(r.volume_ratio) : null,
      isPerfectRetest: r.is_perfect_retest,
      ma20DistancePercent:
        r.ma20_distance_percent != null ? toNum(r.ma20_distance_percent) : null,
      sector: r.sector,
      industry: r.industry,
      phase: r.phase,
      rsScore: r.rs_score,
    }));

    return JSON.stringify({
      date,
      totalBreakouts: breakouts.length,
      breakouts,
    });
  },
};
