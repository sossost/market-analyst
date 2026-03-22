import { describe, it, expect, vi } from "vitest";

/**
 * Sector Alpha Gate 단위 테스트.
 *
 * 순수 함수(evaluateSectorAlpha, evaluateAlphaGate)만 테스트.
 * DB 의존 함수(querySectorSepaStats, runSectorAlphaGate)는 통합 테스트 대상.
 */

// DB mock — import 시 참조 에러 방지용
vi.mock("@/db/client", () => ({
  pool: { query: vi.fn() },
}));

vi.mock("@/etl/utils/retry", () => ({
  retryDatabaseOperation: vi.fn((fn: () => unknown) => fn()),
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import {
  evaluateSectorAlpha,
  evaluateAlphaGate,
  MIN_SA_GRADE_RATIO,
  MIN_AVG_SEPA_SCORE,
  REGULATED_INDUSTRIES,
  STRUCTURAL_OBSERVATION_TAG,
  type SectorSepaStats,
  type AlphaGateResult,
} from "../sectorAlphaGate.js";

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makeStats(overrides: Partial<SectorSepaStats> = {}): SectorSepaStats {
  return {
    sector: "Semiconductor Equipment",
    totalStocks: 10,
    saGradeCount: 3,
    saGradeRatio: 0.3,
    avgScore: 45,
    isRegulated: false,
    ...overrides,
  };
}

// ─── evaluateSectorAlpha ─────────────────────────────────────────────────────

describe("evaluateSectorAlpha", () => {
  it("데이터 없는 섹터는 compatible (평가 보류)", () => {
    const result = evaluateSectorAlpha(makeStats({ totalStocks: 0 }));

    expect(result.compatible).toBe(true);
    expect(result.reason).toContain("데이터 없음");
  });

  it("규제 산업은 incompatible", () => {
    const result = evaluateSectorAlpha(
      makeStats({ sector: "Regulated Electric", isRegulated: true }),
    );

    expect(result.compatible).toBe(false);
    expect(result.reason).toContain("규제 산업");
  });

  it("S/A급 0건 + 평균 스코어 미달 → incompatible", () => {
    const result = evaluateSectorAlpha(
      makeStats({
        saGradeCount: 0,
        saGradeRatio: 0,
        avgScore: 12.3,
      }),
    );

    expect(result.compatible).toBe(false);
    expect(result.reason).toContain("S/A급 0건");
    expect(result.reason).toContain("12.3");
  });

  it("S/A급 존재 + 평균 스코어 미달 → compatible (경고)", () => {
    const result = evaluateSectorAlpha(
      makeStats({
        saGradeCount: 1,
        saGradeRatio: 0.1,
        avgScore: 15,
      }),
    );

    expect(result.compatible).toBe(true);
    expect(result.reason).toContain("경고");
  });

  it("S/A급 존재 + 평균 스코어 충족 → compatible", () => {
    const result = evaluateSectorAlpha(
      makeStats({
        saGradeCount: 3,
        saGradeRatio: 0.3,
        avgScore: 45,
      }),
    );

    expect(result.compatible).toBe(true);
    expect(result.reason).toContain("S/A급 3/10건");
  });

  it("S/A급 0건이지만 평균 스코어 충족 → compatible (경계)", () => {
    const result = evaluateSectorAlpha(
      makeStats({
        saGradeCount: 0,
        saGradeRatio: 0,
        avgScore: 25,
      }),
    );

    // S/A 0건 + avg >= 20 → 첫 번째 incompatible 조건에 걸리지 않음
    expect(result.compatible).toBe(true);
  });
});

// ─── evaluateAlphaGate ───────────────────────────────────────────────────────

describe("evaluateAlphaGate", () => {
  it("빈 배열이면 compatible (평가 생략)", () => {
    const result = evaluateAlphaGate([]);

    expect(result.alphaCompatible).toBe(true);
    expect(result.reason).toContain("수혜 섹터 미지정");
  });

  it("모든 섹터 통과 → compatible", () => {
    const result = evaluateAlphaGate([
      makeStats({ sector: "Semiconductors", avgScore: 50, saGradeCount: 5 }),
      makeStats({ sector: "Software", avgScore: 40, saGradeCount: 3 }),
    ]);

    expect(result.alphaCompatible).toBe(true);
    expect(result.sectorStats).toHaveLength(2);
  });

  it("하나라도 incompatible → 전체 incompatible", () => {
    const result = evaluateAlphaGate([
      makeStats({ sector: "Semiconductors", avgScore: 50, saGradeCount: 5 }),
      makeStats({ sector: "Regulated Electric", isRegulated: true }),
    ]);

    expect(result.alphaCompatible).toBe(false);
    expect(result.reason).toContain("규제 산업");
  });

  it("여러 섹터 부적합 → reason에 모두 포함", () => {
    const result = evaluateAlphaGate([
      makeStats({
        sector: "Regulated Electric",
        isRegulated: true,
      }),
      makeStats({
        sector: "Electrical Equipment",
        saGradeCount: 0,
        saGradeRatio: 0,
        avgScore: 12,
      }),
    ]);

    expect(result.alphaCompatible).toBe(false);
    expect(result.reason).toContain("Regulated Electric");
    expect(result.reason).toContain("Electrical Equipment");
  });
});

// ─── Constants ───────────────────────────────────────────────────────────────

describe("Constants", () => {
  it("MIN_AVG_SEPA_SCORE는 20이다", () => {
    expect(MIN_AVG_SEPA_SCORE).toBe(20);
  });

  it("REGULATED_INDUSTRIES에 주요 유틸리티가 포함된다", () => {
    expect(REGULATED_INDUSTRIES.has("Regulated Electric")).toBe(true);
    expect(REGULATED_INDUSTRIES.has("Gas Utilities")).toBe(true);
    expect(REGULATED_INDUSTRIES.has("Water Utilities")).toBe(true);
  });

  it("STRUCTURAL_OBSERVATION_TAG 형식이 올바르다", () => {
    expect(STRUCTURAL_OBSERVATION_TAG).toBe("[구조적 관찰]");
  });
});
