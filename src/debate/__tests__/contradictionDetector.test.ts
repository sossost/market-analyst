import { describe, it, expect } from "vitest";
import {
  classifyDirection,
  normalizeMetric,
  shareTargetEntity,
  detectContradictions,
  type ThesisDirection,
} from "../contradictionDetector.js";
import type { Thesis } from "@/types/debate";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeThesis(overrides: Partial<Thesis> = {}): Thesis {
  return {
    agentPersona: "tech",
    thesis: "Technology 섹터 RS 상승 가속으로 Phase 2 지속",
    timeframeDays: 60,
    verificationMetric: "Technology RS",
    targetCondition: "Technology RS > 65",
    confidence: "high",
    consensusLevel: "3/4",
    category: "sector_rotation",
    ...overrides,
  };
}

// ─── classifyDirection ────────────────────────────────────────────────────────

describe("classifyDirection", () => {
  it("> 연산자가 있는 targetCondition → bullish", () => {
    const t = makeThesis({ targetCondition: "Technology RS > 65" });
    expect(classifyDirection(t)).toBe("bullish");
  });

  it(">= 연산자가 있는 targetCondition → bullish", () => {
    const t = makeThesis({ targetCondition: "S&P 500 >= 5800" });
    expect(classifyDirection(t)).toBe("bullish");
  });

  it("< 연산자가 있는 targetCondition → bearish", () => {
    const t = makeThesis({ targetCondition: "VIX < 15" });
    expect(classifyDirection(t)).toBe("bearish");
  });

  it("<= 연산자가 있는 targetCondition → bearish", () => {
    const t = makeThesis({ targetCondition: "Energy RS <= 40" });
    expect(classifyDirection(t)).toBe("bearish");
  });

  it("연산자 없으면 thesis 텍스트의 bullish 키워드로 판정", () => {
    const t = makeThesis({
      targetCondition: "Energy 섹터 Phase 2 진입 확인",
      thesis: "Energy 섹터 RS 상승 추세 가속",
    });
    expect(classifyDirection(t)).toBe("bullish");
  });

  it("연산자 없으면 thesis 텍스트의 bearish 키워드로 판정", () => {
    const t = makeThesis({
      targetCondition: "Energy 섹터 Phase 2 이탈 확인",
      thesis: "Energy 과열 조정으로 RS 하락 전환",
    });
    expect(classifyDirection(t)).toBe("bearish");
  });

  it("방향성 판정 불가 시 neutral", () => {
    const t = makeThesis({
      targetCondition: "시장 변동성 변화 확인",
      thesis: "글로벌 매크로 환경 변화 모니터링 필요",
    });
    expect(classifyDirection(t)).toBe("neutral");
  });

  it("'상승 전환'은 bullish — '전환' 단독은 bearish 키워드가 아님", () => {
    const t = makeThesis({
      targetCondition: "시장 방향 확인",
      thesis: "Technology 섹터 RS 상승 전환 기대",
    });
    expect(classifyDirection(t)).toBe("bullish");
  });

  it("'하락 전환'은 bearish", () => {
    const t = makeThesis({
      targetCondition: "시장 방향 확인",
      thesis: "Energy 섹터 RS 하락 전환 예상",
    });
    expect(classifyDirection(t)).toBe("bearish");
  });

  it("'Phase 2 이탈'은 bearish — Phase 2 bullish 매칭에서 제외", () => {
    const t = makeThesis({
      targetCondition: "Phase 2 이탈 확인",
      thesis: "Energy 섹터 Phase 2 이탈로 약세 진입",
    });
    expect(classifyDirection(t)).toBe("bearish");
  });

  it("bullish + bearish 키워드 동시 존재 시 neutral", () => {
    const t = makeThesis({
      targetCondition: "시장 상황 변화 확인",
      thesis: "Technology 상승 가능하나 과열 하락 리스크도 존재",
    });
    expect(classifyDirection(t)).toBe("neutral");
  });

  it("targetCondition 연산자 우선 — 텍스트 bearish라도 > 있으면 bullish", () => {
    const t = makeThesis({
      targetCondition: "S&P 500 > 5500",
      thesis: "조정 하락 가능성에도 불구하고 반등 기대",
    });
    expect(classifyDirection(t)).toBe("bullish");
  });
});

// ─── normalizeMetric ──────────────────────────────────────────────────────────

describe("normalizeMetric", () => {
  it("소문자 변환 + 불필요 suffix 제거", () => {
    expect(normalizeMetric("Technology RS")).toBe("technology");
  });

  it("sector 키워드 제거", () => {
    expect(normalizeMetric("Energy sector RS")).toBe("energy");
  });

  it("index 키워드 제거", () => {
    expect(normalizeMetric("S&P 500 Index")).toBe("s&p 500");
  });

  it("다중 공백 정규화", () => {
    expect(normalizeMetric("Technology   sector   RS")).toBe("technology");
  });

  it("VIX는 그대로 유지", () => {
    expect(normalizeMetric("VIX")).toBe("vix");
  });

  it("score 키워드 제거", () => {
    expect(normalizeMetric("Fear Greed Score")).toBe("fear greed");
  });

  it("noise-only metric은 빈 문자열로 정규화", () => {
    expect(normalizeMetric("RS")).toBe("");
    expect(normalizeMetric("Sector RS Index")).toBe("");
  });
});

// ─── shareTargetEntity ────────────────────────────────────────────────────────

describe("shareTargetEntity", () => {
  it("동일 verificationMetric → true", () => {
    const a = makeThesis({ verificationMetric: "Technology RS" });
    const b = makeThesis({ verificationMetric: "Technology sector RS" });
    expect(shareTargetEntity(a, b)).toBe(true);
  });

  it("한쪽이 다른 쪽을 포함 → true", () => {
    const a = makeThesis({ verificationMetric: "Technology" });
    const b = makeThesis({ verificationMetric: "Technology RS" });
    expect(shareTargetEntity(a, b)).toBe(true);
  });

  it("완전히 다른 metric → false (sectors도 다름)", () => {
    const a = makeThesis({
      verificationMetric: "Technology RS",
      beneficiarySectors: ["Technology"],
    });
    const b = makeThesis({
      verificationMetric: "Energy RS",
      beneficiarySectors: ["Energy"],
    });
    expect(shareTargetEntity(a, b)).toBe(false);
  });

  it("metric 다르지만 beneficiarySectors 교집합 → true", () => {
    const a = makeThesis({
      verificationMetric: "AI 반도체 수요",
      beneficiarySectors: ["Technology", "Semiconductors"],
    });
    const b = makeThesis({
      verificationMetric: "클라우드 인프라 투자",
      beneficiarySectors: ["Technology", "Cloud"],
    });
    expect(shareTargetEntity(a, b)).toBe(true);
  });

  it("beneficiarySectors 대소문자 무시", () => {
    const a = makeThesis({
      verificationMetric: "AI 수요",
      beneficiarySectors: ["technology"],
    });
    const b = makeThesis({
      verificationMetric: "반도체 공급",
      beneficiarySectors: ["Technology"],
    });
    expect(shareTargetEntity(a, b)).toBe(true);
  });

  it("beneficiarySectors가 빈 배열이면 metric만으로 판정", () => {
    const a = makeThesis({
      verificationMetric: "S&P 500",
      beneficiarySectors: [],
    });
    const b = makeThesis({
      verificationMetric: "NASDAQ",
      beneficiarySectors: [],
    });
    expect(shareTargetEntity(a, b)).toBe(false);
  });

  it("beneficiarySectors가 undefined이면 무시", () => {
    const a = makeThesis({
      verificationMetric: "S&P 500",
      beneficiarySectors: undefined,
    });
    const b = makeThesis({
      verificationMetric: "S&P 500 Index",
      beneficiarySectors: undefined,
    });
    expect(shareTargetEntity(a, b)).toBe(true);
  });
});

// ─── detectContradictions ─────────────────────────────────────────────────────

describe("detectContradictions", () => {
  it("thesis 1건 이하 → 모순 없음", () => {
    const result = detectContradictions([makeThesis()]);
    expect(result.contradictions).toHaveLength(0);
    expect(result.theses).toHaveLength(1);
  });

  it("빈 배열 → 모순 없음", () => {
    const result = detectContradictions([]);
    expect(result.contradictions).toHaveLength(0);
    expect(result.theses).toHaveLength(0);
  });

  it("같은 target + 상반 방향 → lower consensus에 flag", () => {
    const bullish = makeThesis({
      thesis: "Energy RS 상승 가속, Phase 2 지속",
      verificationMetric: "Energy RS",
      targetCondition: "Energy RS > 75",
      consensusLevel: "3/4",
    });
    const bearish = makeThesis({
      thesis: "Energy 과열, RS 하락 전환 예상",
      verificationMetric: "Energy RS",
      targetCondition: "Energy RS < 60",
      consensusLevel: "2/4",
    });

    const result = detectContradictions([bullish, bearish]);

    expect(result.contradictions).toHaveLength(1);
    expect(result.contradictions[0].keptIndex).toBe(0);   // 3/4 유지
    expect(result.contradictions[0].flaggedIndex).toBe(1); // 2/4 강등
    expect(result.theses[0].contradictionDetected).toBeUndefined();
    expect(result.theses[1].contradictionDetected).toBe(true);
  });

  it("같은 consensus → 앞쪽(먼저 추출된)을 강등", () => {
    const first = makeThesis({
      thesis: "Technology RS 상승 지속",
      verificationMetric: "Technology RS",
      targetCondition: "Technology RS > 70",
      consensusLevel: "3/4",
    });
    const second = makeThesis({
      thesis: "Technology 과열, RS 하락 전환",
      verificationMetric: "Technology RS",
      targetCondition: "Technology RS < 50",
      consensusLevel: "3/4",
    });

    const result = detectContradictions([first, second]);

    expect(result.contradictions).toHaveLength(1);
    expect(result.contradictions[0].flaggedIndex).toBe(0); // 앞쪽 강등
    expect(result.contradictions[0].keptIndex).toBe(1);    // 뒤쪽 유지
    expect(result.theses[0].contradictionDetected).toBe(true);
    expect(result.theses[1].contradictionDetected).toBeUndefined();
  });

  it("다른 target entity → 모순 아님", () => {
    const a = makeThesis({
      thesis: "Technology RS 상승",
      verificationMetric: "Technology RS",
      targetCondition: "Technology RS > 70",
      beneficiarySectors: ["Technology"],
    });
    const b = makeThesis({
      thesis: "Energy RS 하락",
      verificationMetric: "Energy RS",
      targetCondition: "Energy RS < 50",
      beneficiarySectors: ["Energy"],
    });

    const result = detectContradictions([a, b]);
    expect(result.contradictions).toHaveLength(0);
  });

  it("같은 방향 → 모순 아님", () => {
    const a = makeThesis({
      thesis: "Energy RS 상승",
      verificationMetric: "Energy RS",
      targetCondition: "Energy RS > 70",
    });
    const b = makeThesis({
      thesis: "Energy RS 강화 지속",
      verificationMetric: "Energy RS",
      targetCondition: "Energy RS > 80",
    });

    const result = detectContradictions([a, b]);
    expect(result.contradictions).toHaveLength(0);
  });

  it("neutral 방향 thesis는 모순 판정 대상에서 제외", () => {
    const bullish = makeThesis({
      thesis: "Energy RS 상승",
      verificationMetric: "Energy RS",
      targetCondition: "Energy RS > 70",
    });
    const neutral = makeThesis({
      thesis: "Energy 섹터 모니터링 필요",
      verificationMetric: "Energy RS",
      targetCondition: "Energy 시장 변화 관찰",
    });

    const result = detectContradictions([bullish, neutral]);
    expect(result.contradictions).toHaveLength(0);
  });

  it("3개 thesis에서 2쌍 모순 감지 가능", () => {
    const bullish1 = makeThesis({
      thesis: "S&P 500 상승 추세 지속",
      verificationMetric: "S&P 500",
      targetCondition: "S&P 500 > 5800",
      consensusLevel: "4/4",
    });
    const bearish1 = makeThesis({
      thesis: "S&P 500 조정 하락 예상",
      verificationMetric: "S&P 500",
      targetCondition: "S&P 500 < 5200",
      consensusLevel: "2/4",
    });
    const bearish2 = makeThesis({
      thesis: "S&P 500 약세 전환",
      verificationMetric: "S&P 500 Index",
      targetCondition: "S&P 500 < 5000",
      consensusLevel: "1/4",
    });

    const result = detectContradictions([bullish1, bearish1, bearish2]);

    // bullish1 vs bearish1, bullish1 vs bearish2
    expect(result.contradictions).toHaveLength(2);
    // bearish1과 bearish2 모두 flagged
    expect(result.theses[0].contradictionDetected).toBeUndefined();
    expect(result.theses[1].contradictionDetected).toBe(true);
    expect(result.theses[2].contradictionDetected).toBe(true);
  });

  it("beneficiarySectors 교집합으로 target 매칭되는 경우도 탐지", () => {
    const bullish = makeThesis({
      thesis: "AI 반도체 수요 확대로 성장 가속",
      verificationMetric: "AI 반도체 수요",
      targetCondition: "반도체 매출 > 500억",
      beneficiarySectors: ["Technology", "Semiconductors"],
      consensusLevel: "3/4",
    });
    const bearish = makeThesis({
      thesis: "반도체 공급 과잉으로 Technology 약화",
      verificationMetric: "반도체 공급 과잉",
      targetCondition: "반도체 재고 변화 확인",
      beneficiarySectors: ["Technology"],
      consensusLevel: "2/4",
    });

    const result = detectContradictions([bullish, bearish]);
    expect(result.contradictions).toHaveLength(1);
    expect(result.theses[1].contradictionDetected).toBe(true);
  });

  it("flagged thesis의 원본 필드들은 보존된다", () => {
    const bullish = makeThesis({
      thesis: "Energy 상승 지속",
      verificationMetric: "Energy RS",
      targetCondition: "Energy RS > 70",
      consensusLevel: "3/4",
      confidence: "high",
      category: "sector_rotation",
    });
    const bearish = makeThesis({
      thesis: "Energy 하락 전환",
      verificationMetric: "Energy RS",
      targetCondition: "Energy RS < 50",
      consensusLevel: "2/4",
      confidence: "medium",
      category: "sector_rotation",
    });

    const result = detectContradictions([bullish, bearish]);
    const flagged = result.theses[1];

    expect(flagged.confidence).toBe("medium");
    expect(flagged.category).toBe("sector_rotation");
    expect(flagged.consensusLevel).toBe("2/4");
    expect(flagged.contradictionDetected).toBe(true);
  });
});
