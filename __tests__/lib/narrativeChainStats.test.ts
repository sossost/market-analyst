import { describe, it, expect, vi, beforeEach } from "vitest";

// DB mock
const mockSelect = vi.fn();
const mockFrom = vi.fn();
const mockWhere = vi.fn();

vi.mock("../../src/db/client.js", () => ({
  db: {
    select: (...args: unknown[]) => {
      mockSelect(...args);
      return {
        from: (...fArgs: unknown[]) => {
          const result = mockFrom(...fArgs);
          // Return a thenable that also has .where() for chaining
          // getChainStats: await db.select().from() — needs to be thenable
          // getActiveChainsSummary: db.select().from().where() — needs .where()
          if (result != null && typeof result.then === "function") {
            // Already a promise — add .where() method
            (result as any).where = (...wArgs: unknown[]) => mockWhere(...wArgs);
            return result;
          }
          return {
            where: (...wArgs: unknown[]) => mockWhere(...wArgs),
          };
        },
      };
    },
  },
}));

import {
  getChainStats,
  getActiveChainsSummary,
  formatChainsForDailyPrompt,
  formatChainsSummaryForPrompt,
} from "../../src/lib/narrativeChainStats.js";

describe("narrativeChainStats", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getChainStats", () => {
    it("returns null averages when fewer than 3 resolved chains", async () => {
      // getChainStats calls select().from(narrativeChains) without where
      // Need to mock the from() call to return data directly
      mockFrom.mockResolvedValueOnce([
        { id: 1, megatrend: "AI", status: "RESOLVED", resolutionDays: 30 },
        { id: 2, megatrend: "AI", status: "ACTIVE", resolutionDays: null },
        { id: 3, megatrend: "EV", status: "RESOLVED", resolutionDays: 45 },
      ]);

      const stats = await getChainStats();

      expect(stats.totalChains).toBe(3);
      expect(stats.resolvedChains).toBe(2);
      expect(stats.avgResolutionDays).toBeNull();
      expect(stats.medianResolutionDays).toBeNull();
    });

    it("calculates averages when 3+ resolved chains exist", async () => {
      mockFrom.mockResolvedValueOnce([
        { id: 1, megatrend: "AI", status: "RESOLVED", resolutionDays: 30 },
        { id: 2, megatrend: "AI", status: "RESOLVED", resolutionDays: 60 },
        { id: 3, megatrend: "EV", status: "OVERSUPPLY", resolutionDays: 90 },
        { id: 4, megatrend: "EV", status: "ACTIVE", resolutionDays: null },
      ]);

      const stats = await getChainStats();

      expect(stats.totalChains).toBe(4);
      expect(stats.resolvedChains).toBe(3);
      expect(stats.avgResolutionDays).toBe(60); // (30+60+90)/3
      expect(stats.medianResolutionDays).toBe(60); // middle of [30,60,90]
    });

    it("counts chains by megatrend", async () => {
      mockFrom.mockResolvedValueOnce([
        { id: 1, megatrend: "AI 인프라", status: "ACTIVE", resolutionDays: null },
        { id: 2, megatrend: "AI 인프라", status: "RESOLVED", resolutionDays: 30 },
        { id: 3, megatrend: "EV 전환", status: "ACTIVE", resolutionDays: null },
      ]);

      const stats = await getChainStats();

      expect(stats.chainsByMegatrend).toEqual({
        "AI 인프라": 2,
        "EV 전환": 1,
      });
    });

    it("returns zeros for empty dataset", async () => {
      mockFrom.mockResolvedValueOnce([]);

      const stats = await getChainStats();

      expect(stats.totalChains).toBe(0);
      expect(stats.resolvedChains).toBe(0);
      expect(stats.avgResolutionDays).toBeNull();
      expect(stats.medianResolutionDays).toBeNull();
      expect(stats.chainsByMegatrend).toEqual({});
    });

    it("calculates correct median for even number of resolved chains", async () => {
      mockFrom.mockResolvedValueOnce([
        { id: 1, megatrend: "AI", status: "RESOLVED", resolutionDays: 20 },
        { id: 2, megatrend: "AI", status: "RESOLVED", resolutionDays: 40 },
        { id: 3, megatrend: "AI", status: "RESOLVED", resolutionDays: 60 },
        { id: 4, megatrend: "AI", status: "RESOLVED", resolutionDays: 80 },
      ]);

      const stats = await getChainStats();

      expect(stats.medianResolutionDays).toBe(50); // (40+60)/2
    });
  });

  describe("getActiveChainsSummary", () => {
    it("returns active and resolving chains with calculated days", async () => {
      const identifiedAt = new Date("2026-01-15");
      mockWhere.mockResolvedValueOnce([
        {
          id: 1,
          megatrend: "AI 인프라",
          bottleneck: "GPU 공급 부족",
          supplyChain: "GPU → HBM → 광트랜시버",
          bottleneckIdentifiedAt: identifiedAt,
          status: "ACTIVE",
          nextBottleneck: "전력 인프라",
          linkedThesisIds: [10, 20, 30],
          beneficiarySectors: ["Power Infrastructure"],
          beneficiaryTickers: ["VRT", "ETN"],
          nextBeneficiarySectors: ["Utilities"],
          nextBeneficiaryTickers: ["AES", "NEE"],
        },
      ]);

      const summary = await getActiveChainsSummary();

      expect(summary).toHaveLength(1);
      expect(summary[0].megatrend).toBe("AI 인프라");
      expect(summary[0].bottleneck).toBe("GPU 공급 부족");
      expect(summary[0].supplyChain).toBe("GPU → HBM → 광트랜시버");
      expect(summary[0].identifiedAt).toEqual(identifiedAt);
      expect(summary[0].daysSinceIdentified).toBeGreaterThan(0);
      expect(summary[0].status).toBe("ACTIVE");
      expect(summary[0].nextBottleneck).toBe("전력 인프라");
      expect(summary[0].linkedThesisCount).toBe(3);
      expect(summary[0].beneficiarySectors).toEqual(["Power Infrastructure"]);
      expect(summary[0].beneficiaryTickers).toEqual(["VRT", "ETN"]);
      expect(summary[0].nextBeneficiarySectors).toEqual(["Utilities"]);
      expect(summary[0].nextBeneficiaryTickers).toEqual(["AES", "NEE"]);
    });

    it("returns empty array when no active chains", async () => {
      mockWhere.mockResolvedValueOnce([]);

      const summary = await getActiveChainsSummary();
      expect(summary).toEqual([]);
    });

    it("handles null linkedThesisIds and null beneficiary fields", async () => {
      mockWhere.mockResolvedValueOnce([
        {
          id: 1,
          megatrend: "AI",
          bottleneck: "test",
          supplyChain: "",
          bottleneckIdentifiedAt: new Date(),
          status: "ACTIVE",
          nextBottleneck: null,
          linkedThesisIds: null,
          beneficiarySectors: null,
          beneficiaryTickers: null,
          nextBeneficiarySectors: null,
          nextBeneficiaryTickers: null,
        },
      ]);

      const summary = await getActiveChainsSummary();
      expect(summary[0].linkedThesisCount).toBe(0);
      expect(summary[0].beneficiarySectors).toEqual([]);
      expect(summary[0].beneficiaryTickers).toEqual([]);
      expect(summary[0].nextBeneficiarySectors).toEqual([]);
      expect(summary[0].nextBeneficiaryTickers).toEqual([]);
    });
  });

  describe("formatChainsForDailyPrompt", () => {
    it("returns empty string when no active chains", async () => {
      mockWhere.mockResolvedValueOnce([]);

      const result = await formatChainsForDailyPrompt();
      expect(result).toBe("");
    });

    it("formats single ACTIVE chain into concise table with supplyChain", async () => {
      const identifiedAt = new Date("2026-01-20");

      mockWhere.mockResolvedValueOnce([
        {
          id: 1,
          megatrend: "AI인프라",
          bottleneck: "HBM 공급 부족",
          supplyChain: "GPU → HBM → 패키징",
          bottleneckIdentifiedAt: identifiedAt,
          status: "ACTIVE",
          nextBottleneck: null,
          linkedThesisIds: [10],
          beneficiarySectors: null,
          beneficiaryTickers: null,
          nextBeneficiarySectors: null,
          nextBeneficiaryTickers: null,
        },
      ]);

      const result = await formatChainsForDailyPrompt();

      expect(result).toContain("## 현재 추적 중인 서사 체인 (종목 태그 참조용)");
      expect(result).toContain("공급망 경로");
      expect(result).toContain("GPU → HBM → 패키징");
      expect(result).toContain("HBM 공급 부족");
      expect(result).toContain("AI인프라");
      expect(result).toContain("ACTIVE");
      expect(result).toContain("[체인명 / 상태] 태그를 추가하세요");
    });

    it("formats multiple ACTIVE and RESOLVING chains", async () => {
      mockWhere.mockResolvedValueOnce([
        {
          id: 1,
          megatrend: "AI인프라",
          bottleneck: "HBM 공급 부족",
          supplyChain: "",
          bottleneckIdentifiedAt: new Date("2026-01-20"),
          status: "ACTIVE",
          nextBottleneck: null,
          linkedThesisIds: [10],
          beneficiarySectors: null,
          beneficiaryTickers: null,
          nextBeneficiarySectors: null,
          nextBeneficiaryTickers: null,
        },
        {
          id: 2,
          megatrend: "AI인프라",
          bottleneck: "광트랜시버 부족",
          supplyChain: "광트랜시버 공급망",
          bottleneckIdentifiedAt: new Date("2026-02-01"),
          status: "RESOLVING",
          nextBottleneck: null,
          linkedThesisIds: [20, 30],
          beneficiarySectors: null,
          beneficiaryTickers: null,
          nextBeneficiarySectors: null,
          nextBeneficiaryTickers: null,
        },
      ]);

      const result = await formatChainsForDailyPrompt();

      expect(result).toContain("HBM 공급 부족");
      expect(result).toContain("광트랜시버 부족");
      expect(result).toContain("ACTIVE");
      expect(result).toContain("RESOLVING");
    });

    it("excludes RESOLVED chains (only ACTIVE/RESOLVING returned by getActiveChainsSummary)", async () => {
      // getActiveChainsSummary already filters to ACTIVE/RESOLVING only
      mockWhere.mockResolvedValueOnce([
        {
          id: 1,
          megatrend: "AI인프라",
          bottleneck: "HBM 공급 부족",
          supplyChain: "",
          bottleneckIdentifiedAt: new Date("2026-01-20"),
          status: "ACTIVE",
          nextBottleneck: null,
          linkedThesisIds: [],
          beneficiarySectors: null,
          beneficiaryTickers: null,
          nextBeneficiarySectors: null,
          nextBeneficiaryTickers: null,
        },
      ]);

      const result = await formatChainsForDailyPrompt();

      expect(result).toContain("ACTIVE");
      expect(result).not.toContain("RESOLVED");
    });
  });

  describe("formatChainsSummaryForPrompt", () => {
    it("returns empty string when no active chains", async () => {
      // getActiveChainsSummary -> mockWhere
      mockWhere.mockResolvedValueOnce([]);

      const result = await formatChainsSummaryForPrompt();
      expect(result).toBe("");
    });

    it("formats active chains into markdown table with supplyChain and nextBeneficiary", async () => {
      const identifiedAt = new Date("2026-01-15");

      // mockWhere for getActiveChainsSummary
      mockWhere.mockResolvedValueOnce([
        {
          id: 1,
          megatrend: "AI 인프라",
          bottleneck: "광트랜시버 공급 부족",
          supplyChain: "GPU → HBM → 광트랜시버 → 전력",
          bottleneckIdentifiedAt: identifiedAt,
          status: "ACTIVE",
          nextBottleneck: "전력 인프라 부족",
          linkedThesisIds: [1, 2],
          beneficiarySectors: ["Power Infrastructure"],
          beneficiaryTickers: ["VRT", "ETN"],
          nextBeneficiarySectors: ["Utilities"],
          nextBeneficiaryTickers: ["AES", "NEE"],
        },
      ]);

      // 2nd mockFrom: for getChainStats — needs to return data as thenable
      mockFrom
        .mockReturnValueOnce({ where: (...wArgs: unknown[]) => mockWhere(...wArgs) }) // 1st: getActiveChainsSummary
        .mockResolvedValueOnce([ // 2nd: getChainStats
          { id: 1, megatrend: "AI 인프라", status: "ACTIVE", resolutionDays: null },
        ]);

      const result = await formatChainsSummaryForPrompt();

      expect(result).toContain("## 현재 추적 중인 병목 체인");
      expect(result).toContain("공급망 경로");
      expect(result).toContain("GPU → HBM → 광트랜시버 → 전력");
      expect(result).toContain("광트랜시버 공급 부족");
      expect(result).toContain("AI 인프라");
      expect(result).toContain("2026-01-15");
      expect(result).toContain("ACTIVE");
      expect(result).toContain("데이터 축적 중");
      expect(result).toContain("전력 인프라 부족");
      expect(result).toContain("Power Infrastructure");
      expect(result).toContain("VRT, ETN");
      expect(result).toContain("N+1 수혜 섹터");
      expect(result).toContain("Utilities");
      expect(result).toContain("AES, NEE");
      expect(result).toContain("선행 포착 후보");
    });

    it("shows average resolution days when 3+ resolved chains", async () => {
      const identifiedAt = new Date("2026-02-01");

      // mockWhere for getActiveChainsSummary
      mockWhere.mockResolvedValueOnce([
        {
          id: 4,
          megatrend: "AI 인프라",
          bottleneck: "전력 부족",
          supplyChain: "",
          bottleneckIdentifiedAt: identifiedAt,
          status: "ACTIVE",
          nextBottleneck: null,
          linkedThesisIds: [1],
          beneficiarySectors: null,
          beneficiaryTickers: null,
          nextBeneficiarySectors: null,
          nextBeneficiaryTickers: null,
        },
      ]);

      mockFrom
        .mockReturnValueOnce({ where: (...wArgs: unknown[]) => mockWhere(...wArgs) }) // getActiveChainsSummary
        .mockResolvedValueOnce([ // getChainStats
          { id: 1, megatrend: "AI", status: "RESOLVED", resolutionDays: 30 },
          { id: 2, megatrend: "AI", status: "RESOLVED", resolutionDays: 60 },
          { id: 3, megatrend: "AI", status: "RESOLVED", resolutionDays: 90 },
          { id: 4, megatrend: "AI", status: "ACTIVE", resolutionDays: null },
        ]);

      const result = await formatChainsSummaryForPrompt();

      expect(result).toContain("평균 60일");
      expect(result).not.toContain("데이터 축적 중");
    });
  });
});
