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

      expect(result).toContain("[HIGH/3/4]");
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

      expect(formatThesesForPrompt([makeRow("high")] as any)).toContain("[HIGH/4/4]");
      expect(formatThesesForPrompt([makeRow("medium")] as any)).toContain("[MED/4/4]");
      expect(formatThesesForPrompt([makeRow("low")] as any)).toContain("[LOW/4/4]");
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
});
