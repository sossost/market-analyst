import { describe, it, expect, vi, beforeEach } from "vitest";
import { formatEarlyDetectionContext, type EarlyDetectionData } from "../earlyDetectionLoader";

describe("formatEarlyDetectionContext", () => {
  it("3개 카테고리 모두 비어있으면 빈 문자열 반환", () => {
    const data: EarlyDetectionData = {
      phase1Late: [],
      risingRs: [],
      accelerating: [],
    };
    expect(formatEarlyDetectionContext(data)).toBe("");
  });

  it("Phase1Late 데이터만 있으면 해당 섹션만 생성", () => {
    const data: EarlyDetectionData = {
      phase1Late: [
        { symbol: "AAPL", rsScore: 45, ma150Slope: 0.0012, volRatio: 2.1, sector: "Technology" },
      ],
      risingRs: [],
      accelerating: [],
    };
    const result = formatEarlyDetectionContext(data);
    expect(result).toContain("Phase 1 후기");
    expect(result).toContain("AAPL");
    expect(result).toContain("45");
    expect(result).toContain("0.0012");
    expect(result).toContain("2.1x");
    expect(result).toContain("Technology");
    expect(result).not.toContain("RS 상승 초기");
    expect(result).not.toContain("펀더멘탈 가속");
  });

  it("RisingRS 데이터만 있으면 해당 섹션만 생성", () => {
    const data: EarlyDetectionData = {
      phase1Late: [],
      risingRs: [
        { symbol: "MSFT", rsScore: 42, rsChange: 8, sector: "Technology" },
      ],
      accelerating: [],
    };
    const result = formatEarlyDetectionContext(data);
    expect(result).toContain("RS 상승 초기");
    expect(result).toContain("MSFT");
    expect(result).toContain("+8");
    expect(result).not.toContain("Phase 1 후기");
  });

  it("펀더멘탈 가속 데이터만 있으면 해당 섹션만 생성", () => {
    const data: EarlyDetectionData = {
      phase1Late: [],
      risingRs: [],
      accelerating: [
        {
          symbol: "NVDA",
          sector: "Technology",
          latestEpsGrowth: 145.3,
          latestRevenueGrowth: 122.0,
          isEpsAccelerating: true,
          isRevenueAccelerating: true,
        },
      ],
    };
    const result = formatEarlyDetectionContext(data);
    expect(result).toContain("펀더멘탈 가속");
    expect(result).toContain("NVDA");
    expect(result).toContain("+145.3%");
    expect(result).toContain("+122%");
    expect(result).toContain("EPS+매출");
  });

  it("3개 카테고리 모두 있으면 모든 섹션 생성", () => {
    const data: EarlyDetectionData = {
      phase1Late: [
        { symbol: "AAPL", rsScore: 45, ma150Slope: 0.001, volRatio: 2.0, sector: "Tech" },
      ],
      risingRs: [
        { symbol: "MSFT", rsScore: 42, rsChange: 8, sector: "Tech" },
      ],
      accelerating: [
        {
          symbol: "NVDA",
          sector: "Tech",
          latestEpsGrowth: 100,
          latestRevenueGrowth: 80,
          isEpsAccelerating: true,
          isRevenueAccelerating: false,
        },
      ],
    };
    const result = formatEarlyDetectionContext(data);
    expect(result).toContain("Phase 1 후기");
    expect(result).toContain("RS 상승 초기");
    expect(result).toContain("펀더멘탈 가속");
  });

  it("null 필드는 '—'으로 표시", () => {
    const data: EarlyDetectionData = {
      phase1Late: [
        { symbol: "TEST", rsScore: null, ma150Slope: null, volRatio: null, sector: null },
      ],
      risingRs: [],
      accelerating: [],
    };
    const result = formatEarlyDetectionContext(data);
    // symbol 뒤에 null 필드들이 —로 표시되어야 함
    const lines = result.split("\n").filter((l) => l.includes("TEST"));
    expect(lines.length).toBe(1);
    // RS, MA150기울기, 거래량비율, 섹터 모두 —
    expect(lines[0]).toMatch(/\| TEST \| — \| — \| — \| — \|/);
  });

  it("EPS만 가속인 경우 가속항목에 EPS만 표시", () => {
    const data: EarlyDetectionData = {
      phase1Late: [],
      risingRs: [],
      accelerating: [
        {
          symbol: "AMD",
          sector: "Tech",
          latestEpsGrowth: 50,
          latestRevenueGrowth: 20,
          isEpsAccelerating: true,
          isRevenueAccelerating: false,
        },
      ],
    };
    const result = formatEarlyDetectionContext(data);
    const amdLine = result.split("\n").find((l) => l.includes("AMD"));
    expect(amdLine).toContain("| EPS |");
  });

  it("음수 성장률도 올바르게 포맷", () => {
    const data: EarlyDetectionData = {
      phase1Late: [],
      risingRs: [],
      accelerating: [
        {
          symbol: "INTC",
          sector: "Tech",
          latestEpsGrowth: -5.2,
          latestRevenueGrowth: -10.0,
          isEpsAccelerating: false,
          isRevenueAccelerating: true,
        },
      ],
    };
    const result = formatEarlyDetectionContext(data);
    expect(result).toContain("-5.2%");
    expect(result).toContain("-10%");
  });
});
