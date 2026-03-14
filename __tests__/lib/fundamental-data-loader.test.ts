import { describe, it, expect } from "vitest";
import { groupBySymbol, type RawRow } from "../../src/lib/fundamental-data-loader.js";
import { scoreFundamentals } from "../../src/lib/fundamental-scorer.js";

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

  it("normalizes net_margin from decimal to percent (DB stores mostly decimal, scorer expects percent)", () => {
    // DB의 87.6%는 소수 단위(0~1)로 저장 → ×100으로 퍼센트 변환
    // scorer는 퍼센트 단위(0~100%)를 기대
    const rows: RawRow[] = [
      makeRow({
        symbol: "NORM",
        as_of_q: "Q4 2025",
        period_end_date: "2025-12-31",
        net_margin: "0.265",  // 소수 단위 (절댓값 ≤ 1) → ×100 → 26.5%
      }),
      makeRow({
        symbol: "NORM",
        as_of_q: "Q3 2025",
        period_end_date: "2025-09-30",
        net_margin: "57.0",   // 이미 퍼센트 단위 (절댓값 > 1) → 그대로
      }),
    ];

    const result = groupBySymbol(rows, ["NORM"]);

    // 0.265는 소수 단위 → ×100 → 26.5
    expect(result[0].quarters[0].netMargin).toBeCloseTo(26.5);
    // 57.0은 이미 퍼센트 단위 → 그대로
    expect(result[0].quarters[1].netMargin).toBeCloseTo(57.0);
  });
});

// ─── 통합 경로: groupBySymbol → normalizeMargin → scoreFundamentals ──

describe("통합 경로: DB 마진값 → normalizeMargin → scoreFundamentals rankScore", () => {
  /**
   * DB에서 소수 단위로 저장된 net_margin이 normalizeMargin(×100)을 거쳐
   * scoreFundamentals에 퍼센트 단위로 전달될 때 rankScore가 유의미한지 검증.
   */
  it("DB의 소수 단위 마진(0.57)이 퍼센트(57%)로 변환되어 rankScore에 기여한다", () => {
    // DB 원시 행 — net_margin이 소수 단위 (실제 DB 분포 87.6% 케이스)
    const rawRows: RawRow[] = [
      makeRow({ symbol: "NVDA", as_of_q: "Q4 2025", period_end_date: "2025-12-31", eps_diluted: "1.89", revenue: "35100000000", net_margin: "0.57" }),
      makeRow({ symbol: "NVDA", as_of_q: "Q3 2025", period_end_date: "2025-09-30", eps_diluted: "1.27", revenue: "30000000000", net_margin: "0.53" }),
      makeRow({ symbol: "NVDA", as_of_q: "Q2 2025", period_end_date: "2025-06-30", eps_diluted: "0.98", revenue: "26000000000", net_margin: "0.50" }),
      makeRow({ symbol: "NVDA", as_of_q: "Q1 2025", period_end_date: "2025-03-31", eps_diluted: "0.82", revenue: "22000000000", net_margin: "0.45" }),
      makeRow({ symbol: "NVDA", as_of_q: "Q4 2024", period_end_date: "2024-12-31", eps_diluted: "0.78", revenue: "18000000000", net_margin: "0.39" }),
      makeRow({ symbol: "NVDA", as_of_q: "Q3 2024", period_end_date: "2024-09-30", eps_diluted: "0.55", revenue: "15000000000", net_margin: "0.33" }),
      makeRow({ symbol: "NVDA", as_of_q: "Q2 2024", period_end_date: "2024-06-30", eps_diluted: "0.45", revenue: "12000000000", net_margin: "0.29" }),
      makeRow({ symbol: "NVDA", as_of_q: "Q1 2024", period_end_date: "2024-03-31", eps_diluted: "0.35", revenue: "10000000000", net_margin: "0.25" }),
    ];

    const [fundamentalInput] = groupBySymbol(rawRows, ["NVDA"]);

    // normalizeMargin이 소수→퍼센트 변환을 올바르게 수행했는지 확인
    const latestMargin = fundamentalInput.quarters[0].netMargin;
    expect(latestMargin).toBeCloseTo(57); // 0.57 × 100 = 57%

    // scoreFundamentals에서 퍼센트 단위 마진이 rankScore에 유의미하게 기여하는지 확인
    const score = scoreFundamentals(fundamentalInput);
    expect(score.grade).toBe("A");

    // rankScore: marginExpansion 기여분 = Math.min(57, 70) × 2 = 114
    // 마진 기여가 0에 수렴하지 않는지 검증
    expect(score.rankScore).toBeGreaterThan(100);
  });

  it("같은 종목에서 소수(0.57) vs 퍼센트(57) 입력 시 동일한 rankScore를 반환한다", () => {
    function makeRows(netMarginStr: string): RawRow[] {
      return [
        makeRow({ symbol: "TEST", as_of_q: "Q4 2025", period_end_date: "2025-12-31", eps_diluted: "1.89", revenue: "35100000000", net_margin: netMarginStr }),
        makeRow({ symbol: "TEST", as_of_q: "Q3 2025", period_end_date: "2025-09-30", eps_diluted: "1.27", revenue: "30000000000", net_margin: netMarginStr }),
        makeRow({ symbol: "TEST", as_of_q: "Q2 2025", period_end_date: "2025-06-30", eps_diluted: "0.98", revenue: "26000000000", net_margin: netMarginStr }),
        makeRow({ symbol: "TEST", as_of_q: "Q1 2025", period_end_date: "2025-03-31", eps_diluted: "0.82", revenue: "22000000000", net_margin: netMarginStr }),
        makeRow({ symbol: "TEST", as_of_q: "Q4 2024", period_end_date: "2024-12-31", eps_diluted: "0.78", revenue: "18000000000", net_margin: netMarginStr }),
        makeRow({ symbol: "TEST", as_of_q: "Q3 2024", period_end_date: "2024-09-30", eps_diluted: "0.55", revenue: "15000000000", net_margin: netMarginStr }),
        makeRow({ symbol: "TEST", as_of_q: "Q2 2024", period_end_date: "2024-06-30", eps_diluted: "0.45", revenue: "12000000000", net_margin: netMarginStr }),
        makeRow({ symbol: "TEST", as_of_q: "Q1 2024", period_end_date: "2024-03-31", eps_diluted: "0.35", revenue: "10000000000", net_margin: netMarginStr }),
      ];
    }

    const [decimalInput] = groupBySymbol(makeRows("0.57"), ["TEST"]);
    const [percentInput] = groupBySymbol(makeRows("57"), ["TEST"]);

    const decimalScore = scoreFundamentals(decimalInput);
    const percentScore = scoreFundamentals(percentInput);

    // 소수(0.57)와 퍼센트(57) 모두 normalizeMargin 후 동일한 값이 되어야 함
    expect(decimalScore.rankScore).toBeCloseTo(percentScore.rankScore, 1);
  });
});
