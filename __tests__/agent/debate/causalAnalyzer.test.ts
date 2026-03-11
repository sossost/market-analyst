import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockCreate, mockFindSession } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockFindSession: vi.fn(),
}));

vi.mock("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = { create: mockCreate };
  },
}));

vi.mock("../../../src/agent/debate/sessionStore.js", () => ({
  findSessionByDate: mockFindSession,
}));

import {
  analyzeCauses,
  parseCausalAnalysis,
  type CausalAnalysisInput,
} from "../../../src/agent/debate/causalAnalyzer.js";

function makeResolvedThesis(overrides: Partial<CausalAnalysisInput["resolvedTheses"][0]> = {}) {
  return {
    id: 1,
    agentPersona: "macro",
    thesis: "Fed가 6월에 금리를 인하할 것이다",
    debateDate: "2026-02-15",
    verificationMetric: "Fed funds rate",
    targetCondition: "6월 FOMC에서 25bp 인하",
    invalidationCondition: "6월 FOMC 동결 또는 인상",
    status: "CONFIRMED" as const,
    verificationResult: "6월 FOMC에서 25bp 인하 결정",
    ...overrides,
  };
}

describe("causalAnalyzer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("parseCausalAnalysis", () => {
    it("parses valid JSON array response", () => {
      const raw = JSON.stringify([
        {
          thesisId: 1,
          causalChain: "CPI 둔화 → 실질금리 상승 부담 → Fed 비둘기 시그널 → 시장 기대 형성",
          keyFactors: ["CPI 3개월 연속 하락", "파월 의회 증언에서 '적절한 시기' 언급"],
          reusablePattern: "CPI 3개월 연속 둔화 + Fed 비둘기 발언 = 금리 인하 선행 신호",
          lessonsLearned: "물가 추세 반전은 3개월 이상 확인 후 판단해야 신뢰도 높음",
        },
      ]);

      const result = parseCausalAnalysis(raw, [1]);
      expect(result).toHaveLength(1);
      expect(result[0].thesisId).toBe(1);
      expect(result[0].causalChain).toContain("CPI 둔화");
      expect(result[0].keyFactors).toHaveLength(2);
      expect(result[0].reusablePattern).toContain("CPI 3개월");
      expect(result[0].lessonsLearned).toContain("물가 추세");
    });

    it("handles code fences in response", () => {
      const raw = "```json\n" + JSON.stringify([
        {
          thesisId: 2,
          causalChain: "원인 체인",
          keyFactors: ["팩터1"],
          reusablePattern: "패턴",
          lessonsLearned: "교훈",
        },
      ]) + "\n```";

      const result = parseCausalAnalysis(raw, [2]);
      expect(result).toHaveLength(1);
      expect(result[0].thesisId).toBe(2);
    });

    it("filters out invalid thesis IDs", () => {
      const raw = JSON.stringify([
        {
          thesisId: 999,
          causalChain: "체인",
          keyFactors: ["팩터"],
          reusablePattern: "패턴",
          lessonsLearned: "교훈",
        },
      ]);

      const result = parseCausalAnalysis(raw, [1, 2, 3]);
      expect(result).toHaveLength(0);
    });

    it("returns empty array for malformed JSON", () => {
      const result = parseCausalAnalysis("not json at all", [1]);
      expect(result).toHaveLength(0);
    });

    it("filters out items missing required fields", () => {
      const raw = JSON.stringify([
        { thesisId: 1, causalChain: "체인" }, // missing other fields
        {
          thesisId: 2,
          causalChain: "체인",
          keyFactors: ["팩터"],
          reusablePattern: "패턴",
          lessonsLearned: "교훈",
        },
      ]);

      const result = parseCausalAnalysis(raw, [1, 2]);
      expect(result).toHaveLength(1);
      expect(result[0].thesisId).toBe(2);
    });
  });

  describe("analyzeCauses", () => {
    it("returns empty array when no resolved theses", async () => {
      const result = await analyzeCauses({
        resolvedTheses: [],
        marketDataContext: "시장 데이터",
        debateDate: "2026-03-06",
      });

      expect(result).toHaveLength(0);
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it("loads debate session and calls LLM for analysis", async () => {
      mockFindSession.mockResolvedValue({
        round1Outputs: JSON.stringify([
          { persona: "macro", content: "CPI 둔화 추세가 명확..." },
        ]),
        synthesisReport: "종합: Fed 금리 인하 예상",
      });

      mockCreate.mockResolvedValue({
        content: [
          {
            type: "text",
            text: JSON.stringify([
              {
                thesisId: 1,
                causalChain: "CPI 둔화 → Fed 인하",
                keyFactors: ["CPI 하락"],
                reusablePattern: "CPI 둔화 시 Fed 인하 가능성 높음",
                lessonsLearned: "물가 추세 확인 필수",
              },
            ]),
          },
        ],
        usage: { input_tokens: 1000, output_tokens: 500 },
      });

      const result = await analyzeCauses({
        resolvedTheses: [makeResolvedThesis()],
        marketDataContext: "S&P 500: 5,850 (+0.5%)",
        debateDate: "2026-03-06",
      });

      expect(result).toHaveLength(1);
      expect(result[0].causalChain).toContain("CPI 둔화");
      expect(mockFindSession).toHaveBeenCalledWith("2026-02-15");
      expect(mockCreate).toHaveBeenCalledTimes(1);
    });

    it("handles missing debate session gracefully", async () => {
      mockFindSession.mockResolvedValue(null);

      mockCreate.mockResolvedValue({
        content: [
          {
            type: "text",
            text: JSON.stringify([
              {
                thesisId: 1,
                causalChain: "원인 불명 — 원본 세션 없음",
                keyFactors: ["데이터 부족"],
                reusablePattern: "N/A",
                lessonsLearned: "원본 세션이 없어 정확한 분석 불가",
              },
            ]),
          },
        ],
        usage: { input_tokens: 500, output_tokens: 200 },
      });

      const result = await analyzeCauses({
        resolvedTheses: [makeResolvedThesis()],
        marketDataContext: "시장 데이터",
        debateDate: "2026-03-06",
      });

      // Should still work, just without original session context
      expect(result).toHaveLength(1);
      expect(mockCreate).toHaveBeenCalledTimes(1);
    });

    it("groups theses by debateDate to minimize session lookups", async () => {
      mockFindSession.mockResolvedValue({
        round1Outputs: "[]",
        synthesisReport: "리포트",
      });

      mockCreate.mockResolvedValue({
        content: [
          {
            type: "text",
            text: JSON.stringify([
              {
                thesisId: 1,
                causalChain: "체인1",
                keyFactors: ["팩터"],
                reusablePattern: "패턴1",
                lessonsLearned: "교훈1",
              },
              {
                thesisId: 2,
                causalChain: "체인2",
                keyFactors: ["팩터"],
                reusablePattern: "패턴2",
                lessonsLearned: "교훈2",
              },
            ]),
          },
        ],
        usage: { input_tokens: 800, output_tokens: 400 },
      });

      const result = await analyzeCauses({
        resolvedTheses: [
          makeResolvedThesis({ id: 1, debateDate: "2026-02-15" }),
          makeResolvedThesis({ id: 2, debateDate: "2026-02-15", thesis: "다른 전망" }),
        ],
        marketDataContext: "시장 데이터",
        debateDate: "2026-03-06",
      });

      // Same debateDate → 1 session lookup, 1 LLM call
      expect(mockFindSession).toHaveBeenCalledTimes(1);
      expect(mockCreate).toHaveBeenCalledTimes(1);
      expect(result).toHaveLength(2);
    });
  });
});
