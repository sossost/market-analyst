import { pool } from "@/db/client";
import { retryDatabaseOperation } from "@/etl/utils/retry";
import { toNum } from "@/etl/utils/common";
import type { AgentTool } from "./types";
import { validateDate, validateSymbol } from "./validation";

/**
 * 개별 종목 상세 정보를 조회한다.
 * Phase, RS, MA, 52w 고저, 섹터/업종 RS 맥락 포함.
 */
export const getStockDetail: AgentTool = {
  definition: {
    name: "get_stock_detail",
    description:
      "개별 종목의 상세 정보를 조회합니다. Phase, RS, MA50/150/200, 52주 고가/저가, MA150 기울기, Phase 2 조건 충족 상태, 소속 섹터/업종의 RS 랭킹과 Phase를 포함합니다.",
    input_schema: {
      type: "object" as const,
      properties: {
        symbol: {
          type: "string",
          description: "종목 심볼 (예: AAPL)",
        },
        date: {
          type: "string",
          description: "조회 날짜 (YYYY-MM-DD)",
        },
      },
      required: ["symbol", "date"],
    },
  },

  async execute(input) {
    const symbol = validateSymbol(input.symbol);
    if (symbol == null) {
      return JSON.stringify({ error: "Invalid or missing symbol parameter" });
    }
    const date = validateDate(input.date);
    if (date == null) {
      return JSON.stringify({ error: "Invalid or missing date parameter" });
    }

    // 종목 Phase 데이터
    const { rows: phaseRows } = await retryDatabaseOperation(() =>
      pool.query<{
        phase: number;
        prev_phase: number | null;
        rs_score: number;
        ma150: string | null;
        ma150_slope: string | null;
        pct_from_high_52w: string | null;
        pct_from_low_52w: string | null;
        conditions_met: string | null;
      }>(
        `SELECT phase, prev_phase, rs_score,
                ma150::text, ma150_slope::text,
                pct_from_high_52w::text, pct_from_low_52w::text,
                conditions_met
         FROM stock_phases
         WHERE symbol = $1 AND date = $2`,
        [symbol, date],
      ),
    );

    if (phaseRows.length === 0) {
      return JSON.stringify({ error: `No data found for ${symbol} on ${date}` });
    }

    const sp = phaseRows[0];

    // 가격 + MA 데이터
    const { rows: priceRows } = await retryDatabaseOperation(() =>
      pool.query<{
        close: string;
        volume: string;
        ma50: string | null;
        ma200: string | null;
      }>(
        `SELECT dp.close::text, dp.volume::text,
                dm.ma50::text, dm.ma200::text
         FROM daily_prices dp
         LEFT JOIN daily_ma dm ON dp.symbol = dm.symbol AND dp.date = dm.date
         WHERE dp.symbol = $1 AND dp.date = $2`,
        [symbol, date],
      ),
    );

    // 종목 메타데이터 (섹터, 업종)
    const { rows: metaRows } = await retryDatabaseOperation(() =>
      pool.query<{
        sector: string | null;
        industry: string | null;
        market_cap: string | null;
      }>(
        `SELECT sector, industry, market_cap::text
         FROM symbols WHERE symbol = $1`,
        [symbol],
      ),
    );

    const meta = metaRows[0];
    const price = priceRows[0];

    // 소속 섹터/업종의 RS 컨텍스트
    let sectorContext = null;
    let industryContext = null;

    if (meta?.sector != null) {
      const { rows: sectorRows } = await retryDatabaseOperation(() =>
        pool.query<{
          avg_rs: string;
          rs_rank: number;
          group_phase: number;
        }>(
          `SELECT avg_rs::text, rs_rank, group_phase
           FROM sector_rs_daily
           WHERE date = $1 AND sector = $2`,
          [date, meta.sector],
        ),
      );
      if (sectorRows.length > 0) {
        sectorContext = {
          sector: meta.sector,
          avgRs: toNum(sectorRows[0].avg_rs),
          rsRank: sectorRows[0].rs_rank,
          groupPhase: sectorRows[0].group_phase,
        };
      }
    }

    if (meta?.industry != null) {
      const { rows: industryRows } = await retryDatabaseOperation(() =>
        pool.query<{
          avg_rs: string;
          rs_rank: number;
          group_phase: number;
        }>(
          `SELECT avg_rs::text, rs_rank, group_phase
           FROM industry_rs_daily
           WHERE date = $1 AND industry = $2`,
          [date, meta.industry],
        ),
      );
      if (industryRows.length > 0) {
        industryContext = {
          industry: meta.industry,
          avgRs: toNum(industryRows[0].avg_rs),
          rsRank: industryRows[0].rs_rank,
          groupPhase: industryRows[0].group_phase,
        };
      }
    }

    return JSON.stringify({
      symbol,
      date,
      phase: sp.phase,
      prevPhase: sp.prev_phase,
      rsScore: sp.rs_score,
      price: price != null ? toNum(price.close) : null,
      volume: price != null ? toNum(price.volume) : null,
      ma50: price?.ma50 != null ? toNum(price.ma50) : null,
      ma150: sp.ma150 != null ? toNum(sp.ma150) : null,
      ma200: price?.ma200 != null ? toNum(price.ma200) : null,
      ma150Slope: sp.ma150_slope != null ? toNum(sp.ma150_slope) : null,
      pctFromHigh52w:
        sp.pct_from_high_52w != null
          ? Number((toNum(sp.pct_from_high_52w) * 100).toFixed(1))
          : null,
      pctFromLow52w:
        sp.pct_from_low_52w != null
          ? Number((toNum(sp.pct_from_low_52w) * 100).toFixed(1))
          : null,
      conditionsMet:
        sp.conditions_met != null ? JSON.parse(sp.conditions_met) : [],
      marketCap: meta?.market_cap != null ? toNum(meta.market_cap) : null,
      sectorContext,
      industryContext,
    });
  },
};
