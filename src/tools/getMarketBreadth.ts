import { retryDatabaseOperation } from "@/etl/utils/retry";
import { toNum, toDivergenceSignal } from "@/etl/utils/common";
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
  findMarketBreadthSnapshot,
  findMarketBreadthSnapshots,
  findPhase1To2Count1d,
  findPhase2To3Count1d,
} from "@/db/repositories/index.js";

/**
 * weekly 모드 실행: 5거래일 추이 + 최신 스냅샷.
 * market_breadth_daily 배치 조회를 먼저 시도하고, 미완성 시 집계 쿼리로 폴백.
 */
async function executeWeeklyMode(date: string): Promise<string> {
  const dateRows = await retryDatabaseOperation(() =>
    findTradingDates(date, 5),
  );

  const dates = dateRows.map((r) => r.date).reverse();

  if (dates.length === 0) {
    return JSON.stringify({ error: "No data available for the given date" });
  }

  const latestDate = dates[dates.length - 1];

  // 스냅샷 배치 조회 시도
  const snapshots = await retryDatabaseOperation(() =>
    findMarketBreadthSnapshots(dates),
  );

  if (snapshots.length === dates.length) {
    // 스냅샷 완전 히트 — 집계 쿼리 불필요
    const weeklyTrend = snapshots.map((s) => ({
      date: s.date,
      phase2Ratio: clampPercent(toNum(s.phase2_ratio), `weeklyTrend:${s.date}:phase2Ratio`) ?? 0,
      marketAvgRs: s.market_avg_rs != null ? toNum(s.market_avg_rs) : 0,
    }));

    const latestSnap = snapshots[snapshots.length - 1];
    const firstSnap = snapshots[0];

    const phase1to2Transitions = snapshots[snapshots.length - 1]?.phase1_to2_count_5d ?? 0;

    const phase2RatioChange =
      latestSnap != null && firstSnap != null
        ? Number((toNum(latestSnap.phase2_ratio) - toNum(firstSnap.phase2_ratio)).toFixed(1))
        : 0;

    const latestTrend = weeklyTrend[weeklyTrend.length - 1];
    const advancers = latestSnap?.advancers ?? 0;
    const decliners = latestSnap?.decliners ?? 0;
    const unchanged = latestSnap?.unchanged ?? 0;
    const adRatio = latestSnap?.ad_ratio != null ? toNum(latestSnap.ad_ratio) : null;
    const newHighs = latestSnap?.new_highs ?? 0;
    const newLows = latestSnap?.new_lows ?? 0;
    const hlRatio = latestSnap?.hl_ratio != null ? toNum(latestSnap.hl_ratio) : null;

    const phaseDistribution = {
      phase1: latestSnap?.phase1_count ?? 0,
      phase2: latestSnap?.phase2_count ?? 0,
      phase3: latestSnap?.phase3_count ?? 0,
      phase4: latestSnap?.phase4_count ?? 0,
    };
    const total = latestSnap?.total_stocks ?? 0;

    const topSectors = await retryDatabaseOperation(() =>
      findBreadthTopSectors(latestDate, 5),
    );

    const latestBreadthScore = latestSnap?.breadth_score != null ? toNum(latestSnap.breadth_score) : null;
    const latestDivergenceSignal = toDivergenceSignal(latestSnap?.divergence_signal);

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
        newHighLow: { newHighs, newLows, ratio: hlRatio },
        breadthScore: latestBreadthScore,
        divergenceSignal: latestDivergenceSignal,
        topSectors: topSectors.map((s) => ({
          sector: s.sector,
          avgRs: toNum(s.avg_rs),
          groupPhase: s.group_phase,
        })),
      },
    });
  }

  // 폴백: 집계 쿼리 사용 (스냅샷 미완성 시)
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

  const transRow = await retryDatabaseOperation(() =>
    findWeeklyPhase1to2Transitions(dates),
  );

  const phase1to2Transitions = toNum(transRow.transitions);

  const phaseRows = await retryDatabaseOperation(() =>
    findPhaseDistribution(latestDate),
  );

  const total = phaseRows.reduce((sum, r) => sum + toNum(r.count), 0);
  const phaseDistribution = Object.fromEntries(
    phaseRows.map((r) => [`phase${r.phase}`, toNum(r.count)]),
  );

  const latestTrend = weeklyTrend[weeklyTrend.length - 1];
  const firstTrend = weeklyTrend[0];

  const phase2RatioChange =
    latestTrend != null &&
    firstTrend != null &&
    latestTrend.phase2Ratio != null &&
    firstTrend.phase2Ratio != null
      ? Number((latestTrend.phase2Ratio - firstTrend.phase2Ratio).toFixed(1))
      : 0;

  const adRow = await retryDatabaseOperation(() =>
    findAdvanceDecline(latestDate),
  ).catch(() => null);

  const advancers = adRow != null ? toNum(adRow.advancers) : 0;
  const decliners = adRow != null ? toNum(adRow.decliners) : 0;
  const unchanged = adRow != null ? toNum(adRow.unchanged) : 0;
  const adRatio = decliners > 0 ? Number((advancers / decliners).toFixed(2)) : null;

  const hlRow = await retryDatabaseOperation(() =>
    findNewHighLow(latestDate),
  ).catch(() => null);

  const newHighs = hlRow != null ? toNum(hlRow.new_highs) : 0;
  const newLows = hlRow != null ? toNum(hlRow.new_lows) : 0;

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
        ratio: newLows > 0 ? Number((newHighs / newLows).toFixed(2)) : null,
      },
      topSectors: topSectors.map((s) => ({
        sector: s.sector,
        avgRs: toNum(s.avg_rs),
        groupPhase: s.group_phase,
      })),
    },
  });
}

/**
 * daily 모드 실행: 단일 날짜 스냅샷.
 * market_breadth_daily 단건 조회를 먼저 시도하고, 없으면 집계 쿼리로 폴백.
 */
async function executeDailyMode(date: string): Promise<string> {
  const snapshot = await retryDatabaseOperation(() =>
    findMarketBreadthSnapshot(date),
  );

  if (snapshot != null) {
    // 스냅샷 히트 — 단순 조회
    const phase2Ratio = clampPercent(toNum(snapshot.phase2_ratio), "daily:phase2Ratio") ?? 0;
    const phase2RatioChange = snapshot.phase2_ratio_change != null
      ? toNum(snapshot.phase2_ratio_change)
      : 0;
    const advancers = snapshot.advancers ?? 0;
    const decliners = snapshot.decliners ?? 0;
    const unchanged = snapshot.unchanged ?? 0;
    const adRatio = snapshot.ad_ratio != null ? toNum(snapshot.ad_ratio) : null;
    const newHighs = snapshot.new_highs ?? 0;
    const newLows = snapshot.new_lows ?? 0;
    const hlRatio = snapshot.hl_ratio != null ? toNum(snapshot.hl_ratio) : null;
    const breadthScore = snapshot.breadth_score != null ? toNum(snapshot.breadth_score) : null;
    const divergenceSignal = toDivergenceSignal(snapshot.divergence_signal);

    const phaseDistribution = {
      phase1: snapshot.phase1_count,
      phase2: snapshot.phase2_count,
      phase3: snapshot.phase3_count,
      phase4: snapshot.phase4_count,
    };

    const topSectors = await retryDatabaseOperation(() =>
      findBreadthTopSectors(date, 5),
    );

    const phase1to2Count1d = snapshot.phase1_to2_count_1d ?? null;
    const phase2to3Count1d = snapshot.phase2_to3_count_1d ?? null;
    const phase2NetFlow =
      phase1to2Count1d != null && phase2to3Count1d != null
        ? phase1to2Count1d - phase2to3Count1d
        : null;
    const phase2EntryAvg5d =
      snapshot.phase1_to2_count_5d != null
        ? Number((snapshot.phase1_to2_count_5d / 5).toFixed(1))
        : null;

    return JSON.stringify({
      _note: "phase2Ratio는 이미 퍼센트(0~100). 절대 ×100 하지 마세요",
      date,
      totalStocks: snapshot.total_stocks,
      phaseDistribution,
      phase2Ratio,
      phase2RatioChange,
      marketAvgRs: snapshot.market_avg_rs != null ? toNum(snapshot.market_avg_rs) : 0,
      advanceDecline: { advancers, decliners, unchanged, ratio: adRatio },
      newHighLow: { newHighs, newLows, ratio: hlRatio },
      breadthScore,
      divergenceSignal,
      phase1to2Count1d,
      phase2to3Count1d,
      phase2NetFlow,
      phase2EntryAvg5d,
      topSectors: topSectors.map((s) => ({
        sector: s.sector,
        avgRs: toNum(s.avg_rs),
        groupPhase: s.group_phase,
      })),
    });
  }

  // 폴백: 집계 쿼리 사용 (스냅샷 없을 때)
  const phaseRows = await retryDatabaseOperation(() =>
    findPhaseDistribution(date),
  );

  const total = phaseRows.reduce((sum, r) => sum + toNum(r.count), 0);
  const phaseDistribution = Object.fromEntries(
    phaseRows.map((r) => [`phase${r.phase}`, toNum(r.count)]),
  );
  const phase2Count = phaseDistribution.phase2 ?? 0;
  const phase2Ratio = total > 0 ? phase2Count / total : 0;

  const prevRow = await retryDatabaseOperation(() =>
    findPrevDayPhase2Ratio(date),
  );

  const prevTotal = toNum(prevRow.total_count);
  const prevPhase2Count = toNum(prevRow.phase2_count);
  const prevPhase2Ratio = prevTotal > 0 ? prevPhase2Count / prevTotal : 0;

  const rsRow = await retryDatabaseOperation(() =>
    findMarketAvgRs(date),
  );

  const adRow = await retryDatabaseOperation(() =>
    findAdvanceDecline(date),
  );

  const advancers = toNum(adRow.advancers);
  const decliners = toNum(adRow.decliners);
  const unchanged = toNum(adRow.unchanged);
  const adRatio = decliners > 0 ? Number((advancers / decliners).toFixed(2)) : null;

  const hlRow = await retryDatabaseOperation(() =>
    findNewHighLow(date),
  );

  const newHighs = toNum(hlRow.new_highs);
  const newLows = toNum(hlRow.new_lows);

  const topSectors = await retryDatabaseOperation(() =>
    findBreadthTopSectors(date, 5),
  );

  const p1to2Count1dRow = await retryDatabaseOperation(() =>
    findPhase1To2Count1d(date),
  ).catch(() => null);

  const p2to3Count1dRow = await retryDatabaseOperation(() =>
    findPhase2To3Count1d(date),
  ).catch(() => null);

  const fallbackPhase1to2Count1d = p1to2Count1dRow != null ? toNum(p1to2Count1dRow.count) : null;
  const fallbackPhase2to3Count1d = p2to3Count1dRow != null ? toNum(p2to3Count1dRow.count) : null;
  const fallbackPhase2NetFlow =
    fallbackPhase1to2Count1d != null && fallbackPhase2to3Count1d != null
      ? fallbackPhase1to2Count1d - fallbackPhase2to3Count1d
      : null;

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
    phase1to2Count1d: fallbackPhase1to2Count1d,
    phase2to3Count1d: fallbackPhase2to3Count1d,
    phase2NetFlow: fallbackPhase2NetFlow,
    // phase1_to2_count_5d는 market_breadth_daily 스냅샷에만 존재 — 폴백 경로에서 계산 불가
    phase2EntryAvg5d: null,
    topSectors: topSectors.map((s) => ({
      sector: s.sector,
      avgRs: toNum(s.avg_rs),
      groupPhase: s.group_phase,
    })),
  });
}

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
      return executeWeeklyMode(date);
    }

    return executeDailyMode(date);
  },
};
