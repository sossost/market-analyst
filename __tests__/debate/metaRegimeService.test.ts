import { describe, it, expect, vi, beforeEach } from "vitest";

// DB mock — junction table 지원 (innerJoin, leftJoin, onConflictDoNothing)
const mockInsert = vi.fn();
const mockValues = vi.fn();
const mockReturning = vi.fn();
const mockOnConflict = vi.fn();
const mockSelect = vi.fn();
const mockFrom = vi.fn();
const mockWhere = vi.fn();
const mockOrderBy = vi.fn();
const mockInnerJoin = vi.fn();
const mockLeftJoin = vi.fn();
const mockUpdate = vi.fn();
const mockSet = vi.fn();
const mockUpdateWhere = vi.fn();

function makeSelectChain(fromResult?: unknown) {
  const chain: Record<string, unknown> = {};

  chain.where = (...wArgs: unknown[]) => {
    const result = mockWhere(...wArgs);
    if (result != null && typeof (result as { then?: unknown }).then === "function") {
      const c: Record<string, unknown> = {
        orderBy: (...oArgs: unknown[]) => {
          mockOrderBy(...oArgs);
          return c;
        },
        then: (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
          (result as Promise<unknown>).then(resolve, reject),
      };
      return c;
    }
    return {
      orderBy: (...oArgs: unknown[]) => mockOrderBy(...oArgs),
    };
  };

  chain.innerJoin = (...jArgs: unknown[]) => {
    mockInnerJoin(...jArgs);
    return chain;
  };

  chain.leftJoin = (...jArgs: unknown[]) => {
    mockLeftJoin(...jArgs);
    return chain;
  };

  chain.orderBy = (...oArgs: unknown[]) => {
    mockOrderBy(...oArgs);
    return chain;
  };

  // from()이 바로 await되는 경우 (where 없이): thenable 지원
  if (fromResult != null && typeof (fromResult as { then?: unknown }).then === "function") {
    chain.then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
      (fromResult as Promise<unknown>).then(resolve, reject);
  }

  return chain;
}

vi.mock("../../src/db/client.js", () => {
  const dbImpl = {
    insert: (...args: unknown[]) => {
      mockInsert(...args);
      return {
        values: (...vArgs: unknown[]) => {
          mockValues(...vArgs);
          return {
            returning: (...rArgs: unknown[]) => mockReturning(...rArgs),
            onConflictDoNothing: (...cArgs: unknown[]) => mockOnConflict(...cArgs),
          };
        },
      };
    },
    select: (...args: unknown[]) => {
      mockSelect(...args);
      return {
        from: (...fArgs: unknown[]) => {
          const fromResult = mockFrom(...fArgs);
          return makeSelectChain(fromResult);
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
    transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb(dbImpl),
  };
  return { db: dbImpl };
});

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

      // batch chains for all regimes (junction table innerJoin)
      mockOrderBy.mockResolvedValueOnce([
        {
          regimeId: 1,
          bottleneck: "GPU 공급 부족",
          supplyChain: "GPU → HBM → 광트랜시버",
          sequenceOrder: 1,
          sequenceConfidence: "high",
          status: "RESOLVED",
        },
        {
          regimeId: 1,
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
      // batch chains from junction table innerJoin
      mockWhere.mockResolvedValueOnce([
        { regimeId: 1, status: "RESOLVING" },
        { regimeId: 1, status: "RESOLVED" },
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
        { regimeId: 1, status: "ACTIVE" },
        { regimeId: 1, status: "RESOLVED" },
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
        { regimeId: 2, status: "RESOLVED" },
        { regimeId: 2, status: "INVALIDATED" },
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
        { regimeId: 3, status: "ACTIVE" },
        { regimeId: 3, status: "RESOLVED" },
      ]);
      mockUpdateWhere.mockResolvedValueOnce(undefined);

      const result = await transitionMetaRegimeStatuses();

      expect(result).toBe(1);
      expect(mockSet).toHaveBeenCalledWith(
        expect.objectContaining({ status: "ACTIVE" }),
      );
    });
  });

  // ─── linkChainToRegime Tests — junction table INSERT ────────────

  describe("linkChainToRegime", () => {
    it("junction table에 INSERT로 체인-국면 링크를 생성한다", async () => {
      // max sequence order query (junction table)
      mockWhere.mockResolvedValueOnce([{ maxOrder: 3 }]);
      // insert junction row
      mockOnConflict.mockResolvedValueOnce(undefined);

      await linkChainToRegime(10, 1);

      expect(mockInsert).toHaveBeenCalled();
      expect(mockValues).toHaveBeenCalledWith(
        expect.objectContaining({
          chainId: 10,
          regimeId: 1,
          sequenceOrder: 4,
          sequenceConfidence: "medium",
        }),
      );
      expect(mockOnConflict).toHaveBeenCalled();
      // update가 호출되지 않아야 함 (기존 방식 제거 확인)
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it("starts at order 1 when no existing chains in regime", async () => {
      mockWhere.mockResolvedValueOnce([{ maxOrder: 0 }]);
      mockOnConflict.mockResolvedValueOnce(undefined);

      await linkChainToRegime(5, 2, "high");

      expect(mockValues).toHaveBeenCalledWith(
        expect.objectContaining({
          chainId: 5,
          regimeId: 2,
          sequenceOrder: 1,
          sequenceConfidence: "high",
        }),
      );
    });
  });

  // ─── linkUnlinkedChainsToRegimes Tests — junction table 기준 ────

  describe("linkUnlinkedChainsToRegimes", () => {
    beforeEach(() => {
      mockOnConflict.mockResolvedValue(undefined);
    });

    it("returns 0 when no unlinked chains", async () => {
      // LEFT JOIN 단일 쿼리: unlinked chains 없음
      mockWhere.mockResolvedValueOnce([]);

      const result = await linkUnlinkedChainsToRegimes();
      expect(result).toBe(0);
    });

    it("returns 0 when no active regimes", async () => {
      // 1) LEFT JOIN: unlinked chains 1개
      mockWhere.mockResolvedValueOnce([{ id: 10, megatrend: "AI 인프라 확장" }]);
      // 2) getActiveMetaRegimes
      mockWhere.mockResolvedValueOnce([]);

      const result = await linkUnlinkedChainsToRegimes();
      expect(result).toBe(0);
    });

    it("links chain to regime with matching megatrend keywords", async () => {
      // 1) LEFT JOIN: unlinked chains
      mockWhere.mockResolvedValueOnce([{ id: 10, megatrend: "AI 인프라 확장 GPU 수요" }]);
      // 2) getActiveMetaRegimes
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
      // 3) batch fetch regime chains (junction table innerJoin)
      mockWhere.mockResolvedValueOnce([{ regimeId: 1, megatrend: "AI 인프라 확장 HBM" }]);
      // 4) linkChainToRegime: max order query
      mockWhere.mockResolvedValueOnce([{ maxOrder: 2 }]);
      // 5) insert junction row
      mockOnConflict.mockResolvedValueOnce(undefined);

      const result = await linkUnlinkedChainsToRegimes();
      expect(result).toBe(1);
    });

    it("does not link when keyword overlap is insufficient", async () => {
      // 1) LEFT JOIN: unlinked chains
      mockWhere.mockResolvedValueOnce([{ id: 10, megatrend: "에너지 전환 태양광" }]);
      // 2) getActiveMetaRegimes
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
      // 3) batch fetch regime chains
      mockWhere.mockResolvedValueOnce([{ regimeId: 1, megatrend: "AI 인프라 확장 GPU" }]);

      const result = await linkUnlinkedChainsToRegimes();
      expect(result).toBe(0);
    });
  });

  // ─── detectAndCreateNewRegimes Tests — junction table 기준 ──────

  describe("detectAndCreateNewRegimes", () => {
    beforeEach(() => {
      mockOnConflict.mockResolvedValue(undefined);
    });

    it("returns 0 when fewer than 2 unlinked chains", async () => {
      // LEFT JOIN 단일 쿼리: 1개만
      mockWhere.mockResolvedValueOnce([
        { id: 1, megatrend: "AI 인프라 확장", supplyChain: "GPU → HBM" },
      ]);

      const result = await detectAndCreateNewRegimes();
      expect(result).toBe(0);
    });

    it("creates regime when 2+ chains share megatrend keywords", async () => {
      // 1) LEFT JOIN: unlinked chains
      mockWhere.mockResolvedValueOnce([
        { id: 10, megatrend: "AI 인프라 확장 GPU", supplyChain: "GPU → HBM → 광트랜시버" },
        { id: 11, megatrend: "AI 인프라 확장 HBM", supplyChain: "HBM → 패키징" },
      ]);
      // 2) createMetaRegime
      mockReturning.mockResolvedValueOnce([{ id: 100 }]);
      // 3) linkChainToRegime for chain 10: max order
      mockWhere.mockResolvedValueOnce([{ maxOrder: 0 }]);
      // 4) insert junction (chain 10)
      mockOnConflict.mockResolvedValueOnce(undefined);
      // 5) linkChainToRegime for chain 11: max order
      mockWhere.mockResolvedValueOnce([{ maxOrder: 1 }]);
      // 6) insert junction (chain 11)
      mockOnConflict.mockResolvedValueOnce(undefined);

      const result = await detectAndCreateNewRegimes();

      expect(result).toBe(1);
      // createMetaRegime insert values
      expect(mockValues).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "AI 인프라 확장 GPU",
          propagationType: "supply_chain",
        }),
      );
    });

    it("does not create regime when chains have unrelated megatrends", async () => {
      // LEFT JOIN: unlinked chains (관련 없는 메가트렌드)
      mockWhere.mockResolvedValueOnce([
        { id: 10, megatrend: "AI 인프라 확장", supplyChain: "GPU → HBM" },
        { id: 11, megatrend: "에너지 전환 태양광", supplyChain: "폴리실리콘 → 웨이퍼" },
      ]);

      const result = await detectAndCreateNewRegimes();
      expect(result).toBe(0);
    });

    it("detects narrative_shift propagation when no arrow in supply chain", async () => {
      // 1) LEFT JOIN: unlinked chains
      mockWhere.mockResolvedValueOnce([
        { id: 10, megatrend: "인플레이션 사이클 거시경제 금리", supplyChain: "금리 상승" },
        { id: 11, megatrend: "인플레이션 사이클 거시경제 통화정책", supplyChain: "긴축 정책" },
      ]);
      // 2) createMetaRegime
      mockReturning.mockResolvedValueOnce([{ id: 101 }]);
      // 3) linkChainToRegime: max orders
      mockWhere.mockResolvedValueOnce([{ maxOrder: 0 }]);
      mockOnConflict.mockResolvedValueOnce(undefined);
      mockWhere.mockResolvedValueOnce([{ maxOrder: 1 }]);
      mockOnConflict.mockResolvedValueOnce(undefined);

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
      // 실행 순서 (where() 호출 순서 기준):
      //
      // 1. transitionMetaRegimeStatuses → getActiveMetaRegimes:
      //    db.select().from(metaRegimes).where()
      //    → mockWhere #1: [] → early return (activeRegimes = [])
      //
      // 2. linkUnlinkedChainsToRegimes → LEFT JOIN 단일 쿼리:
      //    db.select().from(narrativeChains).leftJoin(...).where()
      //    → mockWhere #2: [] → unlinkedChains = [] → early return (0)
      //
      // 3. detectAndCreateNewRegimes → LEFT JOIN 단일 쿼리:
      //    db.select().from(narrativeChains).leftJoin(...).where()
      //    → mockWhere #3: [] → unlinkedChains = [] → early return (0)

      // mockWhere 호출 순서 (총 3회):
      // #1: getActiveMetaRegimes .where() → []
      // #2: linkUnlinked LEFT JOIN .where() → []
      // #3: detectAndCreate LEFT JOIN .where() → []
      mockWhere.mockResolvedValueOnce([]);
      mockWhere.mockResolvedValueOnce([]);
      mockWhere.mockResolvedValueOnce([]);

      const result = await manageMetaRegimes();

      expect(result).toEqual({ transitioned: 0, linked: 0, created: 0 });
    });
  });
});
