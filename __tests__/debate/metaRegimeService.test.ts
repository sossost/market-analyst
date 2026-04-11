import { describe, it, expect, vi, beforeEach } from "vitest";

// DB mock
const mockInsert = vi.fn();
const mockValues = vi.fn();
const mockReturning = vi.fn();
const mockSelect = vi.fn();
const mockFrom = vi.fn();
const mockWhere = vi.fn();
const mockOrderBy = vi.fn();

vi.mock("../../src/db/client.js", () => ({
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
                const chainable = {
                  orderBy: (...oArgs: unknown[]) => {
                    mockOrderBy(...oArgs);
                    return chainable;
                  },
                  then: (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
                    result.then(resolve, reject),
                };
                return chainable;
              }
              return {
                orderBy: (...oArgs: unknown[]) => mockOrderBy(...oArgs),
              };
            },
          };
        },
      };
    },
  },
}));

import {
  createMetaRegime,
  getActiveMetaRegimes,
  getMetaRegimeWithChains,
  formatMetaRegimesForPrompt,
} from "../../src/debate/metaRegimeService.js";

describe("metaRegimeService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("createMetaRegime", () => {
    it("inserts a new meta-regime and returns its id", async () => {
      mockReturning.mockResolvedValueOnce([{ id: 1 }]);

      const result = await createMetaRegime({
        name: "AI 인프라 투자 사이클",
        description: "GPU → 메모리 → 광통신 → 전력 → 장비",
        propagationType: "supply_chain",
      });

      expect(result).toEqual({ id: 1 });
      expect(mockInsert).toHaveBeenCalled();
      expect(mockValues).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "AI 인프라 투자 사이클",
          propagationType: "supply_chain",
        }),
      );
    });

    it("uses provided activatedAt date", async () => {
      const activatedAt = new Date("2025-01-15");
      mockReturning.mockResolvedValueOnce([{ id: 2 }]);

      await createMetaRegime({
        name: "인플레이션 사이클",
        propagationType: "narrative_shift",
        activatedAt,
      });

      expect(mockValues).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "인플레이션 사이클",
          propagationType: "narrative_shift",
          activatedAt,
        }),
      );
    });
  });

  describe("getActiveMetaRegimes", () => {
    it("returns ACTIVE and PEAKED regimes", async () => {
      const regimes = [
        {
          id: 1,
          name: "AI 인프라",
          description: null,
          propagationType: "supply_chain" as const,
          status: "ACTIVE" as const,
          activatedAt: new Date("2023-01-01"),
          peakAt: null,
        },
      ];
      mockWhere.mockResolvedValueOnce(regimes);

      const result = await getActiveMetaRegimes();

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("AI 인프라");
    });

    it("returns empty array when no active regimes", async () => {
      mockWhere.mockResolvedValueOnce([]);

      const result = await getActiveMetaRegimes();
      expect(result).toEqual([]);
    });
  });

  describe("getMetaRegimeWithChains", () => {
    it("returns null when regime does not exist", async () => {
      mockWhere.mockResolvedValueOnce([]);

      const result = await getMetaRegimeWithChains(999);
      expect(result).toBeNull();
    });

    it("returns regime with ordered chains", async () => {
      // First query: regime
      mockWhere.mockResolvedValueOnce([
        {
          id: 1,
          name: "AI 인프라",
          description: "GPU cycle",
          propagationType: "supply_chain",
          status: "ACTIVE",
          activatedAt: new Date("2023-01-01"),
          peakAt: null,
        },
      ]);
      // Second query: chains
      mockOrderBy.mockResolvedValueOnce([
        {
          id: 10,
          bottleneck: "GPU 공급 부족",
          supplyChain: "GPU → HBM → 광트랜시버",
          sequenceOrder: 1,
          sequenceConfidence: "high",
          status: "RESOLVED",
          activatedAt: new Date("2023-01-01"),
          peakAt: new Date("2023-06-01"),
        },
        {
          id: 11,
          bottleneck: "HBM 공급 부족",
          supplyChain: "HBM → 패키징 → 테스트",
          sequenceOrder: 2,
          sequenceConfidence: "medium",
          status: "ACTIVE",
          activatedAt: new Date("2023-07-01"),
          peakAt: null,
        },
      ]);

      const result = await getMetaRegimeWithChains(1);

      expect(result).not.toBeNull();
      expect(result!.name).toBe("AI 인프라");
      expect(result!.chains).toHaveLength(2);
      expect(result!.chains[0].sequenceOrder).toBe(1);
      expect(result!.chains[1].sequenceOrder).toBe(2);
    });
  });

  describe("formatMetaRegimesForPrompt", () => {
    it("returns empty string when no active regimes", async () => {
      // getActiveMetaRegimes
      mockWhere.mockResolvedValueOnce([]);

      const result = await formatMetaRegimesForPrompt();
      expect(result).toBe("");
    });

    it("formats active regime with chains into markdown", async () => {
      // getActiveMetaRegimes
      mockWhere.mockResolvedValueOnce([
        {
          id: 1,
          name: "AI 인프라 투자 사이클",
          description: "GPU부터 반도체 장비까지 순차 활성화",
          propagationType: "supply_chain" as const,
          status: "ACTIVE" as const,
          activatedAt: new Date("2023-01-01"),
          peakAt: null,
        },
      ]);

      // batch chains for all regimes
      mockOrderBy.mockResolvedValueOnce([
        {
          metaRegimeId: 1,
          bottleneck: "GPU 공급 부족",
          supplyChain: "GPU → HBM → 광트랜시버",
          sequenceOrder: 1,
          sequenceConfidence: "high",
          status: "RESOLVED",
        },
        {
          metaRegimeId: 1,
          bottleneck: "HBM 병목",
          supplyChain: "HBM → 패키징",
          sequenceOrder: 2,
          sequenceConfidence: "medium",
          status: "ACTIVE",
        },
      ]);

      const result = await formatMetaRegimesForPrompt();

      expect(result).toContain("## 현재 활성 국면 (Meta-Regime)");
      expect(result).toContain("AI 인프라 투자 사이클");
      expect(result).toContain("병목 전파 (Bullwhip)");
      expect(result).toContain("GPU 공급 부족");
      expect(result).toContain("HBM 병목");
      expect(result).toContain("| 1 |");
      expect(result).toContain("| 2 |");
    });

    it("shows PEAKED status tag", async () => {
      mockWhere.mockResolvedValueOnce([
        {
          id: 2,
          name: "COVID 리오프닝",
          description: null,
          propagationType: "narrative_shift" as const,
          status: "PEAKED" as const,
          activatedAt: new Date("2020-03-01"),
          peakAt: new Date("2021-06-01"),
        },
      ]);
      mockOrderBy.mockResolvedValueOnce([]);

      const result = await formatMetaRegimesForPrompt();

      expect(result).toContain("COVID 리오프닝 (피크 통과)");
      expect(result).toContain("내러티브 전환");
    });
  });
});
