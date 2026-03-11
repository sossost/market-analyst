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
});
