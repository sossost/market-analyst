import { describe, it, expect } from "vitest";
import { groupBySymbol, type RawRow } from "../../src/lib/fundamental-data-loader.js";

function makeRow(overrides: Partial<RawRow> = {}): RawRow {
  return {
    symbol: "AAPL",
    period_end_date: "2025-12-31",
    as_of_q: "Q4 2025",
    revenue: "100000000000",
    net_income: "25000000000",
    eps_diluted: "1.50",
    net_margin: "0.25",
    ...overrides,
  };
}

describe("groupBySymbol", () => {
  it("groups rows by symbol", () => {
    const rows: RawRow[] = [
      makeRow({ symbol: "AAPL", as_of_q: "Q4 2025", period_end_date: "2025-12-31" }),
      makeRow({ symbol: "AAPL", as_of_q: "Q3 2025", period_end_date: "2025-09-30" }),
      makeRow({ symbol: "NVDA", as_of_q: "Q4 2025", period_end_date: "2025-12-31" }),
    ];

    const result = groupBySymbol(rows, ["AAPL", "NVDA"]);

    expect(result).toHaveLength(2);
    expect(result[0].symbol).toBe("AAPL");
    expect(result[0].quarters).toHaveLength(2);
    expect(result[1].symbol).toBe("NVDA");
    expect(result[1].quarters).toHaveLength(1);
  });

  it("deduplicates same as_of_q rows keeping the first (most recent period_end_date)", () => {
    const rows: RawRow[] = [
      makeRow({
        symbol: "CYD",
        as_of_q: "Q2 2025",
        period_end_date: "2025-06-30",
        revenue: "200000000",
      }),
      makeRow({
        symbol: "CYD",
        as_of_q: "Q2 2025",
        period_end_date: "2025-03-31",
        revenue: "100000000",
      }),
      makeRow({
        symbol: "CYD",
        as_of_q: "Q1 2025",
        period_end_date: "2025-03-31",
        revenue: "90000000",
      }),
    ];

    const result = groupBySymbol(rows, ["CYD"]);

    expect(result).toHaveLength(1);
    expect(result[0].quarters).toHaveLength(2);
    expect(result[0].quarters[0].asOfQ).toBe("Q2 2025");
    expect(result[0].quarters[0].revenue).toBe(200_000_000);
    expect(result[0].quarters[1].asOfQ).toBe("Q1 2025");
  });

  it("returns empty quarters for symbols with no data", () => {
    const result = groupBySymbol([], ["AAPL"]);

    expect(result).toHaveLength(1);
    expect(result[0].quarters).toHaveLength(0);
  });

  it("limits to QUARTERS_TO_LOAD (8) per symbol", () => {
    const rows: RawRow[] = Array.from({ length: 10 }, (_, i) =>
      makeRow({
        symbol: "AAPL",
        as_of_q: `Q${(i % 4) + 1} ${2025 - Math.floor(i / 4)}`,
        period_end_date: `${2025 - Math.floor(i / 4)}-${String((i % 4 + 1) * 3).padStart(2, "0")}-30`,
      }),
    );

    const result = groupBySymbol(rows, ["AAPL"]);

    expect(result[0].quarters).toHaveLength(8);
  });

  it("deduplicates rows with same quarter in different format (Q4 2024 vs 2024Q4)", () => {
    // 동일 분기를 다른 포맷으로 표기한 두 행 → 첫 번째(최신 period_end_date)만 남겨야 함
    const rows: RawRow[] = [
      makeRow({
        symbol: "CYD",
        as_of_q: "Q4 2024",
        period_end_date: "2025-03-31",
        revenue: "300000000",
      }),
      makeRow({
        symbol: "CYD",
        as_of_q: "2024Q4",
        period_end_date: "2024-12-31",
        revenue: "200000000",
      }),
      makeRow({
        symbol: "CYD",
        as_of_q: "Q3 2024",
        period_end_date: "2024-09-30",
        revenue: "150000000",
      }),
    ];

    const result = groupBySymbol(rows, ["CYD"]);

    // Q4 2024 와 2024Q4 는 동일 분기 → 하나만 남아야 함
    expect(result[0].quarters).toHaveLength(2);
    // 첫 번째가 먼저 들어온 Q4 2024 (revenue 300000000)
    expect(result[0].quarters[0].revenue).toBe(300_000_000);
  });

  it("normalizes net_margin values greater than 5 (already in percent) to decimal", () => {
    // DB에 이미 퍼센트 단위(예: 265)로 저장된 net_margin → 0~1 소수로 정규화
    const rows: RawRow[] = [
      makeRow({
        symbol: "NORM",
        as_of_q: "Q4 2025",
        period_end_date: "2025-12-31",
        net_margin: "265.0",  // 이미 퍼센트 단위 (비정상)
      }),
      makeRow({
        symbol: "NORM",
        as_of_q: "Q3 2025",
        period_end_date: "2025-09-30",
        net_margin: "0.25",   // 정상 소수 단위
      }),
    ];

    const result = groupBySymbol(rows, ["NORM"]);

    // 265.0은 임계값 5 초과 → ÷100 → 2.65
    expect(result[0].quarters[0].netMargin).toBeCloseTo(2.65);
    // 0.25는 임계값 이하 → 그대로
    expect(result[0].quarters[1].netMargin).toBeCloseTo(0.25);
  });
});
