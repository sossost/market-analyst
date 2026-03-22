import { describe, it, expect } from "vitest";
import { buildUserMessage } from "../../../src/agent/fundamental/fundamentalAgent.js";
import type { FundamentalScore, FundamentalInput } from "../../../src/types/fundamental.js";

function makeScore(overrides: Partial<FundamentalScore> = {}): FundamentalScore {
  return {
    symbol: "NVDA",
    grade: "A",
    totalScore: 100,
    rankScore: 500,
    requiredMet: 2,
    bonusMet: 2,
    criteria: {
      epsGrowth: { passed: true, value: 142, detail: "EPS YoY +142%" },
      revenueGrowth: { passed: true, value: 95, detail: "매출 YoY +95%" },
      epsAcceleration: { passed: true, value: 142, detail: "EPS 가속" },
      marginExpansion: { passed: true, value: 65, detail: "이익률 확대" },
      roe: { passed: false, value: null, detail: "ROE 데이터 미확보" },
    },
    ...overrides,
  };
}

function makeInput(): FundamentalInput {
  return {
    symbol: "NVDA",
    quarters: [
      { periodEndDate: "2025-12-31", asOfQ: "Q4 2025", revenue: 35_100_000_000, netIncome: 20_000_000_000, epsDiluted: 1.89, netMargin: 57.0 },
      { periodEndDate: "2025-09-30", asOfQ: "Q3 2025", revenue: 30_000_000_000, netIncome: 16_000_000_000, epsDiluted: 1.27, netMargin: 15.0 },
    ],
  };
}

describe("buildUserMessage", () => {
  it("formats netMargin as percentage (already in percent form)", () => {
    const msg = buildUserMessage(makeScore(), makeInput());

    // netMargin은 이미 percent 단위 (normalizeMargin에서 변환 완료)
    expect(msg).toContain("마진 57.0%");
    expect(msg).toContain("마진 15.0%");
  });

  it("includes technical data section when provided", () => {
    const technical = {
      phase: 2,
      rsScore: 95,
      volumeConfirmed: true,
      pctFromHigh52w: -5.2,
      marketCapB: 2800.5,
      sector: "Technology",
      industry: "Semiconductors",
    };

    const msg = buildUserMessage(makeScore(), makeInput(), technical);

    expect(msg).toContain("기술적 현황");
    expect(msg).toContain("Phase: 2");
    expect(msg).toContain("RS Score: 95");
    expect(msg).toContain("52주 고점 대비: -5.2%");
    expect(msg).toContain("Technology / Semiconductors");
  });

  it("does not include technical section when undefined", () => {
    const msg = buildUserMessage(makeScore(), makeInput());

    expect(msg).not.toContain("기술적 현황");
  });

  it("requests deep analysis for S-grade (isTopGrade)", () => {
    const msg = buildUserMessage(makeScore({ grade: "S" }), makeInput(), undefined, true);

    expect(msg).toContain("S등급");
    expect(msg).toContain("심층 분석");
    expect(msg).not.toContain("2-3문단으로 해석");
  });

  it("requests 2-3 paragraph analysis for non-S-grade", () => {
    const msg = buildUserMessage(makeScore({ grade: "A" }), makeInput(), undefined, false);

    expect(msg).toContain("2-3문단으로 해석");
    expect(msg).not.toContain("심층 분석");
  });
});
