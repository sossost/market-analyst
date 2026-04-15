import { describe, it, expect, vi, beforeEach } from "vitest";

// DB mock
const mockInsert = vi.fn();
const mockValues = vi.fn();
const mockReturning = vi.fn();
const mockSelect = vi.fn();
const mockFrom = vi.fn();
const mockWhere = vi.fn();
const mockOrderBy = vi.fn();
const mockUpdate = vi.fn();
const mockSet = vi.fn();
const mockUpdateWhere = vi.fn();

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
  createMetaRegime,
  getActiveMetaRegimes,
  getMetaRegimeWithChains,
  formatMetaRegimesForPrompt,
  determineRegimeStatus,
  transitionMetaRegimeStatuses,
  linkChainToRegime,
  linkUnlinkedChainsToRegimes,
  detectAndCreateNewRegimes,
  manageMetaRegimes,
} from "../../src/debate/metaRegimeService.js";

describe("metaRegimeService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── Existing CRUD Tests ────────────────────────────────────────

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

  // ─── Status Transition Tests (Pure Function) ────────────────────

  describe("determineRegimeStatus", () => {
    it("returns null for empty chain list", () => {
      expect(determineRegimeStatus("ACTIVE", [])).toBeNull();
    });

    it("returns null when ACTIVE regime has ACTIVE chains (no change)", () => {
      expect(determineRegimeStatus("ACTIVE", ["ACTIVE", "RESOLVING"])).toBeNull();
    });

    it("transitions to PEAKED when no chain is ACTIVE", () => {
      expect(
        determineRegimeStatus("ACTIVE", ["RESOLVING", "RESOLVED", "OVERSUPPLY"]),
      ).toBe("PEAKED");
    });

    it("returns null when already PEAKED and still no ACTIVE chain", () => {
      expect(
        determineRegimeStatus("PEAKED", ["RESOLVING", "RESOLVED"]),
      ).toBeNull();
    });

    it("transitions to RESOLVED when all chains are RESOLVED or INVALIDATED", () => {
      expect(
        determineRegimeStatus("PEAKED", ["RESOLVED", "INVALIDATED", "RESOLVED"]),
      ).toBe("RESOLVED");
    });

    it("transitions ACTIVE directly to RESOLVED when all chains terminal", () => {
      expect(
        determineRegimeStatus("ACTIVE", ["RESOLVED", "RESOLVED"]),
      ).toBe("RESOLVED");
    });

    it("returns PEAKED not RESOLVED when some chains are OVERSUPPLY", () => {
      // OVERSUPPLY is not RESOLVED/INVALIDATED, so not terminal for regime RESOLVED check
      expect(
        determineRegimeStatus("ACTIVE", ["RESOLVED", "OVERSUPPLY"]),
      ).toBe("PEAKED");
    });

    it("single RESOLVING chain transitions regime to PEAKED", () => {
      expect(determineRegimeStatus("ACTIVE", ["RESOLVING"])).toBe("PEAKED");
    });

    it("single ACTIVE chain keeps regime ACTIVE", () => {
      expect(determineRegimeStatus("ACTIVE", ["ACTIVE"])).toBeNull();
    });

    it("mix of ACTIVE and terminal keeps regime ACTIVE", () => {
      expect(
        determineRegimeStatus("ACTIVE", ["ACTIVE", "RESOLVED", "INVALIDATED"]),
      ).toBeNull();
    });

    it("recovers PEAKED regime to ACTIVE when a chain becomes ACTIVE", () => {
      expect(
        determineRegimeStatus("PEAKED", ["ACTIVE", "RESOLVED"]),
      ).toBe("ACTIVE");
    });
  });

  // ─── transitionMetaRegimeStatuses Tests ─────────────────────────

  describe("transitionMetaRegimeStatuses", () => {
    it("returns 0 when no active regimes", async () => {
      // getActiveMetaRegimes
      mockWhere.mockResolvedValueOnce([]);

      const result = await transitionMetaRegimeStatuses();
      expect(result).toBe(0);
    });

    it("transitions ACTIVE regime to PEAKED when all chains non-ACTIVE", async () => {
      // getActiveMetaRegimes
      mockWhere.mockResolvedValueOnce([
        {
          id: 1,
          name: "AI 인프라",
          description: null,
          propagationType: "supply_chain" as const,
          status: "ACTIVE" as const,
          activatedAt: new Date("2023-01-01"),
          peakAt: null,
        },
      ]);
      // batch chains for all regimes
      mockWhere.mockResolvedValueOnce([
        { metaRegimeId: 1, status: "RESOLVING" },
        { metaRegimeId: 1, status: "RESOLVED" },
      ]);
      // db.update().set().where()
      mockUpdateWhere.mockResolvedValueOnce(undefined);

      const result = await transitionMetaRegimeStatuses();

      expect(result).toBe(1);
      expect(mockUpdate).toHaveBeenCalled();
      expect(mockSet).toHaveBeenCalledWith(
        expect.objectContaining({ status: "PEAKED" }),
      );
    });

    it("skips regime when chains still ACTIVE", async () => {
      mockWhere.mockResolvedValueOnce([
        {
          id: 1,
          name: "AI 인프라",
          description: null,
          propagationType: "supply_chain" as const,
          status: "ACTIVE" as const,
          activatedAt: new Date("2023-01-01"),
          peakAt: null,
        },
      ]);
      // batch chains: one still ACTIVE
      mockWhere.mockResolvedValueOnce([
        { metaRegimeId: 1, status: "ACTIVE" },
        { metaRegimeId: 1, status: "RESOLVED" },
      ]);

      const result = await transitionMetaRegimeStatuses();

      expect(result).toBe(0);
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it("transitions PEAKED regime to RESOLVED when all chains terminal", async () => {
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
      // batch chains: all terminal
      mockWhere.mockResolvedValueOnce([
        { metaRegimeId: 2, status: "RESOLVED" },
        { metaRegimeId: 2, status: "INVALIDATED" },
      ]);
      mockUpdateWhere.mockResolvedValueOnce(undefined);

      const result = await transitionMetaRegimeStatuses();

      expect(result).toBe(1);
      expect(mockSet).toHaveBeenCalledWith(
        expect.objectContaining({ status: "RESOLVED" }),
      );
    });

    it("recovers PEAKED regime to ACTIVE when new chain fires up", async () => {
      mockWhere.mockResolvedValueOnce([
        {
          id: 3,
          name: "AI 인프라",
          description: null,
          propagationType: "supply_chain" as const,
          status: "PEAKED" as const,
          activatedAt: new Date("2023-01-01"),
          peakAt: new Date("2024-06-01"),
        },
      ]);
      // batch chains: one ACTIVE (new chain linked)
      mockWhere.mockResolvedValueOnce([
        { metaRegimeId: 3, status: "ACTIVE" },
        { metaRegimeId: 3, status: "RESOLVED" },
      ]);
      mockUpdateWhere.mockResolvedValueOnce(undefined);

      const result = await transitionMetaRegimeStatuses();

      expect(result).toBe(1);
      expect(mockSet).toHaveBeenCalledWith(
        expect.objectContaining({ status: "ACTIVE" }),
      );
    });
  });

  // ─── linkChainToRegime Tests ────────────────────────────────────

  describe("linkChainToRegime", () => {
    it("links chain with auto-incremented sequence order", async () => {
      // max sequence order query
      mockWhere.mockResolvedValueOnce([{ maxOrder: 3 }]);
      // update chain
      mockUpdateWhere.mockResolvedValueOnce(undefined);

      await linkChainToRegime(10, 1);

      expect(mockSet).toHaveBeenCalledWith(
        expect.objectContaining({
          metaRegimeId: 1,
          sequenceOrder: 4,
          sequenceConfidence: "medium",
        }),
      );
    });

    it("starts at order 1 when no existing chains in regime", async () => {
      mockWhere.mockResolvedValueOnce([{ maxOrder: 0 }]);
      mockUpdateWhere.mockResolvedValueOnce(undefined);

      await linkChainToRegime(5, 2, "high");

      expect(mockSet).toHaveBeenCalledWith(
        expect.objectContaining({
          metaRegimeId: 2,
          sequenceOrder: 1,
          sequenceConfidence: "high",
        }),
      );
    });
  });

  // ─── linkUnlinkedChainsToRegimes Tests ──────────────────────────

  describe("linkUnlinkedChainsToRegimes", () => {
    it("returns 0 when no unlinked chains", async () => {
      // unlinked chains query
      mockWhere.mockResolvedValueOnce([]);

      const result = await linkUnlinkedChainsToRegimes();
      expect(result).toBe(0);
    });

    it("returns 0 when no active regimes", async () => {
      // unlinked chains
      mockWhere.mockResolvedValueOnce([
        { id: 10, megatrend: "AI 인프라 확장" },
      ]);
      // getActiveMetaRegimes
      mockWhere.mockResolvedValueOnce([]);

      const result = await linkUnlinkedChainsToRegimes();
      expect(result).toBe(0);
    });

    it("links chain to regime with matching megatrend keywords", async () => {
      // unlinked chains
      mockWhere.mockResolvedValueOnce([
        { id: 10, megatrend: "AI 인프라 확장 GPU 수요" },
      ]);
      // getActiveMetaRegimes
      mockWhere.mockResolvedValueOnce([
        {
          id: 1,
          name: "AI 인프라 투자 사이클",
          description: null,
          propagationType: "supply_chain" as const,
          status: "ACTIVE" as const,
          activatedAt: new Date(),
          peakAt: null,
        },
      ]);
      // batch fetch regime chains (all regimes in one query)
      mockWhere.mockResolvedValueOnce([
        { metaRegimeId: 1, megatrend: "AI 인프라 확장 HBM" },
      ]);
      // linkChainToRegime: max order
      mockWhere.mockResolvedValueOnce([{ maxOrder: 2 }]);
      // linkChainToRegime: update
      mockUpdateWhere.mockResolvedValueOnce(undefined);

      const result = await linkUnlinkedChainsToRegimes();
      expect(result).toBe(1);
    });

    it("does not link when keyword overlap is insufficient", async () => {
      // unlinked chains
      mockWhere.mockResolvedValueOnce([
        { id: 10, megatrend: "에너지 전환 태양광" },
      ]);
      // getActiveMetaRegimes
      mockWhere.mockResolvedValueOnce([
        {
          id: 1,
          name: "AI 인프라",
          description: null,
          propagationType: "supply_chain" as const,
          status: "ACTIVE" as const,
          activatedAt: new Date(),
          peakAt: null,
        },
      ]);
      // batch fetch regime chains
      mockWhere.mockResolvedValueOnce([
        { metaRegimeId: 1, megatrend: "AI 인프라 확장 GPU" },
      ]);

      const result = await linkUnlinkedChainsToRegimes();
      expect(result).toBe(0);
    });
  });

  // ─── detectAndCreateNewRegimes Tests ────────────────────────────

  describe("detectAndCreateNewRegimes", () => {
    it("returns 0 when fewer than 2 unlinked chains", async () => {
      mockWhere.mockResolvedValueOnce([
        { id: 1, megatrend: "AI 인프라 확장", supplyChain: "GPU → HBM" },
      ]);

      const result = await detectAndCreateNewRegimes();
      expect(result).toBe(0);
    });

    it("creates regime when 2+ chains share megatrend keywords", async () => {
      // unlinked chains
      mockWhere.mockResolvedValueOnce([
        { id: 10, megatrend: "AI 인프라 확장 GPU", supplyChain: "GPU → HBM → 광트랜시버" },
        { id: 11, megatrend: "AI 인프라 확장 HBM", supplyChain: "HBM → 패키징" },
      ]);
      // createMetaRegime
      mockReturning.mockResolvedValueOnce([{ id: 100 }]);
      // linkChainToRegime for chain 10: max order
      mockWhere.mockResolvedValueOnce([{ maxOrder: 0 }]);
      mockUpdateWhere.mockResolvedValueOnce(undefined);
      // linkChainToRegime for chain 11: max order
      mockWhere.mockResolvedValueOnce([{ maxOrder: 1 }]);
      mockUpdateWhere.mockResolvedValueOnce(undefined);

      const result = await detectAndCreateNewRegimes();

      expect(result).toBe(1);
      expect(mockValues).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "AI 인프라 확장 GPU",
          propagationType: "supply_chain",
        }),
      );
    });

    it("does not create regime when chains have unrelated megatrends", async () => {
      mockWhere.mockResolvedValueOnce([
        { id: 10, megatrend: "AI 인프라 확장", supplyChain: "GPU → HBM" },
        { id: 11, megatrend: "에너지 전환 태양광", supplyChain: "폴리실리콘 → 웨이퍼" },
      ]);

      const result = await detectAndCreateNewRegimes();
      expect(result).toBe(0);
    });

    it("detects narrative_shift propagation when no arrow in supply chain", async () => {
      mockWhere.mockResolvedValueOnce([
        { id: 10, megatrend: "인플레이션 사이클 거시경제 금리", supplyChain: "금리 상승" },
        { id: 11, megatrend: "인플레이션 사이클 거시경제 통화정책", supplyChain: "긴축 정책" },
      ]);
      mockReturning.mockResolvedValueOnce([{ id: 101 }]);
      mockWhere.mockResolvedValueOnce([{ maxOrder: 0 }]);
      mockUpdateWhere.mockResolvedValueOnce(undefined);
      mockWhere.mockResolvedValueOnce([{ maxOrder: 1 }]);
      mockUpdateWhere.mockResolvedValueOnce(undefined);

      const result = await detectAndCreateNewRegimes();

      expect(result).toBe(1);
      expect(mockValues).toHaveBeenCalledWith(
        expect.objectContaining({
          propagationType: "narrative_shift",
        }),
      );
    });
  });

  // ─── manageMetaRegimes Orchestrator Tests ───────────────────────

  describe("manageMetaRegimes", () => {
    it("returns zeros when nothing to do", async () => {
      // transitionMetaRegimeStatuses → getActiveMetaRegimes
      mockWhere.mockResolvedValueOnce([]);
      // linkUnlinkedChainsToRegimes → unlinked chains
      mockWhere.mockResolvedValueOnce([]);
      // detectAndCreateNewRegimes → unlinked chains
      mockWhere.mockResolvedValueOnce([]);

      const result = await manageMetaRegimes();

      expect(result).toEqual({ transitioned: 0, linked: 0, created: 0 });
    });
  });
});
