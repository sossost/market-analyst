import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { extractThesesFromText, extractDebateOutput, containsNumericPrediction, containsPriceTarget, filterShortTermOutlookCap } from "../round3-synthesis.js";
import { logger } from "@/lib/logger";

// ─── Helper ──────��─────────────────────────────────────────────────────────────

function wrapThesesInText(theses: unknown[]): string {
  return `리포트 내용\n\n\`\`\`json\n${JSON.stringify(theses)}\n\`\`\``;
}

function makeThesis(overrides: Record<string, unknown> = {}) {
  return {
    agentPersona: "macro",
    thesis: "테스트 전망",
    category: "short_term_outlook",
    timeframeDays: 30,
    verificationMetric: "S&P 500",
    targetCondition: "S&P 500 > 5800",
    invalidationCondition: "S&P 500 < 5500",
    confidence: "medium",
    consensusLevel: "3/4",
    ...overrides,
  };
}

// ─── sentiment short_term_outlook 재분류 ─────────────────────────────────────

describe("sentiment short_term_outlook 카테고리 필터", () => {
  it("sentiment의 short_term_outlook을 sector_rotation으로 재분류한다", () => {
    const text = wrapThesesInText([
      makeThesis({
        agentPersona: "sentiment",
        category: "short_term_outlook",
        thesis: "VIX 하락 전망",
        timeframeDays: 30,
      }),
    ]);

    const result = extractThesesFromText(text);

    expect(result.theses).toHaveLength(1);
    expect(result.theses[0].category).toBe("sector_rotation");
    expect(result.theses[0].agentPersona).toBe("sentiment");
  });

  it("sentiment의 structural_narrative는 변경하�� 않는다", () => {
    const text = wrapThesesInText([
      makeThesis({
        agentPersona: "sentiment",
        category: "structural_narrative",
        thesis: "포지셔닝 과밀 분석",
        timeframeDays: 60,
      }),
    ]);

    const result = extractThesesFromText(text);

    expect(result.theses).toHaveLength(1);
    expect(result.theses[0].category).toBe("structural_narrative");
  });

  it("sentiment의 sector_rotation은 변경하지 않는다", () => {
    const text = wrapThesesInText([
      makeThesis({
        agentPersona: "sentiment",
        category: "sector_rotation",
        thesis: "자금 로테이션 분석",
        timeframeDays: 30,
      }),
    ]);

    const result = extractThesesFromText(text);

    expect(result.theses).toHaveLength(1);
    expect(result.theses[0].category).toBe("sector_rotation");
  });

  it("macro의 short_term_outlook을 sector_rotation으로 재분류한다", () => {
    const text = wrapThesesInText([
      makeThesis({
        agentPersona: "macro",
        category: "short_term_outlook",
        thesis: "금리 인하 전망",
        timeframeDays: 30,
      }),
    ]);

    const result = extractThesesFromText(text);

    expect(result.theses).toHaveLength(1);
    expect(result.theses[0].category).toBe("sector_rotation");
  });

  it("tech의 short_term_outlook은 ��경하지 않는다", () => {
    const text = wrapThesesInText([
      makeThesis({
        agentPersona: "tech",
        category: "short_term_outlook",
        thesis: "반도체 수요 전망",
        timeframeDays: 30,
      }),
    ]);

    const result = extractThesesFromText(text);

    expect(result.theses).toHaveLength(1);
    expect(result.theses[0].category).toBe("short_term_outlook");
  });

  it("geopolitics의 short_term_outlook을 sector_rotation으로 재분류한다", () => {
    const text = wrapThesesInText([
      makeThesis({
        agentPersona: "geopolitics",
        category: "short_term_outlook",
        thesis: "관세 영향 전망",
        timeframeDays: 30,
      }),
    ]);

    const result = extractThesesFromText(text);

    expect(result.theses).toHaveLength(1);
    expect(result.theses[0].category).toBe("sector_rotation");
  });

  it("재분류 시 로그를 남긴다", () => {
    const text = wrapThesesInText([
      makeThesis({
        agentPersona: "sentiment",
        category: "short_term_outlook",
        thesis: "VIX 하락 전망",
        timeframeDays: 30,
      }),
    ]);

    extractThesesFromText(text);

    expect(logger.info).toHaveBeenCalledWith(
      "Round3",
      expect.stringContaining("sentiment의 thesis 카테고리 재분류"),
    );
  });

  it("여러 thesis 중 macro와 sentiment를 재분류한다", () => {
    const text = wrapThesesInText([
      makeThesis({
        agentPersona: "macro",
        category: "short_term_outlook",
        thesis: "매크로 전망",
        timeframeDays: 30,
      }),
      makeThesis({
        agentPersona: "sentiment",
        category: "short_term_outlook",
        thesis: "심리 전망",
        timeframeDays: 30,
      }),
      makeThesis({
        agentPersona: "tech",
        category: "structural_narrative",
        thesis: "AI 인프라 서사",
        timeframeDays: 60,
      }),
    ]);

    const result = extractThesesFromText(text);

    expect(result.theses).toHaveLength(3);
    expect(result.theses.find((t) => t.agentPersona === "macro")!.category).toBe("sector_rotation");
    expect(result.theses.find((t) => t.agentPersona === "sentiment")!.category).toBe("sector_rotation");
    expect(result.theses.find((t) => t.agentPersona === "tech")!.category).toBe("structural_narrative");
  });
});

// ─── sentiment confidence 자동 하향 ─────────────────────────────────────────

describe("sentiment confidence 자동 하향", () => {
  it("sentiment의 high confidence를 low로 2단계 하향한다", () => {
    const text = wrapThesesInText([
      makeThesis({
        agentPersona: "sentiment",
        category: "structural_narrative",
        confidence: "high",
        thesis: "포지셔닝 과밀 분석",
        timeframeDays: 60,
      }),
    ]);

    const result = extractThesesFromText(text);

    expect(result.theses).toHaveLength(1);
    expect(result.theses[0].confidence).toBe("low");
  });

  it("sentiment의 medium confidence를 low로 하향한다", () => {
    const text = wrapThesesInText([
      makeThesis({
        agentPersona: "sentiment",
        category: "sector_rotation",
        confidence: "medium",
        thesis: "자금 로테이션 분석",
        timeframeDays: 30,
      }),
    ]);

    const result = extractThesesFromText(text);

    expect(result.theses).toHaveLength(1);
    expect(result.theses[0].confidence).toBe("low");
  });

  it("sentiment의 low confidence는 low를 유지한다", () => {
    const text = wrapThesesInText([
      makeThesis({
        agentPersona: "sentiment",
        category: "sector_rotation",
        confidence: "low",
        thesis: "약한 확신 분석",
        timeframeDays: 30,
      }),
    ]);

    const result = extractThesesFromText(text);

    expect(result.theses).toHaveLength(1);
    expect(result.theses[0].confidence).toBe("low");
  });

  it("macro의 confidence는 하향하지 않는다", () => {
    const text = wrapThesesInText([
      makeThesis({
        agentPersona: "macro",
        category: "short_term_outlook",
        confidence: "high",
        thesis: "금리 전망",
        timeframeDays: 30,
      }),
    ]);

    const result = extractThesesFromText(text);

    expect(result.theses).toHaveLength(1);
    expect(result.theses[0].confidence).toBe("high");
  });

  it("tech의 confidence는 하향하지 않는다", () => {
    const text = wrapThesesInText([
      makeThesis({
        agentPersona: "tech",
        category: "structural_narrative",
        confidence: "high",
        thesis: "AI 인프라 서사",
        timeframeDays: 60,
      }),
    ]);

    const result = extractThesesFromText(text);

    expect(result.theses).toHaveLength(1);
    expect(result.theses[0].confidence).toBe("high");
  });

  it("geopolitics의 confidence는 하향하지 않는다", () => {
    const text = wrapThesesInText([
      makeThesis({
        agentPersona: "geopolitics",
        category: "structural_narrative",
        confidence: "high",
        thesis: "관세 영향 분석",
        timeframeDays: 60,
      }),
    ]);

    const result = extractThesesFromText(text);

    expect(result.theses).toHaveLength(1);
    expect(result.theses[0].confidence).toBe("high");
  });

  it("confidence 하향 시 로그를 남긴다", () => {
    const text = wrapThesesInText([
      makeThesis({
        agentPersona: "sentiment",
        category: "structural_narrative",
        confidence: "high",
        thesis: "포지셔닝 분석",
        timeframeDays: 60,
      }),
    ]);

    extractThesesFromText(text);

    expect(logger.info).toHaveBeenCalledWith(
      "Round3",
      expect.stringContaining("sentiment의 thesis confidence 하향"),
    );
  });

  it("여러 thesis에서 sentiment만 confidence 하향한다", () => {
    const text = wrapThesesInText([
      makeThesis({
        agentPersona: "macro",
        confidence: "high",
        thesis: "매크로 전망",
        timeframeDays: 30,
      }),
      makeThesis({
        agentPersona: "sentiment",
        category: "sector_rotation",
        confidence: "high",
        thesis: "심리 전망",
        timeframeDays: 30,
      }),
      makeThesis({
        agentPersona: "tech",
        confidence: "high",
        category: "structural_narrative",
        thesis: "AI 인프라 서사",
        timeframeDays: 60,
      }),
    ]);

    const result = extractThesesFromText(text);

    expect(result.theses).toHaveLength(3);
    expect(result.theses.find((t) => t.agentPersona === "macro")!.confidence).toBe("high");
    expect(result.theses.find((t) => t.agentPersona === "sentiment")!.confidence).toBe("low");
    expect(result.theses.find((t) => t.agentPersona === "tech")!.confidence).toBe("high");
  });
});

// ─── containsNumericPrediction 패턴 검출 ─────────────────────────────────────

describe("containsNumericPrediction", () => {
  it("VIX + 수치 + 하회 패턴을 검출한다", () => {
    expect(containsNumericPrediction("VIX 20 하회 안착에 4-6주 소요")).toBe(true);
  });

  it("F&G + 수치 + 회복 패턴을 검출한다", () => {
    expect(containsNumericPrediction("F&G 25+ 회복 전망")).toBe(true);
  });

  it("RS + 수치 + 하회 패턴을 검출한다", () => {
    expect(containsNumericPrediction("RS 60일내 65 하회 전망")).toBe(true);
  });

  it("N주 내 반전 패턴을 검출한다", () => {
    expect(containsNumericPrediction("4주 내 반전 가능성")).toBe(true);
  });

  it("바닥 형성 후 반등 패턴을 검출한다", () => {
    expect(containsNumericPrediction("바닥 형성 이후 반등 예상")).toBe(true);
  });

  it("VIX 레인지 예측 패턴을 검출한다", () => {
    expect(containsNumericPrediction("VIX 22-28 레인지 전망")).toBe(true);
  });

  it("공포탐욕 수치 예측을 검출한다", () => {
    expect(containsNumericPrediction("공포탐욕 30 도달 전망")).toBe(true);
  });

  it("현재값 인용은 검출하지 않는다", () => {
    expect(containsNumericPrediction("현재 VIX 31, 극단적 공포 구간")).toBe(false);
  });

  it("수치 없는 방향성 관찰은 검출하지 않는다", () => {
    expect(containsNumericPrediction("자금이 defensive 섹터로 이동 중")).toBe(false);
  });

  it("구조적 분석은 검출하지 않는다", () => {
    expect(containsNumericPrediction("포지셔닝이 과밀하여 해소 압력 존재")).toBe(false);
  });

  it("조건부 분석은 검출하지 않는다", () => {
    expect(containsNumericPrediction("VIX가 30 이상 유지되는 한 risk-off 지속")).toBe(false);
  });
});

// ─── sentiment 수치 예측 thesis 드롭 ─────────────────────────────────────────

describe("sentiment 수치 예측 thesis 드롭", () => {
  it("sentiment의 수치 예측 thesis를 드롭한다", () => {
    const text = wrapThesesInText([
      makeThesis({
        agentPersona: "sentiment",
        category: "sector_rotation",
        thesis: "VIX 20 하회 안착 전망",
        timeframeDays: 30,
      }),
    ]);

    const result = extractThesesFromText(text);

    expect(result.theses).toHaveLength(0);
  });

  it("sentiment의 구조적 분석 thesis는 통과한다", () => {
    const text = wrapThesesInText([
      makeThesis({
        agentPersona: "sentiment",
        category: "structural_narrative",
        thesis: "포지셔닝이 과밀하여 해소 압력이 구조적으로 존재",
        timeframeDays: 60,
      }),
    ]);

    const result = extractThesesFromText(text);

    expect(result.theses).toHaveLength(1);
  });

  it("macro의 수치 포함 thesis는 드롭하지 않는다", () => {
    const text = wrapThesesInText([
      makeThesis({
        agentPersona: "macro",
        category: "structural_narrative",
        thesis: "VIX 20 하회 안착 전망",
        timeframeDays: 30,
      }),
    ]);

    const result = extractThesesFromText(text);

    expect(result.theses).toHaveLength(1);
  });

  it("수치 예측 드롭 시 로그를 남긴다", () => {
    const text = wrapThesesInText([
      makeThesis({
        agentPersona: "sentiment",
        category: "sector_rotation",
        thesis: "F&G 25+ 회복 전망으로 리스크온 전환 기대",
        timeframeDays: 30,
      }),
    ]);

    extractThesesFromText(text);

    expect(logger.info).toHaveBeenCalledWith(
      "Round3",
      expect.stringContaining("수치 예측 thesis 드롭"),
    );
  });

  it("여러 thesis에서 수치 예측인 sentiment만 드롭한다", () => {
    const text = wrapThesesInText([
      makeThesis({
        agentPersona: "sentiment",
        category: "sector_rotation",
        thesis: "VIX 22-28 레인지 전망",
        timeframeDays: 30,
      }),
      makeThesis({
        agentPersona: "sentiment",
        category: "structural_narrative",
        thesis: "자금이 defensive 섹터로 구조적 이동 중",
        timeframeDays: 60,
      }),
      makeThesis({
        agentPersona: "tech",
        category: "structural_narrative",
        thesis: "AI 인프라 투자 가속화",
        timeframeDays: 60,
      }),
    ]);

    const result = extractThesesFromText(text);

    expect(result.theses).toHaveLength(2);
    expect(result.theses.find((t) => t.thesis.includes("VIX 22-28"))).toBeUndefined();
    expect(result.theses.find((t) => t.thesis.includes("자금이 defensive"))).toBeDefined();
    expect(result.theses.find((t) => t.thesis.includes("AI 인프라"))).toBeDefined();
  });
});

// ─── short_term_outlook 카테고리 confidence 강제 하향 (#627) ──────────────────

describe("short_term_outlook 카테고리 confidence 강제 하향", () => {
  it("tech의 short_term_outlook high confidence를 low로 하향한다", () => {
    const text = wrapThesesInText([
      makeThesis({
        agentPersona: "tech",
        category: "short_term_outlook",
        confidence: "high",
        thesis: "반도체 단기 전망",
        timeframeDays: 30,
      }),
    ]);

    const result = extractThesesFromText(text);

    expect(result.theses).toHaveLength(1);
    expect(result.theses[0].category).toBe("short_term_outlook");
    expect(result.theses[0].confidence).toBe("low");
  });

  it("tech의 short_term_outlook medium confidence를 low로 하향한다", () => {
    const text = wrapThesesInText([
      makeThesis({
        agentPersona: "tech",
        category: "short_term_outlook",
        confidence: "medium",
        thesis: "NASDAQ 단기 전망",
        timeframeDays: 30,
      }),
    ]);

    const result = extractThesesFromText(text);

    expect(result.theses).toHaveLength(1);
    expect(result.theses[0].confidence).toBe("low");
  });

  it("tech의 short_term_outlook low confidence는 low를 유지한다", () => {
    const text = wrapThesesInText([
      makeThesis({
        agentPersona: "tech",
        category: "short_term_outlook",
        confidence: "low",
        thesis: "약한 단기 전망",
        timeframeDays: 30,
      }),
    ]);

    const result = extractThesesFromText(text);

    expect(result.theses).toHaveLength(1);
    expect(result.theses[0].confidence).toBe("low");
  });

  it("structural_narrative 카테고리 confidence는 하향하지 않는다", () => {
    const text = wrapThesesInText([
      makeThesis({
        agentPersona: "tech",
        category: "structural_narrative",
        confidence: "high",
        thesis: "AI 인프라 서사",
        timeframeDays: 60,
      }),
    ]);

    const result = extractThesesFromText(text);

    expect(result.theses).toHaveLength(1);
    expect(result.theses[0].confidence).toBe("high");
  });

  it("sector_rotation 카테고리 confidence는 하향하지 않는다", () => {
    const text = wrapThesesInText([
      makeThesis({
        agentPersona: "macro",
        category: "sector_rotation",
        confidence: "high",
        thesis: "섹터 로테이션 전망",
        timeframeDays: 30,
      }),
    ]);

    const result = extractThesesFromText(text);

    expect(result.theses).toHaveLength(1);
    expect(result.theses[0].confidence).toBe("high");
  });

  it("sentiment의 short_term_outlook은 카테고리 재분류 후 페르소나 하향으로 low가 된다", () => {
    // sentiment의 short_term_outlook → sector_rotation(카테고리 재분류)
    // → confidence는 CONFIDENCE_DOWNGRADE_PERSONAS(페르소나 하향)에 의해 low
    // CONFIDENCE_DOWNGRADE_CATEGORIES는 sector_rotation에 해당 없으므로 미적용
    const text = wrapThesesInText([
      makeThesis({
        agentPersona: "sentiment",
        category: "short_term_outlook",
        confidence: "high",
        thesis: "심리 단기 전망",
        timeframeDays: 30,
      }),
    ]);

    const result = extractThesesFromText(text);

    expect(result.theses).toHaveLength(1);
    expect(result.theses[0].category).toBe("sector_rotation"); // 카테고리 재분류
    expect(result.theses[0].confidence).toBe("low"); // 페르소나 하향
  });

  it("카테고리 confidence 하향 시 로그를 남긴다", () => {
    const text = wrapThesesInText([
      makeThesis({
        agentPersona: "tech",
        category: "short_term_outlook",
        confidence: "high",
        thesis: "단기 전망",
        timeframeDays: 30,
      }),
    ]);

    extractThesesFromText(text);

    expect(logger.info).toHaveBeenCalledWith(
      "Round3",
      expect.stringContaining("카테고리 thesis confidence 하향"),
    );
  });
});

// ─── short_term_outlook 세션당 발행 건수 제한 (#627) ──────────────────────────

describe("short_term_outlook 세션당 발행 건수 제한", () => {
  it("short_term_outlook 1건은 통과한다", () => {
    const text = wrapThesesInText([
      makeThesis({
        agentPersona: "tech",
        category: "short_term_outlook",
        thesis: "반도체 단기 전망",
        timeframeDays: 30,
      }),
    ]);

    const result = extractThesesFromText(text);

    expect(result.theses).toHaveLength(1);
    expect(result.theses[0].category).toBe("short_term_outlook");
  });

  it("short_term_outlook 2건 중 1건만 유지한다", () => {
    const text = wrapThesesInText([
      makeThesis({
        agentPersona: "tech",
        category: "short_term_outlook",
        thesis: "첫 번째 단기 전망",
        timeframeDays: 30,
      }),
      makeThesis({
        agentPersona: "tech",
        category: "short_term_outlook",
        thesis: "두 번째 단기 전망",
        timeframeDays: 30,
      }),
    ]);

    const result = extractThesesFromText(text);

    const shortTermTheses = result.theses.filter((t) => t.category === "short_term_outlook");
    expect(shortTermTheses).toHaveLength(1);
    expect(shortTermTheses[0].thesis).toContain("첫 번째");
  });

  it("short_term_outlook 초과 드롭 시 다른 카테고리는 영향 없다", () => {
    const text = wrapThesesInText([
      makeThesis({
        agentPersona: "tech",
        category: "short_term_outlook",
        thesis: "단기 전망 1",
        timeframeDays: 30,
      }),
      makeThesis({
        agentPersona: "tech",
        category: "structural_narrative",
        thesis: "AI 인프라 서사",
        timeframeDays: 60,
      }),
      makeThesis({
        agentPersona: "tech",
        category: "short_term_outlook",
        thesis: "단기 전망 2",
        timeframeDays: 30,
      }),
    ]);

    const result = extractThesesFromText(text);

    expect(result.theses).toHaveLength(2);
    expect(result.theses.find((t) => t.thesis.includes("단기 전망 1"))).toBeDefined();
    expect(result.theses.find((t) => t.thesis.includes("AI 인프라"))).toBeDefined();
    expect(result.theses.find((t) => t.thesis.includes("단기 전망 2"))).toBeUndefined();
  });

  it("초과 드롭 시 로그를 남긴다", () => {
    const text = wrapThesesInText([
      makeThesis({
        agentPersona: "tech",
        category: "short_term_outlook",
        thesis: "단기 전망 1",
        timeframeDays: 30,
      }),
      makeThesis({
        agentPersona: "tech",
        category: "short_term_outlook",
        thesis: "단기 전망 2",
        timeframeDays: 30,
      }),
    ]);

    extractThesesFromText(text);

    expect(logger.info).toHaveBeenCalledWith(
      "Round3",
      expect.stringContaining("short_term_outlook thesis 초과 드롭"),
    );
  });

  it("filterShortTermOutlookCap을 직접 호출해도 동작한다", () => {
    const theses = [
      { category: "short_term_outlook", thesis: "전망 1" },
      { category: "structural_narrative", thesis: "서사 1" },
      { category: "short_term_outlook", thesis: "전망 2" },
      { category: "short_term_outlook", thesis: "전망 3" },
    ] as any;

    const result = filterShortTermOutlookCap(theses);

    expect(result).toHaveLength(2);
    expect(result[0].thesis).toBe("전망 1");
    expect(result[1].thesis).toBe("서사 1");
  });
});

// ─── containsPriceTarget 패턴 검출 (#645) ──────────────────────────────────

describe("containsPriceTarget", () => {
  it("$N 목표가 패턴을 검출한다", () => {
    expect(containsPriceTarget("Broadcom $250 목표가")).toBe(true);
  });

  it("$N → $N 패턴을 검출한다", () => {
    expect(containsPriceTarget("SOXX $185.2 → $208 목표")).toBe(true);
  });

  it("ARKQ $52.8 → $62 패턴을 검출한다", () => {
    expect(containsPriceTarget("ARKQ $52.8 → $62 도달 전망")).toBe(true);
  });

  it("N% 상승 패턴을 검출한다", () => {
    expect(containsPriceTarget("바이오텍 90일 내 20% 상승")).toBe(true);
  });

  it("N-N% 상승 패턴을 검출한다", () => {
    expect(containsPriceTarget("방산 ETF 60일 내 15-20% 상승")).toBe(true);
  });

  it("N% 조정 패턴을 검출한다", () => {
    expect(containsPriceTarget("NVIDIA 20-30% 조정 후 박스권")).toBe(true);
  });

  it("목표 가격 언급을 검출한다", () => {
    expect(containsPriceTarget("반도체 ETF 목표 가격 상향")).toBe(true);
  });

  it("ETF + $ 가격 패턴을 검출한다", () => {
    expect(containsPriceTarget("ITA $150 돌파 전망")).toBe(true);
  });

  it("N일 내 N% 패턴을 검출한다", () => {
    expect(containsPriceTarget("30일 내 15% 상승 가능")).toBe(true);
  });

  it("신고점 돌파 목표를 검출한다", () => {
    expect(containsPriceTarget("IREN RS 99 신고점 돌파 목표")).toBe(true);
  });

  // 비검출 케이스
  it("구조적 전환 신호는 검출하지 않는다", () => {
    expect(containsPriceTarget("AI capex 사이클 하드웨어→소프트웨어 전환 가속")).toBe(false);
  });

  it("밸류체인 분석은 검출하지 않는다", () => {
    expect(containsPriceTarget("반도체 재고 사이클 저점 통과 신호")).toBe(false);
  });

  it("산업 구조 변화는 검출하지 않는다", () => {
    expect(containsPriceTarget("SaaS 멀티플 재평가 시작")).toBe(false);
  });

  it("RS 기반 조건은 검출하지 않는다", () => {
    expect(containsPriceTarget("Technology RS 상승 추세 유지")).toBe(false);
  });

  it("캐즘 분석은 검출하지 않는다", () => {
    expect(containsPriceTarget("AI 기술 채택이 캐즘을 넘어 Early Majority 진입")).toBe(false);
  });
});

// ─── tech 가격 목표 thesis 드롭 (#645) ──────────────────────────────────────

describe("tech 가격 목표 thesis 드롭", () => {
  it("tech의 short_term_outlook 가격 목표 thesis를 드롭한다", () => {
    const text = wrapThesesInText([
      makeThesis({
        agentPersona: "tech",
        category: "short_term_outlook",
        thesis: "SOXX $185 → $208 목표 전망",
        timeframeDays: 30,
      }),
    ]);

    const result = extractThesesFromText(text);

    expect(result.theses).toHaveLength(0);
  });

  it("tech의 short_term_outlook % 상승 thesis를 드롭한다", () => {
    const text = wrapThesesInText([
      makeThesis({
        agentPersona: "tech",
        category: "short_term_outlook",
        thesis: "방산 ETF ITA 60일 내 15-20% 상승 전망",
        timeframeDays: 30,
      }),
    ]);

    const result = extractThesesFromText(text);

    expect(result.theses).toHaveLength(0);
  });

  it("tech의 structural_narrative는 가격 패턴이 있어도 드롭하지 않는다", () => {
    const text = wrapThesesInText([
      makeThesis({
        agentPersona: "tech",
        category: "structural_narrative",
        thesis: "AI 인프라 capex $100B 이상 투자 지속으로 밸류체인 확장",
        timeframeDays: 60,
      }),
    ]);

    const result = extractThesesFromText(text);

    expect(result.theses).toHaveLength(1);
  });

  it("tech의 short_term_outlook 구조적 전환 thesis는 통과한다", () => {
    const text = wrapThesesInText([
      makeThesis({
        agentPersona: "tech",
        category: "short_term_outlook",
        thesis: "AI capex 사이클 하드웨어에서 소프트웨어로 전환 가속 신호",
        timeframeDays: 30,
      }),
    ]);

    const result = extractThesesFromText(text);

    expect(result.theses).toHaveLength(1);
  });

  it("macro의 가격 목표 thesis는 드롭하지 않는다", () => {
    const text = wrapThesesInText([
      makeThesis({
        agentPersona: "macro",
        category: "structural_narrative",
        thesis: "S&P 500 $6000 돌파 가능성",
        timeframeDays: 60,
      }),
    ]);

    const result = extractThesesFromText(text);

    expect(result.theses).toHaveLength(1);
  });

  it("가격 목표 드롭 시 로그를 남긴다", () => {
    const text = wrapThesesInText([
      makeThesis({
        agentPersona: "tech",
        category: "short_term_outlook",
        thesis: "Broadcom $250 목표가 도달 전망",
        timeframeDays: 30,
      }),
    ]);

    extractThesesFromText(text);

    expect(logger.info).toHaveBeenCalledWith(
      "Round3",
      expect.stringContaining("가격 목표 thesis 드롭"),
    );
  });

  it("여러 thesis에서 tech short_term_outlook 가격 목표만 드롭한다", () => {
    const text = wrapThesesInText([
      makeThesis({
        agentPersona: "tech",
        category: "short_term_outlook",
        thesis: "SOXX $185 → $208 목표 전망",
        timeframeDays: 30,
      }),
      makeThesis({
        agentPersona: "tech",
        category: "structural_narrative",
        thesis: "AI 인프라 투자 가속으로 반도체 수요 구조적 증가",
        timeframeDays: 60,
      }),
      makeThesis({
        agentPersona: "tech",
        category: "short_term_outlook",
        thesis: "반도체 재고 사이클 저점 통과 신호 감지",
        timeframeDays: 30,
      }),
    ]);

    const result = extractThesesFromText(text);

    expect(result.theses).toHaveLength(2);
    expect(result.theses.find((t) => t.thesis.includes("SOXX $185"))).toBeUndefined();
    expect(result.theses.find((t) => t.thesis.includes("AI 인프라"))).toBeDefined();
    expect(result.theses.find((t) => t.thesis.includes("반도체 재고"))).toBeDefined();
  });
});

// ─── extractDebateOutput 필터 파이프라인 검증 ─────────────────────────────────

describe("extractDebateOutput 필터 파이프라인", () => {
  it("tech short_term_outlook 가격 목표 thesis를 드롭한다", () => {
    const theses = [
      makeThesis({
        agentPersona: "tech",
        category: "short_term_outlook",
        thesis: "SOXX $185 → $208 목표 전망",
        timeframeDays: 30,
      }),
      makeThesis({
        agentPersona: "tech",
        category: "structural_narrative",
        thesis: "AI 인프라 투자 가속으로 반도체 수요 구조적 증가",
        timeframeDays: 60,
      }),
    ];
    const text = `리포트 내용\n\n\`\`\`json\n${JSON.stringify(theses)}\n\`\`\``;

    const result = extractDebateOutput(text);

    expect(result.theses).toHaveLength(1);
    expect(result.theses[0].thesis).toContain("AI 인프라");
  });

  it("sentiment 수치 예측 thesis를 드롭한다", () => {
    const theses = [
      makeThesis({
        agentPersona: "sentiment",
        category: "sector_rotation",
        thesis: "VIX 20 하회 안착 전망",
        timeframeDays: 30,
      }),
    ];
    const text = `리포트 내용\n\n\`\`\`json\n${JSON.stringify(theses)}\n\`\`\``;

    const result = extractDebateOutput(text);

    expect(result.theses).toHaveLength(0);
  });

  it("short_term_outlook 2건 중 1건만 유지한다", () => {
    const theses = [
      makeThesis({
        agentPersona: "tech",
        category: "short_term_outlook",
        thesis: "첫 번째 단기 전망",
        timeframeDays: 30,
      }),
      makeThesis({
        agentPersona: "tech",
        category: "short_term_outlook",
        thesis: "두 번째 단기 전망",
        timeframeDays: 30,
      }),
    ];
    const text = `리포트 내용\n\n\`\`\`json\n${JSON.stringify(theses)}\n\`\`\``;

    const result = extractDebateOutput(text);

    const shortTermTheses = result.theses.filter((t) => t.category === "short_term_outlook");
    expect(shortTermTheses).toHaveLength(1);
  });
});
