import { describe, it, expect, vi } from "vitest";
import {
  collectFailureConditions,
  getMarketBreadthDirection,
  getSectorRsIsolated,
  getVolumeConfirmed,
  getSepaGrade,
  calcLinearSlope,
  classifySlope,
  type DbExecutor,
} from "../../src/lib/marketConditionCollector.js";

// ─── Mock DB helper ─────────────────────────────────────────────────

function createMockDb(
  handler: (query: unknown) => { rows: unknown[] },
): DbExecutor {
  return {
    execute: vi.fn().mockImplementation((query) => Promise.resolve(handler(query))),
  };
}

/**
 * 쿼리 내 SQL 문자열에서 특정 키워드 포함 여부로 분기하는 mock DB.
 * drizzle의 sql`` 태그 결과는 내부적으로 queryChunks를 가지므로
 * JSON.stringify로 전체 구조를 문자열화하여 키워드 검색한다.
 */
function createRoutingMockDb(
  routes: Array<{ match: string; rows: unknown[] }>,
): DbExecutor {
  return {
    execute: vi.fn().mockImplementation((query) => {
      const queryStr = JSON.stringify(query);
      for (const route of routes) {
        if (queryStr.includes(route.match)) {
          return Promise.resolve({ rows: route.rows });
        }
      }
      return Promise.resolve({ rows: [] });
    }),
  };
}

// ─── calcLinearSlope ────────────────────────────────────────────────

describe("calcLinearSlope", () => {
  it("returns positive slope for increasing values", () => {
    const slope = calcLinearSlope([1, 2, 3, 4, 5]);
    expect(slope).toBe(1);
  });

  it("returns negative slope for decreasing values", () => {
    const slope = calcLinearSlope([5, 4, 3, 2, 1]);
    expect(slope).toBe(-1);
  });

  it("returns zero for constant values", () => {
    const slope = calcLinearSlope([3, 3, 3, 3]);
    expect(slope).toBe(0);
  });

  it("returns 0 for single value", () => {
    const slope = calcLinearSlope([5]);
    expect(slope).toBe(0);
  });

  it("returns 0 for empty array", () => {
    const slope = calcLinearSlope([]);
    expect(slope).toBe(0);
  });

  it("calculates correct slope for non-trivial data", () => {
    // y = 2x + 1 → slope = 2
    const slope = calcLinearSlope([1, 3, 5, 7, 9]);
    expect(slope).toBe(2);
  });
});

// ─── classifySlope ──────────────────────────────────────────────────

describe("classifySlope", () => {
  it("returns 'improving' for positive slope above threshold", () => {
    expect(classifySlope(0.01)).toBe("improving");
  });

  it("returns 'declining' for negative slope below threshold", () => {
    expect(classifySlope(-0.01)).toBe("declining");
  });

  it("returns 'neutral' for slope near zero", () => {
    expect(classifySlope(0.0005)).toBe("neutral");
    expect(classifySlope(-0.0005)).toBe("neutral");
    expect(classifySlope(0)).toBe("neutral");
  });

  it("returns 'improving' at exactly above threshold", () => {
    expect(classifySlope(0.0011)).toBe("improving");
  });

  it("returns 'declining' at exactly below negative threshold", () => {
    expect(classifySlope(-0.0011)).toBe("declining");
  });
});

// ─── getMarketBreadthDirection ──────────────────────────────────────

describe("getMarketBreadthDirection", () => {
  it("returns 'improving' when phase2_ratio is trending up", async () => {
    // 시간 역순 (최신 먼저) — 함수 내부에서 reverse 처리
    const db = createMockDb(() => ({
      rows: [
        { date: "2026-03-05", avg_phase2_ratio: "0.30" },
        { date: "2026-03-04", avg_phase2_ratio: "0.28" },
        { date: "2026-03-03", avg_phase2_ratio: "0.25" },
        { date: "2026-03-02", avg_phase2_ratio: "0.22" },
        { date: "2026-03-01", avg_phase2_ratio: "0.20" },
      ],
    }));

    const result = await getMarketBreadthDirection("2026-03-05", db);
    expect(result).toBe("improving");
  });

  it("returns 'declining' when phase2_ratio is trending down", async () => {
    const db = createMockDb(() => ({
      rows: [
        { date: "2026-03-05", avg_phase2_ratio: "0.15" },
        { date: "2026-03-04", avg_phase2_ratio: "0.18" },
        { date: "2026-03-03", avg_phase2_ratio: "0.22" },
        { date: "2026-03-02", avg_phase2_ratio: "0.25" },
        { date: "2026-03-01", avg_phase2_ratio: "0.30" },
      ],
    }));

    const result = await getMarketBreadthDirection("2026-03-05", db);
    expect(result).toBe("declining");
  });

  it("returns 'neutral' when phase2_ratio is flat", async () => {
    const db = createMockDb(() => ({
      rows: [
        { date: "2026-03-05", avg_phase2_ratio: "0.250" },
        { date: "2026-03-04", avg_phase2_ratio: "0.250" },
        { date: "2026-03-03", avg_phase2_ratio: "0.250" },
        { date: "2026-03-02", avg_phase2_ratio: "0.250" },
        { date: "2026-03-01", avg_phase2_ratio: "0.250" },
      ],
    }));

    const result = await getMarketBreadthDirection("2026-03-05", db);
    expect(result).toBe("neutral");
  });

  it("returns null when fewer than 2 data points", async () => {
    const db = createMockDb(() => ({
      rows: [{ date: "2026-03-05", avg_phase2_ratio: "0.25" }],
    }));

    const result = await getMarketBreadthDirection("2026-03-05", db);
    expect(result).toBeNull();
  });

  it("returns null when no data available", async () => {
    const db = createMockDb(() => ({ rows: [] }));

    const result = await getMarketBreadthDirection("2026-03-05", db);
    expect(result).toBeNull();
  });

  it("filters out null phase2_ratio values", async () => {
    const db = createMockDb(() => ({
      rows: [
        { date: "2026-03-05", avg_phase2_ratio: "0.30" },
        { date: "2026-03-04", avg_phase2_ratio: null },
        { date: "2026-03-03", avg_phase2_ratio: "0.20" },
      ],
    }));

    const result = await getMarketBreadthDirection("2026-03-05", db);
    // 0.20 → 0.30, slope positive
    expect(result).toBe("improving");
  });
});

// ─── getSectorRsIsolated ────────────────────────────────────────────

describe("getSectorRsIsolated", () => {
  it("returns true when fewer than 2 co-rising sectors (isolated)", async () => {
    const db = createRoutingMockDb([
      { match: "symbols", rows: [{ sector: "Technology" }] },
      {
        match: "sector_rs_daily",
        rows: [
          { sector: "Technology", change_4w: "5.0" },
          { sector: "Energy", change_4w: "-2.0" },
          { sector: "Healthcare", change_4w: "-1.0" },
          { sector: "Financials", change_4w: "-3.0" },
          { sector: "Industrials", change_4w: "1.0" }, // 1개만 동반 상승
        ],
      },
    ]);

    const result = await getSectorRsIsolated("AAPL", "2026-03-05", db);
    expect(result).toBe(true);
  });

  it("returns false when 2+ co-rising sectors (not isolated)", async () => {
    const db = createRoutingMockDb([
      { match: "symbols", rows: [{ sector: "Technology" }] },
      {
        match: "sector_rs_daily",
        rows: [
          { sector: "Technology", change_4w: "5.0" },
          { sector: "Energy", change_4w: "3.0" },
          { sector: "Healthcare", change_4w: "2.0" },
          { sector: "Financials", change_4w: "-1.0" },
          { sector: "Industrials", change_4w: "-2.0" },
        ],
      },
    ]);

    const result = await getSectorRsIsolated("AAPL", "2026-03-05", db);
    expect(result).toBe(false);
  });

  it("returns null when symbol has no sector", async () => {
    const db = createRoutingMockDb([
      { match: "symbols", rows: [{ sector: null }] },
    ]);

    const result = await getSectorRsIsolated("UNKNOWN", "2026-03-05", db);
    expect(result).toBeNull();
  });

  it("returns null when symbol not found", async () => {
    const db = createRoutingMockDb([
      { match: "symbols", rows: [] },
    ]);

    const result = await getSectorRsIsolated("NONE", "2026-03-05", db);
    expect(result).toBeNull();
  });

  it("returns null when no sector_rs_daily data", async () => {
    const db = createRoutingMockDb([
      { match: "symbols", rows: [{ sector: "Technology" }] },
      { match: "sector_rs_daily", rows: [] },
    ]);

    const result = await getSectorRsIsolated("AAPL", "2026-03-05", db);
    expect(result).toBeNull();
  });

  it("excludes own sector from co-rising count", async () => {
    // Technology 자신은 제외하고 나머지 중 동반 상승 체크
    const db = createRoutingMockDb([
      { match: "symbols", rows: [{ sector: "Technology" }] },
      {
        match: "sector_rs_daily",
        rows: [
          { sector: "Technology", change_4w: "10.0" },
          { sector: "Energy", change_4w: "3.0" },
          { sector: "Healthcare", change_4w: "2.0" },
          { sector: "Financials", change_4w: "1.0" },
          { sector: "Industrials", change_4w: "-1.0" },
        ],
      },
    ]);

    const result = await getSectorRsIsolated("AAPL", "2026-03-05", db);
    // Energy, Healthcare, Financials = 3개 동반 상승 → not isolated
    expect(result).toBe(false);
  });

  it("treats null change_4w as non-rising", async () => {
    const db = createRoutingMockDb([
      { match: "symbols", rows: [{ sector: "Technology" }] },
      {
        match: "sector_rs_daily",
        rows: [
          { sector: "Technology", change_4w: "5.0" },
          { sector: "Energy", change_4w: null },
          { sector: "Healthcare", change_4w: null },
          { sector: "Financials", change_4w: null },
          { sector: "Industrials", change_4w: "1.0" }, // 1개만
        ],
      },
    ]);

    const result = await getSectorRsIsolated("AAPL", "2026-03-05", db);
    expect(result).toBe(true);
  });
});

// ─── getVolumeConfirmed ─────────────────────────────────────────────

describe("getVolumeConfirmed", () => {
  it("returns true when volume confirmed", async () => {
    const db = createMockDb(() => ({
      rows: [{ volume_confirmed: true }],
    }));

    const result = await getVolumeConfirmed("AAPL", "2026-03-05", db);
    expect(result).toBe(true);
  });

  it("returns false when volume not confirmed", async () => {
    const db = createMockDb(() => ({
      rows: [{ volume_confirmed: false }],
    }));

    const result = await getVolumeConfirmed("AAPL", "2026-03-05", db);
    expect(result).toBe(false);
  });

  it("returns null when no stock_phases data", async () => {
    const db = createMockDb(() => ({ rows: [] }));

    const result = await getVolumeConfirmed("NONE", "2026-03-05", db);
    expect(result).toBeNull();
  });

  it("returns null when volume_confirmed is null in DB", async () => {
    const db = createMockDb(() => ({
      rows: [{ volume_confirmed: null }],
    }));

    const result = await getVolumeConfirmed("AAPL", "2026-03-05", db);
    expect(result).toBeNull();
  });
});

// ─── getSepaGrade ───────────────────────────────────────────────────

describe("getSepaGrade", () => {
  it.each(["S", "A", "B", "C", "F"] as const)(
    "returns '%s' grade when found",
    async (grade) => {
      const db = createMockDb(() => ({
        rows: [{ grade }],
      }));

      const result = await getSepaGrade("AAPL", "2026-03-05", db);
      expect(result).toBe(grade);
    },
  );

  it("returns null when no fundamental_scores data", async () => {
    const db = createMockDb(() => ({ rows: [] }));

    const result = await getSepaGrade("NONE", "2026-03-05", db);
    expect(result).toBeNull();
  });

  it("returns null for invalid grade value", async () => {
    const db = createMockDb(() => ({
      rows: [{ grade: "X" }],
    }));

    const result = await getSepaGrade("AAPL", "2026-03-05", db);
    expect(result).toBeNull();
  });

  it("returns null when grade is null in DB", async () => {
    const db = createMockDb(() => ({
      rows: [{ grade: null }],
    }));

    const result = await getSepaGrade("AAPL", "2026-03-05", db);
    expect(result).toBeNull();
  });
});

// ─── collectFailureConditions (integration) ─────────────────────────

describe("collectFailureConditions", () => {
  it("collects all conditions in parallel", async () => {
    const db = createRoutingMockDb([
      // breadth query: sector_rs_daily with GROUP BY
      {
        match: "AVG",
        rows: [
          { date: "2026-03-05", avg_phase2_ratio: "0.30" },
          { date: "2026-03-04", avg_phase2_ratio: "0.28" },
          { date: "2026-03-03", avg_phase2_ratio: "0.25" },
        ],
      },
      // sector lookup
      { match: "symbols", rows: [{ sector: "Technology" }] },
      // top sectors
      {
        match: "sector_rs_daily",
        rows: [
          { sector: "Technology", change_4w: "5.0" },
          { sector: "Energy", change_4w: "3.0" },
          { sector: "Healthcare", change_4w: "2.0" },
          { sector: "Financials", change_4w: "-1.0" },
          { sector: "Industrials", change_4w: "-2.0" },
        ],
      },
      // volume
      { match: "stock_phases", rows: [{ volume_confirmed: true }] },
      // sepa grade
      { match: "fundamental_scores", rows: [{ grade: "A" }] },
    ]);

    const result = await collectFailureConditions("AAPL", "2026-03-05", db);

    expect(result).toEqual({
      marketBreadthDirection: expect.any(String),
      sectorRsIsolated: expect.any(Boolean),
      volumeConfirmed: true,
      sepaGrade: "A",
    });
  });

  it("returns all nulls when no data available", async () => {
    const db = createMockDb(() => ({ rows: [] }));

    const result = await collectFailureConditions("NONE", "2026-03-05", db);

    expect(result).toEqual({
      marketBreadthDirection: null,
      sectorRsIsolated: null,
      volumeConfirmed: null,
      sepaGrade: null,
    });
  });
});
