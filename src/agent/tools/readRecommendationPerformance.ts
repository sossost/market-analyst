import { db } from "@/db/client";
import { recommendations } from "@/db/schema/analyst";
import { retryDatabaseOperation } from "@/etl/utils/retry";
import { toNum } from "@/etl/utils/common";
import { eq, desc, ne, sql } from "drizzle-orm";
import type { AgentTool } from "./types";
import { validateNumber } from "./validation";

const DEFAULT_LIMIT = 30;

/**
 * 과거 추천 종목의 성과를 조회하는 도구.
 * 에이전트가 추천 품질을 평가하고 개선하는 데 사용.
 */
export const readRecommendationPerformance: AgentTool = {
  definition: {
    name: "read_recommendation_performance",
    description:
      "과거 추천 종목의 성과를 조회합니다. 활성/종료 추천의 승률, 평균 수익률, 최대 수익률을 확인하여 추천 품질을 평가하세요.",
    input_schema: {
      type: "object" as const,
      properties: {
        status: {
          type: "string",
          enum: ["ACTIVE", "CLOSED", "ALL"],
          description: "조회할 상태 (기본 ALL)",
        },
        limit: {
          type: "number",
          description: "최대 반환 건수 (기본 30)",
        },
      },
      required: [],
    },
  },

  async execute(input) {
    const statusFilter =
      typeof input.status === "string" ? input.status : "ALL";
    const limit = validateNumber(input.limit, DEFAULT_LIMIT);

    // ACTIVE 추천 조회
    const activeRecs = await retryDatabaseOperation(() =>
      db
        .select()
        .from(recommendations)
        .where(eq(recommendations.status, "ACTIVE"))
        .orderBy(desc(recommendations.recommendationDate))
        .limit(limit),
    );

    // CLOSED 추천 조회
    const closedRecs = await retryDatabaseOperation(() =>
      db
        .select()
        .from(recommendations)
        .where(ne(recommendations.status, "ACTIVE"))
        .orderBy(desc(recommendations.closeDate))
        .limit(limit),
    );

    // 전체 통계 계산
    const allClosed = closedRecs;
    const closedWithPnl = allClosed.filter((r) => r.pnlPercent != null);
    const winners = closedWithPnl.filter((r) => toNum(r.pnlPercent) > 0);

    const avgPnl =
      closedWithPnl.length > 0
        ? closedWithPnl.reduce((sum, r) => sum + toNum(r.pnlPercent), 0) /
          closedWithPnl.length
        : 0;

    const avgMaxPnl =
      closedWithPnl.length > 0
        ? closedWithPnl.reduce((sum, r) => sum + toNum(r.maxPnlPercent), 0) /
          closedWithPnl.length
        : 0;

    const avgDaysHeld =
      closedWithPnl.length > 0
        ? closedWithPnl.reduce((sum, r) => sum + (r.daysHeld ?? 0), 0) /
          closedWithPnl.length
        : 0;

    const summary = {
      totalCount: activeRecs.length + closedRecs.length,
      activeCount: activeRecs.length,
      closedCount: closedRecs.length,
      winRate:
        closedWithPnl.length > 0
          ? Math.round((winners.length / closedWithPnl.length) * 100)
          : 0,
      avgPnlPercent: Math.round(avgPnl * 100) / 100,
      avgMaxPnl: Math.round(avgMaxPnl * 100) / 100,
      avgDaysHeld: Math.round(avgDaysHeld),
    };

    // 필터링
    const active =
      statusFilter === "CLOSED"
        ? []
        : activeRecs.map((r) => ({
            symbol: r.symbol,
            date: r.recommendationDate,
            entryPrice: toNum(r.entryPrice),
            currentPrice: toNum(r.currentPrice),
            pnlPercent: Math.round(toNum(r.pnlPercent) * 100) / 100,
            maxPnlPercent: Math.round(toNum(r.maxPnlPercent) * 100) / 100,
            daysHeld: r.daysHeld ?? 0,
            currentPhase: r.currentPhase,
          }));

    const recentClosed =
      statusFilter === "ACTIVE"
        ? []
        : closedRecs.map((r) => ({
            symbol: r.symbol,
            date: r.recommendationDate,
            closeDate: r.closeDate,
            entryPrice: toNum(r.entryPrice),
            closePrice: toNum(r.closePrice),
            pnlPercent: Math.round(toNum(r.pnlPercent) * 100) / 100,
            maxPnlPercent: Math.round(toNum(r.maxPnlPercent) * 100) / 100,
            daysHeld: r.daysHeld ?? 0,
            closeReason: r.closeReason,
          }));

    return JSON.stringify({ summary, active, recentClosed });
  },
};
