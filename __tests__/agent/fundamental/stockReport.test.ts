import { describe, it, expect } from "vitest";
import { generateStockReport } from "../../../src/agent/fundamental/stockReport.js";
import type { FundamentalScore, FundamentalInput, QuarterlyData } from "../../../src/types/fundamental.js";
import type { StockReportContext } from "../../../src/agent/fundamental/stockReport.js";

function makeScore(overrides: Partial<FundamentalScore> = {}): FundamentalScore {
  return {
    symbol: "NVDA",
    grade: "A",
    totalScore: 100,
    requiredMet: 2,
    bonusMet: 2,
    criteria: {
      epsGrowth: { passed: true, value: 142, detail: "EPS YoY +142%" },
      revenueGrowth: { passed: true, value: 95, detail: "매출 YoY +95%" },
      epsAcceleration: { passed: true, value: 142, detail: "EPS 가속: 142% → 131% → 118%" },
      marginExpansion: { passed: true, value: 65, detail: "이익률 확대: 45% → 50% → 53% → 65%" },
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

describe("generateStockReport", () => {
  it("generates markdown with all sections", () => {
    const ctx: StockReportContext = {
      score: makeScore(),
      input: makeInput(),
      narrative: "AI 인프라 capex 사이클의 핵심 수혜주.",
      technical: {
        phase: 2,
        rsScore: 95,
        volumeConfirmed: true,
        pctFromHigh52w: -5.2,
        marketCapB: 2800.5,
        sector: "Technology",
        industry: "Semiconductors",
      },
    };

    const report = generateStockReport(ctx);

    expect(report).toContain("[NVDA] 종목 심층 분석");
    expect(report).toContain("등급: **A**");
    expect(report).toContain("기술적 현황");
    expect(report).toContain("Phase 2, RS 95");
    expect(report).toContain("펀더멘탈 분석");
    expect(report).toContain("EPS YoY +142%");
    expect(report).toContain("분기별 실적");
    expect(report).toContain("Q4 2025");
    expect(report).toContain("$35.1B");
    expect(report).toContain("펀더멘탈 장관 분석");
    expect(report).toContain("AI 인프라 capex");
    expect(report).toContain("종합 판단");
    expect(report).toContain("슈퍼퍼포머 후보");
  });

  it("works without technical data", () => {
    const ctx: StockReportContext = {
      score: makeScore(),
      input: makeInput(),
      narrative: "실적 분석 내용",
    };

    const report = generateStockReport(ctx);

    expect(report).not.toContain("기술적 현황");
    expect(report).toContain("펀더멘탈 분석");
    expect(report).toContain("종합 판단");
  });

  it("shows correct emoji for criteria pass/fail", () => {
    const ctx: StockReportContext = {
      score: makeScore({
        criteria: {
          epsGrowth: { passed: true, value: 50, detail: "EPS YoY +50%" },
          revenueGrowth: { passed: false, value: 10, detail: "매출 YoY +10%" },
          epsAcceleration: { passed: false, value: null, detail: "미충족" },
          marginExpansion: { passed: true, value: 20, detail: "확대" },
          roe: { passed: false, value: null, detail: "N/A" },
        },
      }),
      input: makeInput(),
      narrative: "분석",
    };

    const report = generateStockReport(ctx);

    expect(report).toContain("✅ | EPS YoY +50%");
    expect(report).toContain("❌ | 매출 YoY +10%");
  });

  it("handles B grade summary", () => {
    const ctx: StockReportContext = {
      score: makeScore({ grade: "B" }),
      input: makeInput(),
      narrative: "양호한 실적",
    };

    const report = generateStockReport(ctx);

    expect(report).toContain("추가 가속 여부 모니터링");
  });
});
