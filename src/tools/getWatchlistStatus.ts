/**
 * getWatchlistStatus — 관심종목 현황 조회 도구.
 *
 * 에이전트가 일간/주간 리포트 작성 시 ACTIVE 관심종목의 현황을 조회한다.
 * Phase 궤적, 등록일, 현재 성과를 포함하여 반환한다.
 */

import { retryDatabaseOperation } from "@/etl/utils/retry";
import { toNum } from "@/etl/utils/common";
import { findActiveWatchlist } from "@/db/repositories/watchlistRepository.js";
import type { AgentTool } from "./types";
import type { TrajectoryPoint } from "@/lib/watchlistTracker.js";

// ─── Types ────────────────────────────────────────────────────────────────────

interface WatchlistStatusItem {
  symbol: string;
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
  priceAtEntry: number | null;
  currentPrice: number | null;
  pnlPercent: number | null;
  maxPnlPercent: number | null;
  sectorRelativePerf: number | null;
  phaseTrajectory: TrajectoryPoint[];
  entryReason: string | null;
  hasThesisBasis: boolean;
}

// ─── Tool Definition ─────────────────────────────────────────────────────────

/**
 * ACTIVE 관심종목 현황을 조회하는 도구.
 * 에이전트가 관심종목의 Phase 궤적, 등록일, 현재 성과를 확인하는 데 사용.
 */
export const getWatchlistStatus: AgentTool = {
  definition: {
    name: "get_watchlist_status",
    description:
      "ACTIVE 관심종목 목록과 각 종목의 Phase 궤적, 등록일, 현재 성과를 조회합니다. 일간/주간 브리핑 작성 시 사용하세요.",
    input_schema: {
      type: "object" as const,
      properties: {
        include_trajectory: {
          type: "boolean",
          description:
            "phase_trajectory 전체 이력을 포함할지 여부 (기본: false — 최근 7일만). true이면 전체 이력 반환.",
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

    const activeItems = await retryDatabaseOperation(() => findActiveWatchlist());

    if (activeItems.length === 0) {
      return JSON.stringify({
        count: 0,
        items: [],
        message: "현재 ACTIVE 관심종목이 없습니다.",
      });
    }

    const items: WatchlistStatusItem[] = activeItems.map((row) => {
      const fullTrajectory: TrajectoryPoint[] = row.phase_trajectory ?? [];

      // 최근 7일만 반환 (includeFullTrajectory === false)
      const trajectoryToReturn = includeFullTrajectory
        ? fullTrajectory
        : fullTrajectory.slice(-7);

      const priceAtEntry = row.price_at_entry != null ? toNum(row.price_at_entry) : null;
      const currentPrice = row.current_price != null ? toNum(row.current_price) : null;
      const pnlPercent = row.pnl_percent != null ? toNum(row.pnl_percent) : null;
      const maxPnlPercent = row.max_pnl_percent != null ? toNum(row.max_pnl_percent) : null;
      const sectorRelativePerf =
        row.sector_relative_perf != null ? toNum(row.sector_relative_perf) : null;

      return {
        symbol: row.symbol,
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
        priceAtEntry: priceAtEntry === 0 ? null : priceAtEntry,
        currentPrice: currentPrice === 0 ? null : currentPrice,
        pnlPercent: pnlPercent === 0 ? 0 : pnlPercent,
        maxPnlPercent: maxPnlPercent === 0 ? 0 : maxPnlPercent,
        sectorRelativePerf,
        phaseTrajectory: trajectoryToReturn,
        entryReason: row.entry_reason,
        hasThesisBasis: row.entry_thesis_id != null,
      };
    });

    // Phase 전이 탐지 (진입 Phase와 현재 Phase가 다른 항목)
    const phaseChanges = items.filter(
      (item) =>
        item.currentPhase != null && item.currentPhase !== item.entryPhase,
    );

    const summary = {
      totalActive: items.length,
      phaseChanges: phaseChanges.map((item) => ({
        symbol: item.symbol,
        entryPhase: item.entryPhase,
        currentPhase: item.currentPhase,
        daysTracked: item.daysTracked,
      })),
      avgPnlPercent:
        items.length > 0
          ? Math.round(
              (items
                .filter((item) => item.pnlPercent != null)
                .reduce((sum, item) => sum + (item.pnlPercent ?? 0), 0) /
                Math.max(
                  1,
                  items.filter((item) => item.pnlPercent != null).length,
                )) *
                100,
            ) / 100
          : 0,
    };

    return JSON.stringify({ summary, items });
  },
};
