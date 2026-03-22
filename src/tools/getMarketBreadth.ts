import { retryDatabaseOperation } from "@/etl/utils/retry";
import { toNum } from "@/etl/utils/common";
import type { AgentTool } from "./types";
import { clampPercent, validateDate } from "./validation";
import {
  findTradingDates,
  findWeeklyTrend,
  findWeeklyPhase1to2Transitions,
  findPhaseDistribution,
  findPrevDayPhase2Ratio,
  findMarketAvgRs,
  findAdvanceDecline,
  findNewHighLow,
  findBreadthTopSectors,
} from "@/db/repositories/index.js";

/**
 * 전체 시장 브레드스 지표를 조회한다.
 * Phase 분포, Phase 2 비율, 전일 대비 변화, 시장 RS 평균.
 */
export const getMarketBreadth: AgentTool = {
  definition: {
    name: "get_market_breadth",
    description:
      "전체 시장 브레드스 지표를 조회합니다. Phase별 종목 분포, Phase 2 비율 및 전일 대비 변화, 시장 평균 RS 등을 반환합니다.",
    input_schema: {
      type: "object" as const,
      properties: {
        date: {
          type: "string",
          description: "조회 날짜 (YYYY-MM-DD)",
        },
        mode: {
          type: "string",
          enum: ["daily", "weekly"],
          description:
            "조회 모드. daily(기본): 단일 날짜, weekly: 5거래일 추이",
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

    const mode = input.mode === "weekly" ? "weekly" : "daily";

    if (mode === "weekly") {
      // 5거래일 날짜 목록 조회
      const dateRows = await retryDatabaseOperation(() =>
        findTradingDates(date, 5),
      );

      const dates = dateRows.map((r) => r.date).reverse();

      if (dates.length === 0) {
        return JSON.stringify({ error: "No data available for the given date" });
      }

      // 각 날짜의 Phase 2 비율 + 시장 RS 일괄 조회
      const trendRows = await retryDatabaseOperation(() =>
        findWeeklyTrend(dates),
      );

      const weeklyTrend = trendRows.map((r) => {
        const t = toNum(r.total);
        const p2 = toNum(r.phase2_count);
        return {
          date: r.date,
          phase2Ratio: t > 0
            ? clampPercent(Number(((p2 / t) * 100).toFixed(1)), "weeklyTrend:phase2Ratio")
            : 0,
          marketAvgRs: toNum(r.avg_rs),
        };
      });

      // 주간 Phase 1→2 전환 종목 수 합계
      const transRow = await retryDatabaseOperation(() =>
        findWeeklyPhase1to2Transitions(dates),
      );

      const phase1to2Transitions = toNum(transRow.transitions);

      // 가장 최근 날짜 기준으로 daily 상세 데이터 조회
      const latestDate = dates[dates.length - 1];

      // Phase 분포
      const phaseRows = await retryDatabaseOperation(() =>
        findPhaseDistribution(latestDate),
      );

      const total = phaseRows.reduce((sum, r) => sum + toNum(r.count), 0);
      const phaseDistribution = Object.fromEntries(
        phaseRows.map((r) => [`phase${r.phase}`, toNum(r.count)]),
      );

      // 시장 평균 RS (최신 날짜)
      const latestTrend = weeklyTrend[weeklyTrend.length - 1];
      const firstTrend = weeklyTrend[0];

      // phase2RatioChange: 주초 대비 변화 (null은 이중변환 감지 시 발생 — NaN으로 처리)
      const phase2RatioChange =
        latestTrend != null &&
        firstTrend != null &&
        latestTrend.phase2Ratio != null &&
        firstTrend.phase2Ratio != null
          ? Number((latestTrend.phase2Ratio - firstTrend.phase2Ratio).toFixed(1))
          : 0;

      // A/D ratio (최신 날짜)
      const adRow = await retryDatabaseOperation(() =>
        findAdvanceDecline(latestDate),
      );

      const advancers = toNum(adRow.advancers);
      const decliners = toNum(adRow.decliners);
      const unchanged = toNum(adRow.unchanged);
      const adRatio =
        decliners > 0
          ? Number((advancers / decliners).toFixed(2))
          : null;

      // 52주 신고가/신저가 (최신 날짜)
      const hlRow = await retryDatabaseOperation(() =>
        findNewHighLow(latestDate),
      );

      const newHighs = toNum(hlRow.new_highs);
      const newLows = toNum(hlRow.new_lows);

      // 상위 섹터 요약 (최신 날짜)
      const topSectors = await retryDatabaseOperation(() =>
        findBreadthTopSectors(latestDate, 5),
      );

      return JSON.stringify({
        _note: "phase2Ratio는 이미 퍼센트(0~100). 절대 ×100 하지 마세요",
        mode: "weekly",
        dates,
        weeklyTrend,
        phase1to2Transitions,
        latestSnapshot: {
          date: latestDate,
          totalStocks: total,
          phaseDistribution,
          phase2Ratio: latestTrend?.phase2Ratio ?? 0,
          phase2RatioChange,
          marketAvgRs: latestTrend?.marketAvgRs ?? 0,
          advanceDecline: { advancers, decliners, unchanged, ratio: adRatio },
          newHighLow: {
            newHighs,
            newLows,
            ratio:
              newLows > 0
                ? Number((newHighs / newLows).toFixed(2))
                : null,
          },
          topSectors: topSectors.map((s) => ({
            sector: s.sector,
            avgRs: toNum(s.avg_rs),
            groupPhase: s.group_phase,
          })),
        },
      });
    }

    // daily 모드 (기존 로직)

    // Phase 분포
    const phaseRows = await retryDatabaseOperation(() =>
      findPhaseDistribution(date),
    );

    const total = phaseRows.reduce((sum, r) => sum + toNum(r.count), 0);
    const phaseDistribution = Object.fromEntries(
      phaseRows.map((r) => [`phase${r.phase}`, toNum(r.count)]),
    );
    const phase2Count = phaseDistribution.phase2 ?? 0;
    const phase2Ratio = total > 0 ? phase2Count / total : 0;

    // 전일 Phase 2 비율 (변화 계산용)
    const prevRow = await retryDatabaseOperation(() =>
      findPrevDayPhase2Ratio(date),
    );

    const prevTotal = toNum(prevRow.total_count);
    const prevPhase2Count = toNum(prevRow.phase2_count);
    const prevPhase2Ratio = prevTotal > 0 ? prevPhase2Count / prevTotal : 0;

    // 시장 평균 RS
    const rsRow = await retryDatabaseOperation(() =>
      findMarketAvgRs(date),
    );

    // 상승/하락/보합 종목수 (Advance/Decline)
    const adRow = await retryDatabaseOperation(() =>
      findAdvanceDecline(date),
    );

    const advancers = toNum(adRow.advancers);
    const decliners = toNum(adRow.decliners);
    const unchanged = toNum(adRow.unchanged);
    const adRatio = decliners > 0 ? Number((advancers / decliners).toFixed(2)) : null;

    // 52주 신고가/신저가
    const hlRow = await retryDatabaseOperation(() =>
      findNewHighLow(date),
    );

    const newHighs = toNum(hlRow.new_highs);
    const newLows = toNum(hlRow.new_lows);

    // 상위 섹터 요약
    const topSectors = await retryDatabaseOperation(() =>
      findBreadthTopSectors(date, 5),
    );

    return JSON.stringify({
      _note: "phase2Ratio는 이미 퍼센트(0~100). 절대 ×100 하지 마세요",
      date,
      totalStocks: total,
      phaseDistribution,
      phase2Ratio: clampPercent(
        Number((phase2Ratio * 100).toFixed(1)),
        "daily:phase2Ratio",
      ) ?? 0,
      phase2RatioChange: Number(
        ((phase2Ratio - prevPhase2Ratio) * 100).toFixed(1),
      ),
      marketAvgRs: toNum(rsRow.avg_rs),
      advanceDecline: { advancers, decliners, unchanged, ratio: adRatio },
      newHighLow: { newHighs, newLows, ratio: newLows > 0 ? Number((newHighs / newLows).toFixed(2)) : null },
      topSectors: topSectors.map((s) => ({
        sector: s.sector,
        avgRs: toNum(s.avg_rs),
        groupPhase: s.group_phase,
      })),
    });
  },
};
