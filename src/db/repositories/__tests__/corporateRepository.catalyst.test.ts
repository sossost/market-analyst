/**
 * findStockNews, findUpcomingEarnings 단위 테스트.
 *
 * DB에 의존하지 않고 Pool을 mock하여 쿼리 파라미터와 반환값을 검증한다.
 */
import { describe, it, expect, vi } from "vitest";
import type { Pool } from "pg";
import { findStockNews, findUpcomingEarnings, findMarketRegimeByDate } from "../corporateRepository.js";
import type { CorporateStockNewsRow, CorporateEarningCalendarRow, CorporateMarketRegimeRow } from "../types.js";

// ---------------------------------------------------------------------------
// Pool mock 헬퍼
// ---------------------------------------------------------------------------

function makePool<T>(rows: T[]): Pool {
  return {
    query: vi.fn().mockResolvedValue({ rows }),
  } as unknown as Pool;
}

// ---------------------------------------------------------------------------
// findStockNews
// ---------------------------------------------------------------------------

describe("findStockNews", () => {
  it("symbol과 limit을 파라미터로 쿼리하고 rows를 반환한다", async () => {
    const MOCK_ROWS: CorporateStockNewsRow[] = [
      { title: "NVIDIA Posts Record Revenue", site: "Reuters", published_date: "2026-03-20" },
      { title: "AI Chip Demand Surges", site: "Bloomberg", published_date: "2026-03-18" },
    ];
    const pool = makePool(MOCK_ROWS);

    const result = await findStockNews("NVDA", 5, pool);

    expect(result).toHaveLength(2);
    expect(result[0].title).toBe("NVIDIA Posts Record Revenue");
    expect(result[0].site).toBe("Reuters");
    expect(result[0].published_date).toBe("2026-03-20");
  });

  it("symbol과 limit을 쿼리 파라미터로 전달한다", async () => {
    const pool = makePool<CorporateStockNewsRow>([]);

    await findStockNews("AAPL", 3, pool);

    const queryMock = pool.query as ReturnType<typeof vi.fn>;
    expect(queryMock).toHaveBeenCalledTimes(1);
    const [, params] = queryMock.mock.calls[0];
    expect(params).toEqual(["AAPL", 3]);
  });

  it("결과가 없으면 빈 배열을 반환한다", async () => {
    const pool = makePool<CorporateStockNewsRow>([]);

    const result = await findStockNews("UNKNOWN", 5, pool);

    expect(result).toHaveLength(0);
  });

  it("site가 null인 뉴스도 반환한다", async () => {
    const MOCK_ROWS: CorporateStockNewsRow[] = [
      { title: "Breaking News", site: null, published_date: "2026-03-25" },
    ];
    const pool = makePool(MOCK_ROWS);

    const result = await findStockNews("TSLA", 5, pool);

    expect(result[0].site).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// findUpcomingEarnings
// ---------------------------------------------------------------------------

describe("findUpcomingEarnings", () => {
  it("symbol과 baseDate를 파라미터로 쿼리하고 rows를 반환한다", async () => {
    const MOCK_ROWS: CorporateEarningCalendarRow[] = [
      {
        date: "2026-04-15",
        eps_estimated: "3.20",
        revenue_estimated: "43500000000",
        time: "AMC",
      },
    ];
    const pool = makePool(MOCK_ROWS);

    const result = await findUpcomingEarnings("NVDA", "2026-03-29", pool);

    expect(result).toHaveLength(1);
    expect(result[0].date).toBe("2026-04-15");
    expect(result[0].eps_estimated).toBe("3.20");
    expect(result[0].revenue_estimated).toBe("43500000000");
    expect(result[0].time).toBe("AMC");
  });

  it("symbol과 baseDate를 쿼리 파라미터로 전달한다", async () => {
    const pool = makePool<CorporateEarningCalendarRow>([]);

    await findUpcomingEarnings("MSFT", "2026-03-01", pool);

    const queryMock = pool.query as ReturnType<typeof vi.fn>;
    expect(queryMock).toHaveBeenCalledTimes(1);
    const [, params] = queryMock.mock.calls[0];
    expect(params).toEqual(["MSFT", "2026-03-01"]);
  });

  it("결과가 없으면 빈 배열을 반환한다", async () => {
    const pool = makePool<CorporateEarningCalendarRow>([]);

    const result = await findUpcomingEarnings("UNKNOWN", "2026-03-29", pool);

    expect(result).toHaveLength(0);
  });

  it("eps_estimated, revenue_estimated, time이 null인 행도 반환한다", async () => {
    const MOCK_ROWS: CorporateEarningCalendarRow[] = [
      {
        date: "2026-04-20",
        eps_estimated: null,
        revenue_estimated: null,
        time: null,
      },
    ];
    const pool = makePool(MOCK_ROWS);

    const result = await findUpcomingEarnings("AMZN", "2026-03-29", pool);

    expect(result[0].eps_estimated).toBeNull();
    expect(result[0].revenue_estimated).toBeNull();
    expect(result[0].time).toBeNull();
  });

  it("여러 실적 발표 일정을 date ASC 순서로 반환한다", async () => {
    const MOCK_ROWS: CorporateEarningCalendarRow[] = [
      { date: "2026-04-10", eps_estimated: "2.50", revenue_estimated: null, time: "BMO" },
      { date: "2026-04-15", eps_estimated: "3.20", revenue_estimated: null, time: "AMC" },
      { date: "2026-04-28", eps_estimated: "1.80", revenue_estimated: null, time: null },
    ];
    const pool = makePool(MOCK_ROWS);

    const result = await findUpcomingEarnings("META", "2026-03-29", pool);

    expect(result).toHaveLength(3);
    expect(result[0].date).toBe("2026-04-10");
    expect(result[2].date).toBe("2026-04-28");
  });
});

// ---------------------------------------------------------------------------
// findMarketRegimeByDate
// ---------------------------------------------------------------------------

describe("findMarketRegimeByDate", () => {
  it("recommendationDate를 파라미터로 전달하고 rows를 반환한다", async () => {
    const MOCK_ROWS: CorporateMarketRegimeRow[] = [
      { regime: "EARLY_BEAR", rationale: "Breadth deteriorating", confidence: "high" },
    ];
    const pool = makePool(MOCK_ROWS);

    const result = await findMarketRegimeByDate("2026-04-01", pool);

    expect(result).toHaveLength(1);
    expect(result[0].regime).toBe("EARLY_BEAR");
    expect(result[0].rationale).toBe("Breadth deteriorating");
    expect(result[0].confidence).toBe("high");
  });

  it("쿼리에 is_confirmed = true 필터가 포함된다", async () => {
    const pool = makePool<CorporateMarketRegimeRow>([]);

    await findMarketRegimeByDate("2026-04-07", pool);

    const queryMock = pool.query as ReturnType<typeof vi.fn>;
    expect(queryMock).toHaveBeenCalledTimes(1);
    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toContain("is_confirmed = true");
    expect(params).toEqual(["2026-04-07"]);
  });

  it("결과가 없으면 빈 배열을 반환한다", async () => {
    const pool = makePool<CorporateMarketRegimeRow>([]);

    const result = await findMarketRegimeByDate("2026-01-01", pool);

    expect(result).toHaveLength(0);
  });
});
