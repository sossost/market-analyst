// ---------------------------------------------------------------------------
// priceDeclineFilter.test.ts — 급락 종목 필터 단위 테스트
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from "vitest";

// DB pool mock
vi.mock("@/db/client", () => ({
  pool: {
    query: vi.fn(),
  },
}));

// logger mock
vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { pool } from "@/db/client";
import {
  filterDeclinedSymbols,
  computeDecline,
  formatDeclineWarning,
  type DeclinedSymbol,
} from "../priceDeclineFilter";

const mockQuery = vi.mocked(pool.query);

// ---------------------------------------------------------------------------
// computeDecline — 순수 함수 테스트
// ---------------------------------------------------------------------------

describe("computeDecline", () => {
  it("-5% 이하 + 거래량 1.5배 이상이면 DeclinedSymbol 반환", () => {
    const row = {
      symbol: "NVDA",
      close: "90",
      prev_close: "100",
      volume: "3000000",
      vol_ma30: "1000000",
    };

    const result = computeDecline(row);

    expect(result).not.toBeNull();
    expect(result?.symbol).toBe("NVDA");
    expect(result?.pctChange).toBe(-10); // (90-100)/100 * 100 = -10%
    expect(result?.volumeRatio).toBe(3); // 3000000/1000000
  });

  it("-5% 이하지만 거래량 비율 1.5배 미만이면 null 반환", () => {
    const row = {
      symbol: "NVDA",
      close: "90",
      prev_close: "100",
      volume: "1200000",
      vol_ma30: "1000000",
    };

    const result = computeDecline(row);

    expect(result).toBeNull();
  });

  it("-5% 초과(작은 하락)이면 null 반환", () => {
    const row = {
      symbol: "AAPL",
      close: "96",
      prev_close: "100",
      volume: "5000000",
      vol_ma30: "1000000",
    };

    const result = computeDecline(row);

    expect(result).toBeNull(); // -4% — 기준 미달
  });

  it("정확히 -5.0%이면 급락으로 판정", () => {
    const row = {
      symbol: "TSLA",
      close: "95",
      prev_close: "100",
      volume: "3000000",
      vol_ma30: "1000000",
    };

    const result = computeDecline(row);

    expect(result).not.toBeNull();
    expect(result?.pctChange).toBe(-5);
  });

  it("close가 null이면 null 반환", () => {
    const row = {
      symbol: "NVDA",
      close: null,
      prev_close: "100",
      volume: "3000000",
      vol_ma30: "1000000",
    };

    expect(computeDecline(row)).toBeNull();
  });

  it("prev_close가 null이면 null 반환", () => {
    const row = {
      symbol: "NVDA",
      close: "90",
      prev_close: null,
      volume: "3000000",
      vol_ma30: "1000000",
    };

    expect(computeDecline(row)).toBeNull();
  });

  it("prev_close가 0이면 null 반환 (0 나누기 방어)", () => {
    const row = {
      symbol: "NVDA",
      close: "90",
      prev_close: "0",
      volume: "3000000",
      vol_ma30: "1000000",
    };

    expect(computeDecline(row)).toBeNull();
  });

  it("vol_ma30이 null이면 volumeRatio를 1.0으로 간주 — 거래량 조건 미충족으로 null 반환", () => {
    // volumeRatio = 1.0 < 1.5 이므로 null
    const row = {
      symbol: "NVDA",
      close: "90",
      prev_close: "100",
      volume: "3000000",
      vol_ma30: null,
    };

    const result = computeDecline(row);
    expect(result).toBeNull(); // vol_ma30 없으면 volumeRatio=1.0 → 1.5 미달
  });

  it("상승 종목은 null 반환", () => {
    const row = {
      symbol: "NVDA",
      close: "110",
      prev_close: "100",
      volume: "5000000",
      vol_ma30: "1000000",
    };

    expect(computeDecline(row)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// filterDeclinedSymbols — DB mock 통합 테스트
// ---------------------------------------------------------------------------

describe("filterDeclinedSymbols", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("빈 symbols 배열이면 DB 조회 없이 빈 배열 반환", async () => {
    const result = await filterDeclinedSymbols([], "2026-03-21");

    expect(result).toEqual([]);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("조건 충족 종목만 반환", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          symbol: "NVDA",
          close: "90",
          prev_close: "100",
          volume: "3000000",
          vol_ma30: "1000000",
        },
        {
          symbol: "AAPL",
          close: "98",
          prev_close: "100",
          volume: "500000",
          vol_ma30: "1000000",
        },
      ],
      rowCount: 2,
    } as never);

    const result = await filterDeclinedSymbols(["NVDA", "AAPL"], "2026-03-21");

    expect(result).toHaveLength(1);
    expect(result[0].symbol).toBe("NVDA");
    expect(result[0].pctChange).toBe(-10);
  });

  it("조건 충족 종목이 없으면 빈 배열 반환", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          symbol: "AAPL",
          close: "99",
          prev_close: "100",
          volume: "500000",
          vol_ma30: "1000000",
        },
      ],
      rowCount: 1,
    } as never);

    const result = await filterDeclinedSymbols(["AAPL"], "2026-03-21");

    expect(result).toEqual([]);
  });

  it("DB 조회 실패 시 예외 전파 없이 빈 배열 반환 (비블로킹)", async () => {
    mockQuery.mockRejectedValueOnce(new Error("connection timeout"));

    const result = await filterDeclinedSymbols(["NVDA"], "2026-03-21");

    expect(result).toEqual([]);
  });

  it("여러 급락 종목이 있으면 모두 반환", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          symbol: "NVDA",
          close: "90",
          prev_close: "100",
          volume: "3000000",
          vol_ma30: "1000000",
        },
        {
          symbol: "TSLA",
          close: "95",
          prev_close: "100",
          volume: "2000000",
          vol_ma30: "1000000",
        },
      ],
      rowCount: 2,
    } as never);

    const result = await filterDeclinedSymbols(["NVDA", "TSLA"], "2026-03-21");

    expect(result).toHaveLength(2);
    const symbols = result.map((r) => r.symbol);
    expect(symbols).toContain("NVDA");
    expect(symbols).toContain("TSLA");
  });
});

// ---------------------------------------------------------------------------
// formatDeclineWarning — 순수 함수 테스트
// ---------------------------------------------------------------------------

describe("formatDeclineWarning", () => {
  it("빈 배열이면 빈 문자열 반환", () => {
    expect(formatDeclineWarning([], "2026-03-21")).toBe("");
  });

  it("급락 종목이 있으면 Discord 경고 포맷 반환", () => {
    const declined: DeclinedSymbol[] = [
      { symbol: "NVDA", pctChange: -10, volumeRatio: 3 },
    ];

    const message = formatDeclineWarning(declined, "2026-03-21");

    expect(message).toContain("급락 경고");
    expect(message).toContain("NVDA");
    expect(message).toContain("-10.0%");
    expect(message).toContain("3.0배");
    expect(message).toContain("2026-03-21");
  });

  it("복수 종목이면 모두 포함", () => {
    const declined: DeclinedSymbol[] = [
      { symbol: "NVDA", pctChange: -10, volumeRatio: 3 },
      { symbol: "TSLA", pctChange: -7.5, volumeRatio: 2.1 },
    ];

    const message = formatDeclineWarning(declined, "2026-03-21");

    expect(message).toContain("NVDA");
    expect(message).toContain("TSLA");
  });
});
