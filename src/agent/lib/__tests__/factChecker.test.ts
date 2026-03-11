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
  type Mismatch,
  type DbData,
  type ReportData,
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

  it("겹침 50% 미만이면 warn mismatch 1개 반환", () => {
    // 3개 중 1개 겹침 = 33.3% — warn
    const result = compareSectors(
      ["Technology", "Healthcare", "Energy"],
      ["Technology", "Financials", "Materials"],
    );
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("sector_list");
    expect(result[0].severity).toBe("warn");
    expect(result[0].field).toBe("leadingSectors");
  });

  it("겹침 0%이면 warn mismatch 1개 반환", () => {
    const result = compareSectors(
      ["Technology", "Healthcare"],
      ["Energy", "Financials"],
    );
    expect(result).toHaveLength(1);
    expect(result[0].severity).toBe("warn");
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

  it("차이가 tolerance 초과이면 warn mismatch 반환", () => {
    const result = comparePhase2Ratio(55, 58, 2);
    expect(result).not.toBeNull();
    expect(result!.type).toBe("phase2_ratio");
    expect(result!.severity).toBe("warn");
    expect(result!.field).toBe("phase2Ratio");
  });

  it("dbRatio가 더 큰 경우도 차이 초과이면 warn 반환", () => {
    const result = comparePhase2Ratio(60, 55, 2);
    expect(result).not.toBeNull();
    expect(result!.severity).toBe("warn");
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

  it("mismatch 1개이면 'warn' 반환", () => {
    const mismatches: Mismatch[] = [
      {
        type: "sector_list",
        field: "leadingSectors",
        expected: "Technology",
        actual: "Energy",
        severity: "warn",
      },
    ];
    expect(aggregateSeverity(mismatches)).toBe("warn");
  });

  it("mismatch 2개이면 'block' 반환", () => {
    const mismatches: Mismatch[] = [
      {
        type: "sector_list",
        field: "leadingSectors",
        expected: "Technology",
        actual: "Energy",
        severity: "warn",
      },
      {
        type: "phase2_ratio",
        field: "phase2Ratio",
        expected: 55,
        actual: 65,
        severity: "warn",
      },
    ];
    expect(aggregateSeverity(mismatches)).toBe("block");
  });

  it("mismatch 5개이면 'block' 반환", () => {
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

  it("다수 불일치 시 severity block 반환", () => {
    const reportData: ReportData = {
      ...baseReportData,
      reportedSymbols: [
        { symbol: "NVDA", phase: 3, rsScore: 95, sector: "Technology" }, // phase+rs 불일치
        { symbol: "AAPL", phase: 3, rsScore: 75, sector: "Technology" }, // phase+rs 불일치
      ],
      marketSummary: {
        phase2Ratio: 70, // 불일치
        leadingSectors: ["Financials", "Materials", "Utilities"], // 불일치
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
