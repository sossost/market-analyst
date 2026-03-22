/**
 * quantitativeVerifier 단위 테스트.
 *
 * 검증 항목:
 *
 * parseQuantitativeCondition
 *   1. 유효한 조건 문자열 파싱
 *   2. null/빈 문자열 → null 반환
 *   3. 연산자 없는 문자열 → null 반환
 *   4. 숫자에 콤마/언더스코어 포함 → 올바르게 파싱
 *
 * normalizeSectorName (resolveMetricValue 내부 동작 검증)
 *   5. 정확한 DB 섹터명 → 그대로 매칭
 *   6. "Tech RS > 60" — 약칭 "Tech" → "Technology" 매핑
 *   7. "Information Technology RS > 55" — GICS 공식명 → "Technology" 매핑
 *   8. "Technology sector RS > 60" — "sector" 키워드 포함 형식 → 매핑
 *   9. "Technology RS score > 60" — "score" 접미사 포함 형식 → 매핑
 *  10. "Consumer Discretionary RS > 50" — Consumer Cyclical 매핑
 *  11. "Consumer Staples RS > 50" — Consumer Defensive 매핑
 *  12. "Financials RS > 60" — Financial Services 매핑
 *  13. "Health RS > 55" — Healthcare 매핑
 *  14. 알 수 없는 섹터 이름 → null 반환
 *  15. 섹터 RS 임계값 비교 (> / < / >= / <=)
 *
 * tryQuantitativeVerification
 *  16. targetCondition 충족 → CONFIRMED
 *  17. invalidationCondition 충족 → INVALIDATED (safety-first)
 *  18. 양쪽 모두 파싱 불가 → null (LLM fallback)
 *  19. 메트릭 미발견 → null (LLM fallback)
 *  20. 양쪽 파싱 가능 + 조건 미충족 → null
 */

import { describe, it, expect } from "vitest";
import {
  parseQuantitativeCondition,
  evaluateQuantitativeCondition,
  tryQuantitativeVerification,
} from "../quantitativeVerifier.js";
import type { MarketSnapshot } from "../marketDataLoader.js";

// ─── 픽스처 ───────────────────────────────────────────────────────────────────

function makeSnapshot(sectors: Array<{ sector: string; avgRs: number }> = []): MarketSnapshot {
  return {
    date: "2026-03-16",
    indices: [
      { name: "S&P 500", close: 5800, changePercent: 0.5 },
      { name: "NASDAQ", close: 18000, changePercent: 0.8 },
      { name: "VIX", close: 18, changePercent: -1.2 },
    ],
    sectors: sectors.map((s) => ({
      sector: s.sector,
      avgRs: s.avgRs,
      rsRank: 1,
      groupPhase: 2,
      prevGroupPhase: null,
      change4w: null,
      change12w: null,
      phase2Ratio: 0.5,
      phase1to2Count5d: 0,
    })),
    newPhase2Stocks: [],
    topPhase2Stocks: [],
    breadth: null,
    fearGreed: { score: 55, rating: "Greed", previousClose: 50, previous1Week: 48 },
  };
}

function makeTechSnapshot(avgRs: number): MarketSnapshot {
  return makeSnapshot([{ sector: "Technology", avgRs }]);
}

// ─── parseQuantitativeCondition ───────────────────────────────────────────────

describe("parseQuantitativeCondition", () => {
  it("유효한 조건 문자열을 파싱한다", () => {
    const result = parseQuantitativeCondition("S&P 500 > 5800");

    expect(result).toEqual({
      metric: "S&P 500",
      operator: ">",
      value: 5800,
    });
  });

  it("모든 연산자(>, <, >=, <=)를 파싱한다", () => {
    expect(parseQuantitativeCondition("Technology RS >= 60")).toEqual({
      metric: "Technology RS",
      operator: ">=",
      value: 60,
    });
    expect(parseQuantitativeCondition("VIX < 20")).toEqual({
      metric: "VIX",
      operator: "<",
      value: 20,
    });
    expect(parseQuantitativeCondition("NASDAQ <= 17000")).toEqual({
      metric: "NASDAQ",
      operator: "<=",
      value: 17000,
    });
  });

  it("null 입력 → null을 반환한다", () => {
    expect(parseQuantitativeCondition(null)).toBeNull();
  });

  it("빈 문자열 입력 → null을 반환한다", () => {
    expect(parseQuantitativeCondition("")).toBeNull();
    expect(parseQuantitativeCondition("   ")).toBeNull();
  });

  it("연산자가 없는 문자열 → null을 반환한다", () => {
    expect(parseQuantitativeCondition("Technology RS 상승 중")).toBeNull();
    expect(parseQuantitativeCondition("섹터 강세 지속")).toBeNull();
  });

  it("숫자에 콤마 포함된 조건 → 올바르게 파싱한다", () => {
    const result = parseQuantitativeCondition("S&P 500 > 5,800");

    expect(result?.value).toBe(5800);
  });

  it("숫자에 언더스코어 포함된 조건 → 올바르게 파싱한다", () => {
    const result = parseQuantitativeCondition("Russell 2000 > 2_100");

    expect(result?.value).toBe(2100);
  });
});

// ─── 섹터 RS 매핑 — evaluateQuantitativeCondition 통해 검증 ──────────────────

describe("섹터 RS 매핑", () => {
  it("정확한 DB 섹터명 'Technology RS > 60' → 올바르게 평가한다", () => {
    const parsed = parseQuantitativeCondition("Technology RS > 60");
    const snapshot = makeTechSnapshot(75);

    const result = evaluateQuantitativeCondition(parsed!, snapshot);

    expect(result).toEqual({ result: true, actualValue: 75 });
  });

  it("약칭 'Tech RS > 60' → Technology로 매핑되어 평가한다", () => {
    const parsed = parseQuantitativeCondition("Tech RS > 60");
    const snapshot = makeTechSnapshot(75);

    const result = evaluateQuantitativeCondition(parsed!, snapshot);

    expect(result).toEqual({ result: true, actualValue: 75 });
  });

  it("GICS 공식명 'Information Technology RS > 55' → Technology로 매핑되어 평가한다", () => {
    const parsed = parseQuantitativeCondition("Information Technology RS > 55");
    const snapshot = makeTechSnapshot(65);

    const result = evaluateQuantitativeCondition(parsed!, snapshot);

    expect(result).toEqual({ result: true, actualValue: 65 });
  });

  it("'Technology sector RS > 60' — 'sector' 키워드 포함 형식을 평가한다", () => {
    const parsed = parseQuantitativeCondition("Technology sector RS > 60");
    const snapshot = makeTechSnapshot(75);

    const result = evaluateQuantitativeCondition(parsed!, snapshot);

    expect(result).toEqual({ result: true, actualValue: 75 });
  });

  it("'Tech sector RS > 60' — 약칭 + 'sector' 키워드 포함 형식을 평가한다", () => {
    const parsed = parseQuantitativeCondition("Tech sector RS > 60");
    const snapshot = makeTechSnapshot(75);

    const result = evaluateQuantitativeCondition(parsed!, snapshot);

    expect(result).toEqual({ result: true, actualValue: 75 });
  });

  it("'Technology RS score > 60' — 'score' 접미사 포함 형식을 평가한다", () => {
    const parsed = parseQuantitativeCondition("Technology RS score > 60");
    const snapshot = makeTechSnapshot(75);

    const result = evaluateQuantitativeCondition(parsed!, snapshot);

    expect(result).toEqual({ result: true, actualValue: 75 });
  });

  it("'Consumer Discretionary RS > 50' → Consumer Cyclical로 매핑되어 평가한다", () => {
    const parsed = parseQuantitativeCondition("Consumer Discretionary RS > 50");
    const snapshot = makeSnapshot([{ sector: "Consumer Cyclical", avgRs: 62 }]);

    const result = evaluateQuantitativeCondition(parsed!, snapshot);

    expect(result).toEqual({ result: true, actualValue: 62 });
  });

  it("'Consumer Staples RS > 50' → Consumer Defensive로 매핑되어 평가한다", () => {
    const parsed = parseQuantitativeCondition("Consumer Staples RS > 50");
    const snapshot = makeSnapshot([{ sector: "Consumer Defensive", avgRs: 58 }]);

    const result = evaluateQuantitativeCondition(parsed!, snapshot);

    expect(result).toEqual({ result: true, actualValue: 58 });
  });

  it("'Financials RS > 60' → Financial Services로 매핑되어 평가한다", () => {
    const parsed = parseQuantitativeCondition("Financials RS > 60");
    const snapshot = makeSnapshot([{ sector: "Financial Services", avgRs: 70 }]);

    const result = evaluateQuantitativeCondition(parsed!, snapshot);

    expect(result).toEqual({ result: true, actualValue: 70 });
  });

  it("'Health RS > 55' → Healthcare로 매핑되어 평가한다", () => {
    const parsed = parseQuantitativeCondition("Health RS > 55");
    const snapshot = makeSnapshot([{ sector: "Healthcare", avgRs: 60 }]);

    const result = evaluateQuantitativeCondition(parsed!, snapshot);

    expect(result).toEqual({ result: true, actualValue: 60 });
  });

  it("알 수 없는 섹터명 → null을 반환한다", () => {
    const parsed = parseQuantitativeCondition("Aerospace RS > 60");
    const snapshot = makeTechSnapshot(75);

    const result = evaluateQuantitativeCondition(parsed!, snapshot);

    expect(result).toBeNull();
  });

  it("RS 임계값 미충족(실제값 < 기준값) → result: false", () => {
    const parsed = parseQuantitativeCondition("Technology RS > 80");
    const snapshot = makeTechSnapshot(75);

    const result = evaluateQuantitativeCondition(parsed!, snapshot);

    expect(result).toEqual({ result: false, actualValue: 75 });
  });

  it("RS 임계값 경계값(실제값 === 기준값, '>' 연산자) → result: false", () => {
    const parsed = parseQuantitativeCondition("Technology RS > 75");
    const snapshot = makeTechSnapshot(75);

    const result = evaluateQuantitativeCondition(parsed!, snapshot);

    expect(result).toEqual({ result: false, actualValue: 75 });
  });

  it("RS 임계값 경계값(실제값 === 기준값, '>=' 연산자) → result: true", () => {
    const parsed = parseQuantitativeCondition("Technology RS >= 75");
    const snapshot = makeTechSnapshot(75);

    const result = evaluateQuantitativeCondition(parsed!, snapshot);

    expect(result).toEqual({ result: true, actualValue: 75 });
  });
});

// ─── tryQuantitativeVerification ─────────────────────────────────────────────

describe("tryQuantitativeVerification", () => {
  function makeThesis(overrides: {
    targetCondition: string | null;
    invalidationCondition?: string | null;
  }) {
    return {
      agentPersona: "tech",
      thesis: "테크 섹터 강세 지속",
      timeframeDays: 30,
      verificationMetric: "Technology RS",
      confidence: "medium",
      consensusLevel: "3/4",
      targetCondition: overrides.targetCondition,
      invalidationCondition: overrides.invalidationCondition,
    } as unknown as Parameters<typeof tryQuantitativeVerification>[0];
  }

  it("targetCondition 충족 → CONFIRMED를 반환한다", () => {
    const thesis = makeThesis({ targetCondition: "Technology RS > 60" });
    const snapshot = makeTechSnapshot(75);

    const result = tryQuantitativeVerification(thesis, snapshot);

    expect(result?.verdict).toBe("CONFIRMED");
    expect(result?.method).toBe("quantitative");
    expect(result?.reason).toContain("75");
  });

  it("invalidationCondition 충족 → INVALIDATED를 반환한다 (safety-first)", () => {
    const thesis = makeThesis({
      targetCondition: "Technology RS > 60",
      invalidationCondition: "Technology RS < 50",
    });
    // avgRs = 40: invalidation 조건(<50) 충족, target 조건(>60) 미충족
    const snapshot = makeTechSnapshot(40);

    const result = tryQuantitativeVerification(thesis, snapshot);

    expect(result?.verdict).toBe("INVALIDATED");
    expect(result?.reason).toContain("40");
  });

  it("invalidationCondition이 targetCondition보다 우선한다 (safety-first)", () => {
    // avgRs = 70: target(>60) 충족 AND invalidation(>65) 충족 — INVALIDATED 우선
    const thesis = makeThesis({
      targetCondition: "Technology RS > 60",
      invalidationCondition: "Technology RS > 65",
    });
    const snapshot = makeTechSnapshot(70);

    const result = tryQuantitativeVerification(thesis, snapshot);

    expect(result?.verdict).toBe("INVALIDATED");
  });

  it("양쪽 모두 파싱 불가 → null (LLM fallback)", () => {
    const thesis = makeThesis({
      targetCondition: "기술주 섹터 강세 지속",
      invalidationCondition: "시장 전반적 약세 전환",
    });
    const snapshot = makeTechSnapshot(75);

    const result = tryQuantitativeVerification(thesis, snapshot);

    expect(result).toBeNull();
  });

  it("메트릭 미발견(알 수 없는 섹터) → null (LLM fallback)", () => {
    const thesis = makeThesis({ targetCondition: "Aerospace RS > 60" });
    const snapshot = makeTechSnapshot(75); // Technology만 있음

    const result = tryQuantitativeVerification(thesis, snapshot);

    expect(result).toBeNull();
  });

  it("양쪽 파싱 가능 + 조건 미충족 → null", () => {
    const thesis = makeThesis({
      targetCondition: "Technology RS > 80",
      invalidationCondition: "Technology RS < 50",
    });
    // avgRs = 65: target(>80) 미충족, invalidation(<50) 미충족
    const snapshot = makeTechSnapshot(65);

    const result = tryQuantitativeVerification(thesis, snapshot);

    expect(result).toBeNull();
  });

  it("targetCondition만 null + invalidation 파싱 가능 + 조건 미충족 → null", () => {
    const thesis = makeThesis({
      targetCondition: null,
      invalidationCondition: "Technology RS < 50",
    });
    const snapshot = makeTechSnapshot(65); // <50 미충족

    const result = tryQuantitativeVerification(thesis, snapshot);

    expect(result).toBeNull();
  });

  it("'Tech RS > 60' — 약칭 포함 조건으로 CONFIRMED를 반환한다", () => {
    const thesis = makeThesis({ targetCondition: "Tech RS > 60" });
    const snapshot = makeTechSnapshot(75);

    const result = tryQuantitativeVerification(thesis, snapshot);

    expect(result?.verdict).toBe("CONFIRMED");
  });

  it("'Information Technology RS > 55' — GICS 공식명으로 CONFIRMED를 반환한다", () => {
    const thesis = makeThesis({ targetCondition: "Information Technology RS > 55" });
    const snapshot = makeTechSnapshot(65);

    const result = tryQuantitativeVerification(thesis, snapshot);

    expect(result?.verdict).toBe("CONFIRMED");
  });
});
