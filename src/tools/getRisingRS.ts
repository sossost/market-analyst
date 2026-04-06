import { retryDatabaseOperation } from "@/etl/utils/retry";
import { toNum } from "@/etl/utils/common";
import type { AgentTool } from "./types";
import { validateDate, validateNumber } from "./validation";
import { findRisingRsStocks } from "@/db/repositories/stockPhaseRepository.js";

const DEFAULT_LIMIT = 30;
const RS_MIN = 30;
const RS_MAX = 70;
/** 4주 대비 최소 RS 변화량. 유의미한 모멘텀만 포착하기 위한 노이즈 필터. */
const MIN_RS_CHANGE = 5;
/** Phase 1(바닥 다지기) + Phase 2(상승) 만 허용. Phase 3/4 종목의 일시 반등 false positive 차단. */
const ALLOWED_PHASES = [1, 2];

/**
 * RS 하강→상승 초기 종목을 조회한다.
 * Phase 1/2 + RS 30~70 범위에서 가속 상승 중인 종목 — 시장이 아직 주목하지 않는 초기 모멘텀.
 */
export const getRisingRS: AgentTool = {
  definition: {
    name: "get_rising_rs",
    description:
      "RS 30~70 범위 + Phase 1/2 종목에서 상승 가속 중인 종목을 조회합니다. 시장이 아직 주목하지 않는 초기 모멘텀 포착 목적. 섹터 RS도 상승 중인 종목을 우선 정렬합니다.",
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

    // RS 30~60 종목 중, 4주 전 대비 RS가 상승한 종목
    // 섹터 RS도 상승 중이면 우선 정렬
    const rows = await retryDatabaseOperation(() =>
      findRisingRsStocks({
        date,
        rsMin: RS_MIN,
        rsMax: RS_MAX,
        limit,
        minRsChange: MIN_RS_CHANGE,
        allowedPhases: ALLOWED_PHASES,
      }),
    );

    const stocks = rows.map((r) => {
      const pctFromLowRaw =
        r.pct_from_low_52w != null ? toNum(r.pct_from_low_52w) * 100 : null;

      return {
      symbol: r.symbol,
      phase: r.phase,
      rsScore: r.rs_score,
      rsScore4wAgo: r.rs_score_4w_ago,
      rsChange: r.rs_change,
      ma150Slope: r.ma150_slope != null ? toNum(r.ma150_slope) : null,
      pctFromLow52w:
        pctFromLowRaw != null ? Number(pctFromLowRaw.toFixed(1)) : null,
      isExtremePctFromLow: pctFromLowRaw != null ? pctFromLowRaw > 500 : false,
      volRatio: r.vol_ratio != null ? toNum(r.vol_ratio) : null,
      sector: r.sector,
      industry: r.industry,
      sectorAvgRs: r.sector_avg_rs != null ? toNum(r.sector_avg_rs) : null,
      sectorChange4w: r.sector_change_4w != null ? toNum(r.sector_change_4w) : null,
      sectorGroupPhase: r.sector_group_phase,
      sepaGrade: r.sepa_grade,
      marketCap: r.market_cap != null ? toNum(r.market_cap) : null,
    };
    });

    return JSON.stringify({
      date,
      rsRange: `${RS_MIN}~${RS_MAX}`,
      totalFound: stocks.length,
      description: `Phase 1/2 + RS ${RS_MIN}~${RS_MAX} 범위에서 4주 대비 RS ${MIN_RS_CHANGE}p+ 상승 중 + 섹터 RS 상승 우선`,
      stocks,
    });
  },
};
