import { describe, it, expect } from "vitest";
import { extractThesesFromText } from "../../../src/agent/debate/round3-synthesis.js";

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
  });
});
