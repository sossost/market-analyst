import { describe, it, expect, vi, beforeEach } from "vitest";

const mockQuery = vi.fn();

vi.mock("@/db/client", () => ({
  pool: { query: (...args: unknown[]) => mockQuery(...args) },
}));

vi.mock("@/agent/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    step: vi.fn(),
  },
}));

import { evaluateDailySendGate } from "@/agent/dailySendGate";

const DATE = "2026-03-10";

function setupDefaultMocks() {
  // Default: all conditions return empty/no match
  // Explicit values chosen to be safely below thresholds:
  // - UNUSUAL_STOCK_THRESHOLD = 3, so cnt = "0"
  // - PHASE1_TO_2_THRESHOLD = 10, so total = "0"
  mockQuery.mockImplementation((sql: string) => {
    if (sql.includes("group_phase = 2 AND prev_group_phase = 1")) {
      return { rows: [] };
    }
    if (sql.includes("WITH today AS")) {
      return { rows: [{ sector: "Technology", is_new: false }] };
    }
    if (sql.includes("market_regimes")) {
      return { rows: [{ regime: "MID_BULL" }, { regime: "MID_BULL" }] };
    }
    if (sql.includes("phase = 2 AND prev_phase = 1")) {
      return { rows: [{ cnt: "0" }] };
    }
    if (sql.includes("phase1to2_count_5d")) {
      return { rows: [{ total: "0" }] };
    }
    return { rows: [] };
  });
}

describe("evaluateDailySendGate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultMocks();
  });

  it("returns shouldSend: false when no conditions met", async () => {
    const result = await evaluateDailySendGate(DATE);

    expect(result.shouldSend).toBe(false);
    expect(result.reasons).toEqual([]);
  });

  it("triggers on sector Phase 1→2 transition", async () => {
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes("group_phase = 2 AND prev_group_phase = 1")) {
        return { rows: [{ sector: "Technology" }] };
      }
      if (sql.includes("WITH today AS")) {
        return { rows: [] };
      }
      if (sql.includes("market_regimes")) {
        return { rows: [{ regime: "MID_BULL" }, { regime: "MID_BULL" }] };
      }
      if (sql.includes("phase = 2 AND prev_phase = 1")) {
        return { rows: [{ cnt: "0" }] };
      }
      if (sql.includes("phase1to2_count_5d")) {
        return { rows: [{ total: "0" }] };
      }
      return { rows: [] };
    });

    const result = await evaluateDailySendGate(DATE);

    expect(result.shouldSend).toBe(true);
    expect(result.reasons).toContain("섹터 Phase 1→2 전환: Technology");
  });

  it("triggers on regime change", async () => {
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes("group_phase = 2 AND prev_group_phase = 1")) {
        return { rows: [] };
      }
      if (sql.includes("WITH today AS")) {
        return { rows: [] };
      }
      if (sql.includes("market_regimes")) {
        return { rows: [{ regime: "EARLY_BULL" }, { regime: "BEAR" }] };
      }
      if (sql.includes("phase = 2 AND prev_phase = 1")) {
        return { rows: [{ cnt: "0" }] };
      }
      if (sql.includes("phase1to2_count_5d")) {
        return { rows: [{ total: "0" }] };
      }
      return { rows: [] };
    });

    const result = await evaluateDailySendGate(DATE);

    expect(result.shouldSend).toBe(true);
    expect(result.reasons).toContain("레짐 변화 감지: BEAR → EARLY_BULL");
  });

  it("triggers on unusual phase stocks above threshold", async () => {
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes("group_phase = 2 AND prev_group_phase = 1")) {
        return { rows: [] };
      }
      if (sql.includes("WITH today AS")) {
        return { rows: [] };
      }
      if (sql.includes("market_regimes")) {
        return { rows: [{ regime: "MID_BULL" }, { regime: "MID_BULL" }] };
      }
      if (sql.includes("phase = 2 AND prev_phase = 1")) {
        return { rows: [{ cnt: "5" }] };
      }
      if (sql.includes("phase1to2_count_5d")) {
        return { rows: [{ total: "0" }] };
      }
      return { rows: [] };
    });

    const result = await evaluateDailySendGate(DATE);

    expect(result.shouldSend).toBe(true);
    expect(result.reasons).toContain("Phase 1→2 전환 + 거래량 급증 종목 5개");
  });

  it("does NOT trigger when unusual stocks below threshold (2 < 3)", async () => {
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes("group_phase = 2 AND prev_group_phase = 1")) {
        return { rows: [] };
      }
      if (sql.includes("WITH today AS")) {
        return { rows: [] };
      }
      if (sql.includes("market_regimes")) {
        return { rows: [{ regime: "MID_BULL" }, { regime: "MID_BULL" }] };
      }
      if (sql.includes("phase = 2 AND prev_phase = 1")) {
        return { rows: [{ cnt: "2" }] };
      }
      if (sql.includes("phase1to2_count_5d")) {
        return { rows: [{ total: "0" }] };
      }
      return { rows: [] };
    });

    const result = await evaluateDailySendGate(DATE);

    expect(result.shouldSend).toBe(false);
  });

  it("triggers on Phase 1→2 surge (top 2 sectors >= 10)", async () => {
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes("group_phase = 2 AND prev_group_phase = 1")) {
        return { rows: [] };
      }
      if (sql.includes("WITH today AS")) {
        return { rows: [] };
      }
      if (sql.includes("market_regimes")) {
        return { rows: [{ regime: "MID_BULL" }, { regime: "MID_BULL" }] };
      }
      if (sql.includes("phase = 2 AND prev_phase = 1")) {
        return { rows: [{ cnt: "0" }] };
      }
      if (sql.includes("phase1to2_count_5d")) {
        return { rows: [{ total: "12" }] };
      }
      return { rows: [] };
    });

    const result = await evaluateDailySendGate(DATE);

    expect(result.shouldSend).toBe(true);
    expect(result.reasons).toContain("Phase 1→2 다수 전환: 상위 2개 섹터 합산 12개");
  });

  it("triggers on RS new entrant in top 3", async () => {
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes("group_phase = 2 AND prev_group_phase = 1")) {
        return { rows: [] };
      }
      if (sql.includes("WITH today AS")) {
        return {
          rows: [
            { sector: "Energy", is_new: true },
            { sector: "Technology", is_new: false },
            { sector: "Healthcare", is_new: false },
          ],
        };
      }
      if (sql.includes("market_regimes")) {
        return { rows: [{ regime: "MID_BULL" }, { regime: "MID_BULL" }] };
      }
      if (sql.includes("phase = 2 AND prev_phase = 1")) {
        return { rows: [{ cnt: "0" }] };
      }
      if (sql.includes("phase1to2_count_5d")) {
        return { rows: [{ total: "0" }] };
      }
      return { rows: [] };
    });

    const result = await evaluateDailySendGate(DATE);

    expect(result.shouldSend).toBe(true);
    expect(result.reasons).toContain("RS 급상승 신규 진입: Energy");
  });

  it("collects multiple reasons when multiple conditions met", async () => {
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes("group_phase = 2 AND prev_group_phase = 1")) {
        return { rows: [{ sector: "Technology" }] };
      }
      if (sql.includes("WITH today AS")) {
        return { rows: [] };
      }
      if (sql.includes("market_regimes")) {
        return { rows: [{ regime: "EARLY_BULL" }, { regime: "BEAR" }] };
      }
      if (sql.includes("phase = 2 AND prev_phase = 1")) {
        return { rows: [{ cnt: "4" }] };
      }
      if (sql.includes("phase1to2_count_5d")) {
        return { rows: [{ total: "0" }] };
      }
      return { rows: [] };
    });

    const result = await evaluateDailySendGate(DATE);

    expect(result.shouldSend).toBe(true);
    expect(result.reasons.length).toBeGreaterThanOrEqual(3);
  });

  it("returns shouldSend: true on DB query failure (safe fallback)", async () => {
    mockQuery.mockRejectedValue(new Error("Connection refused"));

    const result = await evaluateDailySendGate(DATE);

    expect(result.shouldSend).toBe(true);
    expect(result.reasons.some((r) => r.includes("실패"))).toBe(true);
  });

  it("returns shouldSend: false when regime data has fewer than 2 rows", async () => {
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes("group_phase = 2 AND prev_group_phase = 1")) {
        return { rows: [] };
      }
      if (sql.includes("WITH today AS")) {
        return { rows: [] };
      }
      if (sql.includes("market_regimes")) {
        return { rows: [{ regime: "MID_BULL" }] }; // only 1 row
      }
      if (sql.includes("phase = 2 AND prev_phase = 1")) {
        return { rows: [{ cnt: "0" }] };
      }
      if (sql.includes("phase1to2_count_5d")) {
        return { rows: [{ total: "0" }] };
      }
      return { rows: [] };
    });

    const result = await evaluateDailySendGate(DATE);

    expect(result.shouldSend).toBe(false);
  });
});
