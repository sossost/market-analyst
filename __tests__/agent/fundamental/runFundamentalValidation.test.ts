import { describe, it, expect, vi, beforeEach } from "vitest";
import type { FundamentalScore, FundamentalInput } from "../../../src/types/fundamental.js";

// ─── Mocks ──────────────────────────────────────────────────────────

vi.mock("../../../src/db/client.js", () => ({
  db: { execute: vi.fn() },
}));

vi.mock("../../../src/lib/fundamental-data-loader.js", () => ({
  loadFundamentalData: vi.fn(),
}));

vi.mock("../../../src/lib/fundamental-scorer.js", () => ({
  scoreFundamentals: vi.fn(),
  promoteTopToS: vi.fn(),
}));

vi.mock("../../../src/agent/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { db } from "../../../src/db/client.js";
import { loadFundamentalData } from "../../../src/lib/fundamental-data-loader.js";
import { scoreFundamentals, promoteTopToS } from "../../../src/lib/fundamental-scorer.js";
import { runFundamentalValidation } from "@/fundamental/runFundamentalValidation.js";

// ─── Helpers ────────────────────────────────────────────────────────

const SCORED_DATE = "2026-03-11";

function makeScore(overrides: Partial<FundamentalScore> = {}): FundamentalScore {
  return {
    symbol: "NVDA",
    grade: "A",
    totalScore: 100,
    rankScore: 500,
    requiredMet: 2,
    bonusMet: 2,
    criteria: {
      epsGrowth: { passed: true, value: 142, detail: "EPS YoY +142%" },
      revenueGrowth: { passed: true, value: 95, detail: "매출 YoY +95%" },
      epsAcceleration: { passed: true, value: 142, detail: "EPS 가속" },
      marginExpansion: { passed: true, value: 65, detail: "이익률 확대" },
      roe: { passed: false, value: null, detail: "ROE 데이터 미확보" },
    },
    ...overrides,
  };
}

function makeInput(symbol: string = "NVDA"): FundamentalInput {
  return {
    symbol,
    quarters: [
      { periodEndDate: "2025-12-31", asOfQ: "Q4 2025", revenue: 35_100_000_000, netIncome: 20_000_000_000, epsDiluted: 1.89, netMargin: 57, actualEps: null },
      { periodEndDate: "2025-09-30", asOfQ: "Q3 2025", revenue: 30_000_000_000, netIncome: 16_000_000_000, epsDiluted: 1.27, netMargin: 53, actualEps: null },
    ],
  };
}

/**
 * drizzle sql 템플릿 태그에서 SQL 텍스트를 추출한다.
 * queryChunks 내 문자열 조각들을 합쳐 패턴 매칭에 사용.
 */
function extractSql(query: unknown): string {
  const q = query as { queryChunks?: unknown[] };
  if (q.queryChunks == null) return String(query);
  return q.queryChunks
    .map((chunk) => {
      if (typeof chunk === "object" && chunk !== null && "value" in chunk) {
        return (chunk as { value: string[] }).value.join("");
      }
      return "";
    })
    .join("");
}

/**
 * db.execute 모킹 — SQL 쿼리 내용 기반으로 응답 분기.
 * 호출 순서에 의존하지 않아 유지보수성이 높다.
 */
function setupDbForCanSkip(existingScores: FundamentalScore[]) {
  const dbExecute = vi.mocked(db.execute) as any;

  dbExecute.mockImplementation(async (query: unknown) => {
    const sql = extractSql(query);

    // getScoredDate
    if (sql.includes("MAX(date)") && sql.includes("stock_phases")) {
      return { rows: [{ max_date: SCORED_DATE }] } as any;
    }
    // canSkipScoring — last_scored_at
    if (sql.includes("MAX(created_at)") && sql.includes("fundamental_scores")) {
      return { rows: [{ last_scored_at: "2026-03-11T06:00:00Z" }] } as any;
    }
    // canSkipScoring — new financials count
    if (sql.includes("COUNT(*)") && sql.includes("quarterly_financials")) {
      return { rows: [{ cnt: 0 }] } as any;
    }
    // loadExistingScores
    if (sql.includes("fundamental_scores") && sql.includes("scored_date") && sql.includes("ORDER BY")) {
      return {
        rows: existingScores.map((s) => ({
          symbol: s.symbol,
          grade: s.grade,
          total_score: s.totalScore,
          rank_score: String(s.rankScore),
          required_met: s.requiredMet,
          bonus_met: s.bonusMet,
          criteria: JSON.stringify(s.criteria),
        })),
      } as any;
    }
    return { rows: [] } as any;
  });
}

function setupDbForFullScoring(symbols: string[]) {
  const dbExecute = vi.mocked(db.execute) as any;

  dbExecute.mockImplementation(async (query: unknown) => {
    const sql = extractSql(query);

    // getScoredDate
    if (sql.includes("MAX(date)") && sql.includes("stock_phases")) {
      return { rows: [{ max_date: SCORED_DATE }] } as any;
    }
    // canSkipScoring — no existing scores → 재스코어링 필요
    if (sql.includes("MAX(created_at)") && sql.includes("fundamental_scores")) {
      return { rows: [{ last_scored_at: null }] } as any;
    }
    // getAllScoringSymbols
    if (sql.includes("DISTINCT") && sql.includes("quarterly_financials")) {
      return { rows: symbols.map((s) => ({ symbol: s })) } as any;
    }
    // saveFundamentalScoresToDB
    if (sql.includes("INSERT INTO") && sql.includes("fundamental_scores")) {
      return { rows: [] } as any;
    }
    return { rows: [] } as any;
  });
}

// ─── Tests ──────────────────────────────────────────────────────────

describe("runFundamentalValidation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("canSkipScoring true — DB 기존 스코어 재사용", () => {
    it("DB에서 기존 스코어를 로드하여 반환한다", async () => {
      const sScore = makeScore({ symbol: "NVDA", grade: "S" });
      const aScore = makeScore({ symbol: "AAPL", grade: "A" });
      setupDbForCanSkip([sScore, aScore]);

      const result = await runFundamentalValidation();

      // 스코어는 DB에서 로드한 것 그대로
      expect(result.scores).toHaveLength(2);
      expect(result.scores[0].symbol).toBe("NVDA");
      expect(result.scores[0].grade).toBe("S");

      // LLM 분석/리포트 발행 없음 (deprecated)
      expect(result.reportsPublished).toEqual([]);
      expect(result.totalTokens).toEqual({ input: 0, output: 0 });
      expect(result.qualityExcluded).toEqual([]);

      // loadFundamentalData 호출 안 함 (canSkip이면 DB 스코어 재사용)
      expect(loadFundamentalData).not.toHaveBeenCalled();
    });

    it("S등급 종목이 없어도 정상 반환한다", async () => {
      const aScore = makeScore({ symbol: "AAPL", grade: "A" });
      const bScore = makeScore({ symbol: "MSFT", grade: "B" });
      setupDbForCanSkip([aScore, bScore]);

      const result = await runFundamentalValidation();

      expect(loadFundamentalData).not.toHaveBeenCalled();
      expect(result.reportsPublished).toEqual([]);
      expect(result.scores).toHaveLength(2);
    });
  });

  describe("canSkipScoring false — 전체 스코어링 경로", () => {
    it("전체 스코어링 → DB 저장", async () => {
      const symbols = ["NVDA", "AAPL"];
      setupDbForFullScoring(symbols);

      const nvdaInput = makeInput("NVDA");
      const aaplInput = makeInput("AAPL");
      vi.mocked(loadFundamentalData).mockResolvedValue([nvdaInput, aaplInput]);

      const sScore = makeScore({ symbol: "NVDA", grade: "S" });
      const aScore = makeScore({ symbol: "AAPL", grade: "A" });
      vi.mocked(scoreFundamentals)
        .mockReturnValueOnce({ ...sScore, grade: "A" })
        .mockReturnValueOnce(aScore);
      vi.mocked(promoteTopToS).mockReturnValue([sScore, aScore]);

      const result = await runFundamentalValidation();

      // 전체 종목 데이터 로드
      expect(loadFundamentalData).toHaveBeenCalledWith(symbols);

      // 스코어링
      expect(scoreFundamentals).toHaveBeenCalledTimes(2);
      expect(promoteTopToS).toHaveBeenCalledTimes(1);

      // deprecated 필드는 빈 값
      expect(result.reportsPublished).toEqual([]);
      expect(result.totalTokens).toEqual({ input: 0, output: 0 });
      expect(result.qualityExcluded).toEqual([]);

      // 스코어 결과
      expect(result.scores).toHaveLength(2);
      expect(result.scores[0].grade).toBe("S");
    });

    it("대상 종목이 0개이면 빈 결과를 반환한다", async () => {
      setupDbForFullScoring([]);

      const result = await runFundamentalValidation();

      expect(loadFundamentalData).not.toHaveBeenCalled();
      expect(result.scores).toEqual([]);
      expect(result.reportsPublished).toEqual([]);
    });
  });
});
