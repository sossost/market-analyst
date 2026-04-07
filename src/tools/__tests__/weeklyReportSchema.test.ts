import { describe, it, expect } from "vitest";
import {
  validateWeeklyReportInsight,
  fillInsightDefaults,
} from "@/tools/schemas/weeklyReportSchema.js";

// ─── 팩토리 함수 ──────────────────────────────────────────────────────────────

function createValidRaw(): Record<string, unknown> {
  return {
    marketTemperature: "neutral",
    marketTemperatureLabel: "중립 — 관망",
    sectorRotationNarrative: "섹터 로테이션 해석",
    industryFlowNarrative: "업종 자금 흐름 해석",
    watchlistNarrative: "관심종목 서사",
    gate5Summary: "5중 게이트 요약",
    riskFactors: "리스크 요인",
    nextWeekWatchpoints: "다음 주 관전 포인트",
    thesisScenarios: "thesis 시나리오",
    debateInsight: "토론 인사이트",
    narrativeEvolution: "서사 체인 진화",
    thesisAccuracy: "thesis 적중률",
    regimeContext: "레짐 맥락",
    discordMessage: "Discord 핵심 요약",
  };
}

// ─── validateWeeklyReportInsight ──────────────────────────────────────────────

describe("validateWeeklyReportInsight", () => {
  it("모든 필드가 존재하면 true를 반환한다", () => {
    const raw = createValidRaw();

    expect(validateWeeklyReportInsight(raw)).toBe(true);
  });

  it("marketTemperature 누락 시 false를 반환한다", () => {
    const raw = createValidRaw();
    delete raw["marketTemperature"];

    expect(validateWeeklyReportInsight(raw)).toBe(false);
  });

  it("marketTemperatureLabel 누락 시 false를 반환한다", () => {
    const raw = createValidRaw();
    delete raw["marketTemperatureLabel"];

    expect(validateWeeklyReportInsight(raw)).toBe(false);
  });

  it("sectorRotationNarrative 누락 시 false를 반환한다", () => {
    const raw = createValidRaw();
    delete raw["sectorRotationNarrative"];

    expect(validateWeeklyReportInsight(raw)).toBe(false);
  });

  it("industryFlowNarrative 누락 시 false를 반환한다", () => {
    const raw = createValidRaw();
    delete raw["industryFlowNarrative"];

    expect(validateWeeklyReportInsight(raw)).toBe(false);
  });

  it("watchlistNarrative 누락 시 false를 반환한다", () => {
    const raw = createValidRaw();
    delete raw["watchlistNarrative"];

    expect(validateWeeklyReportInsight(raw)).toBe(false);
  });

  it("gate5Summary 누락 시 false를 반환한다", () => {
    const raw = createValidRaw();
    delete raw["gate5Summary"];

    expect(validateWeeklyReportInsight(raw)).toBe(false);
  });

  it("riskFactors 누락 시 false를 반환한다", () => {
    const raw = createValidRaw();
    delete raw["riskFactors"];

    expect(validateWeeklyReportInsight(raw)).toBe(false);
  });

  it("nextWeekWatchpoints 누락 시 false를 반환한다", () => {
    const raw = createValidRaw();
    delete raw["nextWeekWatchpoints"];

    expect(validateWeeklyReportInsight(raw)).toBe(false);
  });

  it("thesisScenarios 누락 시 false를 반환한다", () => {
    const raw = createValidRaw();
    delete raw["thesisScenarios"];

    expect(validateWeeklyReportInsight(raw)).toBe(false);
  });

  it("regimeContext 누락 시 false를 반환한다", () => {
    const raw = createValidRaw();
    delete raw["regimeContext"];

    expect(validateWeeklyReportInsight(raw)).toBe(false);
  });

  it("discordMessage 누락 시 false를 반환한다", () => {
    const raw = createValidRaw();
    delete raw["discordMessage"];

    expect(validateWeeklyReportInsight(raw)).toBe(false);
  });

  it("marketTemperature가 잘못된 값이면 false를 반환한다", () => {
    const raw = createValidRaw();
    raw["marketTemperature"] = "hot";

    expect(validateWeeklyReportInsight(raw)).toBe(false);
  });

  it("marketTemperature가 숫자이면 false를 반환한다", () => {
    const raw = createValidRaw();
    raw["marketTemperature"] = 42;

    expect(validateWeeklyReportInsight(raw)).toBe(false);
  });

  it("marketTemperature가 'bullish'이면 true를 반환한다", () => {
    const raw = createValidRaw();
    raw["marketTemperature"] = "bullish";

    expect(validateWeeklyReportInsight(raw)).toBe(true);
  });

  it("marketTemperature가 'bearish'이면 true를 반환한다", () => {
    const raw = createValidRaw();
    raw["marketTemperature"] = "bearish";

    expect(validateWeeklyReportInsight(raw)).toBe(true);
  });

  it("marketTemperatureLabel이 빈 문자열이면 false를 반환한다", () => {
    const raw = createValidRaw();
    raw["marketTemperatureLabel"] = "";

    expect(validateWeeklyReportInsight(raw)).toBe(false);
  });

  it("sectorRotationNarrative가 빈 문자열이면 false를 반환한다", () => {
    const raw = createValidRaw();
    raw["sectorRotationNarrative"] = "";

    expect(validateWeeklyReportInsight(raw)).toBe(false);
  });

  it("discordMessage가 빈 문자열이면 false를 반환한다", () => {
    const raw = createValidRaw();
    raw["discordMessage"] = "";

    expect(validateWeeklyReportInsight(raw)).toBe(false);
  });

  it("필드 값이 null이면 false를 반환한다", () => {
    const raw = createValidRaw();
    raw["sectorRotationNarrative"] = null;

    expect(validateWeeklyReportInsight(raw)).toBe(false);
  });

  it("필드 값이 undefined이면 false를 반환한다", () => {
    const raw = createValidRaw();
    raw["watchlistNarrative"] = undefined;

    expect(validateWeeklyReportInsight(raw)).toBe(false);
  });

  it("빈 객체이면 false를 반환한다", () => {
    expect(validateWeeklyReportInsight({})).toBe(false);
  });
});

// ─── fillInsightDefaults ──────────────────────────────────────────────────────

describe("fillInsightDefaults", () => {
  it("모든 필드가 존재하면 원본 값을 유지한다", () => {
    const raw = createValidRaw();
    raw["marketTemperature"] = "bullish";
    raw["marketTemperatureLabel"] = "강세 — 적극 매수";

    const result = fillInsightDefaults(raw);

    expect(result.marketTemperature).toBe("bullish");
    expect(result.marketTemperatureLabel).toBe("강세 — 적극 매수");
    expect(result.sectorRotationNarrative).toBe("섹터 로테이션 해석");
    expect(result.discordMessage).toBe("Discord 핵심 요약");
  });

  it("marketTemperature 누락 시 neutral 기본값으로 채운다", () => {
    const raw = createValidRaw();
    delete raw["marketTemperature"];

    const result = fillInsightDefaults(raw);

    expect(result.marketTemperature).toBe("neutral");
  });

  it("marketTemperatureLabel 누락 시 기본값으로 채운다", () => {
    const raw = createValidRaw();
    delete raw["marketTemperatureLabel"];

    const result = fillInsightDefaults(raw);

    expect(result.marketTemperatureLabel).toBe("중립 — 관망");
  });

  it("sectorRotationNarrative 누락 시 빈 문자열 기본값을 채운다", () => {
    const raw = createValidRaw();
    delete raw["sectorRotationNarrative"];

    const result = fillInsightDefaults(raw);

    expect(result.sectorRotationNarrative).toBe("");
  });

  it("industryFlowNarrative 누락 시 빈 문자열 기본값을 채운다", () => {
    const raw = createValidRaw();
    delete raw["industryFlowNarrative"];

    const result = fillInsightDefaults(raw);

    expect(result.industryFlowNarrative).toBe("");
  });

  it("gate5Summary 누락 시 빈 문자열 기본값을 채운다", () => {
    const raw = createValidRaw();
    delete raw["gate5Summary"];

    const result = fillInsightDefaults(raw);

    expect(result.gate5Summary).toBe("");
  });

  it("riskFactors 누락 시 빈 문자열 기본값을 채운다", () => {
    const raw = createValidRaw();
    delete raw["riskFactors"];

    const result = fillInsightDefaults(raw);

    expect(result.riskFactors).toBe("");
  });

  it("discordMessage 누락 시 빈 문자열 기본값을 채운다", () => {
    const raw = createValidRaw();
    delete raw["discordMessage"];

    const result = fillInsightDefaults(raw);

    expect(result.discordMessage).toBe("");
  });

  it("marketTemperature가 잘못된 값이면 neutral로 폴백한다", () => {
    const raw = createValidRaw();
    raw["marketTemperature"] = "scorching";

    const result = fillInsightDefaults(raw);

    expect(result.marketTemperature).toBe("neutral");
  });

  it("marketTemperature가 null이면 neutral로 폴백한다", () => {
    const raw = createValidRaw();
    raw["marketTemperature"] = null;

    const result = fillInsightDefaults(raw);

    expect(result.marketTemperature).toBe("neutral");
  });

  it("marketTemperatureLabel이 빈 문자열이면 기본값으로 교체한다", () => {
    const raw = createValidRaw();
    raw["marketTemperatureLabel"] = "";

    const result = fillInsightDefaults(raw);

    expect(result.marketTemperatureLabel).toBe("중립 — 관망");
  });

  it("텍스트 필드가 문자열이 아니면 기본값으로 교체한다", () => {
    const raw = createValidRaw();
    raw["sectorRotationNarrative"] = 12345;

    const result = fillInsightDefaults(raw);

    expect(result.sectorRotationNarrative).toBe("");
  });

  it("빈 객체이면 모든 필드에 기본값을 채운다", () => {
    const result = fillInsightDefaults({});

    expect(result.marketTemperature).toBe("neutral");
    expect(result.marketTemperatureLabel).toBe("중립 — 관망");
    expect(result.sectorRotationNarrative).toBe("");
    expect(result.industryFlowNarrative).toBe("");
    expect(result.watchlistNarrative).toBe("");
    expect(result.gate5Summary).toBe("");
    expect(result.riskFactors).toBe("");
    expect(result.nextWeekWatchpoints).toBe("");
    expect(result.thesisScenarios).toBe("");
    expect(result.breadthNarrative).toBe("");
    expect(result.regimeContext).toBe("");
    expect(result.discordMessage).toBe("");
  });

  it("breadthNarrative 존재 시 원본 값을 유지한다", () => {
    const raw = createValidRaw();
    raw["breadthNarrative"] = "시장 폭 확장 중";

    const result = fillInsightDefaults(raw);

    expect(result.breadthNarrative).toBe("시장 폭 확장 중");
  });

  it("breadthNarrative 누락 시 빈 문자열 기본값을 채운다", () => {
    const raw = createValidRaw();

    const result = fillInsightDefaults(raw);

    expect(result.breadthNarrative).toBe("");
  });

  it("반환 타입이 WeeklyReportInsight 구조를 만족한다", () => {
    const result = fillInsightDefaults(createValidRaw());

    expect(typeof result.marketTemperature).toBe("string");
    expect(typeof result.marketTemperatureLabel).toBe("string");
    expect(typeof result.sectorRotationNarrative).toBe("string");
    expect(typeof result.industryFlowNarrative).toBe("string");
    expect(typeof result.watchlistNarrative).toBe("string");
    expect(typeof result.gate5Summary).toBe("string");
    expect(typeof result.riskFactors).toBe("string");
    expect(typeof result.nextWeekWatchpoints).toBe("string");
    expect(typeof result.thesisScenarios).toBe("string");
    expect(typeof result.regimeContext).toBe("string");
    expect(typeof result.discordMessage).toBe("string");
  });
});
