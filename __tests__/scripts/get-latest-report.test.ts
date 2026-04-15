import { describe, it, expect } from "vitest";
import {
  formatReportedSymbols,
  formatMarketSummary,
  buildFallbackContent,
} from "@/scripts/get-latest-report";
import type {
  ReportedSymbol,
  MarketSummary,
} from "@/scripts/get-latest-report";

// ── Helper ──

function createSymbol(overrides: Partial<ReportedSymbol> = {}): ReportedSymbol {
  return {
    symbol: "AAPL",
    phase: 2,
    rsScore: 90,
    sector: "Technology",
    reason: "RS 상승 + 거래량 확인",
    ...overrides,
  };
}

function createSummary(overrides: Partial<MarketSummary> = {}): MarketSummary {
  return {
    phase2Ratio: 35,
    leadingSectors: ["Technology", "Healthcare"],
    totalAnalyzed: 500,
    ...overrides,
  };
}

// ── formatReportedSymbols ──

describe("formatReportedSymbols", () => {
  it("종목 배열을 마크다운 형식으로 포맷한다", () => {
    const symbols = [
      createSymbol({ symbol: "AAPL", phase: 2, rsScore: 90, sector: "Technology", reason: "강한 모멘텀" }),
      createSymbol({ symbol: "NVDA", phase: 2, rsScore: 95, sector: "Semiconductors", reason: "AI 수요 급증" }),
    ];

    const result = formatReportedSymbols(symbols);

    expect(result).toContain("## 추천 종목 (2건)");
    expect(result).toContain("**AAPL**");
    expect(result).toContain("Phase 2");
    expect(result).toContain("RS 90");
    expect(result).toContain("Technology");
    expect(result).toContain("강한 모멘텀");
    expect(result).toContain("**NVDA**");
    expect(result).toContain("RS 95");
    expect(result).toContain("AI 수요 급증");
  });

  it("빈 배열이면 '추천 종목 없음'을 반환한다", () => {
    const result = formatReportedSymbols([]);

    expect(result).toBe("추천 종목 없음");
  });

  it("종목 1건일 때 건수를 정확히 표시한다", () => {
    const symbols = [createSymbol()];

    const result = formatReportedSymbols(symbols);

    expect(result).toContain("## 추천 종목 (1건)");
  });

  it("각 종목을 줄바꿈으로 구분한다", () => {
    const symbols = [
      createSymbol({ symbol: "AAPL" }),
      createSymbol({ symbol: "MSFT" }),
    ];

    const result = formatReportedSymbols(symbols);
    const lines = result.split("\n");

    // 헤더(1줄) + 빈줄(1줄) + 종목1(2줄: 요약+사유) + 종목2(2줄)
    expect(lines.length).toBeGreaterThanOrEqual(5);
  });
});

// ── formatMarketSummary ──

describe("formatMarketSummary", () => {
  it("시장 요약을 마크다운 형식으로 포맷한다", () => {
    const summary = createSummary({
      phase2Ratio: 35,
      leadingSectors: ["Technology", "Healthcare"],
      totalAnalyzed: 500,
    });

    const result = formatMarketSummary(summary);

    expect(result).toContain("## 시장 요약");
    expect(result).toContain("Phase 2 비율: 35.0%");
    expect(result).toContain("주도 섹터: Technology, Healthcare");
    expect(result).toContain("분석 대상: 500개 종목");
  });

  it("주도 섹터가 없으면 '없음'으로 표시한다", () => {
    const summary = createSummary({ leadingSectors: [] });

    const result = formatMarketSummary(summary);

    expect(result).toContain("주도 섹터: 없음");
  });

  it("Phase 2 비율 0.0%를 정확히 표시한다", () => {
    const summary = createSummary({ phase2Ratio: 0 });

    const result = formatMarketSummary(summary);

    expect(result).toContain("Phase 2 비율: 0.0%");
  });

  it("Phase 2 비율 100%를 정확히 표시한다", () => {
    const summary = createSummary({ phase2Ratio: 100 });

    const result = formatMarketSummary(summary);

    expect(result).toContain("Phase 2 비율: 100.0%");
  });

  it("주도 섹터 1개일 때 쉼표 없이 표시한다", () => {
    const summary = createSummary({ leadingSectors: ["Energy"] });

    const result = formatMarketSummary(summary);

    expect(result).toContain("주도 섹터: Energy");
    expect(result).not.toContain(",");
  });
});

// ── buildFallbackContent ──

describe("buildFallbackContent", () => {
  it("시장 요약과 추천 종목을 결합한 대체 텍스트를 생성한다", () => {
    const symbols = [createSymbol({ symbol: "AAPL" })];
    const summary = createSummary();

    const result = buildFallbackContent(symbols, summary);

    expect(result).toContain("## 시장 요약");
    expect(result).toContain("## 추천 종목 (1건)");
    expect(result).toContain("**AAPL**");
  });

  it("종목이 없으면 시장 요약 + '추천 종목 없음'을 포함한다", () => {
    const summary = createSummary();

    const result = buildFallbackContent([], summary);

    expect(result).toContain("## 시장 요약");
    expect(result).toContain("추천 종목 없음");
    expect(result).not.toContain("## 추천 종목");
  });

  it("시장 요약이 추천 종목보다 앞에 위치한다", () => {
    const symbols = [createSymbol()];
    const summary = createSummary();

    const result = buildFallbackContent(symbols, summary);

    const summaryIndex = result.indexOf("## 시장 요약");
    const symbolsIndex = result.indexOf("## 추천 종목");

    expect(summaryIndex).toBeLessThan(symbolsIndex);
  });
});
