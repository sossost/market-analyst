import { describe, it, expect, vi, beforeEach } from "vitest";
import { aggregateOptionsFlow } from "../load-options-flow";
import type { OptionsFlowRecord } from "@/types/unusual-whales";

// ─── Mocks (ETL 패턴) ──────────────────────────────────────────────────────

vi.mock("@/db/client", () => ({
  db: { insert: vi.fn() },
  pool: { end: vi.fn() },
}));
vi.mock("dotenv/config", () => ({}));
vi.mock("@/lib/retry", () => ({
  retryApiCall: vi.fn((fn: () => unknown) => fn()),
  retryDatabaseOperation: vi.fn((fn: () => unknown) => fn()),
  DEFAULT_RETRY_OPTIONS: {},
}));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), step: vi.fn() },
}));

// ─── Test Helpers ───────────────────────────────────────────────────────────

function makeRecord(overrides: Partial<OptionsFlowRecord> = {}): OptionsFlowRecord {
  return {
    symbol: "AAPL",
    date: "2026-03-20",
    strikePrice: "200.00",
    expireDate: "2026-04-17",
    putCall: "CALL",
    sentiment: "BULLISH",
    premium: "100000",
    volume: 500,
    openInterest: 2000,
    underlyingPrice: "198.50",
    isSweep: false,
    isBlock: false,
    isUnusual: false,
    externalId: "opt-1",
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("load-options-flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("aggregateOptionsFlow", () => {
    it("같은 symbol+date의 레코드를 하나의 집계로 합산한다", () => {
      const records = [
        makeRecord({ premium: "100000", putCall: "CALL", sentiment: "BULLISH", isSweep: true }),
        makeRecord({ premium: "50000", putCall: "PUT", sentiment: "BEARISH", externalId: "opt-2" }),
        makeRecord({ premium: "30000", putCall: "CALL", sentiment: "BULLISH", isBlock: true, externalId: "opt-3" }),
      ];

      const result = aggregateOptionsFlow(records);

      expect(result).toHaveLength(1);
      expect(result[0].symbol).toBe("AAPL");
      expect(result[0].totalPremium).toBe(180000);
      expect(result[0].callPremium).toBe(130000); // 100K + 30K
      expect(result[0].putPremium).toBe(50000);
      expect(result[0].totalContracts).toBe(1500); // 500 * 3
      expect(result[0].sweepCount).toBe(1);
      expect(result[0].blockCount).toBe(1);
      expect(result[0].bullishPremium).toBe(130000);
      expect(result[0].bearishPremium).toBe(50000);
    });

    it("서로 다른 symbol은 별도 집계한다", () => {
      const records = [
        makeRecord({ symbol: "AAPL", premium: "100000" }),
        makeRecord({ symbol: "NVDA", premium: "200000", externalId: "opt-2" }),
      ];

      const result = aggregateOptionsFlow(records);
      expect(result).toHaveLength(2);

      const aapl = result.find((r) => r.symbol === "AAPL");
      const nvda = result.find((r) => r.symbol === "NVDA");
      expect(aapl!.totalPremium).toBe(100000);
      expect(nvda!.totalPremium).toBe(200000);
    });

    it("서로 다른 date는 별도 집계한다", () => {
      const records = [
        makeRecord({ date: "2026-03-19", premium: "100000" }),
        makeRecord({ date: "2026-03-20", premium: "200000", externalId: "opt-2" }),
      ];

      const result = aggregateOptionsFlow(records);
      expect(result).toHaveLength(2);
    });

    it("call/put ratio는 99 이하로 캡한다", () => {
      const records = [
        makeRecord({ putCall: "CALL", premium: "1000000" }),
      ];

      const result = aggregateOptionsFlow(records);
      // putPremium = 0, callPremium > 0 → capped at 99
      expect(result[0].callPutRatio).toBe(99);
    });

    it("sentimentScore는 -100 ~ +100 범위이다", () => {
      // All bullish
      const allBullish = aggregateOptionsFlow([
        makeRecord({ sentiment: "BULLISH", premium: "100000" }),
      ]);
      expect(allBullish[0].sentimentScore).toBe(100);

      // All bearish
      const allBearish = aggregateOptionsFlow([
        makeRecord({ sentiment: "BEARISH", premium: "100000" }),
      ]);
      expect(allBearish[0].sentimentScore).toBe(-100);

      // Mixed
      const mixed = aggregateOptionsFlow([
        makeRecord({ sentiment: "BULLISH", premium: "60000" }),
        makeRecord({ sentiment: "BEARISH", premium: "40000", externalId: "opt-2" }),
      ]);
      // (60K - 40K) / (60K + 40K) * 100 = 20
      expect(mixed[0].sentimentScore).toBe(20);
    });

    it("빈 배열이면 빈 배열을 반환한다", () => {
      const result = aggregateOptionsFlow([]);
      expect(result).toHaveLength(0);
    });

    it("NEUTRAL 센티먼트는 bullish/bearish에 포함되지 않는다", () => {
      const records = [
        makeRecord({ sentiment: "NEUTRAL", premium: "100000" }),
      ];

      const result = aggregateOptionsFlow(records);
      expect(result[0].bullishPremium).toBe(0);
      expect(result[0].bearishPremium).toBe(0);
      expect(result[0].sentimentScore).toBe(0);
    });
  });
});
