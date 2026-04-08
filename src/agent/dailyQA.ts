/**
 * dailyQA — DB 실제 수치와 리포트 데이터를 대조하는 QA 오케스트레이터.
 *
 * DB 쿼리 실패 시에도 severity 'warn'으로 graceful 반환 — QA 실패가 발송을 막지 않는다.
 */
import {
  runFactCheck,
  runContentQA,
  aggregateSeverity,
  type DbData,
  type ReportData,
  type ContentQAInput,
  type Mismatch,
  type Severity,
} from "@/lib/factChecker";
import { logger } from "@/lib/logger";
import {
  findTopSectorsForQa,
  findPhase2RatioForQa,
  findStockPhasesForQa,
} from "@/db/repositories/index.js";

// ────────────────────────────────────────────
// Public interface
// ────────────────────────────────────────────

export type { Mismatch, Severity, ContentQAInput };

export interface DailyQAResult {
  date: string;
  severity: Severity;
  mismatches: Mismatch[];
  checkedItems: number;
  checkedAt: string;
}

// ────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────

const TOP_SECTOR_COUNT = 5;

// ────────────────────────────────────────────
// Internal row types (kept local for QA-specific shape)
// ────────────────────────────────────────────

interface TopSectorRow {
  sector: string;
  avg_rs: string;
}

interface Phase2RatioRow {
  total: string;
  phase2_count: string;
}

interface StockPhaseRow {
  symbol: string;
  phase: number;
  rs_score: number | null;
}

// ────────────────────────────────────────────
// DB rows → DbData 변환
// ────────────────────────────────────────────

function toDbData(
  sectorRows: TopSectorRow[],
  phase2Row: Phase2RatioRow | null,
  stockRows: StockPhaseRow[],
): DbData {
  const topSectors = sectorRows.map((r) => ({
    sector: r.sector,
    avgRs: Number(r.avg_rs),
  }));

  let phase2Ratio = NaN;
  if (phase2Row != null) {
    const total = Number(phase2Row.total);
    if (total > 0) {
      const phase2Count = Number(phase2Row.phase2_count);
      phase2Ratio = Number(((phase2Count / total) * 100).toFixed(1));
    }
  }

  const stocks = stockRows
    .filter((r): r is StockPhaseRow & { rs_score: number } => r.rs_score != null)
    .map((r) => ({
      symbol: r.symbol,
      phase: r.phase,
      rsScore: r.rs_score,
    }));

  return { topSectors, phase2Ratio, stocks };
}

// ────────────────────────────────────────────
// Main orchestrator
// ────────────────────────────────────────────

export async function runDailyQA(
  date: string,
  reportData: ReportData,
  contentQAInput?: ContentQAInput,
): Promise<DailyQAResult> {
  try {
    // DB 조회
    const symbols = reportData.reportedSymbols.map((s) => s.symbol);
    const [sectorRows, phase2Row, stockRows] = await Promise.all([
      findTopSectorsForQa(date, TOP_SECTOR_COUNT),
      findPhase2RatioForQa(date),
      findStockPhasesForQa(date, symbols),
    ]);

    if (sectorRows.length === 0) {
      logger.info("DailyQA",`[DailyQA] ${date}: sector_rs_daily 데이터 없음 — 섹터 검증 스킵`);
    }
    if (phase2Row == null || Number(phase2Row.total) === 0) {
      logger.info("DailyQA",`[DailyQA] ${date}: stock_phases 데이터 없음 — Phase 2 비율 검증 스킵`);
    }

    // DbData 변환 + 팩트 체크
    const dbData = toDbData(sectorRows, phase2Row, stockRows);
    const factResult = runFactCheck(dbData, reportData);

    // 콘텐츠 QA (insight/html 제공 시)
    let allMismatches = [...factResult.mismatches];
    let totalChecked = factResult.checkedItems;

    if (contentQAInput != null) {
      const contentResult = runContentQA(contentQAInput);
      allMismatches = [...allMismatches, ...contentResult.mismatches];
      totalChecked += contentResult.checkedItems;

      logger.info("DailyQA",
        `[DailyQA] ${date}: 콘텐츠 QA ${contentResult.checkedItems}건 검증, ${contentResult.mismatches.length}건 불일치`,
      );
    }

    // 전체 severity는 모든 mismatch 합산으로 재계산
    const severity = aggregateSeverity(allMismatches);

    logger.info("DailyQA",
      `[DailyQA] ${date}: 총 ${totalChecked}건 검증, ${allMismatches.length}건 불일치 (severity: ${severity})`,
    );

    return {
      date,
      severity,
      mismatches: allMismatches,
      checkedItems: totalChecked,
      checkedAt: new Date().toISOString(),
    };
  } catch (error) {
    logger.info("DailyQA",
      `[DailyQA] DB 쿼리 실패 — graceful warn 반환: ${error instanceof Error ? error.message : String(error)}`,
    );
    return {
      date,
      severity: "warn",
      mismatches: [
        {
          type: "db_error",
          field: "db_query",
          expected: "N/A",
          actual: "N/A",
          severity: "warn",
        },
      ],
      checkedItems: 0,
      checkedAt: new Date().toISOString(),
    };
  }
}
