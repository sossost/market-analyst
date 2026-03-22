/**
 * dailyQA — DB 실제 수치와 리포트 데이터를 대조하는 QA 오케스트레이터.
 *
 * DB 쿼리 실패 시에도 severity 'warn'으로 graceful 반환 — QA 실패가 발송을 막지 않는다.
 */
import { pool } from "@/db/client";
import {
  runFactCheck,
  type DbData,
  type ReportData,
  type Mismatch,
  type Severity,
} from "@/lib/factChecker";
import { logger } from "@/lib/logger";

// ────────────────────────────────────────────
// Public interface
// ────────────────────────────────────────────

export type { Mismatch, Severity };

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
// DB query helpers
// ────────────────────────────────────────────

interface TopSectorRow {
  sector: string;
  avg_rs: string;
}

async function fetchTopSectors(date: string): Promise<TopSectorRow[]> {
  const { rows } = await pool.query<TopSectorRow>(
    `SELECT sector, avg_rs::text
     FROM sector_rs_daily
     WHERE date = $1
     ORDER BY avg_rs::numeric DESC
     LIMIT $2`,
    [date, TOP_SECTOR_COUNT],
  );
  return rows;
}

interface Phase2RatioRow {
  total: string;
  phase2_count: string;
}

async function fetchPhase2Ratio(date: string): Promise<Phase2RatioRow | null> {
  const { rows } = await pool.query<Phase2RatioRow>(
    `SELECT
       COUNT(*)::text AS total,
       COUNT(*) FILTER (WHERE sp.phase = 2)::text AS phase2_count
     FROM stock_phases sp
     JOIN symbols s ON sp.symbol = s.symbol
     WHERE sp.date = $1
       AND s.is_actively_trading = true
       AND s.is_etf = false
       AND s.is_fund = false`,
    [date],
  );
  return rows[0] ?? null;
}

interface StockPhaseRow {
  symbol: string;
  phase: number;
  rs_score: number | null;
}

async function fetchStockPhases(
  date: string,
  symbols: string[],
): Promise<StockPhaseRow[]> {
  if (symbols.length === 0) return [];

  const { rows } = await pool.query<StockPhaseRow>(
    `SELECT symbol, phase, rs_score
     FROM stock_phases
     WHERE date = $1 AND symbol = ANY($2)`,
    [date, symbols],
  );
  return rows;
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
): Promise<DailyQAResult> {
  try {
    // DB 조회
    const symbols = reportData.reportedSymbols.map((s) => s.symbol);
    const [sectorRows, phase2Row, stockRows] = await Promise.all([
      fetchTopSectors(date),
      fetchPhase2Ratio(date),
      fetchStockPhases(date, symbols),
    ]);

    if (sectorRows.length === 0) {
      logger.info("DailyQA",`[DailyQA] ${date}: sector_rs_daily 데이터 없음 — 섹터 검증 스킵`);
    }
    if (phase2Row == null || Number(phase2Row.total) === 0) {
      logger.info("DailyQA",`[DailyQA] ${date}: stock_phases 데이터 없음 — Phase 2 비율 검증 스킵`);
    }

    // DbData 변환 + 팩트 체크
    const dbData = toDbData(sectorRows, phase2Row, stockRows);
    const result = runFactCheck(dbData, reportData);

    logger.info("DailyQA",
      `[DailyQA] ${date}: ${result.checkedItems}건 검증, ${result.mismatches.length}건 불일치 (severity: ${result.severity})`,
    );

    return {
      date,
      severity: result.severity,
      mismatches: result.mismatches,
      checkedItems: result.checkedItems,
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
