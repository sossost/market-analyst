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
} from "@/tools/schemas/dailyReportSchema";

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
