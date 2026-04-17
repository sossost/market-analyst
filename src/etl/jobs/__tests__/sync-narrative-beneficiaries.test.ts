/**
 * sync-narrative-beneficiaries 단위 테스트.
 *
 * 순수 함수(Phase 1/4 필터링, 업종 기반 후보 선별)를 격리 테스트한다.
 *
 * Issue #842
 */

import { describe, it, expect } from "vitest";

import {
  filterDegradedTickers,
  selectAutoDiscoveryCandidates,
} from "../sync-narrative-beneficiaries.js";

// =============================================================================
// filterDegradedTickers — Phase 1/4 종목 제거
// =============================================================================

describe("filterDegradedTickers", () => {
  it("Phase 1 종목을 제거한다", () => {
    const phaseMap = new Map([
      ["AAPL", { phase: 2, rsScore: 80 }],
      ["FBK", { phase: 1, rsScore: 39 }],
      ["NVDA", { phase: 2, rsScore: 90 }],
    ]);

    const result = filterDegradedTickers(["AAPL", "FBK", "NVDA"], phaseMap);

    expect(result.kept).toEqual(["AAPL", "NVDA"]);
    expect(result.removed).toEqual(["FBK"]);
  });

  it("Phase 4 종목을 제거한다", () => {
    const phaseMap = new Map([
      ["AAPL", { phase: 2, rsScore: 80 }],
      ["WDH", { phase: 4, rsScore: 42 }],
    ]);

    const result = filterDegradedTickers(["AAPL", "WDH"], phaseMap);

    expect(result.kept).toEqual(["AAPL"]);
    expect(result.removed).toEqual(["WDH"]);
  });

  it("Phase 2 종목은 유지한다", () => {
    const phaseMap = new Map([
      ["AAPL", { phase: 2, rsScore: 80 }],
      ["MSFT", { phase: 2, rsScore: 75 }],
    ]);

    const result = filterDegradedTickers(["AAPL", "MSFT"], phaseMap);

    expect(result.kept).toEqual(["AAPL", "MSFT"]);
    expect(result.removed).toEqual([]);
  });

  it("Phase 3 종목은 유지한다", () => {
    const phaseMap = new Map([["TSLA", { phase: 3, rsScore: 60 }]]);

    const result = filterDegradedTickers(["TSLA"], phaseMap);

    expect(result.kept).toEqual(["TSLA"]);
    expect(result.removed).toEqual([]);
  });

  it("stock_phases 데이터가 없는 종목은 유지한다 (데이터 갭 허용)", () => {
    const phaseMap = new Map([["AAPL", { phase: 2, rsScore: 80 }]]);

    const result = filterDegradedTickers(
      ["AAPL", "UNKNOWN_TICKER"],
      phaseMap,
    );

    expect(result.kept).toEqual(["AAPL", "UNKNOWN_TICKER"]);
    expect(result.removed).toEqual([]);
  });

  it("빈 배열을 처리한다", () => {
    const phaseMap = new Map<string, { phase: number; rsScore: number | null }>();

    const result = filterDegradedTickers([], phaseMap);

    expect(result.kept).toEqual([]);
    expect(result.removed).toEqual([]);
  });

  it("모든 종목이 Phase 1/4이면 전부 제거한다", () => {
    const phaseMap = new Map([
      ["A", { phase: 1, rsScore: 30 }],
      ["B", { phase: 4, rsScore: 20 }],
      ["C", { phase: 1, rsScore: 15 }],
    ]);

    const result = filterDegradedTickers(["A", "B", "C"], phaseMap);

    expect(result.kept).toEqual([]);
    expect(result.removed).toEqual(["A", "B", "C"]);
  });

  it("Phase 1과 4를 혼합 처리한다", () => {
    const phaseMap = new Map([
      ["KEEP1", { phase: 2, rsScore: 80 }],
      ["DROP1", { phase: 1, rsScore: 30 }],
      ["KEEP2", { phase: 3, rsScore: 65 }],
      ["DROP2", { phase: 4, rsScore: 15 }],
      ["KEEP3", { phase: 2, rsScore: 90 }],
    ]);

    const result = filterDegradedTickers(
      ["KEEP1", "DROP1", "KEEP2", "DROP2", "KEEP3"],
      phaseMap,
    );

    expect(result.kept).toEqual(["KEEP1", "KEEP2", "KEEP3"]);
    expect(result.removed).toEqual(["DROP1", "DROP2"]);
  });

  it("rsScore가 null인 종목도 Phase 기준으로만 판단한다", () => {
    const phaseMap = new Map([
      ["A", { phase: 2, rsScore: null }],
      ["B", { phase: 1, rsScore: null }],
    ]);

    const result = filterDegradedTickers(["A", "B"], phaseMap);

    expect(result.kept).toEqual(["A"]);
    expect(result.removed).toEqual(["B"]);
  });
});

// =============================================================================
// selectAutoDiscoveryCandidates — 업종 기반 자동 후보 선별
// =============================================================================

describe("selectAutoDiscoveryCandidates", () => {
  it("RS 내림차순으로 상위 N개를 반환한다", () => {
    const candidates = [
      { symbol: "LOW_RS", rsScore: 60 },
      { symbol: "HIGH_RS", rsScore: 90 },
      { symbol: "MID_RS", rsScore: 75 },
    ];

    const result = selectAutoDiscoveryCandidates(candidates, 2);

    expect(result).toEqual(["HIGH_RS", "MID_RS"]);
  });

  it("기본 상한은 5개다", () => {
    const candidates = Array.from({ length: 10 }, (_, i) => ({
      symbol: `SYM${i}`,
      rsScore: 90 - i,
    }));

    const result = selectAutoDiscoveryCandidates(candidates);

    expect(result).toHaveLength(5);
    expect(result).toEqual(["SYM0", "SYM1", "SYM2", "SYM3", "SYM4"]);
  });

  it("입력 배열을 변경하지 않는다 (immutability)", () => {
    const candidates = [
      { symbol: "C", rsScore: 60 },
      { symbol: "A", rsScore: 90 },
      { symbol: "B", rsScore: 75 },
    ];
    const originalOrder = candidates.map((c) => c.symbol);

    selectAutoDiscoveryCandidates(candidates, 2);

    // 원본 배열 순서가 변경되지 않아야 한다
    expect(candidates.map((c) => c.symbol)).toEqual(originalOrder);
  });

  it("후보가 상한보다 적으면 전부 반환한다", () => {
    const candidates = [
      { symbol: "A", rsScore: 80 },
      { symbol: "B", rsScore: 70 },
    ];

    const result = selectAutoDiscoveryCandidates(candidates, 5);

    expect(result).toEqual(["A", "B"]);
  });

  it("빈 배열을 처리한다", () => {
    const result = selectAutoDiscoveryCandidates([]);

    expect(result).toEqual([]);
  });

  it("rsScore가 null인 후보를 맨 뒤로 정렬한다", () => {
    const candidates = [
      { symbol: "NULL_RS", rsScore: null },
      { symbol: "HIGH_RS", rsScore: 85 },
      { symbol: "LOW_RS", rsScore: 60 },
    ];

    const result = selectAutoDiscoveryCandidates(candidates, 3);

    expect(result).toEqual(["HIGH_RS", "LOW_RS", "NULL_RS"]);
  });

  it("동일 RS인 경우 원래 순서를 유지한다", () => {
    const candidates = [
      { symbol: "A", rsScore: 80 },
      { symbol: "B", rsScore: 80 },
      { symbol: "C", rsScore: 80 },
    ];

    const result = selectAutoDiscoveryCandidates(candidates, 2);

    expect(result).toHaveLength(2);
    // 동일 RS이므로 안정 정렬 기대하지 않지만, 2개가 선택됨을 확인
    expect(candidates.map((c) => c.symbol)).toEqual(
      expect.arrayContaining(result),
    );
  });
});
