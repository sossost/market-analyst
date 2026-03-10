import { describe, expect, it } from "vitest";
import { validateReport } from "../reportValidator";

describe("validateReport", () => {
  // -------------------------------------------------------------------------
  // A. 리스크 키워드 존재 여부
  // -------------------------------------------------------------------------

  it("리스크 키워드가 포함된 정상 리포트 → isValid: true, warnings/errors 비어있음", () => {
    const result = validateReport({
      markdown:
        "반도체 섹터가 상승세를 보이고 있으나, 밸류에이션 과열 리스크와 하락 가능성에 주의가 필요합니다.",
    });

    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  it("리스크 키워드가 전혀 없는 리포트 → errors에 경고 메시지 포함", () => {
    const result = validateReport({
      markdown:
        "반도체 섹터가 강세를 보이며 신고가를 돌파했습니다. 성장 전망이 매우 긍정적입니다.",
    });

    expect(result.isValid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("리스크 관련 키워드가 전혀 없습니다");
  });

  it("bull-bias 90% 리포트 → warnings에 bias 경고 포함", () => {
    // bull 9개 키워드, bear 1개 키워드 → 90%
    const result = validateReport({
      markdown:
        "상승 급등 돌파 신고가 강세 긍정 호재 성장 개선 — 다만 약간의 리스크 존재.",
    });

    expect(result.isValid).toBe(true);
    expect(result.warnings.length).toBeGreaterThanOrEqual(1);
    expect(result.warnings.some((w) => w.includes("Bull-bias"))).toBe(true);
    expect(result.warnings.some((w) => w.includes("90%"))).toBe(true);
  });

  it("bull-bias 80% 이하면 bias 경고 없음", () => {
    // bull 4개, bear 1개 → 80% (threshold 초과가 아니므로 경고 없음)
    const result = validateReport({
      markdown: "상승 돌파 강세 성장 — 하락 위험도 있다.",
    });

    const biasWarning = result.warnings.find((w) => w.includes("Bull-bias"));
    expect(biasWarning).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // B. 섹터-종목 정합성
  // -------------------------------------------------------------------------

  it("섹터 완전 불일치 → warnings에 불일치 경고 포함", () => {
    const result = validateReport({
      markdown: "시장 분석 리포트. 리스크 주의 필요.",
      leadingSectors: ["반도체", "AI"],
      recommendations: [
        { symbol: "XOM", sector: "에너지" },
        { symbol: "JPM", sector: "금융" },
      ],
    });

    expect(result.warnings.some((w) => w.includes("섹터-종목 불일치"))).toBe(true);
  });

  it("섹터 부분 일치 → 불일치 경고 없음", () => {
    const result = validateReport({
      markdown: "시장 분석 리포트. 리스크 주의 필요.",
      leadingSectors: ["반도체", "AI"],
      recommendations: [
        { symbol: "NVDA", sector: "반도체" },
        { symbol: "XOM", sector: "에너지" },
      ],
    });

    const sectorWarning = result.warnings.find((w) =>
      w.includes("섹터-종목 불일치"),
    );
    expect(sectorWarning).toBeUndefined();
  });

  it("leadingSectors만 있고 recommendations 없으면 섹터 체크 스킵", () => {
    const result = validateReport({
      markdown: "시장 분석 리포트. 리스크 주의 필요.",
      leadingSectors: ["반도체"],
    });

    const sectorWarning = result.warnings.find((w) =>
      w.includes("섹터-종목 불일치"),
    );
    expect(sectorWarning).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // C. 기준 미달 종목 태깅
  // -------------------------------------------------------------------------

  it("기준 미달 종목 (Phase 1, RS < 60) → warnings에 기준 미달 종목 목록", () => {
    const result = validateReport({
      markdown: "시장 분석 리포트. 리스크 주의 필요.",
      recommendations: [
        { symbol: "AVGO", rsScore: 56, phase: 1 },
        { symbol: "NVDA", rsScore: 85, phase: 2 },
        { symbol: "AAPL", rsScore: 45, phase: 3 },
      ],
    });

    const substandardWarning = result.warnings.find((w) =>
      w.includes("기준 미달"),
    );
    expect(substandardWarning).toBeDefined();
    expect(substandardWarning).toContain("AVGO");
    expect(substandardWarning).toContain("Phase 1");
    expect(substandardWarning).toContain("RS 56");
    expect(substandardWarning).toContain("AAPL");
    expect(substandardWarning).toContain("RS 45");
    // NVDA는 기준 충족이므로 포함되지 않아야 함
    expect(substandardWarning).not.toContain("NVDA");
  });

  it("빈 recommendations → 기준 미달 체크 스킵", () => {
    const result = validateReport({
      markdown: "시장 분석 리포트. 리스크 주의 필요.",
      recommendations: [],
    });

    const substandardWarning = result.warnings.find((w) =>
      w.includes("기준 미달"),
    );
    expect(substandardWarning).toBeUndefined();
  });

  it("recommendations 없으면 기준 미달 체크 스킵", () => {
    const result = validateReport({
      markdown: "시장 분석 리포트. 리스크 주의 필요.",
    });

    const substandardWarning = result.warnings.find((w) =>
      w.includes("기준 미달"),
    );
    expect(substandardWarning).toBeUndefined();
  });

  it("rsScore와 phase가 모두 없는 종목은 기준 미달에 포함되지 않음", () => {
    const result = validateReport({
      markdown: "시장 분석 리포트. 리스크 주의 필요.",
      recommendations: [{ symbol: "TSLA" }],
    });

    const substandardWarning = result.warnings.find((w) =>
      w.includes("기준 미달"),
    );
    expect(substandardWarning).toBeUndefined();
  });
});
