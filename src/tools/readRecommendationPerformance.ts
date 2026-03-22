import { db } from "@/db/client";
import { recommendations } from "@/db/schema/analyst";
import { retryDatabaseOperation } from "@/etl/utils/retry";
import { toNum } from "@/etl/utils/common";
import { eq, desc, ne, sql } from "drizzle-orm";
import type { AgentTool } from "./types";
import { validateNumber } from "./validation";

const DEFAULT_LIMIT = 30;

/**
 * 이번 주 월요일 날짜를 YYYY-MM-DD 형식으로 반환.
 * 일요일이면 직전 월요일을 반환한다.
 */
function getThisWeekMonday(): string {
  const now = new Date();
  const utcDay = now.getUTCDay(); // 0=일, 1=월, ..., 6=토
  const diff = utcDay === 0 ? 6 : utcDay - 1;
  const monday = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - diff),
  );
  return monday.toISOString().slice(0, 10);
}

/**
 * 과거 추천 종목의 성과를 조회하는 도구.
 * 에이전트가 추천 품질을 평가하고 개선하는 데 사용.
 */
export const readRecommendationPerformance: AgentTool = {
  definition: {
    name: "read_recommendation_performance",
    description:
      "과거 추천 종목의 성과를 조회합니다. period='this_week'으로 이번 주 추천/종료 건의 주간 성과 집계도 확인할 수 있습니다.",
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
        period: {
          type: "string",
          enum: ["all", "this_week"],
          description:
            "조회 기간. all(기본): 전체, this_week: 이번 주 추천/종료 건만",
        },
      },
      required: [],
    },
  },

  async execute(input) {
    const period = input.period === "this_week" ? "this_week" : "all";

    if (period === "this_week") {
      return executeThisWeek();
    }

    const statusFilter =
      typeof input.status === "string" ? input.status : "ALL";
    const limit = validateNumber(input.limit, DEFAULT_LIMIT);

    const fetchActive = statusFilter === "ACTIVE" || statusFilter === "ALL";
    const fetchClosed = statusFilter === "CLOSED" || statusFilter === "ALL";

    const [activeRecs, closedRecs] = await Promise.all([
      fetchActive
        ? retryDatabaseOperation(() =>
            db
              .select()
              .from(recommendations)
              .where(eq(recommendations.status, "ACTIVE"))
              .orderBy(desc(recommendations.recommendationDate))
              .limit(limit),
          )
        : Promise.resolve([]),
      fetchClosed
        ? retryDatabaseOperation(() =>
            db
              .select()
              .from(recommendations)
              .where(ne(recommendations.status, "ACTIVE"))
              .orderBy(desc(recommendations.closeDate))
              .limit(limit),
          )
        : Promise.resolve([]),
    ]);

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

    const trailingStopCount = allClosed.filter(
      (r) => r.status === "CLOSED_TRAILING_STOP",
    ).length;
    const phaseExitCount = allClosed.filter(
      (r) => r.status === "CLOSED_PHASE_EXIT",
    ).length;
    const stopLossCount = allClosed.filter(
      (r) => r.status === "CLOSED_STOP_LOSS",
    ).length;

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
      closedByReason: {
        phaseExit: phaseExitCount,
        trailingStop: trailingStopCount,
        stopLoss: stopLossCount,
        other: closedRecs.length - phaseExitCount - trailingStopCount - stopLossCount,
      },
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

async function executeThisWeek(): Promise<string> {
  const weekStart = getThisWeekMonday();

  const [newThisWeek, closedThisWeek, phaseExits] = await Promise.all([
    retryDatabaseOperation(() =>
      db
        .select()
        .from(recommendations)
        .where(
          sql`${recommendations.recommendationDate} >= ${weekStart}`,
        )
        .orderBy(desc(recommendations.recommendationDate)),
    ),
    retryDatabaseOperation(() =>
      db
        .select()
        .from(recommendations)
        .where(sql`${recommendations.closeDate} >= ${weekStart}`)
        .orderBy(desc(recommendations.closeDate)),
    ),
    retryDatabaseOperation(() =>
      db
        .select()
        .from(recommendations)
        .where(
          sql`${recommendations.status} = 'ACTIVE' AND ${recommendations.currentPhase} != ${recommendations.entryPhase} AND ${recommendations.lastUpdated} >= ${weekStart}`,
        ),
    ),
  ]);

  const closedWithPnl = closedThisWeek.filter((r) => r.pnlPercent != null);
  const winners = closedWithPnl.filter((r) => toNum(r.pnlPercent) > 0);
  const weekAvgPnl =
    closedWithPnl.length > 0
      ? closedWithPnl.reduce((sum, r) => sum + toNum(r.pnlPercent), 0) /
        closedWithPnl.length
      : 0;

  const weekTrailingStopCount = closedThisWeek.filter(
    (r) => r.status === "CLOSED_TRAILING_STOP",
  ).length;
  const weekPhaseExitCount = closedThisWeek.filter(
    (r) => r.status === "CLOSED_PHASE_EXIT",
  ).length;
  const weekStopLossCount = closedThisWeek.filter(
    (r) => r.status === "CLOSED_STOP_LOSS",
  ).length;

  return JSON.stringify({
    period: "this_week",
    weekStart,
    weeklySummary: {
      newCount: newThisWeek.length,
      closedCount: closedThisWeek.length,
      weekWinRate:
        closedWithPnl.length > 0
          ? Math.round((winners.length / closedWithPnl.length) * 100)
          : 0,
      weekAvgPnl: Math.round(weekAvgPnl * 100) / 100,
      closedByReason: {
        phaseExit: weekPhaseExitCount,
        trailingStop: weekTrailingStopCount,
        stopLoss: weekStopLossCount,
        other: closedThisWeek.length - weekPhaseExitCount - weekTrailingStopCount - weekStopLossCount,
      },
    },
    phaseExits: phaseExits.map((r) => ({
      symbol: r.symbol,
      date: r.recommendationDate,
      entryPhase: r.entryPhase,
      currentPhase: r.currentPhase,
      pnlPercent: Math.round(toNum(r.pnlPercent) * 100) / 100,
      daysHeld: r.daysHeld ?? 0,
    })),
    newThisWeek: newThisWeek.map((r) => ({
      symbol: r.symbol,
      date: r.recommendationDate,
      entryPrice: toNum(r.entryPrice),
      currentPrice: toNum(r.currentPrice),
      pnlPercent: Math.round(toNum(r.pnlPercent) * 100) / 100,
      currentPhase: r.currentPhase,
    })),
    closedThisWeek: closedThisWeek.map((r) => ({
      symbol: r.symbol,
      date: r.recommendationDate,
      closeDate: r.closeDate,
      pnlPercent: Math.round(toNum(r.pnlPercent) * 100) / 100,
      closeReason: r.closeReason,
    })),
  });
}
