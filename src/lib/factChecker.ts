// ---------------------------------------------------------------------------
// factChecker.ts — 투자 브리핑 QA 팩트 체크 순수 함수 집합
// DB 의존성 없음. 입력값만으로 동작.
// ---------------------------------------------------------------------------

import type { NarrativeBlock } from "@/tools/schemas/dailyReportSchema.js";

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

export type MismatchType =
  | "sector_list"
  | "phase2_ratio"
  | "symbol_phase"
  | "symbol_rs"
  | "db_error"
  | "narrative_missing"
  | "tone_mismatch"
  | "render_incomplete";
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
 * - 50% 미만이면 block mismatch 1개 반환 (섹터 오분류는 심각한 팩트 오류)
 */
export function compareSectors(
  dbTopSectors: string[],
  reportLeadingSectors: string[],
): Mismatch[] {
  if (dbTopSectors.length === 0 || reportLeadingSectors.length === 0) {
    return [];
  }

  // DB 목록이 리포트보다 길면 리포트 개수만큼만 비교 (상위 N개).
  // DB 목록은 avg_rs DESC 정렬이므로 slice(0, N)이 상위 N개를 정확히 반영한다.
  // 이를 통해 "프롬프트가 상위 2개만 요구 vs QA가 5개 비교" 같은 구조적 거짓 양성을 방지한다.
  const dbSlice =
    dbTopSectors.length > reportLeadingSectors.length
      ? dbTopSectors.slice(0, reportLeadingSectors.length)
      : dbTopSectors;

  const dbSet = new Set(dbSlice);
  const reportSet = new Set(reportLeadingSectors);

  const intersectionSize = [...dbSet].filter((s) => reportSet.has(s)).length;
  const unionSize = new Set([...dbSet, ...reportSet]).size;
  const overlapRatio = intersectionSize / unionSize;

  if (overlapRatio < 0.5) {
    return [
      {
        type: "sector_list",
        field: "leadingSectors",
        expected: dbSlice.join(", "),
        actual: reportLeadingSectors.join(", "),
        severity: "block",
      },
    ];
  }

  return [];
}

// ---------------------------------------------------------------------------
// comparePhase2Ratio
// ---------------------------------------------------------------------------

const PHASE2_RATIO_BLOCK_THRESHOLD = 10;

/**
 * Phase 2 비율의 DB 값과 리포트 값을 비교한다.
 * - NaN 방어: 어느 한쪽이 NaN이면 null 반환
 * - 절댓값 차이가 tolerance 초과 시 mismatch 반환
 * - 차이가 10pp 이상이면 block, 미만이면 warn
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

  const severity: "warn" | "block" = diff >= PHASE2_RATIO_BLOCK_THRESHOLD ? "block" : "warn";

  return {
    type: "phase2_ratio",
    field: "phase2Ratio",
    expected: dbRatio,
    actual: reportRatio,
    severity,
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
  if (!Number.isFinite(dbPhase) || !Number.isFinite(reportPhase)) {
    return null;
  }
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
  if (!Number.isFinite(dbRs) || !Number.isFinite(reportRs)) {
    return null;
  }
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
 * - block severity mismatch 1개 이상: 즉시 'block'
 * - warn mismatch만 존재하는 경우: 1개 → 'warn', 2개 이상 → 'block'
 */
export function aggregateSeverity(mismatches: Mismatch[]): Severity {
  if (mismatches.length === 0) {
    return "ok";
  }

  const hasBlockMismatch = mismatches.some((m) => m.severity === "block");
  if (hasBlockMismatch) {
    return "block";
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

// ---------------------------------------------------------------------------
// Content QA — 해석 품질 + 렌더링 완전성 검증
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ContentQAInsight {
  breadthNarrative: NarrativeBlock;
  unusualStocksNarrative: NarrativeBlock;
  risingRSNarrative: NarrativeBlock;
  watchlistNarrative: NarrativeBlock;
}

export interface ContentQABreadthData {
  phase2RatioChange: number;
  phase2NetFlow: number | null;
  phase2EntryAvg5d: number | null;
}

export interface ContentQADataCounts {
  unusualStocksCount: number;
  risingRSCount: number;
  watchlistActiveCount: number;
}

export interface ContentQAInput {
  insight: ContentQAInsight;
  breadthData: ContentQABreadthData;
  dataCounts: ContentQADataCounts;
  html: string;
}

// ---------------------------------------------------------------------------
// Keyword dictionaries
// ---------------------------------------------------------------------------

const POSITIVE_KEYWORDS = [
  "유입", "증가", "개선", "강세", "확대", "상승", "회복",
  "긍정", "활발", "호전", "강화", "반등", "급증", "확장",
  "유인", "진입", "늘어", "높아", "좋아",
];

const NEGATIVE_KEYWORDS = [
  "악화", "하락", "위축", "약세", "감소", "둔화", "이탈",
  "부진", "축소", "약화", "후퇴", "급감", "저하", "침체",
  "빠져", "줄어", "낮아", "나빠",
];

// ---------------------------------------------------------------------------
// checkNarrativePresence
// ---------------------------------------------------------------------------

/**
 * 데이터가 존재하는 섹션의 나레이션이 비어있는지 검증한다.
 * - breadthNarrative: 항상 존재해야 함
 * - unusualStocksNarrative: unusualStocks > 0일 때만
 * - risingRSNarrative: risingRS > 0일 때만
 * - watchlistNarrative: watchlist.totalActive > 0일 때만
 */
export function checkNarrativePresence(
  insight: ContentQAInsight,
  dataCounts: ContentQADataCounts,
): Mismatch[] {
  const mismatches: Mismatch[] = [];

  const checks: Array<{ field: string; narrative: NarrativeBlock; condition: boolean }> = [
    { field: "breadthNarrative", narrative: insight.breadthNarrative, condition: true },
    { field: "unusualStocksNarrative", narrative: insight.unusualStocksNarrative, condition: dataCounts.unusualStocksCount > 0 },
    { field: "risingRSNarrative", narrative: insight.risingRSNarrative, condition: dataCounts.risingRSCount > 0 },
    { field: "watchlistNarrative", narrative: insight.watchlistNarrative, condition: dataCounts.watchlistActiveCount > 0 },
  ];

  for (const check of checks) {
    if (!check.condition) continue;
    if (isNarrativeEmpty(check.narrative)) {
      const combined = `${check.narrative.headline} ${check.narrative.detail}`.trim();
      mismatches.push({
        type: "narrative_missing",
        field: check.field,
        expected: "비어있지 않은 나레이션",
        actual: combined !== "" ? combined : "(빈 블록)",
        severity: "warn",
      });
    }
  }

  return mismatches;
}

function isNarrativeEmpty(narrative: NarrativeBlock | null | undefined): boolean {
  if (narrative === null || narrative === undefined) return true;
  const headline = narrative.headline.trim();
  return headline === "" || headline === "해당 없음";
}

// ---------------------------------------------------------------------------
// checkToneConsistency
// ---------------------------------------------------------------------------

/**
 * Phase 2 데이터 방향과 breadthNarrative의 해석 톤 일관성을 검증한다.
 *
 * 규칙 1: phase2NetFlow가 phase2EntryAvg5d의 2배 이상(강한 양의 시그널)이면
 *          breadthNarrative에 양의 키워드가 최소 1개 존재해야 한다.
 * 규칙 2: phase2RatioChange > 0(양의 변화)인데
 *          breadthNarrative에 부정 키워드만 존재하고 양의 키워드가 없으면 WARN.
 *
 * LLM 재호출 금지 — 키워드 사전 매칭만 사용.
 */
export function checkToneConsistency(
  insight: ContentQAInsight,
  breadthData: ContentQABreadthData,
): Mismatch[] {
  const mismatches: Mismatch[] = [];
  const narrative = insight.breadthNarrative;

  if (isNarrativeEmpty(narrative)) {
    return mismatches;
  }

  const narrativeText = `${narrative.headline} ${narrative.detail}`;
  const hasPositive = POSITIVE_KEYWORDS.some((kw) => narrativeText.includes(kw));
  const hasNegative = NEGATIVE_KEYWORDS.some((kw) => narrativeText.includes(kw));

  // 규칙 1: 강한 Phase 2 순유입인데 양의 키워드 부재
  if (
    breadthData.phase2NetFlow != null &&
    breadthData.phase2EntryAvg5d != null &&
    breadthData.phase2EntryAvg5d > 0 &&
    breadthData.phase2NetFlow > 0 &&
    breadthData.phase2NetFlow >= breadthData.phase2EntryAvg5d * 2
  ) {
    if (!hasPositive) {
      mismatches.push({
        type: "tone_mismatch",
        field: "breadthNarrative.phase2NetFlow",
        expected: `Phase2 순유입 ${breadthData.phase2NetFlow}건 (5일평균의 ${(breadthData.phase2NetFlow / breadthData.phase2EntryAvg5d).toFixed(1)}배) — 양의 키워드 기대`,
        actual: "양의 키워드 미발견",
        severity: "warn",
      });
    }
  }

  // 규칙 2: Phase 2 비율 양의 변화인데 부정 키워드만 존재
  if (breadthData.phase2RatioChange > 0 && hasNegative && !hasPositive) {
    mismatches.push({
      type: "tone_mismatch",
      field: "breadthNarrative.phase2RatioChange",
      expected: `Phase2 비율 +${breadthData.phase2RatioChange.toFixed(1)}pp — 양의 키워드 기대`,
      actual: "부정 키워드만 발견",
      severity: "warn",
    });
  }

  return mismatches;
}

// ---------------------------------------------------------------------------
// checkRenderCompleteness
// ---------------------------------------------------------------------------

const REQUIRED_SECTIONS = [
  "시장 브레드스",
  "특이종목",
  "섹터 RS 랭킹",
] as const;

/**
 * HTML 렌더링 완전성을 검증한다.
 * - 필수 섹션(h2 태그)이 존재하는지
 * - unusualStocks 데이터 대비 렌더링 수가 현저히 적지 않은지
 *   (데이터의 50% 미만이 렌더링되면 WARN, 단 데이터 3건 이하는 스킵)
 */
export function checkRenderCompleteness(
  html: string,
  dataCounts: ContentQADataCounts,
): Mismatch[] {
  const mismatches: Mismatch[] = [];

  if (html === "") {
    return mismatches;
  }

  // 1. 필수 섹션 존재 확인
  for (const section of REQUIRED_SECTIONS) {
    const pattern = new RegExp(`<h2[^>]*>\\s*${escapeRegex(section)}`, "i");
    if (!pattern.test(html)) {
      mismatches.push({
        type: "render_incomplete",
        field: `section:${section}`,
        expected: `<h2>${section}</h2> 섹션 존재`,
        actual: "미발견",
        severity: "warn",
      });
    }
  }

  // 2. 특이종목 렌더링 수 vs 데이터 수 비교
  if (dataCounts.unusualStocksCount > 3) {
    const symbolPattern = /class="[^"]*stock-symbol[^"]*"/g;
    const unusualSectionMatch = html.match(/<h2[^>]*>\s*특이종목[\s\S]*?(?=<h2|<\/div>\s*<footer)/i);
    if (unusualSectionMatch != null) {
      const sectionHtml = unusualSectionMatch[0];
      const renderedCount = (sectionHtml.match(symbolPattern) || []).length;
      const threshold = Math.floor(dataCounts.unusualStocksCount * 0.5);

      if (renderedCount < threshold) {
        mismatches.push({
          type: "render_incomplete",
          field: "unusualStocks.renderCount",
          expected: `데이터 ${dataCounts.unusualStocksCount}건 중 최소 ${threshold}건 렌더링`,
          actual: `${renderedCount}건 렌더링`,
          severity: "warn",
        });
      }
    }
  }

  return mismatches;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ---------------------------------------------------------------------------
// runContentQA
// ---------------------------------------------------------------------------

/**
 * 콘텐츠 QA를 실행한다 — 나레이션 존재, 톤 일관성, 렌더링 완전성.
 * DB 의존성 없음. insight + data + html로만 동작.
 */
export function runContentQA(input: ContentQAInput): FactCheckResult {
  const mismatches: Mismatch[] = [];
  let checkedItems = 0;

  // 1. 나레이션 존재 검증
  const narrativeMismatches = checkNarrativePresence(input.insight, input.dataCounts);
  mismatches.push(...narrativeMismatches);
  checkedItems += 1;

  // 2. 톤 일관성 검증
  const toneMismatches = checkToneConsistency(input.insight, input.breadthData);
  mismatches.push(...toneMismatches);
  checkedItems += 1;

  // 3. 렌더링 완전성 검증
  const renderMismatches = checkRenderCompleteness(input.html, input.dataCounts);
  mismatches.push(...renderMismatches);
  checkedItems += 1;

  return {
    severity: aggregateSeverity(mismatches),
    mismatches,
    checkedItems,
  };
}
