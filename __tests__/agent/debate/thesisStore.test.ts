import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Thesis } from "../../../src/types/debate.js";

// Mock drizzle DB
const mockInsert = vi.fn();
const mockValues = vi.fn();
const mockReturning = vi.fn();
const mockSelect = vi.fn();
const mockFrom = vi.fn();
const mockWhere = vi.fn();

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
            where: (...wArgs: unknown[]) => mockWhere(...wArgs),
          };
        },
      };
    },
  },
}));

import { saveTheses, loadActiveTheses } from "../../../src/agent/debate/thesisStore.js";

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
});
