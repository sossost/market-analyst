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

vi.mock("../../../src/agent/fundamental/fundamentalAgent.js", () => ({
  analyzeFundamentals: vi.fn(),
}));

vi.mock("../../../src/agent/fundamental/stockReport.js", () => ({
  generateStockReport: vi.fn(),
  publishStockReport: vi.fn(),
}));

vi.mock("@anthropic-ai/sdk", () => {
  return {
    default: class MockAnthropic {},
  };
});

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
import { analyzeFundamentals } from "../../../src/agent/fundamental/fundamentalAgent.js";
import { generateStockReport, publishStockReport } from "../../../src/agent/fundamental/stockReport.js";
import { runFundamentalValidation } from "../../../src/agent/fundamental/runFundamentalValidation.js";

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
      { periodEndDate: "2025-12-31", asOfQ: "Q4 2025", revenue: 35_100_000_000, netIncome: 20_000_000_000, epsDiluted: 1.89, netMargin: 57 },
      { periodEndDate: "2025-09-30", asOfQ: "Q3 2025", revenue: 30_000_000_000, netIncome: 16_000_000_000, epsDiluted: 1.27, netMargin: 53 },
    ],
  };
}

/**
 * db.execute 호출 순서에 따라 다른 결과를 반환하도록 세팅.
 * canSkipScoring 경로: getScoredDate → canSkipScoring(2 calls) → loadExistingScores → loadTechnicalData
 * 일반 경로: getScoredDate → canSkipScoring(2 calls) → getAllScoringSymbols → ...
 */
function setupDbForCanSkip(existingScores: FundamentalScore[]) {
  const dbExecute = vi.mocked(db.execute);
  let callIdx = 0;

  dbExecute.mockImplementation(async () => {
    callIdx++;
    switch (callIdx) {
      // 1. getScoredDate
      case 1:
        return { rows: [{ max_date: SCORED_DATE }] } as any;
      // 2. canSkipScoring — last_scored_at
      case 2:
        return { rows: [{ last_scored_at: "2026-03-11T06:00:00Z" }] } as any;
      // 3. canSkipScoring — new financials count
      case 3:
        return { rows: [{ cnt: 0 }] } as any;
      // 4. loadExistingScores
      case 4:
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
      // 5+. loadTechnicalData per S-grade symbol
      default:
        return {
          rows: [{
            phase: 2,
            rs_score: 95,
            volume_confirmed: true,
            pct_from_high_52w: "-0.05",
            market_cap: "2800000000000",
            sector: "Technology",
            industry: "Semiconductors",
          }],
        } as any;
    }
  });
}

function setupDbForFullScoring(symbols: string[]) {
  const dbExecute = vi.mocked(db.execute);
  let callIdx = 0;

  dbExecute.mockImplementation(async () => {
    callIdx++;
    switch (callIdx) {
      // 1. getScoredDate
      case 1:
        return { rows: [{ max_date: SCORED_DATE }] } as any;
      // 2. canSkipScoring — no existing scores
      case 2:
        return { rows: [{ last_scored_at: null }] } as any;
      // 3. getAllScoringSymbols
      case 3:
        return { rows: symbols.map((s) => ({ symbol: s })) } as any;
      // 4. saveFundamentalScoresToDB
      case 4:
        return { rows: [] } as any;
      // 5+. loadTechnicalData
      default:
        return {
          rows: [{
            phase: 2,
            rs_score: 90,
            volume_confirmed: true,
            pct_from_high_52w: "-0.08",
            market_cap: "1500000000000",
            sector: "Technology",
            industry: "Software",
          }],
        } as any;
    }
  });
}

// ─── Tests ──────────────────────────────────────────────────────────

describe("runFundamentalValidation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("canSkipScoring true — DB 기존 스코어 재사용", () => {
    it("S등급 종목의 리포트가 발행된다", async () => {
      const sScore = makeScore({ symbol: "NVDA", grade: "S" });
      const aScore = makeScore({ symbol: "AAPL", grade: "A" });
      setupDbForCanSkip([sScore, aScore]);

      const nvdaInput = makeInput("NVDA");
      vi.mocked(loadFundamentalData).mockResolvedValue([nvdaInput]);

      vi.mocked(analyzeFundamentals).mockResolvedValue({
        narrative: "AI 인프라 사이클 핵심 수혜",
        tokensUsed: { input: 1000, output: 500 },
      });

      vi.mocked(generateStockReport).mockReturnValue("# NVDA 리포트");
      vi.mocked(publishStockReport).mockResolvedValue(undefined);

      const result = await runFundamentalValidation();

      // S등급 NVDA만 로드
      expect(loadFundamentalData).toHaveBeenCalledWith(["NVDA"]);

      // LLM 분석 호출
      expect(analyzeFundamentals).toHaveBeenCalledTimes(1);

      // 리포트 발행
      expect(publishStockReport).toHaveBeenCalledWith("NVDA", "# NVDA 리포트");
      expect(result.reportsPublished).toEqual(["NVDA"]);

      // 스코어는 DB에서 로드한 것 그대로
      expect(result.scores).toHaveLength(2);
      expect(result.scores[0].symbol).toBe("NVDA");
      expect(result.scores[0].grade).toBe("S");
    });

    it("skipPublish: true 시 canSkip 경로에서도 리포트 미발행", async () => {
      const sScore = makeScore({ symbol: "NVDA", grade: "S" });
      setupDbForCanSkip([sScore]);

      const nvdaInput = makeInput("NVDA");
      vi.mocked(loadFundamentalData).mockResolvedValue([nvdaInput]);

      vi.mocked(analyzeFundamentals).mockResolvedValue({
        narrative: "분석 내용",
        tokensUsed: { input: 500, output: 200 },
      });

      const result = await runFundamentalValidation({ skipPublish: true });

      expect(publishStockReport).not.toHaveBeenCalled();
      expect(result.reportsPublished).toEqual([]);
    });

    it("S등급 종목이 없으면 loadFundamentalData에 빈 배열을 전달하지 않는다", async () => {
      const aScore = makeScore({ symbol: "AAPL", grade: "A" });
      const bScore = makeScore({ symbol: "MSFT", grade: "B" });
      setupDbForCanSkip([aScore, bScore]);

      // S등급 없으므로 loadFundamentalData에 빈 배열 → 빈 결과
      vi.mocked(loadFundamentalData).mockResolvedValue([]);

      const result = await runFundamentalValidation();

      // S등급 없으므로 LLM 분석/리포트 발행 없음
      expect(loadFundamentalData).not.toHaveBeenCalled();
      expect(analyzeFundamentals).not.toHaveBeenCalled();
      expect(publishStockReport).not.toHaveBeenCalled();
      expect(result.reportsPublished).toEqual([]);
      expect(result.scores).toHaveLength(2);
    });
  });

  describe("canSkipScoring false — 전체 스코어링 경로", () => {
    it("전체 스코어링 → LLM 분석 → 리포트 발행", async () => {
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

      vi.mocked(analyzeFundamentals).mockResolvedValue({
        narrative: "GPU 수요 폭발",
        tokensUsed: { input: 800, output: 400 },
      });

      vi.mocked(generateStockReport).mockReturnValue("# NVDA 리포트");
      vi.mocked(publishStockReport).mockResolvedValue(undefined);

      const result = await runFundamentalValidation();

      // 전체 종목 데이터 로드
      expect(loadFundamentalData).toHaveBeenCalledWith(symbols);

      // 스코어링
      expect(scoreFundamentals).toHaveBeenCalledTimes(2);
      expect(promoteTopToS).toHaveBeenCalledTimes(1);

      // S등급만 LLM 분석
      expect(analyzeFundamentals).toHaveBeenCalledTimes(1);

      // S등급만 리포트 발행
      expect(result.reportsPublished).toEqual(["NVDA"]);
      expect(result.totalTokens).toEqual({ input: 800, output: 400 });
    });
  });
});
