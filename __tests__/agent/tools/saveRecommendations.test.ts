import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockValues, mockOnConflictDoNothing, mockQuery } = vi.hoisted(() => ({
  mockValues: vi.fn(),
  mockOnConflictDoNothing: vi.fn(),
  mockQuery: vi.fn(),
}));

vi.mock("@/db/client", () => ({
  db: {
    insert: () => ({ values: mockValues }),
  },
  pool: {
    query: mockQuery,
  },
}));

vi.mock("@/db/schema/analyst", () => ({
  recommendations: {
    symbol: "symbol",
    recommendationDate: "recommendation_date",
  },
  recommendationFactors: {
    symbol: "symbol",
    recommendationDate: "recommendation_date",
  },
}));

vi.mock("@/etl/utils/retry", () => ({
  retryDatabaseOperation: vi.fn((fn: () => unknown) => fn()),
}));

vi.mock("@/etl/utils/common", () => ({
  toNum: (v: unknown) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  },
}));

vi.mock("@/agent/debate/regimeStore", () => ({
  loadConfirmedRegime: vi.fn().mockResolvedValue(null),
  loadPendingRegimes: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/tools/bearExceptionGate", () => ({
  evaluateBearException: vi.fn(),
  tagBearExceptionReason: vi.fn((r: string | null) => r),
  BEAR_EXCEPTION_TAG: "[Bear 예외]",
}));

vi.mock("@/agent/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@/agent/corporateAnalyst/runCorporateAnalyst", () => ({
  runCorporateAnalyst: vi.fn().mockResolvedValue({ success: true }),
}));

import { saveRecommendations } from "@/tools/saveRecommendations";

describe("saveRecommendations", () => {
  function setupPoolMocks() {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })  // activeRows
      .mockResolvedValueOnce({ rows: [] })  // cooldownRows
      .mockResolvedValueOnce({ rows: [{ symbol: "AAPL", phase2_count: "3" }] })  // persistenceRows
      .mockResolvedValue({ rows: [] });     // priceRows + saveFactorSnapshot fallback
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockValues.mockReturnValue({
      onConflictDoNothing: mockOnConflictDoNothing,
    });
    mockOnConflictDoNothing.mockResolvedValue({ rowCount: 1 });
  });

  it("has correct tool name", () => {
    expect(saveRecommendations.definition.name).toBe("save_recommendations");
  });

  it("rejects invalid date", async () => {
    const result = await saveRecommendations.execute({
      date: "not-a-date",
      recommendations: [],
    });
    const parsed = JSON.parse(result);

    expect(parsed.error).toContain("Invalid");
  });

  it("rejects empty recommendations array", async () => {
    const result = await saveRecommendations.execute({
      date: "2026-03-05",
      recommendations: [],
    });
    const parsed = JSON.parse(result);

    expect(parsed.error).toContain("non-empty array");
  });

  it("rejects missing recommendations", async () => {
    const result = await saveRecommendations.execute({
      date: "2026-03-05",
    });
    const parsed = JSON.parse(result);

    expect(parsed.error).toContain("non-empty array");
  });

  it("saves valid recommendations", async () => {
    setupPoolMocks();
    const result = await saveRecommendations.execute({
      date: "2026-03-05",
      recommendations: [
        {
          symbol: "AAPL",
          entry_price: 185.5,
          phase: 2,
          prev_phase: 1,
          rs_score: 78,
          sector: "Technology",
          industry: "Consumer Electronics",
          reason: "Phase 1→2 전환, RS 강세",
        },
      ],
    });
    const parsed = JSON.parse(result);

    expect(parsed.success).toBe(true);
    expect(parsed.savedCount).toBe(1);
    expect(parsed.skippedCount).toBe(0);
  });

  it("skips recommendations with zero entry price", async () => {
    setupPoolMocks();
    const result = await saveRecommendations.execute({
      date: "2026-03-05",
      recommendations: [
        {
          symbol: "BAD",
          entry_price: 0,
          phase: 2,
          rs_score: 70,
          sector: "Tech",
          industry: "SW",
          reason: "test",
        },
      ],
    });
    const parsed = JSON.parse(result);

    expect(parsed.success).toBe(true);
    expect(parsed.savedCount).toBe(0);
    expect(parsed.skippedCount).toBe(1);
  });

  it("skips recommendations with invalid symbol", async () => {
    setupPoolMocks();
    const result = await saveRecommendations.execute({
      date: "2026-03-05",
      recommendations: [
        {
          symbol: "",
          entry_price: 100,
          phase: 2,
          rs_score: 70,
          sector: "Tech",
          industry: "SW",
          reason: "test",
        },
      ],
    });
    const parsed = JSON.parse(result);

    expect(parsed.success).toBe(true);
    expect(parsed.savedCount).toBe(0);
    expect(parsed.skippedCount).toBe(1);
  });

  it("handles duplicate (onConflictDoNothing) as skip", async () => {
    mockOnConflictDoNothing.mockResolvedValue({ rowCount: 0 });
    setupPoolMocks();

    const result = await saveRecommendations.execute({
      date: "2026-03-05",
      recommendations: [
        {
          symbol: "AAPL",
          entry_price: 185,
          phase: 2,
          rs_score: 78,
          sector: "Technology",
          industry: "Consumer Electronics",
          reason: "duplicate test",
        },
      ],
    });
    const parsed = JSON.parse(result);

    expect(parsed.success).toBe(true);
    expect(parsed.savedCount).toBe(0);
    expect(parsed.skippedCount).toBe(1);
  });

  it("handles multiple recommendations with mixed validity", async () => {
    mockOnConflictDoNothing
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({ rowCount: 1 });
    setupPoolMocks();

    const result = await saveRecommendations.execute({
      date: "2026-03-05",
      recommendations: [
        {
          symbol: "AAPL",
          entry_price: 185,
          phase: 2,
          rs_score: 78,
          sector: "Technology",
          industry: "CE",
          reason: "good",
        },
        {
          symbol: "BAD",
          entry_price: 0,
          phase: 2,
          rs_score: 70,
          sector: "Tech",
          industry: "SW",
          reason: "bad price",
        },
      ],
    });
    const parsed = JSON.parse(result);

    expect(parsed.success).toBe(true);
    expect(parsed.savedCount).toBe(1);
    expect(parsed.skippedCount).toBe(1);
  });
});
