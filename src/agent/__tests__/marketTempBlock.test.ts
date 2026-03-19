import { describe, it, expect, vi } from "vitest";

// Mock the DB-dependent module before importing
vi.mock("../debate/marketDataLoader.js", () => ({
  loadMarketSnapshot: vi.fn(),
}));

import { formatMarketTempBlock } from "../marketTempBlock.js";
import type { MarketSnapshot } from "../debate/marketDataLoader.js";

function createFullSnapshot(overrides?: Partial<MarketSnapshot>): MarketSnapshot {
  return {
    date: "2026-03-10",
    sectors: [],
    newPhase2Stocks: [],
    topPhase2Stocks: [],
    indices: [
      { name: "S&P 500", close: 5123.45, changePercent: 1.23 },
      { name: "NASDAQ", close: 16789.01, changePercent: 0.85 },
      { name: "DOW 30", close: 38456.78, changePercent: -0.32 },
      { name: "Russell 2000", close: 2045.67, changePercent: 0.56 },
      { name: "VIX", close: 18.45, changePercent: -3.21 },
    ],
    breadth: {
      totalStocks: 5000,
      phaseDistribution: { phase1: 1500, phase2: 1750, phase3: 1000, phase4: 750 },
      phase2Ratio: 35.0,
      phase2RatioChange: 1.5,
      marketAvgRs: 48.2,
      advancers: 2800,
      decliners: 1900,
      adRatio: 1.47,
      newHighs: 85,
      newLows: 32,
    },
    fearGreed: {
      score: 42,
      rating: "Fear",
      previousClose: 38,
      previous1Week: 45,
    },
    ...overrides,
  };
}

describe("formatMarketTempBlock", () => {
  it("정상 snapshot — 모든 필드 존재 시 지수/공포탐욕/Phase2/A-D 포함 출력", () => {
    const snapshot = createFullSnapshot();
    const result = formatMarketTempBlock(snapshot);

    expect(result).toContain("📊 시장 일일 브리핑 (2026-03-10)");
    expect(result).toContain("📈 지수 등락");
    expect(result).toContain("S&P 500: 5,123.45 (+1.23%)");
    expect(result).toContain("NASDAQ: 16,789.01 (+0.85%)");
    expect(result).toContain("DOW: 38,456.78 (-0.32%)");
    expect(result).toContain("Russell: 2,045.67 (+0.56%)");
    expect(result).toContain("VIX: 18.45 (-3.21%)");
    expect(result).toContain("😨 공포탐욕: 42 (Fear) | 전일 38 | 1주전 45");
    expect(result).toContain("🌡️ 시장 온도 데이터");
    expect(result).toContain("Phase 2: 35% (▲1.5%p) | 시장 평균 RS: 48.2");
    expect(result).toContain("A/D: 2,800:1,900 (1.47)");
    expect(result).toContain("신고가 85 / 신저가 32");
    expect(result).toContain("📭 오늘은 특별한 시장 신호 없음");
  });

  it("indices 빈 배열 — 지수 행 생략, 나머지 정상 출력", () => {
    const snapshot = createFullSnapshot({ indices: [] });
    const result = formatMarketTempBlock(snapshot);

    expect(result).not.toContain("📈 지수 등락");
    expect(result).not.toContain("S&P 500");
    expect(result).toContain("😨 공포탐욕");
    expect(result).toContain("🌡️ 시장 온도 데이터");
    expect(result).toContain("📭 오늘은 특별한 시장 신호 없음");
  });

  it("fearGreed null — 공포탐욕 행 생략", () => {
    const snapshot = createFullSnapshot({ fearGreed: null });
    const result = formatMarketTempBlock(snapshot);

    expect(result).not.toContain("😨 공포탐욕");
    expect(result).toContain("📈 지수 등락");
    expect(result).toContain("🌡️ 시장 온도 데이터");
  });

  it("breadth null — Phase2/A-D 행 생략", () => {
    const snapshot = createFullSnapshot({ breadth: null });
    const result = formatMarketTempBlock(snapshot);

    expect(result).not.toContain("🌡️ 시장 온도 데이터");
    expect(result).not.toContain("Phase 2:");
    expect(result).not.toContain("A/D:");
    expect(result).toContain("📈 지수 등락");
    expect(result).toContain("📭 오늘은 특별한 시장 신호 없음");
  });

  it("phase2RatioChange 양수 — ▲ 표시", () => {
    const snapshot = createFullSnapshot({
      breadth: {
        ...createFullSnapshot().breadth!,
        phase2RatioChange: 2.3,
      },
    });
    const result = formatMarketTempBlock(snapshot);

    expect(result).toContain("▲2.3%p");
  });

  it("phase2RatioChange 음수 — ▼ 표시", () => {
    const snapshot = createFullSnapshot({
      breadth: {
        ...createFullSnapshot().breadth!,
        phase2RatioChange: -1.8,
      },
    });
    const result = formatMarketTempBlock(snapshot);

    expect(result).toContain("▼1.8%p");
  });

  it("phase2RatioChange 0 — - 표시", () => {
    const snapshot = createFullSnapshot({
      breadth: {
        ...createFullSnapshot().breadth!,
        phase2RatioChange: 0,
      },
    });
    const result = formatMarketTempBlock(snapshot);

    expect(result).toContain("Phase 2: 35% (-) | 시장 평균 RS:");
  });

  it("phase2Ratio null — N/A 표시 (이중 변환 감지 시)", () => {
    const snapshot = createFullSnapshot({
      breadth: {
        ...createFullSnapshot().breadth!,
        phase2Ratio: null,
      },
    });
    const result = formatMarketTempBlock(snapshot);

    expect(result).toContain("Phase 2: N/A");
    expect(result).not.toContain("Phase 2: null%");
  });

  it("모든 선택 필드 null — 헤더와 특별한 시장 신호 없음 행만 출력", () => {
    const snapshot = createFullSnapshot({
      indices: [],
      fearGreed: null,
      breadth: null,
    });
    const result = formatMarketTempBlock(snapshot);

    expect(result).toContain("📊 시장 일일 브리핑 (2026-03-10)");
    expect(result).toContain("📭 오늘은 특별한 시장 신호 없음");
    expect(result).not.toContain("📈 지수 등락");
    expect(result).not.toContain("😨 공포탐욕");
    expect(result).not.toContain("🌡️ 시장 온도 데이터");
  });
});
