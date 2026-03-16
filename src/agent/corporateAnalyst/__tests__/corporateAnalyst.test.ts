import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// vi.hoisted: mock 콜백 내부에서 참조 가능한 변수
// ---------------------------------------------------------------------------

const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }));

// ---------------------------------------------------------------------------
// Anthropic SDK mock
// ---------------------------------------------------------------------------

vi.mock("@anthropic-ai/sdk", () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      messages: { create: mockCreate },
    })),
  };
});

// callWithRetry mock — 실제 retry 없이 fn()을 바로 실행
vi.mock("../../debate/callAgent.js", () => ({
  callWithRetry: vi.fn((fn: () => unknown) => fn()),
}));

vi.mock("@/lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ---------------------------------------------------------------------------
// import (mock 이후)
// ---------------------------------------------------------------------------

import { generateAnalysisReport } from "../corporateAnalyst.js";
import type { AnalysisInputs } from "../loadAnalysisInputs.js";
import type Anthropic from "@anthropic-ai/sdk";

// ---------------------------------------------------------------------------
// 픽스처
// ---------------------------------------------------------------------------

const MINIMAL_INPUTS: AnalysisInputs = {
  technical: {
    rsScore: 85,
    phase: 2,
    ma150Slope: 0.15,
    volRatio: 1.5,
    pctFromHigh52w: -5.2,
    pctFromLow52w: 42.3,
    conditionsMet: '["ma_order"]',
    volumeConfirmed: true,
  },
  sectorContext: {
    sector: "Technology",
    industry: "Semiconductors",
    sectorRs: 75.0,
    sectorGroupPhase: 2,
    industryRs: 70.0,
    industryGroupPhase: 2,
    sectorChange4w: 3.2,
    sectorChange8w: 8.1,
  },
  financials: [
    {
      periodEndDate: "2025-12-31",
      revenue: 124_300_000_000,
      netIncome: 36_330_000_000,
      epsDiluted: 2.4,
      ebitda: 43_000_000_000,
      freeCashFlow: 29_000_000_000,
      grossProfit: 54_000_000_000,
    },
  ],
  ratios: {
    peRatio: 28.5,
    psRatio: 7.2,
    pbRatio: 45.3,
    evEbitda: 22.1,
    grossMargin: 43.5,
    opMargin: 30.1,
    netMargin: 25.3,
    debtEquity: 1.8,
  },
  marketRegime: {
    regime: "EARLY_BULL",
    rationale: "시장 저점 확인 후 상승 초입",
    confidence: "high",
  },
  debateSynthesis: "AI 인프라 투자가 지속되며 반도체가 주도한다.",
  companyName: "NVIDIA Corporation",
  sector: "Technology",
  industry: "Semiconductors",
};

const VALID_REPORT_JSON = JSON.stringify({
  investmentSummary: "## 핵심 투자 포인트\n- RS 85 상위권\n- Phase 2 확인",
  technicalAnalysis: "## 기술적 분석\nPhase 2, RS 85",
  fundamentalTrend: "## 실적 트렌드\n4분기 연속 성장",
  valuationAnalysis: "## 밸류에이션\nP/E 28.5",
  sectorPositioning: "## 섹터 포지셔닝\nTechnology 섹터 RS 75",
  marketContext: "## 시장 맥락\nEARLY_BULL 레짐",
  riskFactors: "## 리스크\n- 밸류에이션 과열 주의",
});

function makeSuccessResponse(content: string): Anthropic.Message {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    content: [{ type: "text", text: content }],
    model: "claude-sonnet-4-6-20250725",
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: {
      input_tokens: 1_000,
      output_tokens: 500,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
  } as unknown as Anthropic.Message;
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// 테스트
// ---------------------------------------------------------------------------

describe("generateAnalysisReport", () => {
  describe("정상 케이스: LLM이 유효한 JSON을 반환할 때", () => {
    it("7개 섹션 리포트와 토큰 사용량을 반환한다", async () => {
      mockCreate.mockResolvedValue(makeSuccessResponse(VALID_REPORT_JSON));

      const { report, tokensInput, tokensOutput } = await generateAnalysisReport(
        "NVDA",
        "NVIDIA Corporation",
        MINIMAL_INPUTS,
      );

      expect(report.investmentSummary).toContain("RS 85");
      expect(report.technicalAnalysis).toContain("Phase 2");
      expect(report.fundamentalTrend).toContain("4분기");
      expect(report.valuationAnalysis).toContain("P/E 28.5");
      expect(report.sectorPositioning).toContain("Technology");
      expect(report.marketContext).toContain("EARLY_BULL");
      expect(report.riskFactors).toContain("리스크");
      expect(tokensInput).toBe(1_000);
      expect(tokensOutput).toBe(500);
    });

    it("코드 펜스로 감싼 JSON도 파싱한다", async () => {
      const wrappedJson = `\`\`\`json\n${VALID_REPORT_JSON}\n\`\`\``;
      mockCreate.mockResolvedValue(makeSuccessResponse(wrappedJson));

      const { report } = await generateAnalysisReport("NVDA", null, MINIMAL_INPUTS);

      expect(report.investmentSummary).toBeTruthy();
    });

    it("companyName이 null이어도 정상 동작한다", async () => {
      mockCreate.mockResolvedValue(makeSuccessResponse(VALID_REPORT_JSON));

      await expect(
        generateAnalysisReport("NVDA", null, MINIMAL_INPUTS),
      ).resolves.toBeDefined();
    });
  });

  describe("에러 케이스: LLM 응답 파싱 실패", () => {
    it("JSON이 아닌 응답이면 에러를 throw한다", async () => {
      mockCreate.mockResolvedValue(
        makeSuccessResponse("죄송합니다. 분석이 불가능합니다."),
      );

      await expect(
        generateAnalysisReport("NVDA", null, MINIMAL_INPUTS),
      ).rejects.toThrow("JSON 파싱 실패");
    });

    it("필드가 누락된 JSON이면 에러를 throw한다", async () => {
      const incompleteJson = JSON.stringify({
        investmentSummary: "요약",
        technicalAnalysis: "분석",
        // 나머지 5개 필드 누락
      });
      mockCreate.mockResolvedValue(makeSuccessResponse(incompleteJson));

      await expect(
        generateAnalysisReport("NVDA", null, MINIMAL_INPUTS),
      ).rejects.toThrow("리포트 필드 누락");
    });

    it("빈 응답이면 에러를 throw한다", async () => {
      mockCreate.mockResolvedValue(makeSuccessResponse(""));

      await expect(
        generateAnalysisReport("NVDA", null, MINIMAL_INPUTS),
      ).rejects.toThrow();
    });
  });

  describe("데이터 없는 섹션 처리", () => {
    it("financials가 빈 배열이어도 LLM에 전달하고 정상 반환한다", async () => {
      mockCreate.mockResolvedValue(makeSuccessResponse(VALID_REPORT_JSON));

      const inputsWithNoFinancials: AnalysisInputs = {
        ...MINIMAL_INPUTS,
        financials: [],
        ratios: null,
        marketRegime: null,
        debateSynthesis: null,
      };

      const { report } = await generateAnalysisReport("NVDA", null, inputsWithNoFinancials);
      expect(report.fundamentalTrend).toBeTruthy();
    });

    it("LLM 호출 시 단 1번만 messages.create를 호출한다", async () => {
      mockCreate.mockResolvedValue(makeSuccessResponse(VALID_REPORT_JSON));

      await generateAnalysisReport("NVDA", "NVIDIA", MINIMAL_INPUTS);

      expect(mockCreate).toHaveBeenCalledTimes(1);
    });
  });
});
