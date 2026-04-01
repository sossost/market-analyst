import { pool } from "@/db/client";
import { retryDatabaseOperation } from "@/etl/utils/retry";
import type { AgentTool } from "./types";
import { validateDate, validateSymbol } from "./validation";
import {
  MIN_PHASE,
  MIN_RS_SCORE,
} from "./recommendationGates.js";
import { logger } from "@/lib/logger";

const SUBSTANDARD_TAG = "[기준 미달]";
const PERSISTENCE_TAG = "[지속성 미확인]";

/**
 * Phase < 2 또는 RS < 60인 종목의 reason에 [기준 미달] 접두사를 추가한다.
 * 이미 태그가 있거나 기준을 충족하면 원본을 그대로 반환한다.
 */
export function tagSubstandardReason(
  reason: string | null | undefined,
  phase: number | null | undefined,
  rsScore: number | null | undefined,
): string | null {
  const isSubstandard =
    (phase != null && phase < MIN_PHASE) ||
    (rsScore != null && rsScore < MIN_RS_SCORE);

  if (isSubstandard === false) {
    return reason ?? null;
  }

  if (reason == null || reason === "") {
    return `${SUBSTANDARD_TAG} 사유 미기재`;
  }

  if (reason.startsWith(SUBSTANDARD_TAG)) {
    return reason;
  }

  return `${SUBSTANDARD_TAG} ${reason}`;
}

/**
 * Phase 2 지속성이 부족한 종목의 reason에 [지속성 미확인] 접두사를 추가한다.
 * 이미 태그가 있으면 원본을 그대로 반환한다. 차단이 아닌 소프트 태깅.
 */
export function tagPersistenceReason(reason: string | null | undefined): string {
  const base = reason ?? "";

  if (base.startsWith(PERSISTENCE_TAG)) {
    return base;
  }

  return `${PERSISTENCE_TAG} ${base}`.trim();
}

interface TodayRecommendationRow {
  symbol: string;
  recommendation_date: string;
  entry_price: string;
  entry_rs_score: number | null;
  entry_phase: number;
  sector: string | null;
  industry: string | null;
  reason: string | null;
  status: string;
  market_regime: string | null;
}

/**
 * ETL이 자동 저장한 오늘의 추천 종목을 조회하는 도구.
 * scan-recommendation-candidates ETL job이 매일 Phase 2 종목을 자동 스캔하여 저장하므로,
 * 에이전트는 이 도구로 오늘 저장된 결과를 확인하고 리포트에 활용한다.
 */
export const saveRecommendations: AgentTool = {
  definition: {
    name: "save_recommendations",
    description:
      "오늘 ETL이 자동 저장한 추천 종목을 조회합니다. 지정한 symbols가 오늘 관심종목으로 등록됐는지 확인하고 그 결과를 반환합니다. ETL 자동화로 별도 저장 호출 없이 매 거래일 추천이 생성됩니다.",
    input_schema: {
      type: "object" as const,
      properties: {
        date: {
          type: "string",
          description: "조회 기준일 (YYYY-MM-DD)",
        },
        symbols: {
          type: "array",
          items: { type: "string" },
          description: "조회할 종목 심볼 목록. 비어 있으면 오늘 저장된 전체 추천을 반환한다.",
        },
      },
      required: ["date"],
    },
  },

  async execute(input) {
    const date = validateDate(input.date);
    if (date == null) {
      return JSON.stringify({ error: "Invalid or missing date" });
    }

    const rawSymbols = input.symbols as unknown[] | undefined;
    const symbols: string[] = Array.isArray(rawSymbols)
      ? rawSymbols
          .map((s) => validateSymbol(s))
          .filter((s): s is string => s != null)
      : [];

    let rows: TodayRecommendationRow[];

    if (symbols.length > 0) {
      // 지정 symbols에 대해 오늘 날짜 레코드 조회
      const result = await retryDatabaseOperation(() =>
        pool.query<TodayRecommendationRow>(
          `SELECT symbol, recommendation_date, entry_price::text,
                  entry_rs_score, entry_phase, sector, industry, reason, status, market_regime
           FROM recommendations
           WHERE recommendation_date = $1
             AND symbol = ANY($2)
           ORDER BY entry_rs_score DESC NULLS LAST`,
          [date, symbols],
        ),
      );
      rows = result.rows;
    } else {
      // symbols 미지정 — 오늘 저장된 전체 추천 반환
      const result = await retryDatabaseOperation(() =>
        pool.query<TodayRecommendationRow>(
          `SELECT symbol, recommendation_date, entry_price::text,
                  entry_rs_score, entry_phase, sector, industry, reason, status, market_regime
           FROM recommendations
           WHERE recommendation_date = $1
           ORDER BY entry_rs_score DESC NULLS LAST`,
          [date],
        ),
      );
      rows = result.rows;
    }

    const found = rows.map((r) => ({
      symbol: r.symbol,
      date: r.recommendation_date,
      entryPrice: r.entry_price,
      rsScore: r.entry_rs_score,
      phase: r.entry_phase,
      sector: r.sector,
      industry: r.industry,
      reason: r.reason,
      status: r.status,
      marketRegime: r.market_regime,
    }));

    logger.info(
      "save_recommendations",
      `${date} 추천 조회: ${found.length}건 (요청 symbols: ${symbols.length > 0 ? symbols.join(", ") : "전체"})`,
    );

    return JSON.stringify({
      success: true,
      date,
      count: found.length,
      recommendations: found,
      message: `${date} 기준 ETL 자동 추천 ${found.length}건`,
    });
  },
};
