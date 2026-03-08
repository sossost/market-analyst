import { pool } from "@/db/client";
import { retryDatabaseOperation } from "@/etl/utils/retry";
import { toNum } from "@/etl/utils/common";
import type { AgentTool } from "./types";
import { validateDate, validateNumber } from "./validation";

const DEFAULT_LIMIT = 30;
const RS_MIN = 30;
const RS_MAX = 60;

/**
 * RS 하강→상승 초기 종목을 조회한다.
 * RS 30~60 범위에서 가속 상승 중인 종목 — 시장이 아직 주목하지 않는 초기 모멘텀.
 */
export const getRisingRS: AgentTool = {
  definition: {
    name: "get_rising_rs",
    description:
      "RS 30~60 범위에서 상승 가속 중인 종목을 조회합니다. 시장이 아직 주목하지 않는 초기 모멘텀 포착 목적. 섹터 RS도 상승 중인 종목을 우선 정렬합니다.",
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
    const { rows } = await retryDatabaseOperation(() =>
      pool.query<{
        symbol: string;
        phase: number;
        rs_score: number;
        rs_score_4w_ago: number | null;
        rs_change: number | null;
        ma150_slope: string | null;
        pct_from_low_52w: string | null;
        vol_ratio: string | null;
        sector: string | null;
        industry: string | null;
        sector_avg_rs: string | null;
        sector_change_4w: string | null;
        sector_group_phase: number | null;
      }>(
        `WITH rs_4w AS (
           SELECT sp.symbol, sp.rs_score AS rs_score_4w_ago
           FROM stock_phases sp
           WHERE sp.date = (
             SELECT MAX(date) FROM stock_phases
             WHERE date <= ($1::date - INTERVAL '28 days')::text
           )
         )
         SELECT
           sp.symbol, sp.phase, sp.rs_score,
           r4w.rs_score_4w_ago,
           (sp.rs_score - COALESCE(r4w.rs_score_4w_ago, sp.rs_score)) AS rs_change,
           sp.ma150_slope::text,
           sp.pct_from_low_52w::text,
           sp.vol_ratio::text,
           s.sector, s.industry,
           srd.avg_rs::text AS sector_avg_rs,
           srd.change_4w::text AS sector_change_4w,
           srd.group_phase AS sector_group_phase
         FROM stock_phases sp
         JOIN symbols s ON sp.symbol = s.symbol
         LEFT JOIN rs_4w r4w ON r4w.symbol = sp.symbol
         LEFT JOIN sector_rs_daily srd ON srd.date = sp.date AND srd.sector = s.sector
         WHERE sp.date = $1
           AND sp.rs_score >= $2
           AND sp.rs_score <= $3
           AND (sp.rs_score - COALESCE(r4w.rs_score_4w_ago, sp.rs_score)) > 0
         ORDER BY
           CASE WHEN srd.change_4w::numeric > 0 THEN 0 ELSE 1 END,
           (sp.rs_score - COALESCE(r4w.rs_score_4w_ago, sp.rs_score)) DESC,
           sp.rs_score DESC
         LIMIT $4`,
        [date, RS_MIN, RS_MAX, limit],
      ),
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
    };
    });

    return JSON.stringify({
      date,
      rsRange: `${RS_MIN}~${RS_MAX}`,
      totalFound: stocks.length,
      description: "RS 30~60 범위에서 4주 대비 RS 상승 중 + 섹터 RS 상승 우선",
      stocks,
    });
  },
};
