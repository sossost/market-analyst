import { describe, it, expect } from "vitest";
import { extractDataQualityVerdict, buildUserMessage } from "../fundamentalAgent.js";
import type { FundamentalScore, FundamentalInput } from "@/types/fundamental";

// --- fixtures ---

const baseScore: FundamentalScore = {
  symbol: "AAPL",
  grade: "S",
  totalScore: 4,
  rankScore: 95,
  requiredMet: 2,
  bonusMet: 2,
  criteria: {
    epsGrowth: { passed: true, value: 35, detail: "EPS YoY +35%" },
    revenueGrowth: { passed: true, value: 28, detail: "Revenue YoY +28%" },
    epsAcceleration: { passed: true, value: null, detail: "가속 확인" },
    marginExpansion: { passed: true, value: null, detail: "이익률 확대" },
    roe: { passed: true, value: 20, detail: "ROE 20%" },
  },
};

const aGradeScore: FundamentalScore = {
  ...baseScore,
  grade: "A",
  symbol: "MSFT",
};

const baseInput: FundamentalInput = {
  symbol: "AAPL",
  quarters: [
    {
      periodEndDate: "2025-03-31",
      asOfQ: "Q1 2025",
      revenue: 95_000_000_000,
      netIncome: 24_000_000_000,
      epsDiluted: 1.53,
      netMargin: 25.3,
      actualEps: null,
    },
    {
      periodEndDate: "2024-12-31",
      asOfQ: "Q4 2024",
      revenue: 124_300_000_000,
      netIncome: 36_330_000_000,
      epsDiluted: 2.4,
      netMargin: 29.2,
      actualEps: null,
    },
  ],
};

// --- extractDataQualityVerdict ---

describe("extractDataQualityVerdict", () => {
  it("인라인 JSON 포함 텍스트에서 verdict와 reason을 파싱하고 JSON을 제거한다", () => {
    const rawNarrative = `AAPL의 실적 성장은 진정한 영업 성과를 반영한다.

{"dataQualityVerdict": "CLEAN", "dataQualityReason": "분기별 매출이 일관된 성장세를 보임."}`;

    const result = extractDataQualityVerdict(rawNarrative);

    expect(result.verdict).toBe("CLEAN");
    expect(result.reason).toBe("분기별 매출이 일관된 성장세를 보임.");
    expect(result.cleanedNarrative).not.toContain("dataQualityVerdict");
    expect(result.cleanedNarrative).toContain("AAPL의 실적 성장은 진정한 영업 성과를 반영한다.");
  });

  it("SUSPECT verdict를 올바르게 파싱한다", () => {
    const rawNarrative = `매출 급변 패턴이 감지되었다.

{"dataQualityVerdict": "SUSPECT", "dataQualityReason": "Q3 2024에 매출이 10배 급증 후 다음 분기 급락 — 단위 변경 의심."}`;

    const result = extractDataQualityVerdict(rawNarrative);

    expect(result.verdict).toBe("SUSPECT");
    expect(result.reason).toContain("단위 변경 의심");
    expect(result.cleanedNarrative).not.toContain("dataQualityVerdict");
  });

  it("코드블록(```json ... ```) 안의 JSON도 정상 파싱한다", () => {
    const rawNarrative = `실적 분석 완료.

\`\`\`json
{"dataQualityVerdict": "CLEAN", "dataQualityReason": "정상 보고 패턴 확인."}
\`\`\``;

    const result = extractDataQualityVerdict(rawNarrative);

    expect(result.verdict).toBe("CLEAN");
    expect(result.reason).toBe("정상 보고 패턴 확인.");
    expect(result.cleanedNarrative).not.toContain("dataQualityVerdict");
    expect(result.cleanedNarrative).not.toContain("```json");
  });

  it("JSON이 없는 텍스트이면 CLEAN 기본값을 반환하고 원본 텍스트를 그대로 유지한다", () => {
    const rawNarrative = "펀더멘탈이 우수한 종목입니다. 성장세가 지속되고 있습니다.";

    const result = extractDataQualityVerdict(rawNarrative);

    expect(result.verdict).toBe("CLEAN");
    expect(result.reason).toBe("");
    expect(result.cleanedNarrative).toBe(rawNarrative);
  });

  it("malformed JSON이면 CLEAN 기본값을 반환하고 원본 텍스트를 그대로 유지한다", () => {
    const rawNarrative = `분석 완료.

{"dataQualityVerdict": "CLEAN", "dataQualityReason": }`;

    const result = extractDataQualityVerdict(rawNarrative);

    expect(result.verdict).toBe("CLEAN");
    expect(result.reason).toBe("");
    expect(result.cleanedNarrative).toBe(rawNarrative);
  });

  it("dataQualityVerdict 키가 없는 JSON이면 CLEAN 기본값을 반환한다", () => {
    const rawNarrative = `분석 완료.

{"someOtherKey": "value"}`;

    const result = extractDataQualityVerdict(rawNarrative);

    expect(result.verdict).toBe("CLEAN");
    expect(result.reason).toBe("");
    expect(result.cleanedNarrative).toBe(rawNarrative);
  });
});

// --- buildUserMessage ---

describe("buildUserMessage", () => {
  it("isTopGrade=true일 때 데이터 품질 검증 섹션이 포함된다", () => {
    const message = buildUserMessage(baseScore, baseInput, undefined, true);

    expect(message).toContain("데이터 품질 검증 (필수)");
    expect(message).toContain("누적 보고 의심");
    expect(message).toContain("dataQualityVerdict");
    expect(message).toContain("dataQualityReason");
  });

  it("isTopGrade=false일 때 데이터 품질 검증 섹션이 포함되지 않는다", () => {
    const message = buildUserMessage(aGradeScore, baseInput, undefined, false);

    expect(message).not.toContain("데이터 품질 검증 (필수)");
    expect(message).not.toContain("dataQualityVerdict");
  });

  it("isTopGrade 미전달(undefined)일 때 데이터 품질 검증 섹션이 포함되지 않는다", () => {
    const message = buildUserMessage(aGradeScore, baseInput);

    expect(message).not.toContain("데이터 품질 검증 (필수)");
  });

  it("S급 메시지에 S등급 심층 분석 지시가 포함된다", () => {
    const message = buildUserMessage(baseScore, baseInput, undefined, true);

    expect(message).toContain("S등급");
  });

  it("비S급 메시지에 2-3문단 분석 지시가 포함된다", () => {
    const message = buildUserMessage(aGradeScore, baseInput, undefined, false);

    expect(message).toContain("2-3문단");
  });
});
