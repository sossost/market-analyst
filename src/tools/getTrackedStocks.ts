/**
 * getTrackedStocks — 트래킹 종목 현황 조회 도구.
 *
 * getWatchlistStatus를 대체한다.
 * ACTIVE tracked_stocks 전체를 반환하며, source/tier 필터 옵션을 지원한다.
 * phase_trajectory, 듀레이션 수익률(return_7d/30d/90d)을 포함한다.
 */

import { retryDatabaseOperation } from "@/etl/utils/retry";
import { toNum } from "@/etl/utils/common";
import {
  findActiveTrackedStocks,
  findActiveTrackedStocksBySource,
  findActiveTrackedStocksByTier,
  type TrackedStockSource,
  type TrackedStockTier,
  type TrackedStockRow,
} from "@/db/repositories/trackedStocksRepository.js";
import { getPhase2SegmentInfo, type Phase2Segment } from "@/lib/phase2Segment.js";
import type { AgentTool } from "./types";

// ─── Types ────────────────────────────────────────────────────────────────────

interface TrajectoryPoint {
  date: string;
  phase: number;
  rsScore: number | null;
}

interface TrackedStockStatusItem {
  symbol: string;
  source: string;
  tier: string;
  entryDate: string;
  trackingEndDate: string | null;
  daysTracked: number;
  entryPhase: number;
  currentPhase: number | null;
  entryRsScore: number | null;
  currentRsScore: number | null;
  entrySector: string | null;
  entryIndustry: string | null;
  entrySepaGrade: string | null;
  entryPrice: number | null;
  currentPrice: number | null;
  pnlPercent: number | null;
  maxPnlPercent: number | null;
  return7d: number | null;
  return30d: number | null;
  return90d: number | null;
  sectorRelativePerf: number | null;
  phaseTrajectory: TrajectoryPoint[];
  entryReason: string | null;
  hasThesisBasis: boolean;
  entryThesisId: number | null;
  phase2Since: string | null;
  phase2SinceDays: number | null;
  phase2Segment: Phase2Segment | null;
  detectionLag: number | null;
  recentPhase2Streak: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * phase_trajectory 전체에서 뒤에서부터 연속 Phase 2인 일수를 계산한다.
 * 예: [2,2,3,2,2,2] → 3 (마지막 3일 연속)
 */
export function calcRecentPhase2Streak(trajectory: TrajectoryPoint[]): number {
  let streak = 0;
  for (let i = trajectory.length - 1; i >= 0; i--) {
    if (trajectory[i].phase === 2) {
      streak++;
    } else {
      break;
    }
  }
  return streak;
}

/**
 * entry_date와 phase2_since로 detection_lag(일수)를 계산한다.
 * phase2_since가 null이면 null 반환.
 */
export function calcDetectionLag(entryDate: string, phase2Since: string | null): number | null {
  if (phase2Since == null) return null;
  const entry = new Date(entryDate);
  const p2Start = new Date(phase2Since);
  const diffMs = entry.getTime() - p2Start.getTime();
  return Math.round(diffMs / (1000 * 60 * 60 * 24));
}

const VALID_SOURCES = new Set<string>(["etl_auto", "agent", "thesis_aligned"]);
const VALID_TIERS = new Set<string>(["standard", "featured"]);

// ─── Tool Definition ─────────────────────────────────────────────────────────

/**
 * ACTIVE 트래킹 종목 현황을 조회하는 도구.
 * 에이전트가 일간/주간 리포트 작성 시 사용. source/tier 필터 지원.
 */
export const getTrackedStocks: AgentTool = {
  definition: {
    name: "get_tracked_stocks",
    description:
      "ACTIVE 트래킹 종목 목록과 각 종목의 Phase 궤적, 듀레이션 수익률, 현재 성과를 조회합니다. source(etl_auto/agent/thesis_aligned)와 tier(standard/featured)로 필터할 수 있습니다.",
    input_schema: {
      type: "object" as const,
      properties: {
        include_trajectory: {
          type: "boolean",
          description:
            "phase_trajectory 전체 이력을 포함할지 여부 (기본: false — 최근 7일만). true이면 전체 이력 반환.",
        },
        source: {
          type: "string",
          enum: ["etl_auto", "agent", "thesis_aligned"],
          description: "소스 필터 (선택). 지정 시 해당 source만 반환.",
        },
        tier: {
          type: "string",
          enum: ["standard", "featured"],
          description: "티어 필터 (선택). 지정 시 해당 tier만 반환.",
        },
      },
      required: [],
    },
  },

  async execute(input) {
    const includeFullTrajectory =
      typeof input.include_trajectory === "boolean"
        ? input.include_trajectory
        : false;

    const rawSource = typeof input.source === "string" ? input.source : null;
    const rawTier = typeof input.tier === "string" ? input.tier : null;

    const sourceFilter: TrackedStockSource | null =
      rawSource != null && VALID_SOURCES.has(rawSource)
        ? (rawSource as TrackedStockSource)
        : null;

    const tierFilter: TrackedStockTier | null =
      rawTier != null && VALID_TIERS.has(rawTier)
        ? (rawTier as TrackedStockTier)
        : null;

    let activeItems: TrackedStockRow[];

    if (sourceFilter != null) {
      activeItems = await retryDatabaseOperation(() =>
        findActiveTrackedStocksBySource(sourceFilter),
      );
    } else if (tierFilter != null) {
      activeItems = await retryDatabaseOperation(() =>
        findActiveTrackedStocksByTier(tierFilter),
      );
    } else {
      activeItems = await retryDatabaseOperation(() =>
        findActiveTrackedStocks(),
      );
    }

    if (activeItems.length === 0) {
      return JSON.stringify({
        count: 0,
        items: [],
        message: "현재 ACTIVE 트래킹 종목이 없습니다.",
      });
    }

    const items: TrackedStockStatusItem[] = activeItems.map((row) => {
      const fullTrajectory: TrajectoryPoint[] = row.phase_trajectory ?? [];

      const trajectoryToReturn = includeFullTrajectory
        ? fullTrajectory
        : fullTrajectory.slice(-7);

      const entryPrice = row.entry_price != null ? toNum(row.entry_price) : null;
      const currentPrice = row.current_price != null ? toNum(row.current_price) : null;
      const pnlPercent = row.pnl_percent != null ? toNum(row.pnl_percent) : null;
      const maxPnlPercent = row.max_pnl_percent != null ? toNum(row.max_pnl_percent) : null;
      const return7d = row.return_7d != null ? toNum(row.return_7d) : null;
      const return30d = row.return_30d != null ? toNum(row.return_30d) : null;
      const return90d = row.return_90d != null ? toNum(row.return_90d) : null;
      const sectorRelativePerf =
        row.sector_relative_perf != null ? toNum(row.sector_relative_perf) : null;

      const phase2Info = getPhase2SegmentInfo(row.phase2_since);

      return {
        symbol: row.symbol,
        source: row.source,
        tier: row.tier,
        entryDate: row.entry_date,
        trackingEndDate: row.tracking_end_date,
        daysTracked: row.days_tracked ?? 0,
        entryPhase: row.entry_phase,
        currentPhase: row.current_phase,
        entryRsScore: row.entry_rs_score,
        currentRsScore: row.current_rs_score,
        entrySector: row.entry_sector,
        entryIndustry: row.entry_industry,
        entrySepaGrade: row.entry_sepa_grade,
        entryPrice: entryPrice === 0 ? null : entryPrice,
        currentPrice: currentPrice === 0 ? null : currentPrice,
        pnlPercent: pnlPercent === 0 ? 0 : pnlPercent,
        maxPnlPercent: maxPnlPercent === 0 ? 0 : maxPnlPercent,
        return7d,
        return30d,
        return90d,
        sectorRelativePerf,
        phaseTrajectory: trajectoryToReturn,
        entryReason: row.entry_reason,
        hasThesisBasis: row.entry_thesis_id != null,
        entryThesisId: row.entry_thesis_id,
        phase2Since: row.phase2_since,
        phase2SinceDays: phase2Info?.days ?? null,
        phase2Segment: phase2Info?.segment ?? null,
        detectionLag: calcDetectionLag(row.entry_date, row.phase2_since),
        recentPhase2Streak: calcRecentPhase2Streak(fullTrajectory),
      };
    });

    // Phase 전이 탐지 (진입 Phase와 현재 Phase가 다른 항목)
    const phaseChanges = items.filter(
      (item) =>
        item.currentPhase != null && item.currentPhase !== item.entryPhase,
    );

    const itemsWithPnl = items.filter((item) => item.pnlPercent != null);
    const avgPnlPercent =
      itemsWithPnl.length > 0
        ? Math.round(
            (itemsWithPnl.reduce(
              (sum, item) => sum + (item.pnlPercent ?? 0),
              0,
            ) /
              itemsWithPnl.length) *
              100,
          ) / 100
        : 0;

    const bySource = {
      etl_auto: items.filter((i) => i.source === "etl_auto").length,
      agent: items.filter((i) => i.source === "agent").length,
      thesis_aligned: items.filter((i) => i.source === "thesis_aligned").length,
    };

    const byTier = {
      standard: items.filter((i) => i.tier === "standard").length,
      featured: items.filter((i) => i.tier === "featured").length,
    };

    const summary = {
      totalActive: items.length,
      bySource,
      byTier,
      phaseChanges: phaseChanges.map((item) => ({
        symbol: item.symbol,
        entryPhase: item.entryPhase,
        currentPhase: item.currentPhase,
        daysTracked: item.daysTracked,
        source: item.source,
      })),
      avgPnlPercent,
    };

    return JSON.stringify({ summary, items });
  },
};
