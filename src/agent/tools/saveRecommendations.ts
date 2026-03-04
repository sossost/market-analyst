import { db, pool } from "@/db/client";
import { recommendations, recommendationFactors } from "@/db/schema/analyst";
import { retryDatabaseOperation } from "@/etl/utils/retry";
import { toNum } from "@/etl/utils/common";
import type { AgentTool } from "./types";
import { validateDate, validateString, validateNumber } from "./validation";

interface RecommendationInput {
  symbol: string;
  entry_price: number;
  phase: number;
  prev_phase?: number;
  rs_score: number;
  sector: string;
  industry: string;
  reason: string;
}

/**
 * 에이전트가 추천 종목을 DB에 저장하는 도구.
 * 멱등: 동일 (symbol, date)는 onConflictDoNothing.
 */
export const saveRecommendations: AgentTool = {
  definition: {
    name: "save_recommendations",
    description:
      "이번 분석에서 선정한 추천 종목을 DB에 저장합니다. 추천 종목의 성과를 자동 트래킹하기 위해 반드시 호출하세요.",
    input_schema: {
      type: "object" as const,
      properties: {
        date: {
          type: "string",
          description: "추천일 (YYYY-MM-DD)",
        },
        recommendations: {
          type: "array",
          items: {
            type: "object",
            properties: {
              symbol: { type: "string" },
              entry_price: {
                type: "number",
                description: "진입가 (당일 종가)",
              },
              phase: { type: "number" },
              prev_phase: { type: "number" },
              rs_score: { type: "number" },
              sector: { type: "string" },
              industry: { type: "string" },
              reason: { type: "string" },
            },
            required: [
              "symbol",
              "entry_price",
              "phase",
              "rs_score",
              "sector",
              "industry",
              "reason",
            ],
          },
        },
      },
      required: ["date", "recommendations"],
    },
  },

  async execute(input) {
    const date = validateDate(input.date);
    if (date == null) {
      return JSON.stringify({ error: "Invalid or missing date" });
    }

    const recs = input.recommendations as RecommendationInput[] | undefined;
    if (!Array.isArray(recs) || recs.length === 0) {
      return JSON.stringify({ error: "recommendations must be a non-empty array" });
    }

    let savedCount = 0;
    let skippedCount = 0;

    for (const rec of recs) {
      const symbol = validateString(rec.symbol);
      if (symbol == null) {
        skippedCount++;
        continue;
      }

      const entryPrice = toNum(rec.entry_price);
      if (entryPrice === 0) {
        skippedCount++;
        continue;
      }

      // 1. recommendations 테이블 INSERT
      const insertResult = await retryDatabaseOperation(() =>
        db
          .insert(recommendations)
          .values({
            symbol,
            recommendationDate: date,
            entryPrice: String(entryPrice),
            entryRsScore: rec.rs_score ?? null,
            entryPhase: rec.phase ?? 2,
            entryPrevPhase: rec.prev_phase ?? null,
            sector: rec.sector ?? null,
            industry: rec.industry ?? null,
            reason: rec.reason ?? null,
            status: "ACTIVE",
            currentPrice: String(entryPrice),
            currentPhase: rec.phase ?? 2,
            currentRsScore: rec.rs_score ?? null,
            pnlPercent: "0",
            maxPnlPercent: "0",
            daysHeld: 0,
            lastUpdated: date,
          })
          .onConflictDoNothing({
            target: [recommendations.symbol, recommendations.recommendationDate],
          }),
      );

      // onConflictDoNothing returns rowCount 0 when skipped
      const rowCount = (insertResult as unknown as { rowCount: number }).rowCount ?? 1;
      if (rowCount === 0) {
        skippedCount++;
        continue;
      }

      // 2. 팩터 스냅샷 저장
      await saveFactorSnapshot(symbol, date);
      savedCount++;
    }

    return JSON.stringify({
      success: true,
      savedCount,
      skippedCount,
      message: `${savedCount}개 저장, ${skippedCount}개 스킵 (이미 존재하거나 유효하지 않음)`,
    });
  },
};

/**
 * stock_phases, sector_rs_daily, industry_rs_daily에서 팩터 스냅샷을 가져와 저장.
 */
async function saveFactorSnapshot(
  symbol: string,
  date: string,
): Promise<void> {
  // 종목 팩터
  const { rows: phaseRows } = await retryDatabaseOperation(() =>
    pool.query<{
      rs_score: number | null;
      phase: number;
      ma150_slope: string | null;
      vol_ratio: string | null;
      volume_confirmed: boolean | null;
      pct_from_high_52w: string | null;
      pct_from_low_52w: string | null;
      conditions_met: string | null;
    }>(
      `SELECT rs_score, phase, ma150_slope, vol_ratio, volume_confirmed,
              pct_from_high_52w, pct_from_low_52w, conditions_met
       FROM stock_phases WHERE symbol = $1 AND date = $2`,
      [symbol, date],
    ),
  );
  const stockFactor = phaseRows[0] ?? null;

  // 섹터 팩터 (종목의 섹터 조회 → sector_rs_daily)
  const { rows: symbolRows } = await retryDatabaseOperation(() =>
    pool.query<{ sector: string | null; industry: string | null }>(
      `SELECT sector, industry FROM symbols WHERE symbol = $1`,
      [symbol],
    ),
  );
  const symbolInfo = symbolRows[0] ?? null;

  let sectorRs: number | null = null;
  let sectorGroupPhase: number | null = null;
  let industryRs: number | null = null;
  let industryGroupPhase: number | null = null;

  if (symbolInfo?.sector != null) {
    const { rows: sectorRows } = await retryDatabaseOperation(() =>
      pool.query<{ avg_rs: string | null; group_phase: number | null }>(
        `SELECT avg_rs, group_phase FROM sector_rs_daily
         WHERE sector = $1 AND date = $2`,
        [symbolInfo.sector, date],
      ),
    );
    if (sectorRows[0] != null) {
      sectorRs = toNum(sectorRows[0].avg_rs);
      sectorGroupPhase = sectorRows[0].group_phase;
    }
  }

  if (symbolInfo?.industry != null) {
    const { rows: industryRows } = await retryDatabaseOperation(() =>
      pool.query<{ avg_rs: string | null; group_phase: number | null }>(
        `SELECT avg_rs, group_phase FROM industry_rs_daily
         WHERE industry = $1 AND date = $2`,
        [symbolInfo.industry, date],
      ),
    );
    if (industryRows[0] != null) {
      industryRs = toNum(industryRows[0].avg_rs);
      industryGroupPhase = industryRows[0].group_phase;
    }
  }

  // 시장 팩터 (Phase 2 비율)
  let marketPhase2Ratio: number | null = null;
  const { rows: breadthRows } = await retryDatabaseOperation(() =>
    pool.query<{ phase2_ratio: string | null }>(
      `SELECT
         ROUND(COUNT(*) FILTER (WHERE phase = 2)::numeric / NULLIF(COUNT(*), 0) * 100, 1)::text AS phase2_ratio
       FROM stock_phases WHERE date = $1`,
      [date],
    ),
  );
  if (breadthRows[0]?.phase2_ratio != null) {
    marketPhase2Ratio = toNum(breadthRows[0].phase2_ratio);
  }

  await retryDatabaseOperation(() =>
    db
      .insert(recommendationFactors)
      .values({
        symbol,
        recommendationDate: date,
        rsScore: stockFactor?.rs_score ?? null,
        phase: stockFactor?.phase ?? null,
        ma150Slope: stockFactor?.ma150_slope ?? null,
        volRatio: stockFactor?.vol_ratio ?? null,
        volumeConfirmed: stockFactor?.volume_confirmed ?? null,
        pctFromHigh52w: stockFactor?.pct_from_high_52w ?? null,
        pctFromLow52w: stockFactor?.pct_from_low_52w ?? null,
        conditionsMet: stockFactor?.conditions_met ?? null,
        sectorRs: sectorRs != null ? String(sectorRs) : null,
        sectorGroupPhase,
        industryRs: industryRs != null ? String(industryRs) : null,
        industryGroupPhase,
        marketPhase2Ratio:
          marketPhase2Ratio != null ? String(marketPhase2Ratio) : null,
      })
      .onConflictDoNothing({
        target: [
          recommendationFactors.symbol,
          recommendationFactors.recommendationDate,
        ],
      }),
  );
}
