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
            where: (...wArgs: unknown[]) => mockWhere(...wArgs),
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
} from "../../../src/agent/debate/thesisStore.js";

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
});
