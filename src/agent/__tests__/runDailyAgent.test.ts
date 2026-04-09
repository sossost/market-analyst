/**
 * run-daily-agent — 데이터 수집 + 인사이트 생성 파이프라인 단위 테스트.
 *
 * withQAWarning / dailyQA 로직은 CLI 모드 전환 (Phase 2-B,C) 에서 제거됨.
 * LLM은 클린 JSON → fillInsightDefaults 폴백으로 대체됨.
 */

import { describe, it, expect } from "vitest";
import {
  fillInsightDefaults,
  type DailyReportInsight,
  type DailyRisingRSStock,
} from "@/tools/schemas/dailyReportSchema";
import { buildRisingRsSectorDistribution } from "../run-daily-agent";

// ────────────────────────────────────────────
// fillInsightDefaults
// ────────────────────────────────────────────

describe("fillInsightDefaults", () => {
  it("빈 객체 → 모든 필드 기본값으로 채움", () => {
    const result = fillInsightDefaults({});

    expect(result.marketTemperature).toBe("neutral");
    expect(result.marketTemperatureLabel).toBe("중립 — 관망");
    expect(result.unusualStocksNarrative).toBe("해당 없음");
    expect(result.risingRSNarrative).toBe("해당 없음");
    expect(result.watchlistNarrative).toBe("해당 없음");
    expect(result.todayInsight).toBe("해당 없음");
    expect(result.discordMessage).toBe("");
  });

  it("유효한 marketTemperature 값은 그대로 유지", () => {
    const bullish = fillInsightDefaults({ marketTemperature: "bullish" });
    const bearish = fillInsightDefaults({ marketTemperature: "bearish" });

    expect(bullish.marketTemperature).toBe("bullish");
    expect(bearish.marketTemperature).toBe("bearish");
  });

  it("유효하지 않은 marketTemperature → neutral로 폴백", () => {
    const result = fillInsightDefaults({ marketTemperature: "extreme_fear" });

    expect(result.marketTemperature).toBe("neutral");
  });

  it("제공된 문자열 필드는 유지", () => {
    const raw = {
      marketTemperature: "bearish",
      marketTemperatureLabel: "약세 — 하락 3일째",
      marketTemperatureRationale: "S&P 500이 하락하며 Phase 2 비율이 감소 중이다.",
      unusualStocksNarrative: "반도체 업종 집중 매도세.",
      risingRSNarrative: "에너지 업종 중소형주 RS 가속.",
      watchlistNarrative: "NVDA Phase 2 유지.",
      todayInsight: "토론과 일치 — 약세장 전환 신호 확인.",
      discordMessage: "📊 2026-04-06\nS&P500 -1.5%\nPhase 2: 32.1%",
    };

    const result: DailyReportInsight = fillInsightDefaults(raw);

    expect(result.marketTemperature).toBe("bearish");
    expect(result.marketTemperatureLabel).toBe("약세 — 하락 3일째");
    expect(result.unusualStocksNarrative).toBe("반도체 업종 집중 매도세.");
    expect(result.discordMessage).toBe("📊 2026-04-06\nS&P500 -1.5%\nPhase 2: 32.1%");
  });

  it("빈 문자열 필드는 기본값으로 대체되지 않음 (빈 string 허용)", () => {
    const result = fillInsightDefaults({ marketTemperatureRationale: "" });

    expect(result.marketTemperatureRationale).toBe("");
  });

  it("원본 객체를 변경하지 않는다 (불변성)", () => {
    const raw: Record<string, unknown> = { marketTemperature: "bullish" };
    fillInsightDefaults(raw);

    expect(Object.keys(raw)).toHaveLength(1);
  });
});

// ────────────────────────────────────────────
// buildRisingRsSectorDistribution
// ────────────────────────────────────────────

function makeStock(overrides: Partial<DailyRisingRSStock> = {}): DailyRisingRSStock {
  return {
    symbol: "TEST",
    phase: 2,
    rsScore: 50,
    rsScore4wAgo: null,
    rsChange: null,
    ma150Slope: null,
    pctFromLow52w: null,
    isExtremePctFromLow: false,
    volRatio: null,
    sector: null,
    industry: null,
    sectorAvgRs: null,
    sectorChange4w: null,
    sectorGroupPhase: null,
    sepaGrade: null,
    marketCap: null,
    ...overrides,
  };
}

describe("buildRisingRsSectorDistribution", () => {
  it("빈 배열 → '해당 없음' 반환", () => {
    const result = buildRisingRsSectorDistribution([]);
    expect(result).toBe("섹터 분포: 해당 없음");
  });

  it("단일 섹터 종목들 → 100% 표시", () => {
    const stocks = [
      makeStock({ sector: "Financial Services" }),
      makeStock({ sector: "Financial Services" }),
      makeStock({ sector: "Financial Services" }),
    ];
    const result = buildRisingRsSectorDistribution(stocks);
    expect(result).toBe("섹터 분포(전체 3건): Financial Services 3건(100%)");
  });

  it("복수 섹터 → 내림차순 정렬, 비율 포함", () => {
    const stocks = [
      makeStock({ sector: "Financial Services" }),
      makeStock({ sector: "Technology" }),
      makeStock({ sector: "Financial Services" }),
      makeStock({ sector: "Financial Services" }),
      makeStock({ sector: "Technology" }),
      makeStock({ sector: "Energy" }),
    ];
    const result = buildRisingRsSectorDistribution(stocks);
    expect(result).toBe(
      "섹터 분포(전체 6건): Financial Services 3건(50%), Technology 2건(33%), Energy 1건(17%)",
    );
  });

  it("null sector → 'Unknown'으로 집계", () => {
    const stocks = [
      makeStock({ sector: null }),
      makeStock({ sector: "Technology" }),
      makeStock({ sector: null }),
    ];
    const result = buildRisingRsSectorDistribution(stocks);
    expect(result).toContain("Unknown 2건");
    expect(result).toContain("Technology 1건");
  });

  it("이슈 #714 재현: 22건 Financial Services 정확 카운트", () => {
    const financialStocks = Array.from({ length: 22 }, () =>
      makeStock({ sector: "Financial Services" }),
    );
    const techStocks = Array.from({ length: 3 }, () =>
      makeStock({ sector: "Technology" }),
    );
    const otherStocks = Array.from({ length: 5 }, () =>
      makeStock({ sector: "Energy" }),
    );
    const all = [...financialStocks, ...techStocks, ...otherStocks];

    const result = buildRisingRsSectorDistribution(all);
    expect(result).toContain("전체 30건");
    expect(result).toContain("Financial Services 22건(73%)");
    expect(result).toContain("Energy 5건(17%)");
    expect(result).toContain("Technology 3건(10%)");
  });
});
