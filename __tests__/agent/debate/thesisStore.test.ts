import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Thesis } from "../../../src/types/debate.js";

// Mock drizzle DB
const mockInsert = vi.fn();
const mockValues = vi.fn();
const mockReturning = vi.fn();
const mockSelect = vi.fn();
const mockFrom = vi.fn();
const mockWhere = vi.fn();
const mockDelete = vi.fn();
const mockDeleteWhere = vi.fn();
const mockUpdate = vi.fn();
const mockSet = vi.fn();
const mockUpdateWhere = vi.fn();
const mockUpdateReturning = vi.fn();
const mockGroupBy = vi.fn();
const mockOrderBy = vi.fn();

// Mock narrativeChainService — error-isolated, no-op in thesis tests
vi.mock("@/debate/narrativeChainService.js", () => ({
  recordNarrativeChain: vi.fn().mockResolvedValue(undefined),
}));

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
    delete: (...args: unknown[]) => {
      mockDelete(...args);
      return {
        where: (...wArgs: unknown[]) => mockDeleteWhere(...wArgs),
      };
    },
    select: (...args: unknown[]) => {
      mockSelect(...args);
      return {
        from: (...fArgs: unknown[]) => {
          mockFrom(...fArgs);
          return {
            // loadActiveTheses: .select().from().where() → Promise<rows>
            // getConsensusByHitRate: .select().from().where().groupBy().orderBy() → Promise<rows>
            // mockWhere가 Promise를 반환하면 loadActiveTheses용,
            // 그렇지 않으면 groupBy 체인이 이어짐
            where: (...wArgs: unknown[]) => {
              const result = mockWhere(...wArgs);
              // result가 thenable이면 loadActiveTheses 용 (바로 반환)
              // 아니면 groupBy 체인을 반환
              if (result != null && typeof (result as Promise<unknown>).then === "function") {
                return result;
              }
              return {
                groupBy: (...gArgs: unknown[]) => {
                  mockGroupBy(...gArgs);
                  return {
                    orderBy: (...oArgs: unknown[]) => mockOrderBy(...oArgs),
                  };
                },
              };
            },
            groupBy: (...gArgs: unknown[]) => mockGroupBy(...gArgs),
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
            where: (...wArgs: unknown[]) => {
              mockUpdateWhere(...wArgs);
              return {
                returning: (...rArgs: unknown[]) => mockUpdateReturning(...rArgs),
              };
            },
          };
        },
      };
    },
  },
}));

import {
  saveTheses,
  loadActiveTheses,
  formatThesesForPrompt,
  expireStaleTheses,
  resolveThesis,
  getThesisStats,
  getThesisStatsByCategory,
  getConsensusByHitRate,
} from "@/debate/thesisStore.js";

describe("thesisStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("saveTheses", () => {
    it("saves theses to DB and returns count", async () => {
      const theses: Thesis[] = [
        {
          agentPersona: "macro",
          thesis: "Fed cuts 25bp in June",
          timeframeDays: 90,
          verificationMetric: "Fed funds rate",
          targetCondition: "Rate cut >= 25bp",
          invalidationCondition: "Rate hike",
          confidence: "medium",
          consensusLevel: "3/4",
        },
      ];

      mockReturning.mockResolvedValueOnce([{ id: 1 }]);

      const count = await saveTheses("2026-03-05", theses);

      expect(count).toBe(1);
      expect(mockInsert).toHaveBeenCalled();
      expect(mockValues).toHaveBeenCalledWith([
        expect.objectContaining({
          debateDate: "2026-03-05",
          agentPersona: "macro",
          thesis: "Fed cuts 25bp in June",
          status: "ACTIVE",
        }),
      ]);
    });

    it("returns 0 for empty theses array", async () => {
      const count = await saveTheses("2026-03-05", []);
      expect(count).toBe(0);
      expect(mockInsert).not.toHaveBeenCalled();
    });

    it("saves thesis with category field", async () => {
      const theses: Thesis[] = [
        {
          agentPersona: "macro",
          thesis: "구조적 금리 전환",
          timeframeDays: 90,
          verificationMetric: "Fed funds rate",
          targetCondition: "Rate cut >= 25bp",
          confidence: "high",
          consensusLevel: "4/4",
          category: "structural_narrative",
        },
      ];

      mockReturning.mockResolvedValueOnce([{ id: 1 }]);

      await saveTheses("2026-03-08", theses);

      expect(mockValues).toHaveBeenCalledWith([
        expect.objectContaining({
          category: "structural_narrative",
        }),
      ]);
    });

    it("defaults category to short_term_outlook when not provided", async () => {
      const theses: Thesis[] = [
        {
          agentPersona: "tech",
          thesis: "AI capex surge",
          timeframeDays: 30,
          verificationMetric: "Capex",
          targetCondition: "> 20%",
          confidence: "medium",
          consensusLevel: "3/4",
        },
      ];

      mockReturning.mockResolvedValueOnce([{ id: 1 }]);

      await saveTheses("2026-03-08", theses);

      expect(mockValues).toHaveBeenCalledWith([
        expect.objectContaining({
          category: "short_term_outlook",
        }),
      ]);
    });

    it("handles thesis without invalidation condition", async () => {
      const theses: Thesis[] = [
        {
          agentPersona: "tech",
          thesis: "AI capex growth > 20%",
          timeframeDays: 60,
          verificationMetric: "Capex YoY",
          targetCondition: "Growth > 20%",
          confidence: "high",
          consensusLevel: "4/4",
        },
      ];

      mockReturning.mockResolvedValueOnce([{ id: 2 }]);

      await saveTheses("2026-03-05", theses);

      expect(mockValues).toHaveBeenCalledWith([
        expect.objectContaining({
          invalidationCondition: null,
        }),
      ]);
    });
  });

  describe("loadActiveTheses", () => {
    it("queries DB for ACTIVE theses", async () => {
      mockWhere.mockResolvedValueOnce([
        { id: 1, thesis: "test", status: "ACTIVE" },
      ]);

      const result = await loadActiveTheses();

      expect(result).toHaveLength(1);
      expect(mockSelect).toHaveBeenCalled();
      expect(mockFrom).toHaveBeenCalled();
      expect(mockWhere).toHaveBeenCalled();
    });
  });

  describe("formatThesesForPrompt", () => {
    it("returns empty string for empty array", () => {
      expect(formatThesesForPrompt([])).toBe("");
    });

    it("formats thesis with correct persona label and confidence", () => {
      const rows = [
        {
          id: 1,
          debateDate: "2026-03-05",
          agentPersona: "macro",
          thesis: "금리 인하 가속화",
          timeframeDays: 30,
          verificationMetric: "10Y Yield",
          targetCondition: "< 4.0%",
          invalidationCondition: "> 4.5%",
          confidence: "high",
          consensusLevel: "3/4",
          status: "ACTIVE",
          verificationDate: null,
          verificationResult: null,
          closeReason: null,
          createdAt: new Date(),
        },
      ];

      const result = formatThesesForPrompt(rows as any);

      expect(result).toContain("[SHORT][HIGH/3/4]");
      expect(result).toContain("매크로 이코노미스트");
      expect(result).toContain("금리 인하 가속화");
      expect(result).toContain("30일");
      expect(result).toContain("< 4.0%");
    });

    it("formats all persona types correctly", () => {
      const personas = ["tech", "geopolitics", "sentiment"];
      const labels = ["테크 애널리스트", "지정학 전략가", "시장 심리 분석가"];

      const rows = personas.map((p, i) => ({
        id: i + 1,
        debateDate: "2026-03-05",
        agentPersona: p,
        thesis: `thesis ${i}`,
        timeframeDays: 30,
        verificationMetric: "metric",
        targetCondition: "condition",
        invalidationCondition: null,
        confidence: "medium",
        consensusLevel: "2/4",
        status: "ACTIVE",
        verificationDate: null,
        verificationResult: null,
        closeReason: null,
        createdAt: new Date(),
      }));

      const result = formatThesesForPrompt(rows as any);

      for (const label of labels) {
        expect(result).toContain(label);
      }
    });

    it("includes category label in output", () => {
      const makeRowWithCategory = (category: string | null) => ({
        id: 1,
        debateDate: "2026-03-08",
        agentPersona: "macro",
        thesis: "test thesis",
        timeframeDays: 30,
        verificationMetric: "m",
        targetCondition: "c",
        invalidationCondition: null,
        confidence: "high",
        consensusLevel: "4/4",
        category,
        status: "ACTIVE",
        verificationDate: null,
        verificationResult: null,
        closeReason: null,
        createdAt: new Date(),
      });

      expect(formatThesesForPrompt([makeRowWithCategory("structural_narrative")] as any)).toContain("[STRUCTURAL]");
      expect(formatThesesForPrompt([makeRowWithCategory("sector_rotation")] as any)).toContain("[ROTATION]");
      expect(formatThesesForPrompt([makeRowWithCategory("short_term_outlook")] as any)).toContain("[SHORT]");
      expect(formatThesesForPrompt([makeRowWithCategory(null)] as any)).toContain("[SHORT]");
    });

    it("maps confidence levels correctly", () => {
      const makeRow = (confidence: string) => ({
        id: 1,
        debateDate: "2026-03-05",
        agentPersona: "macro",
        thesis: "test",
        timeframeDays: 30,
        verificationMetric: "m",
        targetCondition: "c",
        invalidationCondition: null,
        confidence,
        consensusLevel: "4/4",
        status: "ACTIVE",
        verificationDate: null,
        verificationResult: null,
        closeReason: null,
        createdAt: new Date(),
      });

      expect(formatThesesForPrompt([makeRow("high")] as any)).toContain("[SHORT][HIGH/4/4]");
      expect(formatThesesForPrompt([makeRow("medium")] as any)).toContain("[SHORT][MED/4/4]");
      expect(formatThesesForPrompt([makeRow("low")] as any)).toContain("[SHORT][LOW/4/4]");
    });
  });

  describe("expireStaleTheses", () => {
    it("calls update with EXPIRED status and returns count", async () => {
      mockUpdateReturning.mockResolvedValueOnce([{ id: 1 }, { id: 2 }]);

      const count = await expireStaleTheses("2026-03-06");

      expect(count).toBe(2);
      expect(mockUpdate).toHaveBeenCalled();
      expect(mockSet).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "EXPIRED",
          closeReason: "timeframe_exceeded",
          verificationDate: "2026-03-06",
        }),
      );
    });

    it("returns 0 when no theses expired", async () => {
      mockUpdateReturning.mockResolvedValueOnce([]);

      const count = await expireStaleTheses("2026-03-06");

      expect(count).toBe(0);
    });
  });

  describe("resolveThesis", () => {
    it("updates thesis to CONFIRMED", async () => {
      mockUpdateWhere.mockResolvedValueOnce(undefined);

      await resolveThesis(42, {
        status: "CONFIRMED",
        verificationDate: "2026-03-06",
        verificationResult: "10Y Yield dropped to 3.8%",
        closeReason: "target_met",
      });

      expect(mockUpdate).toHaveBeenCalled();
      expect(mockSet).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "CONFIRMED",
          verificationResult: "10Y Yield dropped to 3.8%",
        }),
      );
    });
  });

  describe("getThesisStats", () => {
    it("returns status counts", async () => {
      mockGroupBy.mockResolvedValueOnce([
        { status: "ACTIVE", count: 5 },
        { status: "EXPIRED", count: 3 },
        { status: "CONFIRMED", count: 1 },
      ]);

      const stats = await getThesisStats();

      expect(stats).toEqual({ ACTIVE: 5, EXPIRED: 3, CONFIRMED: 1 });
    });

    it("returns empty object when no theses exist", async () => {
      mockGroupBy.mockResolvedValueOnce([]);

      const stats = await getThesisStats();

      expect(stats).toEqual({});
    });
  });

  describe("getThesisStatsByCategory", () => {
    it("returns category-status counts grouped correctly", async () => {
      mockGroupBy.mockResolvedValueOnce([
        { category: "structural_narrative", status: "ACTIVE", count: 3 },
        { category: "structural_narrative", status: "CONFIRMED", count: 1 },
        { category: "sector_rotation", status: "ACTIVE", count: 2 },
        { category: "short_term_outlook", status: "EXPIRED", count: 5 },
      ]);

      const stats = await getThesisStatsByCategory();

      expect(stats).toEqual({
        structural_narrative: { ACTIVE: 3, CONFIRMED: 1 },
        sector_rotation: { ACTIVE: 2 },
        short_term_outlook: { EXPIRED: 5 },
      });
    });

    it("defaults null category to short_term_outlook", async () => {
      mockGroupBy.mockResolvedValueOnce([
        { category: null, status: "ACTIVE", count: 4 },
      ]);

      const stats = await getThesisStatsByCategory();

      expect(stats).toEqual({
        short_term_outlook: { ACTIVE: 4 },
      });
    });

    it("returns empty object when no theses exist", async () => {
      mockGroupBy.mockResolvedValueOnce([]);

      const stats = await getThesisStatsByCategory();

      expect(stats).toEqual({});
    });
  });

  // N-1c/N-1d: parseConsensusScore (saveTheses를 통한 간접 검증)
  describe("parseConsensusScore (saveTheses consensusScore 컬럼 검증)", () => {
    it('"3/4" → consensusScore 3으로 저장된다', async () => {
      const theses: Thesis[] = [
        {
          agentPersona: "macro",
          thesis: "Fed cuts 25bp",
          timeframeDays: 90,
          verificationMetric: "Fed funds rate",
          targetCondition: "Rate cut >= 25bp",
          confidence: "medium",
          consensusLevel: "3/4",
          category: "short_term_outlook",
        },
      ];
      mockReturning.mockResolvedValueOnce([{ id: 1 }]);
      await saveTheses("2026-03-08", theses);
      expect(mockValues).toHaveBeenCalledWith([
        expect.objectContaining({ consensusScore: 3 }),
      ]);
    });

    it('"4/4" → consensusScore 4으로 저장된다', async () => {
      const theses: Thesis[] = [
        {
          agentPersona: "tech",
          thesis: "AI capex surge",
          timeframeDays: 60,
          verificationMetric: "Hyperscaler capex",
          targetCondition: "Capex growth > 20%",
          confidence: "high",
          consensusLevel: "4/4",
          category: "structural_narrative",
        },
      ];
      mockReturning.mockResolvedValueOnce([{ id: 2 }]);
      await saveTheses("2026-03-08", theses);
      expect(mockValues).toHaveBeenCalledWith([
        expect.objectContaining({ consensusScore: 4 }),
      ]);
    });

    it('"2/4" → consensusScore 2로 저장된다', async () => {
      const theses: Thesis[] = [
        {
          agentPersona: "geopolitics",
          thesis: "반도체 수출 규제 확대",
          timeframeDays: 30,
          verificationMetric: "Export control regulations",
          targetCondition: "New controls announced",
          confidence: "medium",
          consensusLevel: "2/4",
          category: "short_term_outlook",
        },
      ];
      mockReturning.mockResolvedValueOnce([{ id: 3 }]);
      await saveTheses("2026-03-08", theses);
      expect(mockValues).toHaveBeenCalledWith([
        expect.objectContaining({ consensusScore: 2 }),
      ]);
    });

    it('"1/4" → consensusScore 1로 저장된다', async () => {
      const theses: Thesis[] = [
        {
          agentPersona: "sentiment",
          thesis: "소매 투자자 리스크 온",
          timeframeDays: 30,
          verificationMetric: "AAII bull ratio",
          targetCondition: "Bull ratio > 50%",
          confidence: "low",
          consensusLevel: "1/4",
          category: "short_term_outlook",
        },
      ];
      mockReturning.mockResolvedValueOnce([{ id: 4 }]);
      await saveTheses("2026-03-08", theses);
      expect(mockValues).toHaveBeenCalledWith([
        expect.objectContaining({ consensusScore: 1 }),
      ]);
    });
  });

  // N-1d: saveTheses에서 nextBottleneck / dissentReason 저장 검증
  describe("saveTheses — nextBottleneck / dissentReason 저장", () => {
    it("nextBottleneck과 dissentReason이 있으면 그대로 저장한다", async () => {
      const theses: Thesis[] = [
        {
          agentPersona: "tech",
          thesis: "AI 인프라 수요 구조적 성장",
          timeframeDays: 60,
          verificationMetric: "Hyperscaler capex YoY",
          targetCondition: "Capex growth > 20%",
          confidence: "high",
          consensusLevel: "3/4",
          category: "structural_narrative",
          nextBottleneck: "광트랜시버 대역폭 제한",
          dissentReason: "지정학 분석가: 공급망 재편 속도 과대평가",
        },
      ];
      mockReturning.mockResolvedValueOnce([{ id: 5 }]);
      await saveTheses("2026-03-08", theses);
      expect(mockValues).toHaveBeenCalledWith([
        expect.objectContaining({
          nextBottleneck: "광트랜시버 대역폭 제한",
          dissentReason: "지정학 분석가: 공급망 재편 속도 과대평가",
        }),
      ]);
    });

    it("nextBottleneck이 없으면 null로 저장한다", async () => {
      const theses: Thesis[] = [
        {
          agentPersona: "macro",
          thesis: "금리 인하 가속화",
          timeframeDays: 90,
          verificationMetric: "Fed funds rate",
          targetCondition: "Rate < 4%",
          confidence: "medium",
          consensusLevel: "3/4",
          category: "sector_rotation",
          // nextBottleneck 없음
        },
      ];
      mockReturning.mockResolvedValueOnce([{ id: 6 }]);
      await saveTheses("2026-03-08", theses);
      expect(mockValues).toHaveBeenCalledWith([
        expect.objectContaining({ nextBottleneck: null }),
      ]);
    });

    it("dissentReason이 없으면 null로 저장한다 (만장일치)", async () => {
      const theses: Thesis[] = [
        {
          agentPersona: "macro",
          thesis: "달러 강세 전환",
          timeframeDays: 30,
          verificationMetric: "DXY",
          targetCondition: "DXY > 105",
          confidence: "high",
          consensusLevel: "4/4",
          category: "short_term_outlook",
          // dissentReason 없음
        },
      ];
      mockReturning.mockResolvedValueOnce([{ id: 7 }]);
      await saveTheses("2026-03-08", theses);
      expect(mockValues).toHaveBeenCalledWith([
        expect.objectContaining({ dissentReason: null }),
      ]);
    });
  });

  // N-1d: getConsensusByHitRate 테스트
  describe("getConsensusByHitRate", () => {
    it("consensusScore별 적중률 집계를 반환한다", async () => {
      mockOrderBy.mockResolvedValueOnce([
        { consensusScore: 1, confirmed: 1, invalidated: 2, expired: 1, total: 4 },
        { consensusScore: 3, confirmed: 5, invalidated: 1, expired: 2, total: 8 },
        { consensusScore: 4, confirmed: 3, invalidated: 0, expired: 1, total: 4 },
      ]);

      const rows = await getConsensusByHitRate();

      expect(rows).toHaveLength(3);
      expect(rows[0]).toEqual({
        consensusScore: 1,
        confirmed: 1,
        invalidated: 2,
        expired: 1,
        total: 4,
      });
      expect(rows[2].consensusScore).toBe(4);
      expect(rows[2].confirmed).toBe(3);
    });

    it("데이터가 없으면 빈 배열을 반환한다", async () => {
      mockOrderBy.mockResolvedValueOnce([]);

      const rows = await getConsensusByHitRate();

      expect(rows).toEqual([]);
    });

    it("select + from + where + groupBy + orderBy 체인을 호출한다", async () => {
      mockOrderBy.mockResolvedValueOnce([]);

      await getConsensusByHitRate();

      expect(mockSelect).toHaveBeenCalled();
      expect(mockFrom).toHaveBeenCalled();
      expect(mockWhere).toHaveBeenCalled();
      expect(mockGroupBy).toHaveBeenCalled();
      expect(mockOrderBy).toHaveBeenCalled();
    });
  });
});
