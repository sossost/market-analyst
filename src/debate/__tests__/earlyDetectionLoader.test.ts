import { describe, it, expect } from "vitest";
import {
  formatEarlyDetectionContext,
  computeOverlapStocks,
  type EarlyDetectionData,
} from "../earlyDetectionLoader";

describe("computeOverlapStocks", () => {
  it("모든 리스트가 비어있으면 빈 배열 반환", () => {
    const result = computeOverlapStocks([], [], []);
    expect(result).toEqual([]);
  });

  it("1개 도구에만 등장하는 종목은 제외", () => {
    const result = computeOverlapStocks(
      [{ symbol: "AAPL", rsScore: 45, ma150Slope: 0.001, volRatio: 2.0, sector: "Tech" }],
      [{ symbol: "MSFT", rsScore: 42, rsChange: 8, sector: "Tech" }],
      [],
    );
    expect(result).toEqual([]);
  });

  it("2개 도구에 등장하면 overlapCount 2로 태깅", () => {
    const result = computeOverlapStocks(
      [{ symbol: "AAPL", rsScore: 45, ma150Slope: 0.001, volRatio: 2.0, sector: "Tech" }],
      [{ symbol: "AAPL", rsScore: 42, rsChange: 8, sector: "Tech" }],
      [],
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      symbol: "AAPL",
      sector: "Tech",
      overlapCount: 2,
      sources: ["phase1Late", "risingRs"],
    });
  });

  it("3개 도구에 모두 등장하면 overlapCount 3으로 태깅", () => {
    const result = computeOverlapStocks(
      [{ symbol: "NVDA", rsScore: 50, ma150Slope: 0.002, volRatio: 3.0, sector: "Tech" }],
      [{ symbol: "NVDA", rsScore: 55, rsChange: 12, sector: "Tech" }],
      [{
        symbol: "NVDA",
        sector: "Tech",
        latestEpsGrowth: 100,
        latestRevenueGrowth: 80,
        isEpsAccelerating: true,
        isRevenueAccelerating: false,
        sepaGrade: "A",
      }],
    );
    expect(result).toHaveLength(1);
    expect(result[0].overlapCount).toBe(3);
    expect(result[0].sources).toEqual(["accelerating", "phase1Late", "risingRs"]);
  });

  it("overlap 높은 순으로 정렬, 같으면 알파벳 순", () => {
    const result = computeOverlapStocks(
      [
        { symbol: "AAPL", rsScore: 45, ma150Slope: 0.001, volRatio: 2.0, sector: "Tech" },
        { symbol: "MSFT", rsScore: 40, ma150Slope: 0.001, volRatio: 1.5, sector: "Tech" },
        { symbol: "TSLA", rsScore: 35, ma150Slope: 0.001, volRatio: 1.2, sector: "Auto" },
      ],
      [
        { symbol: "AAPL", rsScore: 48, rsChange: 10, sector: "Tech" },
        { symbol: "MSFT", rsScore: 43, rsChange: 7, sector: "Tech" },
        { symbol: "TSLA", rsScore: 38, rsChange: 6, sector: "Auto" },
      ],
      [{
        symbol: "AAPL",
        sector: "Tech",
        latestEpsGrowth: 50,
        latestRevenueGrowth: 30,
        isEpsAccelerating: true,
        isRevenueAccelerating: false,
        sepaGrade: "B",
      }],
    );
    expect(result).toHaveLength(3);
    expect(result[0].symbol).toBe("AAPL");
    expect(result[0].overlapCount).toBe(3);
    expect(result[1].symbol).toBe("MSFT");
    expect(result[1].overlapCount).toBe(2);
    expect(result[2].symbol).toBe("TSLA");
    expect(result[2].overlapCount).toBe(2);
  });

  it("sector가 첫 번째 도구에서 null이면 다른 도구에서 채운다", () => {
    const result = computeOverlapStocks(
      [{ symbol: "AAPL", rsScore: 45, ma150Slope: 0.001, volRatio: 2.0, sector: null }],
      [{ symbol: "AAPL", rsScore: 42, rsChange: 8, sector: "Technology" }],
      [],
    );
    expect(result[0].sector).toBe("Technology");
  });
});

describe("formatEarlyDetectionContext", () => {
  it("3개 카테고리 모두 비어있으면 빈 문자열 반환", () => {
    const data: EarlyDetectionData = {
      phase1Late: [],
      risingRs: [],
      accelerating: [],
      highConviction: [],
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
      highConviction: [],
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
    expect(result).not.toContain("고확신 후보");
  });

  it("RisingRS 데이터만 있으면 해당 섹션만 생성", () => {
    const data: EarlyDetectionData = {
      phase1Late: [],
      risingRs: [
        { symbol: "MSFT", rsScore: 42, rsChange: 8, sector: "Technology" },
      ],
      accelerating: [],
      highConviction: [],
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
          sepaGrade: "A",
        },
      ],
      highConviction: [],
    };
    const result = formatEarlyDetectionContext(data);
    expect(result).toContain("펀더멘탈 가속");
    expect(result).toContain("NVDA");
    expect(result).toContain("+145.3%");
    expect(result).toContain("+122%");
    expect(result).toContain("EPS+매출");
    expect(result).toContain("| A |");
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
          sepaGrade: "B",
        },
      ],
      highConviction: [],
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
      highConviction: [],
    };
    const result = formatEarlyDetectionContext(data);
    const lines = result.split("\n").filter((l) => l.includes("TEST"));
    expect(lines.length).toBe(1);
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
          sepaGrade: "B",
        },
      ],
      highConviction: [],
    };
    const result = formatEarlyDetectionContext(data);
    const amdLine = result.split("\n").find((l) => l.includes("AMD"));
    expect(amdLine).toContain("| EPS |");
    expect(amdLine).toContain("| B |");
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
          sepaGrade: "C",
        },
      ],
      highConviction: [],
    };
    const result = formatEarlyDetectionContext(data);
    expect(result).toContain("-5.2%");
    expect(result).toContain("-10%");
  });

  it("고확신 후보 섹션이 다른 섹션보다 먼저 표시", () => {
    const data: EarlyDetectionData = {
      phase1Late: [
        { symbol: "AAPL", rsScore: 45, ma150Slope: 0.001, volRatio: 2.0, sector: "Tech" },
      ],
      risingRs: [
        { symbol: "AAPL", rsScore: 48, rsChange: 10, sector: "Tech" },
      ],
      accelerating: [],
      highConviction: [
        { symbol: "AAPL", sector: "Tech", overlapCount: 2, sources: ["phase1Late", "risingRs"] },
      ],
    };
    const result = formatEarlyDetectionContext(data);
    const highConvIdx = result.indexOf("고확신 후보");
    const phase1Idx = result.indexOf("Phase 1 후기");
    expect(highConvIdx).toBeLessThan(phase1Idx);
    expect(result).toContain("| AAPL | 2 | Phase1후기+RS상승 | Tech |");
  });

  it("고확신 후보가 3개 도구 모두 등장하면 출처 3개 표시", () => {
    const data: EarlyDetectionData = {
      phase1Late: [],
      risingRs: [],
      accelerating: [],
      highConviction: [
        {
          symbol: "NVDA",
          sector: "Tech",
          overlapCount: 3,
          sources: ["accelerating", "phase1Late", "risingRs"],
        },
      ],
    };
    const result = formatEarlyDetectionContext(data);
    expect(result).toContain("| NVDA | 3 | 펀더멘탈가속+Phase1후기+RS상승 | Tech |");
  });

  it("고확신 후보가 없으면 해당 섹션 미표시", () => {
    const data: EarlyDetectionData = {
      phase1Late: [
        { symbol: "AAPL", rsScore: 45, ma150Slope: 0.001, volRatio: 2.0, sector: "Tech" },
      ],
      risingRs: [],
      accelerating: [],
      highConviction: [],
    };
    const result = formatEarlyDetectionContext(data);
    expect(result).not.toContain("고확신 후보");
  });

  it("고확신 후보 sector가 null이면 —으로 표시", () => {
    const data: EarlyDetectionData = {
      phase1Late: [],
      risingRs: [],
      accelerating: [],
      highConviction: [
        { symbol: "XYZ", sector: null, overlapCount: 2, sources: ["phase1Late", "risingRs"] },
      ],
    };
    const result = formatEarlyDetectionContext(data);
    expect(result).toContain("| XYZ | 2 | Phase1후기+RS상승 | — |");
  });
});
