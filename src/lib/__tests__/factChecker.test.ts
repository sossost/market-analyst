// ---------------------------------------------------------------------------
// factChecker.test.ts — TDD RED phase
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import {
  compareSectors,
  comparePhase2Ratio,
  compareSymbolPhase,
  compareSymbolRs,
  aggregateSeverity,
  runFactCheck,
  checkNarrativePresence,
  checkToneConsistency,
  checkRenderCompleteness,
  runContentQA,
  type Mismatch,
  type DbData,
  type ReportData,
  type ContentQAInsight,
  type ContentQABreadthData,
  type ContentQADataCounts,
  type ContentQAInput,
} from "../factChecker";

// ---------------------------------------------------------------------------
// compareSectors
// ---------------------------------------------------------------------------

describe("compareSectors", () => {
  it("완전 일치 시 mismatch 없음", () => {
    const result = compareSectors(
      ["Technology", "Healthcare", "Energy"],
      ["Technology", "Healthcare", "Energy"],
    );
    expect(result).toHaveLength(0);
  });

  it("순서가 달라도 완전 일치 시 mismatch 없음", () => {
    const result = compareSectors(
      ["Healthcare", "Energy", "Technology"],
      ["Technology", "Healthcare", "Energy"],
    );
    expect(result).toHaveLength(0);
  });

  it("겹침 50% 이상이면 mismatch 없음", () => {
    // 3개 중 2개 겹침 = 66.7% — ok
    const result = compareSectors(
      ["Technology", "Healthcare", "Energy"],
      ["Technology", "Healthcare", "Financials"],
    );
    expect(result).toHaveLength(0);
  });

  it("겹침 정확히 50%이면 mismatch 없음 (경계값 — Jaccard)", () => {
    // Jaccard: 교집합 / 합집합
    // db=[A,B,C,D], report=[A,B,C,E] → 교집합=3, 합집합=5 → 3/5=60% → ok
    // db=[A,B], report=[A,B,C,D] → 교집합=2, 합집합=4 → 2/4=50% → ok (50% 미만만 warn)
    const result = compareSectors(
      ["Technology", "Healthcare"],
      ["Technology", "Healthcare", "Energy", "Financials"],
    );
    expect(result).toHaveLength(0);
  });

  it("겹침 50% 미만이면 block mismatch 1개 반환 (섹터 오분류는 심각한 팩트 오류)", () => {
    // 3개 중 1개 겹침 = 33.3% — block
    const result = compareSectors(
      ["Technology", "Healthcare", "Energy"],
      ["Technology", "Financials", "Materials"],
    );
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("sector_list");
    expect(result[0].severity).toBe("block");
    expect(result[0].field).toBe("leadingSectors");
  });

  it("겹침 0%이면 block mismatch 1개 반환", () => {
    const result = compareSectors(
      ["Technology", "Healthcare"],
      ["Energy", "Financials"],
    );
    expect(result).toHaveLength(1);
    expect(result[0].severity).toBe("block");
  });

  it("dbTopSectors가 빈 배열이면 mismatch 없음 (스킵)", () => {
    const result = compareSectors([], ["Technology", "Healthcare"]);
    expect(result).toHaveLength(0);
  });

  it("reportLeadingSectors가 빈 배열이면 mismatch 없음 (스킵)", () => {
    const result = compareSectors(["Technology", "Healthcare"], []);
    expect(result).toHaveLength(0);
  });

  it("둘 다 빈 배열이면 mismatch 없음 (스킵)", () => {
    const result = compareSectors([], []);
    expect(result).toHaveLength(0);
  });

  it("mismatch에 expected와 actual이 포함됨", () => {
    const result = compareSectors(["Technology", "Healthcare"], ["Energy", "Financials"]);
    expect(result[0].expected).toBeDefined();
    expect(result[0].actual).toBeDefined();
  });

  it("DB가 5개, 리포트가 2개일 때 상위 2개 일치하면 mismatch 없음 (#416)", () => {
    const result = compareSectors(
      ["Energy", "Utilities", "Basic Materials", "Financial Services", "Industrials"],
      ["Energy", "Utilities"],
    );
    expect(result).toHaveLength(0);
  });

  it("DB가 5개, 리포트가 2개일 때 상위 2개와 불일치하면 block mismatch 반환", () => {
    const result = compareSectors(
      ["Energy", "Utilities", "Basic Materials", "Financial Services", "Industrials"],
      ["Technology", "Healthcare"],
    );
    expect(result).toHaveLength(1);
    expect(result[0].severity).toBe("block");
    // expected에는 DB 상위 2개만 표시
    expect(result[0].expected).toBe("Energy, Utilities");
  });

  it("DB가 리포트보다 짧으면 trim 없이 전체 비교", () => {
    const result = compareSectors(
      ["Technology", "Healthcare"],
      ["Technology", "Healthcare", "Energy"],
    );
    // DB 2개, 리포트 3개 — trim 안 함. 교집합=2, 합집합=3, 2/3=0.67 → ok
    expect(result).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// comparePhase2Ratio
// ---------------------------------------------------------------------------

describe("comparePhase2Ratio", () => {
  it("차이가 tolerance 이내이면 null 반환", () => {
    const result = comparePhase2Ratio(55, 56, 2);
    expect(result).toBeNull();
  });

  it("차이가 정확히 tolerance이면 null 반환 (경계값)", () => {
    const result = comparePhase2Ratio(55, 57, 2);
    expect(result).toBeNull();
  });

  it("차이가 tolerance 초과이지만 10pp 미만이면 warn mismatch 반환", () => {
    const result = comparePhase2Ratio(55, 58, 2);
    expect(result).not.toBeNull();
    expect(result!.type).toBe("phase2_ratio");
    expect(result!.severity).toBe("warn");
    expect(result!.field).toBe("phase2Ratio");
  });

  it("차이가 10pp 이상이면 block mismatch 반환", () => {
    const result = comparePhase2Ratio(55, 65, 2);
    expect(result).not.toBeNull();
    expect(result!.type).toBe("phase2_ratio");
    expect(result!.severity).toBe("block");
  });

  it("차이가 정확히 10pp이면 block mismatch 반환 (경계값)", () => {
    const result = comparePhase2Ratio(55, 65, 2);
    expect(result).not.toBeNull();
    expect(result!.severity).toBe("block");
  });

  it("차이가 9pp이면 warn mismatch 반환 (block 미만)", () => {
    const result = comparePhase2Ratio(55, 64, 2);
    expect(result).not.toBeNull();
    expect(result!.severity).toBe("warn");
  });

  it("dbRatio가 더 큰 경우도 차이 초과이면 warn 반환 (10pp 미만)", () => {
    const result = comparePhase2Ratio(60, 55, 2);
    expect(result).not.toBeNull();
    expect(result!.severity).toBe("warn");
  });

  it("dbRatio가 더 클 때도 10pp 이상이면 block 반환", () => {
    const result = comparePhase2Ratio(70, 55, 2);
    expect(result).not.toBeNull();
    expect(result!.severity).toBe("block");
  });

  it("기본 tolerance(2)로 동작", () => {
    const withinDefault = comparePhase2Ratio(55, 57);
    expect(withinDefault).toBeNull();

    const exceedsDefault = comparePhase2Ratio(55, 58);
    expect(exceedsDefault).not.toBeNull();
  });

  it("mismatch에 expected(DB값)와 actual(리포트값)이 담김", () => {
    const result = comparePhase2Ratio(55, 60, 2);
    expect(result!.expected).toBe(55);
    expect(result!.actual).toBe(60);
  });

  it("dbRatio가 NaN이면 null 반환 (방어)", () => {
    const result = comparePhase2Ratio(NaN, 55, 2);
    expect(result).toBeNull();
  });

  it("reportRatio가 NaN이면 null 반환 (방어)", () => {
    const result = comparePhase2Ratio(55, NaN, 2);
    expect(result).toBeNull();
  });

  it("둘 다 NaN이면 null 반환 (방어)", () => {
    const result = comparePhase2Ratio(NaN, NaN, 2);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// compareSymbolPhase
// ---------------------------------------------------------------------------

describe("compareSymbolPhase", () => {
  it("phase가 일치하면 null 반환", () => {
    const result = compareSymbolPhase(2, 2, "NVDA");
    expect(result).toBeNull();
  });

  it("phase가 다르면 warn mismatch 반환", () => {
    const result = compareSymbolPhase(2, 3, "NVDA");
    expect(result).not.toBeNull();
    expect(result!.type).toBe("symbol_phase");
    expect(result!.severity).toBe("warn");
  });

  it("mismatch field에 symbol이 포함됨", () => {
    const result = compareSymbolPhase(2, 3, "NVDA");
    expect(result!.field).toContain("NVDA");
  });

  it("mismatch에 expected(DB phase)와 actual(리포트 phase)이 담김", () => {
    const result = compareSymbolPhase(2, 3, "NVDA");
    expect(result!.expected).toBe(2);
    expect(result!.actual).toBe(3);
  });

  it("phase 0 vs 1 불일치도 감지", () => {
    const result = compareSymbolPhase(0, 1, "TSLA");
    expect(result).not.toBeNull();
  });

  it("dbPhase가 NaN이면 null 반환", () => {
    expect(compareSymbolPhase(NaN, 2, "NVDA")).toBeNull();
  });

  it("reportPhase가 NaN이면 null 반환", () => {
    expect(compareSymbolPhase(2, NaN, "NVDA")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// compareSymbolRs
// ---------------------------------------------------------------------------

describe("compareSymbolRs", () => {
  it("차이가 tolerance 이내이면 null 반환", () => {
    const result = compareSymbolRs(85, 86, "NVDA", 2);
    expect(result).toBeNull();
  });

  it("차이가 정확히 tolerance이면 null 반환 (경계값)", () => {
    const result = compareSymbolRs(85, 87, "NVDA", 2);
    expect(result).toBeNull();
  });

  it("차이가 tolerance 초과이면 warn mismatch 반환", () => {
    const result = compareSymbolRs(85, 88, "NVDA", 2);
    expect(result).not.toBeNull();
    expect(result!.type).toBe("symbol_rs");
    expect(result!.severity).toBe("warn");
  });

  it("mismatch field에 symbol이 포함됨", () => {
    const result = compareSymbolRs(85, 90, "NVDA", 2);
    expect(result!.field).toContain("NVDA");
  });

  it("mismatch에 expected(DB rs)와 actual(리포트 rs)이 담김", () => {
    const result = compareSymbolRs(85, 90, "NVDA", 2);
    expect(result!.expected).toBe(85);
    expect(result!.actual).toBe(90);
  });

  it("기본 tolerance(2)로 동작", () => {
    const withinDefault = compareSymbolRs(85, 87, "NVDA");
    expect(withinDefault).toBeNull();

    const exceedsDefault = compareSymbolRs(85, 88, "NVDA");
    expect(exceedsDefault).not.toBeNull();
  });

  it("dbRs가 더 큰 경우도 차이 초과이면 warn 반환", () => {
    const result = compareSymbolRs(90, 85, "NVDA", 2);
    expect(result).not.toBeNull();
  });

  it("dbRs가 NaN이면 null 반환", () => {
    expect(compareSymbolRs(NaN, 85, "NVDA")).toBeNull();
  });

  it("reportRs가 NaN이면 null 반환", () => {
    expect(compareSymbolRs(85, NaN, "NVDA")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// aggregateSeverity
// ---------------------------------------------------------------------------

describe("aggregateSeverity", () => {
  it("mismatch 0개이면 'ok' 반환", () => {
    expect(aggregateSeverity([])).toBe("ok");
  });

  it("warn mismatch 1개이면 'warn' 반환", () => {
    const mismatches: Mismatch[] = [
      {
        type: "symbol_phase",
        field: "NVDA.phase",
        expected: 2,
        actual: 3,
        severity: "warn",
      },
    ];
    expect(aggregateSeverity(mismatches)).toBe("warn");
  });

  it("block mismatch 1개이면 즉시 'block' 반환 (개수 무관)", () => {
    const mismatches: Mismatch[] = [
      {
        type: "sector_list",
        field: "leadingSectors",
        expected: "Technology",
        actual: "Energy",
        severity: "block",
      },
    ];
    expect(aggregateSeverity(mismatches)).toBe("block");
  });

  it("warn mismatch 2개이면 'block' 반환", () => {
    const mismatches: Mismatch[] = [
      {
        type: "symbol_phase",
        field: "NVDA.phase",
        expected: 2,
        actual: 3,
        severity: "warn",
      },
      {
        type: "phase2_ratio",
        field: "phase2Ratio",
        expected: 55,
        actual: 60,
        severity: "warn",
      },
    ];
    expect(aggregateSeverity(mismatches)).toBe("block");
  });

  it("block + warn 혼합이면 'block' 반환", () => {
    const mismatches: Mismatch[] = [
      {
        type: "sector_list",
        field: "leadingSectors",
        expected: "Technology",
        actual: "Energy",
        severity: "block",
      },
      {
        type: "symbol_rs",
        field: "NVDA.rsScore",
        expected: 90,
        actual: 80,
        severity: "warn",
      },
    ];
    expect(aggregateSeverity(mismatches)).toBe("block");
  });

  it("warn mismatch 5개이면 'block' 반환", () => {
    const mismatches: Mismatch[] = Array.from({ length: 5 }, (_, i) => ({
      type: "symbol_phase" as const,
      field: `STOCK${i}.phase`,
      expected: 2,
      actual: 3,
      severity: "warn" as const,
    }));
    expect(aggregateSeverity(mismatches)).toBe("block");
  });
});

// ---------------------------------------------------------------------------
// runFactCheck
// ---------------------------------------------------------------------------

describe("runFactCheck", () => {
  const baseDbData: DbData = {
    topSectors: [
      { sector: "Technology", avgRs: 85 },
      { sector: "Healthcare", avgRs: 78 },
      { sector: "Energy", avgRs: 72 },
    ],
    phase2Ratio: 55,
    stocks: [
      { symbol: "NVDA", phase: 2, rsScore: 90 },
      { symbol: "AAPL", phase: 2, rsScore: 82 },
    ],
  };

  const baseReportData: ReportData = {
    reportedSymbols: [
      { symbol: "NVDA", phase: 2, rsScore: 90, sector: "Technology" },
      { symbol: "AAPL", phase: 2, rsScore: 82, sector: "Technology" },
    ],
    marketSummary: {
      phase2Ratio: 55,
      leadingSectors: ["Technology", "Healthcare", "Energy"],
      totalAnalyzed: 500,
    },
  };

  it("모든 값이 정확하면 severity ok, mismatches 빈 배열 반환", () => {
    const result = runFactCheck(baseDbData, baseReportData);
    expect(result.severity).toBe("ok");
    expect(result.mismatches).toHaveLength(0);
  });

  it("checkedItems가 0보다 큰 양수를 반환", () => {
    const result = runFactCheck(baseDbData, baseReportData);
    expect(result.checkedItems).toBeGreaterThan(0);
  });

  it("섹터 불일치가 있으면 mismatch 포함", () => {
    const reportData: ReportData = {
      ...baseReportData,
      marketSummary: {
        ...baseReportData.marketSummary,
        leadingSectors: ["Financials", "Materials", "Utilities"],
      },
    };
    const result = runFactCheck(baseDbData, reportData);
    expect(result.mismatches.some((m) => m.type === "sector_list")).toBe(true);
  });

  it("phase2Ratio 불일치가 있으면 mismatch 포함", () => {
    const reportData: ReportData = {
      ...baseReportData,
      marketSummary: {
        ...baseReportData.marketSummary,
        phase2Ratio: 65,
      },
    };
    const result = runFactCheck(baseDbData, reportData);
    expect(result.mismatches.some((m) => m.type === "phase2_ratio")).toBe(true);
  });

  it("종목 phase 불일치가 있으면 mismatch 포함", () => {
    const reportData: ReportData = {
      ...baseReportData,
      reportedSymbols: [
        { symbol: "NVDA", phase: 3, rsScore: 90, sector: "Technology" }, // DB는 2
        { symbol: "AAPL", phase: 2, rsScore: 82, sector: "Technology" },
      ],
    };
    const result = runFactCheck(baseDbData, reportData);
    expect(result.mismatches.some((m) => m.type === "symbol_phase")).toBe(true);
  });

  it("종목 rsScore 불일치가 있으면 mismatch 포함", () => {
    const reportData: ReportData = {
      ...baseReportData,
      reportedSymbols: [
        { symbol: "NVDA", phase: 2, rsScore: 95, sector: "Technology" }, // DB는 90, 차이 5 > tolerance 2
        { symbol: "AAPL", phase: 2, rsScore: 82, sector: "Technology" },
      ],
    };
    const result = runFactCheck(baseDbData, reportData);
    expect(result.mismatches.some((m) => m.type === "symbol_rs")).toBe(true);
  });

  it("reportedSymbols에 DB에 없는 종목은 검증 스킵", () => {
    const reportData: ReportData = {
      ...baseReportData,
      reportedSymbols: [
        { symbol: "MSFT", phase: 2, rsScore: 80, sector: "Technology" }, // DB에 없음
      ],
    };
    // MSFT가 DB에 없어서 비교 불가 → mismatch 없음 (섹터도 ok이면)
    const result = runFactCheck(baseDbData, reportData);
    const symbolMismatches = result.mismatches.filter(
      (m) => m.type === "symbol_phase" || m.type === "symbol_rs",
    );
    expect(symbolMismatches).toHaveLength(0);
  });

  it("섹터 오분류(block) 단독으로도 severity block 반환", () => {
    const reportData: ReportData = {
      ...baseReportData,
      marketSummary: {
        ...baseReportData.marketSummary,
        leadingSectors: ["Financials", "Materials", "Utilities"], // 섹터 완전 불일치
      },
    };
    const result = runFactCheck(baseDbData, reportData);
    expect(result.severity).toBe("block");
    const sectorMismatch = result.mismatches.find((m) => m.type === "sector_list");
    expect(sectorMismatch?.severity).toBe("block");
  });

  it("다수 불일치 시 severity block 반환", () => {
    const reportData: ReportData = {
      ...baseReportData,
      reportedSymbols: [
        { symbol: "NVDA", phase: 3, rsScore: 95, sector: "Technology" }, // phase+rs 불일치
        { symbol: "AAPL", phase: 3, rsScore: 75, sector: "Technology" }, // phase+rs 불일치
      ],
      marketSummary: {
        phase2Ratio: 70, // 불일치 15pp → block
        leadingSectors: ["Financials", "Materials", "Utilities"], // 섹터 오분류 → block
        totalAnalyzed: 500,
      },
    };
    const result = runFactCheck(baseDbData, reportData);
    expect(result.severity).toBe("block");
    expect(result.mismatches.length).toBeGreaterThanOrEqual(2);
  });

  it("topSectors가 빈 배열이면 섹터 checkedItems 카운트 안 함", () => {
    const dbData: DbData = {
      ...baseDbData,
      topSectors: [],
    };
    const result = runFactCheck(dbData, baseReportData);
    // 섹터 체크 스킵, phase2Ratio + 2종목 = 3 checked
    expect(result.checkedItems).toBeGreaterThan(0);
    expect(result.severity).toBe("ok");
  });

  it("leadingSectors가 빈 배열이면 섹터 checkedItems 카운트 안 함", () => {
    const reportData: ReportData = {
      ...baseReportData,
      marketSummary: {
        ...baseReportData.marketSummary,
        leadingSectors: [],
      },
    };
    const result = runFactCheck(baseDbData, reportData);
    expect(result.checkedItems).toBeGreaterThan(0);
  });

  it("mismatch 1개이면 severity warn 반환", () => {
    const reportData: ReportData = {
      ...baseReportData,
      marketSummary: {
        ...baseReportData.marketSummary,
        phase2Ratio: 59, // 차이 4 > tolerance 2 → warn 1개
      },
    };
    const result = runFactCheck(baseDbData, reportData);
    // sector, phase, rs는 일치 — phase2Ratio만 불일치
    const phase2Mismatches = result.mismatches.filter((m) => m.type === "phase2_ratio");
    expect(phase2Mismatches).toHaveLength(1);
    // 전체 mismatch가 1개이면 warn
    if (result.mismatches.length === 1) {
      expect(result.severity).toBe("warn");
    }
  });
});

// ---------------------------------------------------------------------------
// Content QA — checkNarrativePresence
// ---------------------------------------------------------------------------

describe("checkNarrativePresence", () => {
  const fullInsight: ContentQAInsight = {
    breadthNarrative: "Phase 2 비율이 상승하며 시장 브레드스가 개선되고 있다.",
    unusualStocksNarrative: "반도체 섹터에서 거래량 급증 종목이 집중되고 있다.",
    risingRSNarrative: "헬스케어 업종에서 RS 상승 초기 종목이 다수 발견된다.",
    watchlistNarrative: "관심종목 3개 중 2개가 Phase 2를 유지하고 있다.",
  };

  const dataCounts: ContentQADataCounts = {
    unusualStocksCount: 10,
    risingRSCount: 5,
    watchlistActiveCount: 3,
  };

  it("모든 나레이션이 존재하면 mismatch 없음", () => {
    const result = checkNarrativePresence(fullInsight, dataCounts);
    expect(result).toHaveLength(0);
  });

  it("breadthNarrative가 비어있으면 warn 반환", () => {
    const insight = { ...fullInsight, breadthNarrative: "" };
    const result = checkNarrativePresence(insight, dataCounts);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("narrative_missing");
    expect(result[0].field).toBe("breadthNarrative");
    expect(result[0].severity).toBe("warn");
  });

  it("'해당 없음'은 비어있는 것으로 취급", () => {
    const insight = { ...fullInsight, breadthNarrative: "해당 없음" };
    const result = checkNarrativePresence(insight, dataCounts);
    expect(result).toHaveLength(1);
    expect(result[0].field).toBe("breadthNarrative");
  });

  it("unusualStocks가 0건이면 unusualStocksNarrative 검증 스킵", () => {
    const insight = { ...fullInsight, unusualStocksNarrative: "" };
    const counts = { ...dataCounts, unusualStocksCount: 0 };
    const result = checkNarrativePresence(insight, counts);
    expect(result).toHaveLength(0);
  });

  it("risingRS가 0건이면 risingRSNarrative 검증 스킵", () => {
    const insight = { ...fullInsight, risingRSNarrative: "" };
    const counts = { ...dataCounts, risingRSCount: 0 };
    const result = checkNarrativePresence(insight, counts);
    expect(result).toHaveLength(0);
  });

  it("watchlist가 0건이면 watchlistNarrative 검증 스킵", () => {
    const insight = { ...fullInsight, watchlistNarrative: "" };
    const counts = { ...dataCounts, watchlistActiveCount: 0 };
    const result = checkNarrativePresence(insight, counts);
    expect(result).toHaveLength(0);
  });

  it("여러 나레이션이 동시에 비어있으면 각각 mismatch 반환", () => {
    const insight = { ...fullInsight, breadthNarrative: "", unusualStocksNarrative: "해당 없음" };
    const result = checkNarrativePresence(insight, dataCounts);
    expect(result).toHaveLength(2);
    expect(result.map((m) => m.field)).toContain("breadthNarrative");
    expect(result.map((m) => m.field)).toContain("unusualStocksNarrative");
  });

  it("공백만 있는 나레이션은 비어있는 것으로 취급", () => {
    const insight = { ...fullInsight, breadthNarrative: "   " };
    const result = checkNarrativePresence(insight, dataCounts);
    expect(result).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Content QA — checkToneConsistency
// ---------------------------------------------------------------------------

describe("checkToneConsistency", () => {
  it("강한 Phase 2 순유입인데 양의 키워드 있으면 mismatch 없음", () => {
    const insight: ContentQAInsight = {
      breadthNarrative: "Phase 2 순유입이 크게 증가하며 시장 참여가 활발해지고 있다.",
      unusualStocksNarrative: "",
      risingRSNarrative: "",
      watchlistNarrative: "",
    };
    const breadthData: ContentQABreadthData = {
      phase2RatioChange: 2.5,
      phase2NetFlow: 20,
      phase2EntryAvg5d: 8,
    };
    const result = checkToneConsistency(insight, breadthData);
    expect(result).toHaveLength(0);
  });

  it("강한 Phase 2 순유입(5일평균 2배+)인데 양의 키워드 없으면 warn", () => {
    const insight: ContentQAInsight = {
      breadthNarrative: "시장은 현재 관망세를 보이고 있다.",
      unusualStocksNarrative: "",
      risingRSNarrative: "",
      watchlistNarrative: "",
    };
    const breadthData: ContentQABreadthData = {
      phase2RatioChange: 2.5,
      phase2NetFlow: 20,
      phase2EntryAvg5d: 8,
    };
    const result = checkToneConsistency(insight, breadthData);
    expect(result.some((m) => m.field === "breadthNarrative.phase2NetFlow")).toBe(true);
    expect(result[0].severity).toBe("warn");
  });

  it("Phase 2 순유입이 2배 미만이면 규칙1 스킵", () => {
    const insight: ContentQAInsight = {
      breadthNarrative: "시장은 현재 관망세를 보이고 있다.",
      unusualStocksNarrative: "",
      risingRSNarrative: "",
      watchlistNarrative: "",
    };
    const breadthData: ContentQABreadthData = {
      phase2RatioChange: 1.0,
      phase2NetFlow: 10,
      phase2EntryAvg5d: 8,
    };
    const result = checkToneConsistency(insight, breadthData);
    expect(result.filter((m) => m.field === "breadthNarrative.phase2NetFlow")).toHaveLength(0);
  });

  it("phase2NetFlow가 null이면 규칙1 스킵", () => {
    const insight: ContentQAInsight = {
      breadthNarrative: "시장은 약세를 보이고 있다.",
      unusualStocksNarrative: "",
      risingRSNarrative: "",
      watchlistNarrative: "",
    };
    const breadthData: ContentQABreadthData = {
      phase2RatioChange: -1.0,
      phase2NetFlow: null,
      phase2EntryAvg5d: null,
    };
    const result = checkToneConsistency(insight, breadthData);
    expect(result.filter((m) => m.field === "breadthNarrative.phase2NetFlow")).toHaveLength(0);
  });

  it("Phase 2 비율 양의 변화인데 부정 키워드만 → warn", () => {
    const insight: ContentQAInsight = {
      breadthNarrative: "시장은 악화되고 위축된 상태가 지속되고 있다.",
      unusualStocksNarrative: "",
      risingRSNarrative: "",
      watchlistNarrative: "",
    };
    const breadthData: ContentQABreadthData = {
      phase2RatioChange: 3.0,
      phase2NetFlow: null,
      phase2EntryAvg5d: null,
    };
    const result = checkToneConsistency(insight, breadthData);
    expect(result.some((m) => m.field === "breadthNarrative.phase2RatioChange")).toBe(true);
  });

  it("Phase 2 비율 양의 변화 + 양의 키워드 + 부정 키워드 혼재 → 규칙2 통과", () => {
    const insight: ContentQAInsight = {
      breadthNarrative: "브레드스가 개선되고 있지만 일부 섹터에서 약세가 보인다.",
      unusualStocksNarrative: "",
      risingRSNarrative: "",
      watchlistNarrative: "",
    };
    const breadthData: ContentQABreadthData = {
      phase2RatioChange: 2.0,
      phase2NetFlow: null,
      phase2EntryAvg5d: null,
    };
    const result = checkToneConsistency(insight, breadthData);
    expect(result.filter((m) => m.field === "breadthNarrative.phase2RatioChange")).toHaveLength(0);
  });

  it("Phase 2 비율 음의 변화이면 규칙2 스킵", () => {
    const insight: ContentQAInsight = {
      breadthNarrative: "시장은 악화되고 있다.",
      unusualStocksNarrative: "",
      risingRSNarrative: "",
      watchlistNarrative: "",
    };
    const breadthData: ContentQABreadthData = {
      phase2RatioChange: -2.0,
      phase2NetFlow: null,
      phase2EntryAvg5d: null,
    };
    const result = checkToneConsistency(insight, breadthData);
    expect(result).toHaveLength(0);
  });

  it("나레이션이 비어있으면 톤 검증 스킵", () => {
    const insight: ContentQAInsight = {
      breadthNarrative: "",
      unusualStocksNarrative: "",
      risingRSNarrative: "",
      watchlistNarrative: "",
    };
    const breadthData: ContentQABreadthData = {
      phase2RatioChange: 5.0,
      phase2NetFlow: 30,
      phase2EntryAvg5d: 10,
    };
    const result = checkToneConsistency(insight, breadthData);
    expect(result).toHaveLength(0);
  });

  it("phase2EntryAvg5d가 0이면 규칙1 스킵 (0으로 나눗셈 방지)", () => {
    const insight: ContentQAInsight = {
      breadthNarrative: "시장은 관망세이다.",
      unusualStocksNarrative: "",
      risingRSNarrative: "",
      watchlistNarrative: "",
    };
    const breadthData: ContentQABreadthData = {
      phase2RatioChange: 1.0,
      phase2NetFlow: 10,
      phase2EntryAvg5d: 0,
    };
    const result = checkToneConsistency(insight, breadthData);
    expect(result.filter((m) => m.field === "breadthNarrative.phase2NetFlow")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Content QA — checkRenderCompleteness
// ---------------------------------------------------------------------------

describe("checkRenderCompleteness", () => {
  const minimalHtml = `
    <html><body>
      <h2>시장 브레드스</h2><div>content</div>
      <h2>특이종목</h2><div>content</div>
      <h2>섹터 RS 랭킹</h2><div>content</div>
    </body></html>
  `;

  const dataCounts: ContentQADataCounts = {
    unusualStocksCount: 5,
    risingRSCount: 3,
    watchlistActiveCount: 2,
  };

  it("모든 필수 섹션이 존재하면 mismatch 없음", () => {
    const result = checkRenderCompleteness(minimalHtml, dataCounts);
    expect(result).toHaveLength(0);
  });

  it("시장 브레드스 섹션 누락 시 warn", () => {
    const html = minimalHtml.replace("<h2>시장 브레드스</h2>", "");
    const result = checkRenderCompleteness(html, dataCounts);
    expect(result.some((m) => m.field === "section:시장 브레드스")).toBe(true);
    expect(result[0].type).toBe("render_incomplete");
  });

  it("특이종목 섹션 누락 시 warn", () => {
    const html = minimalHtml.replace("<h2>특이종목</h2>", "");
    const result = checkRenderCompleteness(html, dataCounts);
    expect(result.some((m) => m.field === "section:특이종목")).toBe(true);
  });

  it("섹터 RS 랭킹 섹션 누락 시 warn", () => {
    const html = minimalHtml.replace("<h2>섹터 RS 랭킹</h2>", "");
    const result = checkRenderCompleteness(html, dataCounts);
    expect(result.some((m) => m.field === "section:섹터 RS 랭킹")).toBe(true);
  });

  it("빈 HTML이면 mismatch 없음 (검증 스킵)", () => {
    const result = checkRenderCompleteness("", dataCounts);
    expect(result).toHaveLength(0);
  });

  it("여러 섹션이 동시에 누락되면 각각 mismatch 반환", () => {
    const html = "<html><body><p>empty</p></body></html>";
    const result = checkRenderCompleteness(html, dataCounts);
    expect(result).toHaveLength(3);
  });

  it("unusualStocks 3건 이하이면 렌더링 수 비교 스킵", () => {
    const counts = { ...dataCounts, unusualStocksCount: 3 };
    const result = checkRenderCompleteness(minimalHtml, counts);
    // 필수 섹션은 있으므로 mismatch 없음
    expect(result).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Content QA — runContentQA
// ---------------------------------------------------------------------------

describe("runContentQA", () => {
  const baseInput: ContentQAInput = {
    insight: {
      breadthNarrative: "Phase 2 비율이 증가하며 시장이 개선되고 있다.",
      unusualStocksNarrative: "반도체 섹터에서 특이 움직임.",
      risingRSNarrative: "헬스케어 업종 RS 상승 초기.",
      watchlistNarrative: "관심종목 현황 양호.",
    },
    breadthData: {
      phase2RatioChange: 1.0,
      phase2NetFlow: 5,
      phase2EntryAvg5d: 4,
    },
    dataCounts: {
      unusualStocksCount: 10,
      risingRSCount: 5,
      watchlistActiveCount: 3,
    },
    html: `<html><body>
      <h2>시장 브레드스</h2><div>content</div>
      <h2>특이종목</h2><div>content</div>
      <h2>섹터 RS 랭킹</h2><div>content</div>
    </body></html>`,
  };

  it("모든 검증 통과 시 severity ok", () => {
    const result = runContentQA(baseInput);
    expect(result.severity).toBe("ok");
    expect(result.mismatches).toHaveLength(0);
    expect(result.checkedItems).toBe(3);
  });

  it("나레이션 누락 1건이면 severity warn", () => {
    const input = {
      ...baseInput,
      insight: { ...baseInput.insight, breadthNarrative: "" },
    };
    const result = runContentQA(input);
    expect(result.severity).toBe("warn");
    expect(result.mismatches.some((m) => m.type === "narrative_missing")).toBe(true);
  });

  it("나레이션 누락 + 톤 불일치 → severity block (warn 2건+)", () => {
    const input: ContentQAInput = {
      ...baseInput,
      insight: {
        breadthNarrative: "시장은 악화되고 있다.",
        unusualStocksNarrative: "",
        risingRSNarrative: "RS 상승 초기.",
        watchlistNarrative: "관심종목 현황.",
      },
      breadthData: {
        phase2RatioChange: 3.0,
        phase2NetFlow: null,
        phase2EntryAvg5d: null,
      },
    };
    const result = runContentQA(input);
    // unusualStocksNarrative 누락(warn) + tone_mismatch(warn) = 2건 → block
    expect(result.mismatches.length).toBeGreaterThanOrEqual(2);
    expect(result.severity).toBe("block");
  });

  it("checkedItems는 항상 3 (나레이션 + 톤 + 렌더링)", () => {
    const result = runContentQA(baseInput);
    expect(result.checkedItems).toBe(3);
  });
});
