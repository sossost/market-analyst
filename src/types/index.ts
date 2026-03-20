/**
 * Weinstein Phase Detection types.
 */

export type Phase = 1 | 2 | 3 | 4;

export interface PhaseInput {
  price: number;
  ma50: number;
  ma150: number;
  ma200: number;
  ma150_20dAgo: number;
  rsScore: number; // 0-100
  high52w: number;
  low52w: number;
}

export interface PhaseResult {
  phase: Phase;
  ma150Slope: number;
  detail: PhaseDetail;
}

export interface PhaseDetail {
  priceAboveMa150: boolean;
  priceAboveMa200: boolean;
  ma150AboveMa200: boolean;
  ma50AboveMa150: boolean;
  ma150SlopePositive: boolean;
  rsAbove50: boolean;
  priceAbove30PctFromLow: boolean;
  priceWithin25PctOfHigh: boolean;
  conditionsMet: string[];
  /** Number of Phase 2 conditions met (0-8). Used to identify near-Phase-2 stocks. */
  phase2ConditionsMet: number;
}

/**
 * Group RS types (shared by sector and industry).
 */

export type GroupBy = "sector" | "industry";

export interface GroupRsConfig {
  groupBy: GroupBy;
  minStockCount: number;
  targetDate: string;
}

export interface GroupRsRow {
  date: string;
  groupName: string;
  parentGroup?: string; // sector (for industry only)

  avgRs: number;
  rsRank: number;
  stockCount: number;
  change4w: number | null;
  change8w: number | null;
  change12w: number | null;

  groupPhase: Phase;
  prevGroupPhase: Phase | null;

  maOrderedRatio: number;
  phase2Ratio: number;
  rsAbove50Ratio: number;
  newHighRatio: number;

  phase1to2Count5d: number;
  phase2to3Count5d: number;

  revenueAccelRatio: number;
  incomeAccelRatio: number;
  profitableRatio: number;
}

/**
 * Agent Core types.
 */

export interface ReportedStock {
  symbol: string;
  phase: number;
  prevPhase: number | null;
  rsScore: number;
  sector: string;
  industry: string;
  reason: string;
  firstReportedDate: string;
}

export interface DailyReportLog {
  date: string;
  type?: "daily" | "weekly" | "debate";
  reportedSymbols: ReportedStock[];
  marketSummary: {
    phase2Ratio: number;
    leadingSectors: string[];
    totalAnalyzed: number;
  };
  fullContent?: string | null;
  metadata: {
    model: string;
    tokensUsed: { input: number; output: number };
    toolCalls: number;
    executionTime: number;
  };
}
