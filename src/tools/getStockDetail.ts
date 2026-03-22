import { retryDatabaseOperation } from "@/etl/utils/retry";
import { toNum } from "@/etl/utils/common";
import type { AgentTool } from "./types";
import { validateDate, validateSymbol } from "./validation";
import { findStockPhaseFull } from "@/db/repositories/stockPhaseRepository.js";
import { findPriceWithMa } from "@/db/repositories/priceRepository.js";
import { findSymbolMeta } from "@/db/repositories/symbolRepository.js";
import { findSectorRsDetail, findIndustryRsDetail } from "@/db/repositories/sectorRepository.js";

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
    const sp = await retryDatabaseOperation(() =>
      findStockPhaseFull(symbol, date),
    );

    if (sp == null) {
      return JSON.stringify({ error: `No data found for ${symbol} on ${date}` });
    }

    // 가격 + MA 데이터, 종목 메타데이터 병렬 조회
    const [price, meta] = await Promise.all([
      retryDatabaseOperation(() => findPriceWithMa(symbol, date)),
      retryDatabaseOperation(() => findSymbolMeta(symbol)),
    ]);

    // 소속 섹터/업종의 RS 컨텍스트
    let sectorContext = null;
    let industryContext = null;

    if (meta?.sector != null) {
      const sectorRow = await retryDatabaseOperation(() =>
        findSectorRsDetail(meta.sector!, date),
      );
      if (sectorRow != null) {
        sectorContext = {
          sector: meta.sector,
          avgRs: toNum(sectorRow.avg_rs),
          rsRank: sectorRow.rs_rank,
          groupPhase: sectorRow.group_phase,
        };
      }
    }

    if (meta?.industry != null) {
      const industryRow = await retryDatabaseOperation(() =>
        findIndustryRsDetail(meta.industry!, date),
      );
      if (industryRow != null) {
        industryContext = {
          industry: meta.industry,
          avgRs: toNum(industryRow.avg_rs),
          rsRank: industryRow.rs_rank,
          groupPhase: industryRow.group_phase,
        };
      }
    }

    const pctFromLowRaw =
      sp.pct_from_low_52w != null ? toNum(sp.pct_from_low_52w) * 100 : null;

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
        pctFromLowRaw != null ? Number(pctFromLowRaw.toFixed(1)) : null,
      isExtremePctFromLow: pctFromLowRaw != null ? pctFromLowRaw > 500 : false,
      conditionsMet:
        sp.conditions_met != null ? JSON.parse(sp.conditions_met) : [],
      marketCap: meta?.market_cap != null ? toNum(meta.market_cap) : null,
      sectorContext,
      industryContext,
    });
  },
};
