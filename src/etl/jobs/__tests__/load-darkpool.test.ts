import { describe, it, expect, vi, beforeEach } from "vitest";
import { aggregateDarkPoolTrades } from "../load-darkpool";
import type { DarkPoolTradeRecord } from "@/types/unusual-whales";

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

function makeTrade(overrides: Partial<DarkPoolTradeRecord> = {}): DarkPoolTradeRecord {
  return {
    symbol: "NVDA",
    date: "2026-03-20",
    price: "850.00",
    size: 10000,
    notionalValue: "8500000",
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("load-darkpool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("aggregateDarkPoolTrades", () => {
    it("같은 symbol+date의 거래를 하나의 집계로 합산한다", () => {
      const trades = [
        makeTrade({ price: "850.00", size: 10000, notionalValue: "8500000" }),
        makeTrade({ price: "860.00", size: 5000, notionalValue: "4300000" }),
      ];

      const result = aggregateDarkPoolTrades(trades);

      expect(result).toHaveLength(1);
      expect(result[0].symbol).toBe("NVDA");
      expect(result[0].totalShares).toBe(15000);
      expect(result[0].totalNotional).toBe(12800000);
      expect(result[0].tradeCount).toBe(2);
      expect(result[0].avgPrice).toBe(855); // (850 + 860) / 2
      expect(result[0].blockSize).toBe(7500); // 15000 / 2
    });

    it("서로 다른 symbol은 별도 집계한다", () => {
      const trades = [
        makeTrade({ symbol: "NVDA", size: 10000 }),
        makeTrade({ symbol: "AAPL", size: 5000 }),
      ];

      const result = aggregateDarkPoolTrades(trades);
      expect(result).toHaveLength(2);

      const nvda = result.find((r) => r.symbol === "NVDA");
      const aapl = result.find((r) => r.symbol === "AAPL");
      expect(nvda!.totalShares).toBe(10000);
      expect(aapl!.totalShares).toBe(5000);
    });

    it("서로 다른 date는 별도 집계한다", () => {
      const trades = [
        makeTrade({ date: "2026-03-19" }),
        makeTrade({ date: "2026-03-20" }),
      ];

      const result = aggregateDarkPoolTrades(trades);
      expect(result).toHaveLength(2);
    });

    it("빈 배열이면 빈 배열을 반환한다", () => {
      const result = aggregateDarkPoolTrades([]);
      expect(result).toHaveLength(0);
    });

    it("단일 거래도 올바르게 집계한다", () => {
      const trades = [makeTrade()];

      const result = aggregateDarkPoolTrades(trades);

      expect(result).toHaveLength(1);
      expect(result[0].tradeCount).toBe(1);
      expect(result[0].avgPrice).toBe(850);
      expect(result[0].blockSize).toBe(10000);
    });
  });
});
