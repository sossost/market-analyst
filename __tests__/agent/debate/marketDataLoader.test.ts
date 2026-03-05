import { describe, it, expect } from "vitest";
import { formatMarketSnapshot, type MarketSnapshot } from "../../../src/agent/debate/marketDataLoader.js";

function createSnapshot(overrides: Partial<MarketSnapshot> = {}): MarketSnapshot {
  return {
    date: "2026-03-05",
    sectors: [],
    newPhase2Stocks: [],
    topPhase2Stocks: [],
    breadth: null,
    indices: [],
    fearGreed: null,
    ...overrides,
  };
}

describe("formatMarketSnapshot", () => {
  it("returns empty string when no data available", () => {
    const result = formatMarketSnapshot(createSnapshot());
    expect(result).toBe("");
  });

  it("includes index data when available", () => {
    const result = formatMarketSnapshot(
      createSnapshot({
        indices: [
          { name: "S&P 500", close: 5200.5, changePercent: 1.23 },
          { name: "VIX", close: 18.5, changePercent: -3.2 },
        ],
      }),
    );

    expect(result).toContain("S&P 500: 5,200.5 (+1.23%)");
    expect(result).toContain("VIX: 18.5 (-3.2%)");
    expect(result).toContain("실제 시장 데이터");
  });

  it("includes fear & greed data", () => {
    const result = formatMarketSnapshot(
      createSnapshot({
        indices: [{ name: "S&P 500", close: 5200, changePercent: 0 }],
        fearGreed: { score: 35, rating: "Fear" },
      }),
    );

    expect(result).toContain("공포탐욕지수: 35 (Fear)");
  });

  it("includes market breadth", () => {
    const result = formatMarketSnapshot(
      createSnapshot({
        breadth: {
          totalStocks: 1000,
          phaseDistribution: { phase1: 200, phase2: 300, phase3: 350, phase4: 150 },
          phase2Ratio: 30,
          phase2RatioChange: 1.5,
          marketAvgRs: 50,
        },
      }),
    );

    expect(result).toContain("총 1000종목");
    expect(result).toContain("Phase 2 비율: 30%");
    expect(result).toContain("+1.5%p");
    expect(result).toContain("시장 평균 RS: 50");
  });

  it("includes sector RS ranking", () => {
    const result = formatMarketSnapshot(
      createSnapshot({
        sectors: [
          {
            sector: "Technology",
            avgRs: 75,
            rsRank: 1,
            groupPhase: 2,
            prevGroupPhase: 1,
            change4w: 5.2,
            change12w: null,
            phase2Ratio: 45,
            phase1to2Count5d: 12,
          },
          {
            sector: "Healthcare",
            avgRs: 65,
            rsRank: 2,
            groupPhase: 2,
            prevGroupPhase: 2,
            change4w: 2.1,
            change12w: null,
            phase2Ratio: 35,
            phase1to2Count5d: 5,
          },
        ],
      }),
    );

    expect(result).toContain("Technology: RS 75");
    expect(result).toContain("Phase 1->2");
    expect(result).toContain("Phase2 비율 45%");
    expect(result).toContain("5일 1->2 전환 12건");
  });

  it("includes new Phase 2 entries with 52w high and market cap context", () => {
    const result = formatMarketSnapshot(
      createSnapshot({
        newPhase2Stocks: [
          {
            symbol: "NVDA",
            rsScore: 95,
            prevPhase: 1,
            sector: "Technology",
            industry: "Semiconductors",
            volumeConfirmed: true,
            pctFromHigh52w: -5.2,
            marketCapB: 2800.5,
          },
          {
            symbol: "ACME",
            rsScore: 88,
            prevPhase: 1,
            sector: "Industrials",
            industry: "Machinery",
            volumeConfirmed: false,
            pctFromHigh52w: -45.0,
            marketCapB: 1.2,
          },
        ],
      }),
    );

    expect(result).toContain("NVDA (RS 95, 고점 대비 -5.2%, 시총 $2800.5B");
    expect(result).toContain("[거래량 확인]");
    expect(result).toContain("ACME (RS 88, 고점 대비 -45%");
    expect(result).toContain("신규 상승 전환 진입 종목 (2건");
    expect(result).toContain("시총 $3억 이상");
    expect(result).toContain("바닥 반등일 수 있으니");
  });

  it("includes top Phase 2 stocks with market cap", () => {
    const result = formatMarketSnapshot(
      createSnapshot({
        topPhase2Stocks: [
          {
            symbol: "MSFT",
            rsScore: 90,
            prevPhase: 2,
            sector: "Technology",
            industry: "Software",
            volumeConfirmed: false,
            pctFromHigh52w: -8.1,
            marketCapB: 3100.0,
          },
        ],
      }),
    );

    expect(result).toContain("상승 초입 RS 상위 종목");
    expect(result).toContain("MSFT (RS 90, 고점 대비 -8.1%, 시총 $3100B");
  });

  it("warns not to estimate prices", () => {
    const result = formatMarketSnapshot(
      createSnapshot({
        indices: [{ name: "S&P 500", close: 5200, changePercent: 0 }],
      }),
    );

    expect(result).toContain("절대 추정하지 마세요");
  });

  it("shows negative breadth change correctly", () => {
    const result = formatMarketSnapshot(
      createSnapshot({
        breadth: {
          totalStocks: 500,
          phaseDistribution: { phase1: 100, phase2: 100, phase3: 200, phase4: 100 },
          phase2Ratio: 20,
          phase2RatioChange: -2.3,
          marketAvgRs: 45,
        },
      }),
    );

    expect(result).toContain("-2.3%p");
  });
});
