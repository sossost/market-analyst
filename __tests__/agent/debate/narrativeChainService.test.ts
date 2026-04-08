import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Thesis } from "../../../src/types/debate.js";

// DB mock
const mockInsert = vi.fn();
const mockValues = vi.fn();
const mockReturning = vi.fn();
const mockSelect = vi.fn();
const mockFrom = vi.fn();
const mockWhere = vi.fn();
const mockLimit = vi.fn();
const mockUpdate = vi.fn();
const mockSet = vi.fn();
const mockUpdateWhere = vi.fn();

vi.mock("../../../src/db/client.js", () => ({
  db: {
    insert: (...args: unknown[]) => {
      mockInsert(...args);
      return {
        values: (...vArgs: unknown[]) => {
          mockValues(...vArgs);
          return {
            returning: (...rArgs: unknown[]) => mockReturning(...rArgs),
          };
        },
      };
    },
    select: (...args: unknown[]) => {
      mockSelect(...args);
      return {
        from: (...fArgs: unknown[]) => {
          mockFrom(...fArgs);
          return {
            where: (...wArgs: unknown[]) => {
              const result = mockWhere(...wArgs);
              if (result != null && typeof result.then === "function") {
                // Make thenable result chainable with orderBy
                const chainable = {
                  orderBy: () => chainable,
                  then: (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
                    result.then(resolve, reject),
                };
                return chainable;
              }
              return {
                limit: (...lArgs: unknown[]) => mockLimit(...lArgs),
              };
            },
          };
        },
      };
    },
    update: (...args: unknown[]) => {
      mockUpdate(...args);
      return {
        set: (...sArgs: unknown[]) => {
          mockSet(...sArgs);
          return {
            where: (...wArgs: unknown[]) => mockUpdateWhere(...wArgs),
          };
        },
      };
    },
  },
}));

import {
  jaccardSimilarity,
  parseBottleneckFromThesis,
  buildChainFields,
  findMatchingChain,
  recordNarrativeChain,
} from "@/debate/narrativeChainService.js";

describe("narrativeChainService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("jaccardSimilarity", () => {
    it("returns 1 for identical strings", () => {
      expect(jaccardSimilarity("hello world", "hello world")).toBe(1);
    });

    it("returns 0 for completely different strings", () => {
      expect(jaccardSimilarity("foo bar", "baz qux")).toBe(0);
    });

    it("calculates correct similarity for partial overlap", () => {
      // "광트랜시버 공급 부족" vs "광트랜시버 병목"
      // words A: {광트랜시버, 공급, 부족} = 3
      // words B: {광트랜시버, 병목} = 2
      // intersection: {광트랜시버} = 1
      // union: 3 + 2 - 1 = 4
      // jaccard: 1/4 = 0.25
      const sim = jaccardSimilarity("광트랜시버 공급 부족", "광트랜시버 병목");
      expect(sim).toBe(0.25);
    });

    it("returns above threshold for very similar bottleneck texts", () => {
      // "광트랜시버 공급 부족 심화" vs "광트랜시버 공급 부족 지속"
      // words A: {광트랜시버, 공급, 부족, 심화} = 4
      // words B: {광트랜시버, 공급, 부족, 지속} = 4
      // intersection: {광트랜시버, 공급, 부족} = 3
      // union: 4 + 4 - 3 = 5
      // jaccard: 3/5 = 0.6
      const sim = jaccardSimilarity(
        "광트랜시버 공급 부족 심화",
        "광트랜시버 공급 부족 지속",
      );
      expect(sim).toBeCloseTo(0.6);
    });

    it("is case-insensitive", () => {
      expect(jaccardSimilarity("Hello World", "hello world")).toBe(1);
    });

    it("returns 1 for two empty strings", () => {
      expect(jaccardSimilarity("", "")).toBe(1);
    });

    it("returns 0 when one string is empty", () => {
      expect(jaccardSimilarity("hello", "")).toBe(0);
    });
  });

  describe("parseBottleneckFromThesis", () => {
    it("returns null for empty thesis text", () => {
      const thesis: Thesis = {
        agentPersona: "tech",
        thesis: "",
        timeframeDays: 60,
        verificationMetric: "m",
        targetCondition: "c",
        confidence: "high",
        consensusLevel: "3/4",
        category: "structural_narrative",
      };
      expect(parseBottleneckFromThesis(thesis)).toBeNull();
    });

    it("detects RESOLVING status from thesis text", () => {
      const thesis: Thesis = {
        agentPersona: "tech",
        thesis: "GPU 공급 부족이 RESOLVING 단계에 진입",
        timeframeDays: 60,
        verificationMetric: "m",
        targetCondition: "c",
        confidence: "high",
        consensusLevel: "3/4",
        category: "structural_narrative",
      };
      const info = parseBottleneckFromThesis(thesis);
      expect(info?.status).toBe("RESOLVING");
    });

    it("detects RESOLVED status from thesis text", () => {
      const thesis: Thesis = {
        agentPersona: "tech",
        thesis: "HBM 공급 제약이 RESOLVED - 용량 확장 완료",
        timeframeDays: 60,
        verificationMetric: "m",
        targetCondition: "c",
        confidence: "high",
        consensusLevel: "3/4",
        category: "structural_narrative",
      };
      const info = parseBottleneckFromThesis(thesis);
      expect(info?.status).toBe("RESOLVED");
    });

    it("detects OVERSUPPLY status from thesis text", () => {
      const thesis: Thesis = {
        agentPersona: "tech",
        thesis: "DRAM 시장 OVERSUPPLY 국면 진입",
        timeframeDays: 60,
        verificationMetric: "m",
        targetCondition: "c",
        confidence: "high",
        consensusLevel: "3/4",
        category: "structural_narrative",
      };
      const info = parseBottleneckFromThesis(thesis);
      expect(info?.status).toBe("OVERSUPPLY");
    });

    it("detects Korean status keywords", () => {
      const thesis: Thesis = {
        agentPersona: "tech",
        thesis: "전력 인프라 공급 과잉 우려",
        timeframeDays: 60,
        verificationMetric: "m",
        targetCondition: "c",
        confidence: "high",
        consensusLevel: "3/4",
        category: "structural_narrative",
      };
      const info = parseBottleneckFromThesis(thesis);
      expect(info?.status).toBe("OVERSUPPLY");
    });

    it("defaults to ACTIVE when no status keyword found", () => {
      const thesis: Thesis = {
        agentPersona: "tech",
        thesis: "AI 인프라 투자 확대 추세",
        timeframeDays: 60,
        verificationMetric: "m",
        targetCondition: "c",
        confidence: "high",
        consensusLevel: "3/4",
        category: "structural_narrative",
      };
      const info = parseBottleneckFromThesis(thesis);
      expect(info?.status).toBe("ACTIVE");
    });

    it("preserves nextBottleneck from thesis field", () => {
      const thesis: Thesis = {
        agentPersona: "tech",
        thesis: "GPU 공급 부족 지속",
        timeframeDays: 60,
        verificationMetric: "m",
        targetCondition: "c",
        confidence: "high",
        consensusLevel: "3/4",
        category: "structural_narrative",
        nextBottleneck: "전력 인프라 부족",
      };
      const info = parseBottleneckFromThesis(thesis);
      expect(info?.nextBottleneck).toBe("전력 인프라 부족");
    });

    it("extracts beneficiarySectors and beneficiaryTickers from thesis", () => {
      const thesis: Thesis = {
        agentPersona: "tech",
        thesis: "GPU 공급 부족 지속",
        timeframeDays: 60,
        verificationMetric: "m",
        targetCondition: "c",
        confidence: "high",
        consensusLevel: "3/4",
        category: "structural_narrative",
        nextBottleneck: "전력 인프라 부족",
        beneficiarySectors: ["Power Infrastructure", "Utilities"],
        beneficiaryTickers: ["VRT", "ETN"],
      };
      const info = parseBottleneckFromThesis(thesis);
      expect(info?.beneficiarySectors).toEqual(["Power Infrastructure", "Utilities"]);
      expect(info?.beneficiaryTickers).toEqual(["VRT", "ETN"]);
    });

    it("returns empty arrays when beneficiary fields are null or missing", () => {
      const thesis: Thesis = {
        agentPersona: "tech",
        thesis: "GPU 공급 부족 지속",
        timeframeDays: 60,
        verificationMetric: "m",
        targetCondition: "c",
        confidence: "high",
        consensusLevel: "3/4",
        category: "structural_narrative",
      };
      const info = parseBottleneckFromThesis(thesis);
      expect(info?.beneficiarySectors).toEqual([]);
      expect(info?.beneficiaryTickers).toEqual([]);
    });
  });

  describe("buildChainFields", () => {
    it("uses narrativeChain fields directly when present", () => {
      const thesis: Thesis = {
        agentPersona: "tech",
        thesis: "AI 인프라 투자 확대",
        timeframeDays: 60,
        verificationMetric: "Technology RS",
        targetCondition: "Technology RS > 60",
        confidence: "high",
        consensusLevel: "3/4",
        category: "structural_narrative",
        narrativeChain: {
          megatrend: "AI 인프라 확장",
          demandDriver: "AI 모델 파라미터 증가 → 전력 수요 급증",
          supplyChain: "전력 변압기 → 냉각 시스템 → 광트랜시버",
          bottleneck: "광트랜시버 대역폭 제한",
        },
        beneficiarySectors: ["Communication Equipment"],
        beneficiaryTickers: ["CIEN", "LITE"],
      };
      const info = buildChainFields(thesis);
      expect(info?.megatrend).toBe("AI 인프라 확장");
      expect(info?.demandDriver).toBe("AI 모델 파라미터 증가 → 전력 수요 급증");
      expect(info?.supplyChain).toBe("전력 변압기 → 냉각 시스템 → 광트랜시버");
      expect(info?.bottleneck).toBe("광트랜시버 대역폭 제한");
      expect(info?.beneficiarySectors).toEqual(["Communication Equipment"]);
      expect(info?.beneficiaryTickers).toEqual(["CIEN", "LITE"]);
    });

    it("falls back to first sentence when narrativeChain is null", () => {
      const thesis: Thesis = {
        agentPersona: "tech",
        thesis: "GPU 공급 부족 지속. 세부 내용.",
        timeframeDays: 60,
        verificationMetric: "Technology RS",
        targetCondition: "Technology RS > 60",
        confidence: "high",
        consensusLevel: "3/4",
        category: "structural_narrative",
        narrativeChain: null,
      };
      const info = buildChainFields(thesis);
      expect(info?.megatrend).toBe("GPU 공급 부족 지속");
      expect(info?.bottleneck).toBe("GPU 공급 부족 지속");
      expect(info?.demandDriver).toBe("");
      expect(info?.supplyChain).toBe("");
    });

    it("detects RESOLVING status even with narrativeChain present", () => {
      const thesis: Thesis = {
        agentPersona: "tech",
        thesis: "GPU 병목이 RESOLVING 단계에 진입",
        timeframeDays: 60,
        verificationMetric: "Technology RS",
        targetCondition: "Technology RS > 60",
        confidence: "high",
        consensusLevel: "3/4",
        category: "structural_narrative",
        narrativeChain: {
          megatrend: "AI 인프라",
          demandDriver: "수요",
          supplyChain: "공급망",
          bottleneck: "GPU 병목",
        },
      };
      const info = buildChainFields(thesis);
      expect(info?.status).toBe("RESOLVING");
    });
  });

  describe("findMatchingChain", () => {
    const makeInfo = (megatrend: string, bottleneck: string) => ({
      megatrend,
      demandDriver: "",
      supplyChain: "",
      bottleneck,
      nextBottleneck: null,
      status: "ACTIVE" as const,
      beneficiarySectors: [],
      beneficiaryTickers: [],
    });

    it("returns null when no candidates exist", async () => {
      mockWhere.mockResolvedValueOnce([]);
      const result = await findMatchingChain(makeInfo("AI 인프라", "GPU 공급 부족"));
      expect(result).toBeNull();
    });

    it("returns matching chain when keyword overlap >= 2", async () => {
      const identifiedAt = new Date("2026-01-01");
      mockWhere.mockResolvedValueOnce([
        {
          id: 1,
          megatrend: "AI 인프라",
          bottleneck: "GPU supply shortage",
          linkedThesisIds: [10, 20],
          bottleneckIdentifiedAt: identifiedAt,
        },
      ]);

      // "AI 인프라 GPU supply shortage" — overlap: "ai", "인프라", "gpu", "supply", "shortage" >= 2
      const result = await findMatchingChain(makeInfo("AI 인프라", "GPU supply shortage"));
      expect(result).toEqual({ id: 1, linkedThesisIds: [10, 20], bottleneckIdentifiedAt: identifiedAt });
    });

    it("returns null when keyword overlap < 2", async () => {
      mockWhere.mockResolvedValueOnce([
        {
          id: 1,
          megatrend: "에너지 전환",
          bottleneck: "completely different bottleneck text here",
          linkedThesisIds: [10],
          bottleneckIdentifiedAt: new Date("2026-01-01"),
        },
      ]);

      const result = await findMatchingChain(makeInfo("AI 인프라", "GPU 공급 부족"));
      expect(result).toBeNull();
    });

    it("handles null linkedThesisIds gracefully", async () => {
      const identifiedAt = new Date("2026-01-01");
      mockWhere.mockResolvedValueOnce([
        {
          id: 1,
          megatrend: "AI 인프라 확장",
          bottleneck: "GPU 공급 부족 심화",
          linkedThesisIds: null,
          bottleneckIdentifiedAt: identifiedAt,
        },
      ]);

      // "AI 인프라 확장 GPU 공급 부족 심화" — many keyword overlaps
      const result = await findMatchingChain(makeInfo("AI 인프라", "GPU 공급 부족"));
      expect(result).toEqual({ id: 1, linkedThesisIds: [], bottleneckIdentifiedAt: identifiedAt });
    });
  });

  describe("recordNarrativeChain", () => {
    it("skips non-structural_narrative theses", async () => {
      const thesis: Thesis = {
        agentPersona: "macro",
        thesis: "금리 인하 가속",
        timeframeDays: 90,
        verificationMetric: "m",
        targetCondition: "c",
        confidence: "medium",
        consensusLevel: "3/4",
        category: "sector_rotation",
      };

      await recordNarrativeChain(thesis, 1);

      expect(mockSelect).not.toHaveBeenCalled();
      expect(mockInsert).not.toHaveBeenCalled();
    });

    it("creates new chain when no matching chain exists", async () => {
      const thesis: Thesis = {
        agentPersona: "tech",
        thesis: "AI 인프라 GPU 공급 부족 지속",
        timeframeDays: 60,
        verificationMetric: "m",
        targetCondition: "c",
        confidence: "high",
        consensusLevel: "3/4",
        category: "structural_narrative",
        nextBottleneck: "전력 인프라",
        narrativeChain: {
          megatrend: "AI 인프라",
          demandDriver: "AI 모델 성장 → 데이터센터 수요 증가",
          supplyChain: "GPU 제조 → 패키징 → 데이터센터",
          bottleneck: "GPU 공급 부족",
        },
      };

      // findMatchingChain returns no candidates
      mockWhere.mockResolvedValueOnce([]);
      // findBeneficiaryFromSameNarrative: thesis has empty beneficiary, no matching chain with data
      mockWhere.mockResolvedValueOnce([]);
      // insert returns id
      mockReturning.mockResolvedValueOnce([{ id: 1 }]);

      await recordNarrativeChain(thesis, 100);

      expect(mockInsert).toHaveBeenCalled();
      expect(mockValues).toHaveBeenCalledWith(
        expect.objectContaining({
          megatrend: "AI 인프라",
          bottleneck: "GPU 공급 부족",
          nextBottleneck: "전력 인프라",
          linkedThesisIds: [100],
        }),
      );
    });

    it("inherits beneficiary from existing chain when new chain has empty beneficiary", async () => {
      const thesis: Thesis = {
        agentPersona: "tech",
        thesis: "AI 인프라 광트랜시버 공급 부족 심화",
        timeframeDays: 60,
        verificationMetric: "m",
        targetCondition: "c",
        confidence: "high",
        consensusLevel: "3/4",
        category: "structural_narrative",
        narrativeChain: {
          megatrend: "AI 인프라",
          demandDriver: "데이터센터 수요 증가",
          supplyChain: "광트랜시버 공급망",
          bottleneck: "광트랜시버 공급 부족",
        },
        // beneficiarySectors/Tickers omitted → empty arrays from buildChainFields
      };

      // findMatchingChain: no existing chain matches (new bottleneck)
      mockWhere.mockResolvedValueOnce([]);
      // findBeneficiaryFromSameNarrative: existing ACTIVE chain with same megatrend has beneficiary data
      mockWhere.mockResolvedValueOnce([
        {
          megatrend: "AI 인프라 확장",
          beneficiarySectors: ["Communication Equipment"],
          beneficiaryTickers: ["CIEN", "LITE"],
        },
      ]);
      // insert returns id
      mockReturning.mockResolvedValueOnce([{ id: 2 }]);

      await recordNarrativeChain(thesis, 101);

      expect(mockInsert).toHaveBeenCalled();
      expect(mockValues).toHaveBeenCalledWith(
        expect.objectContaining({
          beneficiarySectors: ["Communication Equipment"],
          beneficiaryTickers: ["CIEN", "LITE"],
        }),
      );
    });

    it("keeps empty beneficiary when no existing chain has data", async () => {
      const thesis: Thesis = {
        agentPersona: "tech",
        thesis: "완전히 새로운 서사 병목 발생",
        timeframeDays: 60,
        verificationMetric: "m",
        targetCondition: "c",
        confidence: "high",
        consensusLevel: "3/4",
        category: "structural_narrative",
        narrativeChain: {
          megatrend: "완전히 새로운 서사",
          demandDriver: "새로운 수요",
          supplyChain: "새로운 공급망",
          bottleneck: "새로운 병목",
        },
      };

      // findMatchingChain: no match
      mockWhere.mockResolvedValueOnce([]);
      // findBeneficiaryFromSameNarrative: all existing chains also have empty beneficiary
      mockWhere.mockResolvedValueOnce([
        {
          megatrend: "완전히 새로운 서사",
          beneficiarySectors: null,
          beneficiaryTickers: null,
        },
      ]);
      // insert returns id
      mockReturning.mockResolvedValueOnce([{ id: 3 }]);

      await recordNarrativeChain(thesis, 102);

      expect(mockInsert).toHaveBeenCalled();
      expect(mockValues).toHaveBeenCalledWith(
        expect.objectContaining({
          beneficiarySectors: [],
          beneficiaryTickers: [],
        }),
      );
    });

    it("updates existing chain and appends thesis ID", async () => {
      const thesis: Thesis = {
        agentPersona: "tech",
        thesis: "AI 인프라 GPU supply shortage 지속",
        timeframeDays: 60,
        verificationMetric: "m",
        targetCondition: "c",
        confidence: "high",
        consensusLevel: "3/4",
        category: "structural_narrative",
      };

      // findMatchingChain returns existing chain
      mockWhere.mockResolvedValueOnce([
        {
          id: 5,
          megatrend: "AI 인프라",
          bottleneck: "AI 인프라 GPU supply shortage 지속",
          linkedThesisIds: [10],
          bottleneckIdentifiedAt: new Date("2026-01-01"),
        },
      ]);
      mockUpdateWhere.mockResolvedValueOnce(undefined);

      await recordNarrativeChain(thesis, 20);

      expect(mockUpdate).toHaveBeenCalled();
      expect(mockSet).toHaveBeenCalledWith(
        expect.objectContaining({
          linkedThesisIds: [10, 20],
        }),
      );
    });

    it("does not throw on error — error isolation", async () => {
      const thesis: Thesis = {
        agentPersona: "tech",
        thesis: "megatrend: test. bottleneck: test bottleneck",
        timeframeDays: 60,
        verificationMetric: "m",
        targetCondition: "c",
        confidence: "high",
        consensusLevel: "3/4",
        category: "structural_narrative",
      };

      // Force an error
      mockWhere.mockRejectedValueOnce(new Error("DB connection failed"));

      // Should not throw
      await expect(recordNarrativeChain(thesis, 1)).resolves.toBeUndefined();
    });

    it("records resolution date and days for RESOLVED status", async () => {
      const thesis: Thesis = {
        agentPersona: "tech",
        thesis: "GPU 공급 부족이 RESOLVED 완료",
        timeframeDays: 60,
        verificationMetric: "m",
        targetCondition: "c",
        confidence: "high",
        consensusLevel: "3/4",
        category: "structural_narrative",
      };

      // findMatchingChain returns existing chain with bottleneckIdentifiedAt
      const identifiedAt = new Date("2026-01-01");
      mockWhere.mockResolvedValueOnce([
        {
          id: 5,
          megatrend: "AI 인프라",
          bottleneck: "GPU 공급 부족이 RESOLVED 완료",
          linkedThesisIds: [10],
          bottleneckIdentifiedAt: identifiedAt,
        },
      ]);

      mockUpdateWhere.mockResolvedValueOnce(undefined);

      await recordNarrativeChain(thesis, 30);

      expect(mockSet).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "RESOLVED",
          linkedThesisIds: [10, 30],
        }),
      );
      // Check that bottleneckResolvedAt and resolutionDays are set
      const setCall = mockSet.mock.calls[0][0];
      expect(setCall.bottleneckResolvedAt).toBeInstanceOf(Date);
      expect(setCall.resolutionDays).toBeGreaterThan(0);
    });
  });
});
