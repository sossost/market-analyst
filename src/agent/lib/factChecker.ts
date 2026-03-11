// ---------------------------------------------------------------------------
// factChecker.ts — 투자 브리핑 QA 팩트 체크 순수 함수 집합
// DB 의존성 없음. 입력값만으로 동작.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DbSectorData {
  sector: string;
  avgRs: number;
}

export interface DbStockData {
  symbol: string;
  phase: number;
  rsScore: number;
}

export interface DbData {
  topSectors: DbSectorData[];
  phase2Ratio: number;
  stocks: DbStockData[];
}

export interface ReportedSymbol {
  symbol: string;
  phase: number;
  rsScore: number;
  sector: string;
}

export interface ReportData {
  reportedSymbols: ReportedSymbol[];
  marketSummary: {
    phase2Ratio: number;
    leadingSectors: string[];
    totalAnalyzed: number;
  };
}

export type MismatchType = "sector_list" | "phase2_ratio" | "symbol_phase" | "symbol_rs";
export type Severity = "ok" | "warn" | "block";

export interface Mismatch {
  type: MismatchType;
  field: string;
  expected: string | number;
  actual: string | number;
  severity: "warn" | "block";
}

export interface FactCheckResult {
  severity: Severity;
  mismatches: Mismatch[];
  checkedItems: number;
}

// ---------------------------------------------------------------------------
// compareSectors
// ---------------------------------------------------------------------------

/**
 * 집합 비교로 섹터 목록 일치 여부를 검증한다.
 * - 순서 무관
 * - 어느 한쪽이 빈 배열이면 스킵 (mismatch 없음)
 * - 겹침 비율 = |교집합| / |합집합|
 * - 50% 미만이면 warn mismatch 1개 반환
 */
export function compareSectors(
  dbTopSectors: string[],
  reportLeadingSectors: string[],
): Mismatch[] {
  if (dbTopSectors.length === 0 || reportLeadingSectors.length === 0) {
    return [];
  }

  const dbSet = new Set(dbTopSectors);
  const reportSet = new Set(reportLeadingSectors);

  const intersectionSize = dbTopSectors.filter((s) => reportSet.has(s)).length;
  const unionSize = new Set([...dbSet, ...reportSet]).size;
  const overlapRatio = intersectionSize / unionSize;

  if (overlapRatio < 0.5) {
    return [
      {
        type: "sector_list",
        field: "leadingSectors",
        expected: dbTopSectors.join(", "),
        actual: reportLeadingSectors.join(", "),
        severity: "warn",
      },
    ];
  }

  return [];
}

// ---------------------------------------------------------------------------
// comparePhase2Ratio
// ---------------------------------------------------------------------------

/**
 * Phase 2 비율의 DB 값과 리포트 값을 비교한다.
 * - NaN 방어: 어느 한쪽이 NaN이면 null 반환
 * - 절댓값 차이가 tolerance 초과 시 warn mismatch 반환
 */
export function comparePhase2Ratio(
  dbRatio: number,
  reportRatio: number,
  tolerance: number = 2,
): Mismatch | null {
  if (!Number.isFinite(dbRatio) || !Number.isFinite(reportRatio)) {
    return null;
  }

  const diff = Math.abs(dbRatio - reportRatio);
  if (diff <= tolerance) {
    return null;
  }

  return {
    type: "phase2_ratio",
    field: "phase2Ratio",
    expected: dbRatio,
    actual: reportRatio,
    severity: "warn",
  };
}

// ---------------------------------------------------------------------------
// compareSymbolPhase
// ---------------------------------------------------------------------------

/**
 * 종목의 phase를 DB 값과 리포트 값으로 정확 비교한다.
 * - 불일치 시 warn mismatch 반환
 */
export function compareSymbolPhase(
  dbPhase: number,
  reportPhase: number,
  symbol: string,
): Mismatch | null {
  if (dbPhase === reportPhase) {
    return null;
  }

  return {
    type: "symbol_phase",
    field: `${symbol}.phase`,
    expected: dbPhase,
    actual: reportPhase,
    severity: "warn",
  };
}

// ---------------------------------------------------------------------------
// compareSymbolRs
// ---------------------------------------------------------------------------

/**
 * 종목의 RS 스코어를 DB 값과 리포트 값으로 비교한다.
 * - 절댓값 차이가 tolerance 초과 시 warn mismatch 반환
 */
export function compareSymbolRs(
  dbRs: number,
  reportRs: number,
  symbol: string,
  tolerance: number = 2,
): Mismatch | null {
  const diff = Math.abs(dbRs - reportRs);
  if (diff <= tolerance) {
    return null;
  }

  return {
    type: "symbol_rs",
    field: `${symbol}.rsScore`,
    expected: dbRs,
    actual: reportRs,
    severity: "warn",
  };
}

// ---------------------------------------------------------------------------
// aggregateSeverity
// ---------------------------------------------------------------------------

/**
 * mismatch 목록을 바탕으로 전체 심각도를 결정한다.
 * - 0개: 'ok'
 * - 1개: 'warn'
 * - 2개 이상: 'block'
 */
export function aggregateSeverity(mismatches: Mismatch[]): Severity {
  if (mismatches.length === 0) {
    return "ok";
  }
  if (mismatches.length === 1) {
    return "warn";
  }
  return "block";
}

// ---------------------------------------------------------------------------
// runFactCheck
// ---------------------------------------------------------------------------

/**
 * 모든 팩트 체크를 실행하고 결과를 집계한다.
 * - 섹터 목록, Phase 2 비율, 종목별 phase/rs 검증
 * - reportedSymbols 중 DB에 없는 종목은 스킵
 */
export function runFactCheck(dbData: DbData, reportData: ReportData): FactCheckResult {
  const mismatches: Mismatch[] = [];
  let checkedItems = 0;

  // 1. 섹터 목록 비교
  const dbSectorNames = dbData.topSectors.map((s) => s.sector);
  const sectorMismatches = compareSectors(
    dbSectorNames,
    reportData.marketSummary.leadingSectors,
  );
  mismatches.push(...sectorMismatches);
  if (dbSectorNames.length > 0 && reportData.marketSummary.leadingSectors.length > 0) {
    checkedItems += 1;
  }

  // 2. Phase 2 비율 비교
  const phase2Mismatch = comparePhase2Ratio(
    dbData.phase2Ratio,
    reportData.marketSummary.phase2Ratio,
  );
  if (phase2Mismatch != null) {
    mismatches.push(phase2Mismatch);
  }
  checkedItems += 1;

  // 3. 종목별 phase / rs 비교 (DB에 없는 종목은 스킵)
  const dbStockMap = new Map(dbData.stocks.map((s) => [s.symbol, s]));

  for (const reported of reportData.reportedSymbols) {
    const dbStock = dbStockMap.get(reported.symbol);
    if (dbStock == null) {
      continue;
    }

    const phaseMismatch = compareSymbolPhase(dbStock.phase, reported.phase, reported.symbol);
    if (phaseMismatch != null) {
      mismatches.push(phaseMismatch);
    }

    const rsMismatch = compareSymbolRs(dbStock.rsScore, reported.rsScore, reported.symbol);
    if (rsMismatch != null) {
      mismatches.push(rsMismatch);
    }

    checkedItems += 1;
  }

  return {
    severity: aggregateSeverity(mismatches),
    mismatches,
    checkedItems,
  };
}
