import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Pool } from "pg";

// ---------------------------------------------------------------------------
// mock
// ---------------------------------------------------------------------------

vi.mock("../loadAnalysisInputs.js", () => ({
  loadAnalysisInputs: vi.fn(),
}));

vi.mock("../corporateAnalyst.js", () => ({
  generateAnalysisReport: vi.fn(),
  CORPORATE_ANALYST_MODEL: "claude-sonnet-4-6-20250725",
}));

vi.mock("@/lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ---------------------------------------------------------------------------
// import (mock 이후)
// ---------------------------------------------------------------------------

import { runCorporateAnalyst } from "../runCorporateAnalyst.js";
import { loadAnalysisInputs } from "../loadAnalysisInputs.js";
import { generateAnalysisReport } from "../corporateAnalyst.js";
import type { AnalysisInputs } from "../loadAnalysisInputs.js";

const mockLoadAnalysisInputs = loadAnalysisInputs as ReturnType<typeof vi.fn>;
const mockGenerateAnalysisReport = generateAnalysisReport as ReturnType<typeof vi.fn>;

// ---------------------------------------------------------------------------
// 픽스처
// ---------------------------------------------------------------------------

const SYMBOL = "NVDA";
const DATE = "2026-03-10";

const MOCK_INPUTS: AnalysisInputs = {
  technical: { rsScore: 85, phase: 2, ma150Slope: 0.15, volRatio: 1.5, pctFromHigh52w: -5.2, pctFromLow52w: 42.3, conditionsMet: null, volumeConfirmed: true },
  sectorContext: { sector: "Technology", industry: "Semiconductors", sectorRs: 75, sectorGroupPhase: 2, industryRs: 70, industryGroupPhase: 2, sectorChange4w: 3.2, sectorChange8w: 8.1 },
  financials: [],
  ratios: null,
  marketRegime: null,
  debateSynthesis: null,
  companyName: "NVIDIA Corporation",
  sector: "Technology",
  industry: "Semiconductors",
};

const MOCK_REPORT = {
  investmentSummary: "## 핵심 포인트\n- 강한 RS",
  technicalAnalysis: "## 기술적 분석\nPhase 2",
  fundamentalTrend: "## 실적 트렌드\n데이터 미확인",
  valuationAnalysis: "## 밸류에이션\n데이터 미확인",
  sectorPositioning: "## 섹터 포지셔닝\nTechnology",
  marketContext: "## 시장 맥락\n데이터 미확인",
  riskFactors: "## 리스크\n- 시장 변동성",
};

function makePool(queryResult: { rowCount: number } = { rowCount: 1 }): Pool {
  return {
    query: vi.fn().mockResolvedValue(queryResult),
  } as unknown as Pool;
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// 테스트
// ---------------------------------------------------------------------------

describe("runCorporateAnalyst", () => {
  describe("성공 케이스", () => {
    it("정상 흐름에서 { success: true, symbol } 을 반환한다", async () => {
      mockLoadAnalysisInputs.mockResolvedValue(MOCK_INPUTS);
      mockGenerateAnalysisReport.mockResolvedValue({
        report: MOCK_REPORT,
        tokensInput: 1_000,
        tokensOutput: 500,
      });
      const pool = makePool();

      const result = await runCorporateAnalyst(SYMBOL, DATE, pool);

      expect(result.success).toBe(true);
      expect(result.symbol).toBe(SYMBOL);
      expect(result.error).toBeUndefined();
    });

    it("DB UPSERT를 1회 호출한다", async () => {
      mockLoadAnalysisInputs.mockResolvedValue(MOCK_INPUTS);
      mockGenerateAnalysisReport.mockResolvedValue({
        report: MOCK_REPORT,
        tokensInput: 1_000,
        tokensOutput: 500,
      });
      const pool = makePool();

      await runCorporateAnalyst(SYMBOL, DATE, pool);

      expect(pool.query).toHaveBeenCalledTimes(1);
      // UPSERT SQL에 ON CONFLICT가 포함되어 있는지 확인
      const queryCall = (pool.query as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(queryCall[0]).toContain("ON CONFLICT");
      expect(queryCall[0]).toContain("DO UPDATE SET");
    });

    it("UPSERT에 올바른 파라미터를 전달한다", async () => {
      mockLoadAnalysisInputs.mockResolvedValue(MOCK_INPUTS);
      mockGenerateAnalysisReport.mockResolvedValue({
        report: MOCK_REPORT,
        tokensInput: 2_000,
        tokensOutput: 800,
      });
      const pool = makePool();

      await runCorporateAnalyst(SYMBOL, DATE, pool);

      const queryCall = (pool.query as ReturnType<typeof vi.fn>).mock.calls[0];
      const params = queryCall[1] as unknown[];

      // $1=symbol, $2=date, $3...$9=report sections, $10=model_used, $11=tokensInput, $12=tokensOutput
      expect(params[0]).toBe(SYMBOL);
      expect(params[1]).toBe(DATE);
      expect(params[2]).toBe(MOCK_REPORT.investmentSummary);
      expect(params[9]).toBe("claude-sonnet-4-6-20250725");
      expect(params[10]).toBe(2_000);
      expect(params[11]).toBe(800);
    });
  });

  describe("에러 케이스: throw 없이 { success: false } 반환", () => {
    it("loadAnalysisInputs가 throw해도 에러를 반환한다", async () => {
      mockLoadAnalysisInputs.mockRejectedValue(new Error("DB 연결 실패"));
      const pool = makePool();

      const result = await runCorporateAnalyst(SYMBOL, DATE, pool);

      expect(result.success).toBe(false);
      expect(result.symbol).toBe(SYMBOL);
      expect(result.error).toContain("DB 연결 실패");
    });

    it("generateAnalysisReport가 throw해도 에러를 반환한다", async () => {
      mockLoadAnalysisInputs.mockResolvedValue(MOCK_INPUTS);
      mockGenerateAnalysisReport.mockRejectedValue(new Error("JSON 파싱 실패"));
      const pool = makePool();

      const result = await runCorporateAnalyst(SYMBOL, DATE, pool);

      expect(result.success).toBe(false);
      expect(result.error).toContain("JSON 파싱 실패");
    });

    it("DB UPSERT가 throw해도 에러를 반환한다", async () => {
      mockLoadAnalysisInputs.mockResolvedValue(MOCK_INPUTS);
      mockGenerateAnalysisReport.mockResolvedValue({
        report: MOCK_REPORT,
        tokensInput: 1_000,
        tokensOutput: 500,
      });
      const pool = {
        query: vi.fn().mockRejectedValue(new Error("DB UPSERT 실패")),
      } as unknown as Pool;

      const result = await runCorporateAnalyst(SYMBOL, DATE, pool);

      expect(result.success).toBe(false);
      expect(result.error).toContain("DB UPSERT 실패");
    });

    it("어떤 에러가 발생해도 절대 throw하지 않는다", async () => {
      mockLoadAnalysisInputs.mockRejectedValue(new TypeError("예상치 못한 에러"));
      const pool = makePool();

      // await이 throw 없이 완료되어야 함
      await expect(
        runCorporateAnalyst(SYMBOL, DATE, pool),
      ).resolves.toMatchObject({ success: false });
    });
  });
});
