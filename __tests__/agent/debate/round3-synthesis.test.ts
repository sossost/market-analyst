import { describe, it, expect } from "vitest";
import { extractThesesFromText } from "../../../src/agent/debate/round3-synthesis.js";

// helper: nextBottleneck/dissentReason를 포함한 유효한 thesis JSON 생성
function makeThesisJson(overrides: Record<string, unknown> = {}): string {
  const base = {
    agentPersona: "macro",
    thesis: "AI 인프라 수요 구조적 성장",
    category: "structural_narrative",
    timeframeDays: 60,
    verificationMetric: "Hyperscaler capex YoY",
    targetCondition: "Capex growth > 20%",
    invalidationCondition: "Capex growth < 5%",
    confidence: "high",
    consensusLevel: "3/4",
    nextBottleneck: "광트랜시버 대역폭 제한",
    dissentReason: "지정학 분석가: 공급망 재편 속도 과대평가",
    ...overrides,
  };
  return `\`\`\`json\n[${JSON.stringify(base)}]\n\`\`\``;
}

describe("extractThesesFromText", () => {
  it("extracts valid thesis JSON from markdown code block", () => {
    const text = `## 종합 분석

합의 사항: ...

\`\`\`json
[
  {
    "agentPersona": "macro",
    "thesis": "Fed will cut rates by 25bp in June",
    "timeframeDays": 90,
    "verificationMetric": "Fed funds rate",
    "targetCondition": "Rate cut of 25bp or more",
    "invalidationCondition": "Rate hike",
    "confidence": "medium",
    "consensusLevel": "3/4"
  }
]
\`\`\``;

    const { theses } = extractThesesFromText(text);
    expect(theses).toHaveLength(1);
    expect(theses[0].agentPersona).toBe("macro");
    expect(theses[0].timeframeDays).toBe(90);
    expect(theses[0].confidence).toBe("medium");
  });

  it("extracts multiple theses", () => {
    const text = `결과...

\`\`\`json
[
  {
    "agentPersona": "tech",
    "thesis": "AI capex cycle peaks in Q3",
    "timeframeDays": 60,
    "verificationMetric": "Hyperscaler capex growth YoY",
    "targetCondition": "Capex growth < 10%",
    "confidence": "low",
    "consensusLevel": "2/4"
  },
  {
    "agentPersona": "geopolitics",
    "thesis": "Semiconductor export controls expand",
    "timeframeDays": 30,
    "verificationMetric": "New export control regulations",
    "targetCondition": "New controls announced",
    "confidence": "high",
    "consensusLevel": "4/4"
  }
]
\`\`\``;

    const { theses } = extractThesesFromText(text);
    expect(theses).toHaveLength(2);
    expect(theses[0].agentPersona).toBe("tech");
    expect(theses[1].agentPersona).toBe("geopolitics");
  });

  it("returns empty array when no JSON block found", () => {
    const text = "Just a regular report with no JSON.";
    const { theses } = extractThesesFromText(text);
    expect(theses).toEqual([]);
  });

  it("returns empty array on invalid JSON", () => {
    const text = `\`\`\`json
{ invalid json
\`\`\``;
    const { theses } = extractThesesFromText(text);
    expect(theses).toEqual([]);
  });

  it("returns empty array when JSON is not an array", () => {
    const text = `\`\`\`json
{ "not": "an array" }
\`\`\``;
    const { theses } = extractThesesFromText(text);
    expect(theses).toEqual([]);
  });

  it("handles empty JSON array", () => {
    const text = `No theses this week.

\`\`\`json
[]
\`\`\``;
    const { theses } = extractThesesFromText(text);
    expect(theses).toEqual([]);
  });

  it("removes JSON block from clean report", () => {
    const text = `## 핵심 요약

시장 분석 내용...

### 검증 가능한 전망 추출

\`\`\`json
[{"agentPersona": "macro", "thesis": "test"}]
\`\`\``;

    const { cleanReport } = extractThesesFromText(text);
    expect(cleanReport).toContain("핵심 요약");
    expect(cleanReport).toContain("시장 분석 내용");
    expect(cleanReport).not.toContain("```json");
    expect(cleanReport).not.toContain("agentPersona");
    // "검증 가능한 전망 추출" 헤더가 제거됨
    expect(cleanReport).not.toContain("검증 가능한 전망 추출");
  });

  it("filters out theses with invalid fields", () => {
    const text = `Report...

\`\`\`json
[
  {
    "agentPersona": "macro",
    "thesis": "Valid thesis",
    "timeframeDays": 30,
    "verificationMetric": "CPI",
    "targetCondition": "CPI < 3%",
    "confidence": "medium",
    "consensusLevel": "3/4"
  },
  {
    "agentPersona": "unknown_persona",
    "thesis": "Invalid persona",
    "timeframeDays": 30,
    "verificationMetric": "metric",
    "targetCondition": "condition",
    "confidence": "medium",
    "consensusLevel": "3/4"
  },
  {
    "agentPersona": "tech",
    "thesis": "Invalid timeframe",
    "timeframeDays": 999,
    "verificationMetric": "metric",
    "targetCondition": "condition",
    "confidence": "medium",
    "consensusLevel": "3/4"
  },
  {
    "agentPersona": "sentiment",
    "thesis": "",
    "timeframeDays": 60,
    "verificationMetric": "metric",
    "targetCondition": "condition",
    "confidence": "high",
    "consensusLevel": "2/4"
  }
]
\`\`\``;

    const { theses } = extractThesesFromText(text);
    expect(theses).toHaveLength(1);
    expect(theses[0].agentPersona).toBe("macro");
  });

  // N-1c: nextBottleneck / dissentReason 필드 파싱 테스트
  describe("nextBottleneck 필드", () => {
    it("nextBottleneck이 있는 JSON을 파싱한다", () => {
      const text = makeThesisJson({ nextBottleneck: "광트랜시버 대역폭 제한" });
      const { theses } = extractThesesFromText(text);
      expect(theses).toHaveLength(1);
      expect(theses[0].nextBottleneck).toBe("광트랜시버 대역폭 제한");
    });

    it("nextBottleneck이 null인 thesis도 valid로 통과한다", () => {
      const text = makeThesisJson({ nextBottleneck: null });
      const { theses } = extractThesesFromText(text);
      expect(theses).toHaveLength(1);
      expect(theses[0].nextBottleneck).toBeNull();
    });

    it("nextBottleneck이 없으면(undefined) null로 정규화된다", () => {
      // JSON에 키가 아예 없는 경우 → normalizeOptionalFields가 null로 설정
      const base = {
        agentPersona: "tech",
        thesis: "AI 반도체 수요 확대",
        category: "structural_narrative",
        timeframeDays: 60,
        verificationMetric: "NVDA revenue YoY",
        targetCondition: "Revenue growth > 30%",
        confidence: "high",
        consensusLevel: "4/4",
        // nextBottleneck 키 없음
      };
      const text = `\`\`\`json\n[${JSON.stringify(base)}]\n\`\`\``;
      const { theses } = extractThesesFromText(text);
      expect(theses).toHaveLength(1);
      expect(theses[0].nextBottleneck).toBeNull();
    });

    it("sector_rotation 카테고리에서 nextBottleneck이 null이어도 valid다", () => {
      const text = makeThesisJson({
        category: "sector_rotation",
        nextBottleneck: null,
      });
      const { theses } = extractThesesFromText(text);
      expect(theses).toHaveLength(1);
      expect(theses[0].category).toBe("sector_rotation");
      expect(theses[0].nextBottleneck).toBeNull();
    });
  });

  describe("dissentReason 필드", () => {
    it("dissentReason이 있는 JSON을 파싱한다", () => {
      const text = makeThesisJson({
        dissentReason: "지정학 분석가: 공급망 재편 속도 과대평가",
      });
      const { theses } = extractThesesFromText(text);
      expect(theses).toHaveLength(1);
      expect(theses[0].dissentReason).toBe("지정학 분석가: 공급망 재편 속도 과대평가");
    });

    it("dissentReason이 null인 thesis도 valid로 통과한다 (만장일치)", () => {
      const text = makeThesisJson({ dissentReason: null });
      const { theses } = extractThesesFromText(text);
      expect(theses).toHaveLength(1);
      expect(theses[0].dissentReason).toBeNull();
    });

    it("dissentReason이 없으면(undefined) null로 정규화된다", () => {
      const base = {
        agentPersona: "geopolitics",
        thesis: "반도체 수출 규제 확대",
        category: "short_term_outlook",
        timeframeDays: 30,
        verificationMetric: "Export control regulations",
        targetCondition: "New controls announced",
        confidence: "medium",
        consensusLevel: "2/4",
        // dissentReason 키 없음
      };
      const text = `\`\`\`json\n[${JSON.stringify(base)}]\n\`\`\``;
      const { theses } = extractThesesFromText(text);
      expect(theses).toHaveLength(1);
      expect(theses[0].dissentReason).toBeNull();
    });
  });

  describe("normalizeOptionalFields 동작 (extractThesesFromText를 통해 검증)", () => {
    it("nextBottleneck과 dissentReason이 모두 없어도 thesis가 valid로 통과한다", () => {
      const base = {
        agentPersona: "sentiment",
        thesis: "소매 투자자 리스크 온 전환",
        category: "short_term_outlook",
        timeframeDays: 30,
        verificationMetric: "AAII bull/bear ratio",
        targetCondition: "Bull ratio > 50%",
        confidence: "low",
        consensusLevel: "1/4",
      };
      const text = `\`\`\`json\n[${JSON.stringify(base)}]\n\`\`\``;
      const { theses } = extractThesesFromText(text);
      expect(theses).toHaveLength(1);
      expect(theses[0].nextBottleneck).toBeNull();
      expect(theses[0].dissentReason).toBeNull();
    });

    it("nextBottleneck과 dissentReason이 모두 있으면 그대로 보존된다", () => {
      const text = makeThesisJson({
        nextBottleneck: "HBM 공급 부족",
        dissentReason: "매크로: 수요 둔화 가능성",
      });
      const { theses } = extractThesesFromText(text);
      expect(theses).toHaveLength(1);
      expect(theses[0].nextBottleneck).toBe("HBM 공급 부족");
      expect(theses[0].dissentReason).toBe("매크로: 수요 둔화 가능성");
    });
  });

  it("preserves normal section titles containing '전망'", () => {
    const text = `### 4. 주도섹터/주도주 전망

부상하는 섹터 분석...

### 검증 가능한 전망 추출

\`\`\`json
[{"agentPersona": "macro", "thesis": "test"}]
\`\`\``;

    const { cleanReport } = extractThesesFromText(text);
    expect(cleanReport).toContain("주도섹터/주도주 전망");
    expect(cleanReport).not.toContain("검증 가능한 전망 추출");
  });
});
