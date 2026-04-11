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

// Mock thesisConstants — shared constant for stale thesis expiration
vi.mock("@/debate/thesisConstants.js", () => ({
  THESIS_EXPIRE_PROGRESS: 0.5,
}));

// Mock narrativeChainService — error-isolated, no-op in thesis tests
vi.mock("@/debate/narrativeChainService.js", () => ({
  recordNarrativeChain: vi.fn().mockResolvedValue(undefined),
}));

// Mock statusQuoDetector — 기본 false, 테스트에서 필요 시 override
const mockDetectStatusQuo = vi.fn().mockReturnValue(false);
vi.mock("@/debate/statusQuoDetector.js", () => ({
  detectStatusQuo: (...args: unknown[]) => mockDetectStatusQuo(...args),
}));

const mockLoggerWarn = vi.fn();
const mockLoggerInfo = vi.fn();
vi.mock("@/lib/logger", () => ({
  logger: {
    info: (...args: unknown[]) => mockLoggerInfo(...args),
    warn: (...args: unknown[]) => mockLoggerWarn(...args),
    error: vi.fn(),
    step: vi.fn(),
  },
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
                  const groupResult = mockGroupBy(...gArgs);
                  // thenable이면 직접 await 가능 (enforceActiveThesisCap),
                  // 아니면 빈 배열로 resolve — orderBy 체인도 지원
                  const promise = (groupResult != null && typeof (groupResult as any).then === "function")
                    ? groupResult
                    : Promise.resolve(groupResult ?? []);
                  (promise as any).orderBy = (...oArgs: unknown[]) => mockOrderBy(...oArgs);
                  return promise;
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
  expireStalledTheses,
  resolveThesis,
  getThesisStats,
  getThesisStatsByCategory,
  getConsensusByHitRate,
  forceExpireTheses,
  getThesisStatsByPersona,
  STALE_EXPIRE_PROGRESS,
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

  describe("saveTheses — 정량 파싱 가능성 경고", () => {
    it("정량 파싱 불가능한 targetCondition에 대해 경고를 로그한다", async () => {
      const theses: Thesis[] = [
        {
          agentPersona: "tech",
          thesis: "AI capex → revenue 전환 가속",
          timeframeDays: 60,
          verificationMetric: "AI revenue",
          targetCondition: "AI capex → revenue 전환 가시화",
          confidence: "medium",
          consensusLevel: "3/4",
        },
      ];

      mockReturning.mockResolvedValueOnce([{ id: 10 }]);
      await saveTheses("2026-03-29", theses);

      expect(mockLoggerWarn).toHaveBeenCalledWith(
        "ThesisStore",
        expect.stringContaining("[정량 검증 불가]"),
      );
      expect(mockLoggerWarn).toHaveBeenCalledWith(
        "ThesisStore",
        expect.stringContaining("tech"),
      );
    });

    it("정량 파싱 가능한 targetCondition에 대해서는 경고하지 않는다", async () => {
      const theses: Thesis[] = [
        {
          agentPersona: "tech",
          thesis: "Technology 섹터 RS 상승",
          timeframeDays: 30,
          verificationMetric: "Technology RS",
          targetCondition: "Technology RS > 65",
          confidence: "medium",
          consensusLevel: "3/4",
        },
      ];

      mockReturning.mockResolvedValueOnce([{ id: 11 }]);
      mockLoggerWarn.mockClear();
      await saveTheses("2026-03-29", theses);

      const warnCalls = mockLoggerWarn.mock.calls.filter(
        (args: unknown[]) => typeof args[1] === "string" && (args[1] as string).includes("[정량 검증 불가]"),
      );
      expect(warnCalls).toHaveLength(0);
    });
  });

  // #733: status_quo 태깅
  describe("saveTheses — status_quo 태깅", () => {
    it("snapshot 없이 호출하면 isStatusQuo가 null로 저장된다", async () => {
      const thesis: Thesis[] = [
        {
          agentPersona: "geopolitics",
          thesis: "호르무즈 봉쇄 → Energy 강세 유지",
          timeframeDays: 60,
          verificationMetric: "Energy RS",
          targetCondition: "Energy RS > 65",
          confidence: "high",
          consensusLevel: "4/4",
          category: "structural_narrative",
        },
      ];

      mockReturning.mockResolvedValueOnce([{ id: 100 }]);
      await saveTheses("2026-04-01", thesis);

      expect(mockValues).toHaveBeenCalledWith([
        expect.objectContaining({ isStatusQuo: null }),
      ]);
      expect(mockDetectStatusQuo).not.toHaveBeenCalled();
    });

    it("snapshot과 함께 호출하면 detectStatusQuo 결과가 isStatusQuo에 저장된다", async () => {
      mockDetectStatusQuo.mockReturnValueOnce(true);

      const thesis: Thesis[] = [
        {
          agentPersona: "geopolitics",
          thesis: "호르무즈 봉쇄 → Energy 강세 유지",
          timeframeDays: 60,
          verificationMetric: "Energy RS",
          targetCondition: "Energy RS > 65",
          confidence: "high",
          consensusLevel: "4/4",
          category: "structural_narrative",
        },
      ];

      const fakeSnapshot = { date: "2026-04-01" } as unknown as import("../../../src/debate/marketDataLoader.js").MarketSnapshot;
      mockReturning.mockResolvedValueOnce([{ id: 101 }]);
      await saveTheses("2026-04-01", thesis, fakeSnapshot);

      expect(mockDetectStatusQuo).toHaveBeenCalledWith("Energy RS > 65", fakeSnapshot);
      expect(mockValues).toHaveBeenCalledWith([
        expect.objectContaining({ isStatusQuo: true }),
      ]);
    });

    it("status_quo 태깅 로그가 출력된다", async () => {
      mockDetectStatusQuo.mockReturnValueOnce(true);
      mockDetectStatusQuo.mockReturnValueOnce(false);

      const thesisList: Thesis[] = [
        {
          agentPersona: "geopolitics",
          thesis: "Energy 강세 유지",
          timeframeDays: 60,
          verificationMetric: "Energy RS",
          targetCondition: "Energy RS > 65",
          confidence: "high",
          consensusLevel: "4/4",
          category: "structural_narrative",
        },
        {
          agentPersona: "tech",
          thesis: "Technology RS 반등",
          timeframeDays: 30,
          verificationMetric: "Technology RS",
          targetCondition: "Technology RS > 60",
          confidence: "medium",
          consensusLevel: "3/4",
          category: "sector_rotation",
        },
      ];

      const fakeSnapshot = { date: "2026-04-01" } as unknown as import("../../../src/debate/marketDataLoader.js").MarketSnapshot;
      mockReturning.mockResolvedValueOnce([{ id: 102 }, { id: 103 }]);
      mockLoggerInfo.mockClear();
      await saveTheses("2026-04-01", thesisList, fakeSnapshot);

      expect(mockLoggerInfo).toHaveBeenCalledWith(
        "ThesisStore",
        expect.stringContaining("Status-quo 태깅: 1/2건"),
      );
    });
  });

  describe("forceExpireTheses", () => {
    it("ID 배열 기반으로 배치 EXPIRED 처리하고 실제 영향받은 행 수를 반환한다", async () => {
      mockUpdateReturning.mockResolvedValueOnce([{ id: 10 }, { id: 20 }, { id: 30 }]);

      const count = await forceExpireTheses(
        [10, 20, 30],
        "2026-03-29",
        "진행률 80% 이상 + LLM 판정 유보 → 강제 만료",
      );

      expect(count).toBe(3);
      expect(mockUpdate).toHaveBeenCalled();
      expect(mockSet).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "EXPIRED",
          closeReason: "hold_override",
          verificationMethod: "llm",
        }),
      );
    });

    it("일부 ID가 이미 비-ACTIVE이면 실제 영향받은 행만 카운트한다", async () => {
      mockUpdateReturning.mockResolvedValueOnce([{ id: 10 }]);

      const count = await forceExpireTheses(
        [10, 20, 30],
        "2026-03-29",
        "강제 만료",
      );

      expect(count).toBe(1);
    });

    it("빈 ID 배열이면 DB 호출 없이 0을 반환한다", async () => {
      const count = await forceExpireTheses([], "2026-03-29", "강제 만료");

      expect(count).toBe(0);
      expect(mockUpdate).not.toHaveBeenCalled();
    });
  });

  describe("getThesisStatsByPersona", () => {
    it("에이전트별 status 집계를 반환한다", async () => {
      mockGroupBy.mockResolvedValueOnce([
        { persona: "tech", status: "ACTIVE", count: 16 },
        { persona: "tech", status: "CONFIRMED", count: 4 },
        { persona: "macro", status: "ACTIVE", count: 5 },
        { persona: "sentiment", status: "INVALIDATED", count: 3 },
      ]);

      const stats = await getThesisStatsByPersona();

      expect(stats).toEqual({
        tech: { ACTIVE: 16, CONFIRMED: 4 },
        macro: { ACTIVE: 5 },
        sentiment: { INVALIDATED: 3 },
      });
    });

    it("데이터가 없으면 빈 객체를 반환한다", async () => {
      mockGroupBy.mockResolvedValueOnce([]);

      const stats = await getThesisStatsByPersona();

      expect(stats).toEqual({});
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

  describe("expireStalledTheses", () => {
    it("진행률 50%+ 무판정 thesis를 EXPIRED 처리하고 개수를 반환한다", async () => {
      mockUpdateReturning.mockResolvedValueOnce([{ id: 5 }, { id: 8 }]);

      const count = await expireStalledTheses("2026-04-20");

      expect(count).toBe(2);
      expect(mockUpdate).toHaveBeenCalled();
      expect(mockSet).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "EXPIRED",
          verificationDate: "2026-04-20",
          verificationResult: expect.stringContaining("안전망 만료"),
          closeReason: "stale_no_resolution",
        }),
      );
    });

    it("해당하는 thesis가 없으면 0을 반환한다", async () => {
      mockUpdateReturning.mockResolvedValueOnce([]);

      const count = await expireStalledTheses("2026-04-06");

      expect(count).toBe(0);
    });

    it("STALE_EXPIRE_PROGRESS 상수가 0.5이다", () => {
      expect(STALE_EXPIRE_PROGRESS).toBe(0.5);
    });
  });
});
