/**
 * debateQA — 투자 브리핑(토론 Round 3 합성) 사후 품질 검증.
 *
 * 1. bull-bias 감지: 전체 thesis가 bullish인데 bearish/리스크 관점이 없으면 경고
 * 2. 데이터 정합성: thesis에서 언급한 섹터/종목이 DB 실측값과 일치하는지 대조
 *
 * DB 쿼리 실패 시에도 severity 'warn'으로 graceful 반환 — QA 실패가 발송을 막지 않는다.
 */
import { pool } from "@/db/client";
import { logger } from "@/lib/logger";
import type { Thesis } from "@/types/debate";
import type { Mismatch, Severity } from "@/lib/factChecker";

// ────────────────────────────────────────────
// Public interface
// ────────────────────────────────────────────

export { type Mismatch, type Severity };

export interface DebateQAResult {
  date: string;
  severity: Severity;
  mismatches: Mismatch[];
  checkedItems: number;
  checkedAt: string;
}

// ────────────────────────────────────────────
// Bull-bias detection (pure function)
// ────────────────────────────────────────────

/**
 * thesis 전체가 bullish이고 bearish/리스크 관점이 전혀 없으면 bull-bias 경고를 반환한다.
 *
 * Bullish 판정 기준:
 * - thesis 텍스트에 "상승", "수혜", "성장", "긍정", "확대" 등 bullish 키워드 포함
 * - bearish 키워드("하락", "리스크", "위험", "과열", "약세", "경고", "조정", "둔화") 미포함
 *
 * bull-bias 조건:
 * - thesis 3건 이상 AND 전체가 bullish AND bearish 관점 0건
 */
const BULLISH_KEYWORDS = ["상승", "수혜", "성장", "긍정", "확대", "강세", "돌파", "진입", "모멘텀"];
const BEARISH_KEYWORDS = ["하락", "리스크", "위험", "과열", "약세", "경고", "조정", "둔화", "위축", "매도"];

const BULL_BIAS_MIN_THESES = 3;

export function detectBullBias(theses: Thesis[]): Mismatch | null {
  if (theses.length < BULL_BIAS_MIN_THESES) {
    return null;
  }

  const hasBearishView = theses.some(
    (t) =>
      t.minorityView?.position === "bearish" ||
      BEARISH_KEYWORDS.some((kw) => t.thesis.includes(kw)),
  );

  if (hasBearishView) {
    return null;
  }

  const allAreBullish = theses.every((t) =>
    BULLISH_KEYWORDS.some((kw) => t.thesis.includes(kw)),
  );

  if (allAreBullish) {
    return {
      type: "sector_list", // 기존 MismatchType 재사용
      field: "bull_bias",
      expected: "bullish + bearish 균형",
      actual: `전체 ${theses.length}건 bullish, bearish 0건`,
      severity: "warn",
    };
  }

  return null;
}

// ────────────────────────────────────────────
// Sector accuracy check
// ────────────────────────────────────────────

interface SectorRow {
  sector: string;
  group_phase: number;
}

async function fetchSectorPhases(date: string): Promise<SectorRow[]> {
  const { rows } = await pool.query<SectorRow>(
    `SELECT sector, group_phase
     FROM sector_rs_daily
     WHERE date = $1
     ORDER BY avg_rs DESC`,
    [date],
  );
  return rows;
}

/**
 * thesis에서 언급된 beneficiarySectors가 실제 DB의 섹터 목록에 존재하는지 검증.
 * DB에 없는 섹터를 언급하면 warn.
 */
export function checkSectorAccuracy(
  theses: Thesis[],
  dbSectors: SectorRow[],
): Mismatch[] {
  if (dbSectors.length === 0) return [];

  const dbSectorSet = new Set(dbSectors.map((s) => s.sector));
  const mismatches: Mismatch[] = [];

  const mentionedSectors = new Set(theses.flatMap((t) => t.beneficiarySectors ?? []));

  for (const sector of mentionedSectors) {
    if (!dbSectorSet.has(sector)) {
      mismatches.push({
        type: "sector_list",
        field: `beneficiarySector:${sector}`,
        expected: "DB에 존재하는 섹터",
        actual: `${sector} (DB에 없음)`,
        severity: "warn",
      });
    }
  }

  return mismatches;
}

// ────────────────────────────────────────────
// Ticker accuracy check
// ────────────────────────────────────────────

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

/**
 * thesis에서 언급된 beneficiaryTickers의 phase를 DB와 대조.
 * Phase 2(상승 초입)로 언급된 종목이 실제로 다른 phase이면 warn.
 */
export function checkTickerAccuracy(
  theses: Thesis[],
  dbStocks: StockPhaseRow[],
): Mismatch[] {
  if (dbStocks.length === 0) return [];

  const dbStockMap = new Map(dbStocks.map((s) => [s.symbol, s]));
  const mismatches: Mismatch[] = [];

  for (const t of theses) {
    if (t.beneficiaryTickers == null) continue;
    for (const ticker of t.beneficiaryTickers) {
      const dbStock = dbStockMap.get(ticker);
      if (dbStock == null) continue; // DB에 없으면 스킵

      // Phase 불일치 체크 — thesis가 특정 종목을 수혜주로 언급했는데 phase가 1 이하이면 경고
      if (dbStock.phase <= 1) {
        mismatches.push({
          type: "symbol_phase",
          field: `${ticker}.phase`,
          expected: `Phase 2+ (수혜주로 언급됨)`,
          actual: `Phase ${dbStock.phase}`,
          severity: "warn",
        });
      }
    }
  }

  return mismatches;
}

// ────────────────────────────────────────────
// Severity aggregation
// ────────────────────────────────────────────

function aggregateSeverity(mismatches: Mismatch[]): Severity {
  if (mismatches.length === 0) return "ok";
  if (mismatches.length === 1) return "warn";
  return "block";
}

// ────────────────────────────────────────────
// Main orchestrator
// ────────────────────────────────────────────

export async function runDebateQA(
  date: string,
  theses: Thesis[],
): Promise<DebateQAResult> {
  if (theses.length === 0) {
    return {
      date,
      severity: "ok",
      mismatches: [],
      checkedItems: 0,
      checkedAt: new Date().toISOString(),
    };
  }

  try {
    const allMismatches: Mismatch[] = [];
    let checkedItems = 0;

    // 1. Bull-bias detection (pure, no DB)
    const bullBias = detectBullBias(theses);
    if (bullBias != null) {
      allMismatches.push(bullBias);
    }
    checkedItems += 1;

    // 2. DB-based checks (parallel)
    const mentionedTickers = new Set(theses.flatMap((t) => t.beneficiaryTickers ?? []));

    const [sectorRows, stockRows] = await Promise.all([
      fetchSectorPhases(date),
      fetchStockPhases(date, [...mentionedTickers]),
    ]);

    // 3. Sector accuracy
    const sectorMismatches = checkSectorAccuracy(theses, sectorRows);
    allMismatches.push(...sectorMismatches);
    if (sectorRows.length > 0) checkedItems += 1;

    // 4. Ticker accuracy
    const tickerMismatches = checkTickerAccuracy(theses, stockRows);
    allMismatches.push(...tickerMismatches);
    if (stockRows.length > 0) checkedItems += 1;

    const severity = aggregateSeverity(allMismatches);

    logger.info(
      "DebateQA",
      `${date}: ${checkedItems}건 검증, ${allMismatches.length}건 불일치 (severity: ${severity})`,
    );

    return {
      date,
      severity,
      mismatches: allMismatches,
      checkedItems,
      checkedAt: new Date().toISOString(),
    };
  } catch (error) {
    logger.info(
      "DebateQA",
      `DB 쿼리 실패 — graceful warn 반환: ${error instanceof Error ? error.message : String(error)}`,
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
