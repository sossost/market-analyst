import { describe, it, expect } from "vitest";
import {
  parseQuantitativeCondition,
  evaluateQuantitativeCondition,
  tryQuantitativeVerification,
} from "@/debate/quantitativeVerifier";
import type { MarketSnapshot } from "@/debate/marketDataLoader";
import type { Thesis } from "@/types/debate";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMarketSnapshot(
  overrides: Partial<MarketSnapshot> = {},
): MarketSnapshot {
  return {
    date: "2026-03-07",
    sectors: [],
    newPhase2Stocks: [],
    topPhase2Stocks: [],
    breadth: null,
    indices: [],
    fearGreed: null,
    creditIndicators: [],
    ...overrides,
  };
}

function createThesis(
  overrides: Partial<Thesis> = {},
): Thesis {
  return {
    agentPersona: "tech",
    thesis: "테스트 전망",
    timeframeDays: 45,
    verificationMetric: "S&P 500",
    targetCondition: "S&P 500 > 5800",
    confidence: "high",
    consensusLevel: "3/4",
    ...overrides,
  };
}

// ===========================================================================
// parseQuantitativeCondition
// ===========================================================================

describe("parseQuantitativeCondition", () => {
  it('1. "S&P 500 > 5800" — 파싱 성공', () => {
    const result = parseQuantitativeCondition("S&P 500 > 5800");
    expect(result).toEqual({ metric: "S&P 500", operator: ">", value: 5800 });
  });

  it('2. "VIX < 20" — 파싱 성공', () => {
    const result = parseQuantitativeCondition("VIX < 20");
    expect(result).toEqual({ metric: "VIX", operator: "<", value: 20 });
  });

  it('3. "NASDAQ >= 18000" — 파싱 성공', () => {
    const result = parseQuantitativeCondition("NASDAQ >= 18000");
    expect(result).toEqual({ metric: "NASDAQ", operator: ">=", value: 18000 });
  });

  it('4. "Russell 2000 <= 2000" — 파싱 성공', () => {
    const result = parseQuantitativeCondition("Russell 2000 <= 2000");
    expect(result).toEqual({
      metric: "Russell 2000",
      operator: "<=",
      value: 2000,
    });
  });

  it('5. "Energy RS > 70" — 파싱 성공', () => {
    const result = parseQuantitativeCondition("Energy RS > 70");
    expect(result).toEqual({ metric: "Energy RS", operator: ">", value: 70 });
  });

  it('6. "S&P 500 > 5,800" — 쉼표 포함 숫자 처리', () => {
    const result = parseQuantitativeCondition("S&P 500 > 5,800");
    expect(result).toEqual({ metric: "S&P 500", operator: ">", value: 5800 });
  });

  it('7. "기술주 섹터의 상대적 약세가 지속" — 수치 비교 아님 → null', () => {
    const result = parseQuantitativeCondition("기술주 섹터의 상대적 약세가 지속");
    expect(result).toBeNull();
  });

  it('8. "금리 인하 속도 둔화" — 수치 비교 아님 → null', () => {
    const result = parseQuantitativeCondition("금리 인하 속도 둔화");
    expect(result).toBeNull();
  });

  it("9. 빈 문자열 → null", () => {
    const result = parseQuantitativeCondition("");
    expect(result).toBeNull();
  });

  it("10. null/undefined 입력 → null", () => {
    expect(
      parseQuantitativeCondition(null as unknown as string),
    ).toBeNull();
    expect(
      parseQuantitativeCondition(undefined as unknown as string),
    ).toBeNull();
  });

  it('소수점 포함: "VIX < 18.5" → 파싱 성공', () => {
    const result = parseQuantitativeCondition("VIX < 18.5");
    expect(result).toEqual({ metric: "VIX", operator: "<", value: 18.5 });
  });

  it("metric 앞뒤 공백 트림", () => {
    const result = parseQuantitativeCondition("  S&P 500  > 5800");
    expect(result).toEqual({ metric: "S&P 500", operator: ">", value: 5800 });
  });
});

// ===========================================================================
// evaluateQuantitativeCondition
// ===========================================================================

describe("evaluateQuantitativeCondition", () => {
  const snapshotWithIndices = createMarketSnapshot({
    indices: [
      { name: "S&P 500", close: 5900, changePercent: 0.5 },
      { name: "NASDAQ", close: 18500, changePercent: 0.3 },
      { name: "Russell 2000", close: 2100, changePercent: -0.2 },
    ],
    sectors: [
      {
        sector: "Energy",
        avgRs: 75,
        rsRank: 1,
        groupPhase: 2,
        prevGroupPhase: 1,
        change4w: 5,
        change12w: 10,
        phase2Ratio: 40,
        phase1to2Count5d: 3,
      },
      {
        sector: "Technology",
        avgRs: 60,
        rsRank: 2,
        groupPhase: 2,
        prevGroupPhase: 2,
        change4w: 2,
        change12w: 8,
        phase2Ratio: 35,
        phase1to2Count5d: 1,
      },
    ],
  });

  it("11. S&P 500 > 5800, actual 5900 → { result: true, actualValue: 5900 }", () => {
    const parsed = { metric: "S&P 500", operator: ">" as const, value: 5800 };
    const result = evaluateQuantitativeCondition(parsed, snapshotWithIndices);
    expect(result).toEqual({ result: true, actualValue: 5900 });
  });

  it("12. S&P 500 > 5800, actual 5700 → { result: false, actualValue: 5700 }", () => {
    const snapshot = createMarketSnapshot({
      indices: [{ name: "S&P 500", close: 5700, changePercent: -0.5 }],
    });
    const parsed = { metric: "S&P 500", operator: ">" as const, value: 5800 };
    const result = evaluateQuantitativeCondition(parsed, snapshot);
    expect(result).toEqual({ result: false, actualValue: 5700 });
  });

  it("13. VIX < 20, indices에 VIX 없음 → null", () => {
    const parsed = { metric: "VIX", operator: "<" as const, value: 20 };
    const result = evaluateQuantitativeCondition(parsed, snapshotWithIndices);
    expect(result).toBeNull();
  });

  it("13b. VIX < 20, indices에 VIX 있으면 close로 비교", () => {
    const snapshot = createMarketSnapshot({
      indices: [{ name: "VIX", close: 15, changePercent: -2 }],
    });
    const parsed = { metric: "VIX", operator: "<" as const, value: 20 };
    const result = evaluateQuantitativeCondition(parsed, snapshot);
    expect(result).toEqual({ result: true, actualValue: 15 });
  });

  it("14. Energy RS > 70, sector 매치 → { result: true, actualValue: 75 }", () => {
    const parsed = { metric: "Energy RS", operator: ">" as const, value: 70 };
    const result = evaluateQuantitativeCondition(parsed, snapshotWithIndices);
    expect(result).toEqual({ result: true, actualValue: 75 });
  });

  it("14b. Energy sector RS > 80 → { result: false, actualValue: 75 }", () => {
    const parsed = {
      metric: "Energy sector RS",
      operator: ">" as const,
      value: 80,
    };
    const result = evaluateQuantitativeCondition(parsed, snapshotWithIndices);
    expect(result).toEqual({ result: false, actualValue: 75 });
  });

  it('15. 알 수 없는 지표 "FOO" → null', () => {
    const parsed = { metric: "FOO", operator: ">" as const, value: 100 };
    const result = evaluateQuantitativeCondition(parsed, snapshotWithIndices);
    expect(result).toBeNull();
  });

  it("SPX alias → S&P 500 매치", () => {
    const parsed = { metric: "SPX", operator: ">" as const, value: 5800 };
    const result = evaluateQuantitativeCondition(parsed, snapshotWithIndices);
    expect(result).toEqual({ result: true, actualValue: 5900 });
  });

  it("QQQ alias → NASDAQ 매치", () => {
    const parsed = { metric: "QQQ", operator: ">=" as const, value: 18000 };
    const result = evaluateQuantitativeCondition(parsed, snapshotWithIndices);
    expect(result).toEqual({ result: true, actualValue: 18500 });
  });

  it("IWM alias → Russell 2000 매치", () => {
    const parsed = { metric: "IWM", operator: "<=" as const, value: 2200 };
    const result = evaluateQuantitativeCondition(parsed, snapshotWithIndices);
    expect(result).toEqual({ result: true, actualValue: 2100 });
  });

  it(">= 경계값: actual == value → true", () => {
    const snapshot = createMarketSnapshot({
      indices: [{ name: "S&P 500", close: 5800, changePercent: 0 }],
    });
    const parsed = { metric: "S&P 500", operator: ">=" as const, value: 5800 };
    const result = evaluateQuantitativeCondition(parsed, snapshot);
    expect(result).toEqual({ result: true, actualValue: 5800 });
  });

  it("<= 경계값: actual == value → true", () => {
    const snapshot = createMarketSnapshot({
      indices: [{ name: "S&P 500", close: 5800, changePercent: 0 }],
    });
    const parsed = { metric: "S&P 500", operator: "<=" as const, value: 5800 };
    const result = evaluateQuantitativeCondition(parsed, snapshot);
    expect(result).toEqual({ result: true, actualValue: 5800 });
  });
});

// ===========================================================================
// tryQuantitativeVerification
// ===========================================================================

describe("tryQuantitativeVerification", () => {
  const snapshot = createMarketSnapshot({
    indices: [
      { name: "S&P 500", close: 5900, changePercent: 0.5 },
      { name: "NASDAQ", close: 18500, changePercent: 0.3 },
    ],
  });

  it("16. target 충족 → CONFIRMED", () => {
    const thesis = createThesis({
      targetCondition: "S&P 500 > 5800",
    });
    const result = tryQuantitativeVerification(thesis, snapshot);
    expect(result).not.toBeNull();
    expect(result!.verdict).toBe("CONFIRMED");
    expect(result!.method).toBe("quantitative");
    expect(result!.reason).toContain("5900");
  });

  it("17. invalidation 충족 → INVALIDATED", () => {
    const thesis = createThesis({
      targetCondition: "NASDAQ > 20000",
      invalidationCondition: "S&P 500 < 6000",
    });
    const result = tryQuantitativeVerification(thesis, snapshot);
    expect(result).not.toBeNull();
    expect(result!.verdict).toBe("INVALIDATED");
    expect(result!.method).toBe("quantitative");
  });

  it("18. 둘 다 파싱 가능, 조건 미충족 → null", () => {
    const thesis = createThesis({
      targetCondition: "S&P 500 > 6000",
      invalidationCondition: "S&P 500 < 5000",
    });
    const result = tryQuantitativeVerification(thesis, snapshot);
    expect(result).toBeNull();
  });

  it("19. target 파싱 불가 → null (LLM 폴백)", () => {
    const thesis = createThesis({
      targetCondition: "기술주 섹터의 상대적 강세 지속",
    });
    const result = tryQuantitativeVerification(thesis, snapshot);
    expect(result).toBeNull();
  });

  it("20. invalidation 우선 체크 — 둘 다 충족 시 INVALIDATED 반환", () => {
    const thesis = createThesis({
      targetCondition: "S&P 500 > 5800",
      invalidationCondition: "S&P 500 < 6000",
    });
    // target: 5900 > 5800 = true
    // invalidation: 5900 < 6000 = true
    // → INVALIDATED (invalidation 우선)
    const result = tryQuantitativeVerification(thesis, snapshot);
    expect(result).not.toBeNull();
    expect(result!.verdict).toBe("INVALIDATED");
  });

  it("invalidationCondition 없이 target만 파싱 + 충족 → CONFIRMED", () => {
    const thesis = createThesis({
      targetCondition: "S&P 500 > 5800",
      invalidationCondition: undefined,
    });
    const result = tryQuantitativeVerification(thesis, snapshot);
    expect(result).not.toBeNull();
    expect(result!.verdict).toBe("CONFIRMED");
  });

  it("invalidationCondition 없이 target 미충족 → null", () => {
    const thesis = createThesis({
      targetCondition: "S&P 500 > 6000",
      invalidationCondition: undefined,
    });
    const result = tryQuantitativeVerification(thesis, snapshot);
    expect(result).toBeNull();
  });

  it("target 파싱 불가 + invalidation 파싱 가능 + 충족 → INVALIDATED", () => {
    const thesis = createThesis({
      targetCondition: "기술주 강세 지속",
      invalidationCondition: "S&P 500 < 6000",
    });
    const result = tryQuantitativeVerification(thesis, snapshot);
    expect(result).not.toBeNull();
    expect(result!.verdict).toBe("INVALIDATED");
  });

  it("target 파싱 불가 + invalidation 파싱 가능 + 미충족 → null", () => {
    const thesis = createThesis({
      targetCondition: "기술주 강세 지속",
      invalidationCondition: "S&P 500 < 5000",
    });
    const result = tryQuantitativeVerification(thesis, snapshot);
    expect(result).toBeNull();
  });

  it("지표를 찾을 수 없으면 → null (LLM 폴백)", () => {
    const thesis = createThesis({
      targetCondition: "DOW > 40000",
    });
    // snapshot에 DOW 없음
    const result = tryQuantitativeVerification(thesis, snapshot);
    expect(result).toBeNull();
  });
});
