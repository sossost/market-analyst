import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { extractThesesFromText, extractDebateOutput, containsNumericPrediction, containsMeanReversionPattern } from "../round3-synthesis.js";
import { logger } from "@/lib/logger";

// ─── Helper ────────────────────────────────────────────────────────────────

function wrapThesesInText(theses: unknown[]): string {
  return `리포트 내용\n\n\`\`\`json\n${JSON.stringify(theses)}\n\`\`\``;
}

function makeThesis(overrides: Record<string, unknown> = {}) {
  return {
    agentPersona: "macro",
    thesis: "테스트 전망",
    category: "sector_rotation",
    timeframeDays: 60,
    verificationMetric: "S&P 500",
    targetCondition: "S&P 500 > 5800",
    invalidationCondition: "S&P 500 < 5500",
    confidence: "medium",
    consensusLevel: "3/4",
    ...overrides,
  };
}

// ─── short_term_outlook → sector_rotation 재매핑 (#845) ─────────────────────

describe("short_term_outlook 카테고리 재매핑 (#845)", () => {
  it("모든 에이전트의 short_term_outlook을 sector_rotation으로 재매핑한다", () => {
    const agents = ["macro", "tech", "sentiment", "geopolitics"] as const;
    for (const agent of agents) {
      const text = wrapThesesInText([
        makeThesis({
          agentPersona: agent,
          category: "short_term_outlook",
          thesis: "테스트 전망",
          timeframeDays: 60,
        }),
      ]);

      const result = extractThesesFromText(text);

      expect(result.theses).toHaveLength(1);
      expect(result.theses[0].category).toBe("sector_rotation");
    }
  });

  it("structural_narrative와 sector_rotation은 변경하지 않는다", () => {
    const text = wrapThesesInText([
      makeThesis({
        agentPersona: "tech",
        category: "structural_narrative",
        thesis: "AI 인프라 서사",
        timeframeDays: 60,
      }),
      makeThesis({
        agentPersona: "macro",
        category: "sector_rotation",
        thesis: "섹터 로테이션 분석",
        timeframeDays: 45,
      }),
    ]);

    const result = extractThesesFromText(text);

    expect(result.theses).toHaveLength(2);
    expect(result.theses[0].category).toBe("structural_narrative");
    expect(result.theses[1].category).toBe("sector_rotation");
  });
});

// ─── 카테고리별 최소 timeframe 적용 (#845) ─────────────────────────────────

describe("카테고리별 최소 timeframe 적용 (#845)", () => {
  it("structural_narrative + 45일 → 60일로 상향한다", () => {
    const text = wrapThesesInText([
      makeThesis({
        agentPersona: "tech",
        category: "structural_narrative",
        thesis: "AI 인프라 서사",
        timeframeDays: 45,
      }),
    ]);

    const result = extractThesesFromText(text);

    expect(result.theses).toHaveLength(1);
    expect(result.theses[0].timeframeDays).toBe(60);
  });

  it("structural_narrative + 60일은 변경하지 않는다", () => {
    const text = wrapThesesInText([
      makeThesis({
        agentPersona: "tech",
        category: "structural_narrative",
        thesis: "AI 인프라 서사",
        timeframeDays: 60,
      }),
    ]);

    const result = extractThesesFromText(text);

    expect(result.theses).toHaveLength(1);
    expect(result.theses[0].timeframeDays).toBe(60);
  });

  it("sector_rotation + 45일은 변경하지 않는다", () => {
    const text = wrapThesesInText([
      makeThesis({
        agentPersona: "macro",
        category: "sector_rotation",
        thesis: "로테이션 전망",
        timeframeDays: 45,
      }),
    ]);

    const result = extractThesesFromText(text);

    expect(result.theses).toHaveLength(1);
    expect(result.theses[0].timeframeDays).toBe(45);
  });

  it("timeframe 상향 시 로그를 남긴다", () => {
    const text = wrapThesesInText([
      makeThesis({
        agentPersona: "tech",
        category: "structural_narrative",
        thesis: "테스트",
        timeframeDays: 45,
      }),
    ]);

    extractThesesFromText(text);

    expect(logger.info).toHaveBeenCalledWith(
      "Round3",
      expect.stringContaining("timeframe 상향"),
    );
  });
});

// ─── timeframeDays 유효성 — 30일은 무효 (#845) ──────────────────────────────

describe("timeframeDays 유효성", () => {
  it("timeframeDays 30은 무효 thesis로 필터링된다", () => {
    const text = wrapThesesInText([
      makeThesis({
        agentPersona: "tech",
        category: "sector_rotation",
        thesis: "단기 전망",
        timeframeDays: 30,
      }),
    ]);

    const result = extractThesesFromText(text);

    expect(result.theses).toHaveLength(0);
  });

  it("timeframeDays 45, 60, 90은 유효하다", () => {
    const validTimeframes = [45, 60, 90];
    for (const tf of validTimeframes) {
      const text = wrapThesesInText([
        makeThesis({
          agentPersona: "macro",
          category: "sector_rotation",
          thesis: "전망",
          timeframeDays: tf,
        }),
      ]);

      const result = extractThesesFromText(text);

      expect(result.theses).toHaveLength(1);
      expect(result.theses[0].timeframeDays).toBe(tf);
    }
  });
});

// ─── sentiment confidence 자동 하향 ─────────────────────────────────────────

describe("sentiment confidence 자동 하향", () => {
  it("sentiment의 structural_narrative는 confidence 원본을 유지한다 (#669)", () => {
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
    expect(result.theses[0].confidence).toBe("high");
  });

  it("sentiment의 sector_rotation high confidence를 low로 2단계 하향한다", () => {
    const text = wrapThesesInText([
      makeThesis({
        agentPersona: "sentiment",
        category: "sector_rotation",
        confidence: "high",
        thesis: "자금 Technology → Defensive 로테이션",
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
        timeframeDays: 45,
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
        timeframeDays: 45,
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
        category: "sector_rotation",
        confidence: "high",
        thesis: "금리 전망",
        timeframeDays: 45,
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

  it("여러 thesis에서 sentiment만 confidence 하향한다", () => {
    const text = wrapThesesInText([
      makeThesis({
        agentPersona: "macro",
        confidence: "high",
        thesis: "매크로 전망",
        timeframeDays: 60,
      }),
      makeThesis({
        agentPersona: "sentiment",
        category: "sector_rotation",
        confidence: "high",
        thesis: "심리 전망",
        timeframeDays: 45,
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

  it("현재값 인용은 검출하지 않는다", () => {
    expect(containsNumericPrediction("현재 VIX 31, 극단적 공포 구간")).toBe(false);
  });

  it("수치 없는 방향성 관찰은 검출하지 않는다", () => {
    expect(containsNumericPrediction("자금이 defensive 섹터로 이동 중")).toBe(false);
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
        timeframeDays: 45,
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
        timeframeDays: 60,
      }),
    ]);

    const result = extractThesesFromText(text);

    expect(result.theses).toHaveLength(1);
  });
});

// ─── extractDebateOutput 필터 파이프라인 검증 ─────────────────────────────────

describe("extractDebateOutput 필터 파이프라인", () => {
  it("sentiment 수치 예측 thesis를 드롭한다", () => {
    const theses = [
      makeThesis({
        agentPersona: "sentiment",
        category: "sector_rotation",
        thesis: "VIX 20 하회 안착 전망",
        timeframeDays: 45,
      }),
    ];
    const text = `리포트 내용\n\n\`\`\`json\n${JSON.stringify(theses)}\n\`\`\``;

    const result = extractDebateOutput(text);

    expect(result.theses).toHaveLength(0);
  });

  it("short_term_outlook 카테고리를 sector_rotation으로 재매핑한다", () => {
    const theses = [
      makeThesis({
        agentPersona: "tech",
        category: "short_term_outlook",
        thesis: "반도체 수요 구조적 증가",
        timeframeDays: 60,
      }),
    ];
    const text = `리포트 내용\n\n\`\`\`json\n${JSON.stringify(theses)}\n\`\`\``;

    const result = extractDebateOutput(text);

    expect(result.theses).toHaveLength(1);
    expect(result.theses[0].category).toBe("sector_rotation");
  });
});

// ─── containsMeanReversionPattern ─────────────────────────────────────────────

describe("containsMeanReversionPattern", () => {
  it("추세/국면 반전·전환 예측을 감지한다", () => {
    expect(containsMeanReversionPattern("추세 반전 가능성 존재")).toBe(true);
    expect(containsMeanReversionPattern("국면 전환 임박")).toBe(true);
  });

  it("정상화/안정화 예측을 감지한다", () => {
    expect(containsMeanReversionPattern("시장 정상화 전망")).toBe(true);
    expect(containsMeanReversionPattern("변동성 안정화 예상")).toBe(true);
  });

  it("심리 상태 전환 예측(→/->)을 감지한다", () => {
    expect(containsMeanReversionPattern("공포 → 중립 전환")).toBe(true);
    expect(containsMeanReversionPattern("risk-off → risk-on 전환")).toBe(true);
  });

  it("추세 순응형 분석은 감지하지 않는다", () => {
    expect(containsMeanReversionPattern("risk-off 지속 전망")).toBe(false);
    expect(containsMeanReversionPattern("자금 유출 가속")).toBe(false);
    expect(containsMeanReversionPattern("하락 추세 지속")).toBe(false);
  });

  it("구조적 관찰(현재 상태 서술)은 감지하지 않는다", () => {
    expect(containsMeanReversionPattern("현재 극단적 공포 구간")).toBe(false);
    expect(containsMeanReversionPattern("포지셔닝이 과밀하여 해소 압력 존재")).toBe(false);
  });
});

// ─── sentiment structural_narrative mean-reversion confidence 캡 (#731) ──────

describe("sentiment structural_narrative mean-reversion confidence 캡", () => {
  it("mean-reversion 패턴 + structural_narrative + high → medium으로 캡한다", () => {
    const text = wrapThesesInText([
      makeThesis({
        agentPersona: "sentiment",
        category: "structural_narrative",
        confidence: "high",
        thesis: "공포 → 중립 전환 임박, 포지셔닝 해소 압력",
        timeframeDays: 60,
      }),
    ]);

    const result = extractThesesFromText(text);

    expect(result.theses).toHaveLength(1);
    expect(result.theses[0].confidence).toBe("medium");
  });

  it("mean-reversion 패턴 없는 structural_narrative + high는 유지한다", () => {
    const text = wrapThesesInText([
      makeThesis({
        agentPersona: "sentiment",
        category: "structural_narrative",
        confidence: "high",
        thesis: "포지셔닝 과밀 심화, defensive 쏠림 가속",
        timeframeDays: 60,
      }),
    ]);

    const result = extractThesesFromText(text);

    expect(result.theses).toHaveLength(1);
    expect(result.theses[0].confidence).toBe("high");
  });

  it("mean-reversion + sector_rotation + high는 기존 2단계 하향(low) 적용", () => {
    const text = wrapThesesInText([
      makeThesis({
        agentPersona: "sentiment",
        category: "sector_rotation",
        confidence: "high",
        thesis: "추세 반전 예상, 자금 로테이션 전환",
        timeframeDays: 60,
      }),
    ]);

    const result = extractThesesFromText(text);

    expect(result.theses).toHaveLength(1);
    expect(result.theses[0].confidence).toBe("low");
  });

  it("다른 에이전트의 structural_narrative + high + mean-reversion은 변경하지 않는다", () => {
    const text = wrapThesesInText([
      makeThesis({
        agentPersona: "macro",
        category: "structural_narrative",
        confidence: "high",
        thesis: "경기 국면 전환 임박, 회복 전망",
        timeframeDays: 60,
      }),
    ]);

    const result = extractThesesFromText(text);

    expect(result.theses).toHaveLength(1);
    expect(result.theses[0].confidence).toBe("high");
  });
});
