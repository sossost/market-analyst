import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Mocks ──────────────────────────────────────────────────────────────────

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), step: vi.fn() },
}));

vi.mock("@/lib/retry", () => ({
  retryApiCall: vi.fn((fn: () => unknown) => fn()),
}));

import {
  createUWApiConfig,
  fetchOptionsFlow,
  fetchDarkPoolTrades,
} from "../unusual-whales-client";

// ─── Test Data ──────────────────────────────────────────────────────────────

const MOCK_OPTIONS_RESPONSE = {
  data: [
    {
      id: "opt-1",
      ticker: "AAPL",
      date: "2026-03-20",
      strike_price: "200.00",
      expire_date: "2026-04-17",
      put_call: "CALL",
      sentiment: "BULLISH",
      premium: "150000",
      volume: 500,
      open_interest: 2000,
      underlying_price: "198.50",
      is_sweep: true,
      is_block: false,
      is_etf: false,
      is_unusual: true,
    },
    {
      id: "opt-2",
      ticker: "SPY",
      date: "2026-03-20",
      strike_price: "550.00",
      expire_date: "2026-04-17",
      put_call: "PUT",
      sentiment: "BEARISH",
      premium: "80000",
      volume: 300,
      open_interest: 5000,
      underlying_price: "545.00",
      is_sweep: false,
      is_block: true,
      is_etf: true,
      is_unusual: false,
    },
  ],
};

const MOCK_DARKPOOL_RESPONSE = {
  data: [
    {
      ticker: "NVDA",
      date: "2026-03-20",
      price: "850.00",
      size: 10000,
      notional_value: "8500000",
      tracking_timestamp: "2026-03-20T10:30:00Z",
    },
  ],
};

describe("unusual-whales-client", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.UW_API_TOKEN = "test-token-123";
    process.env.UW_API_BASE_URL = "https://api.test.unusualwhales.com/api";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe("createUWApiConfig", () => {
    it("UW_API_TOKEN이 설정되면 config를 반환한다", () => {
      const config = createUWApiConfig();
      expect(config.apiToken).toBe("test-token-123");
      expect(config.baseUrl).toBe("https://api.test.unusualwhales.com/api");
    });

    it("UW_API_TOKEN이 없으면 에러를 던진다", () => {
      delete process.env.UW_API_TOKEN;
      expect(() => createUWApiConfig()).toThrow("Missing required environment variable: UW_API_TOKEN");
    });

    it("UW_API_BASE_URL이 없으면 기본 URL을 사용한다", () => {
      delete process.env.UW_API_BASE_URL;
      const config = createUWApiConfig();
      expect(config.baseUrl).toBe("https://api.unusualwhales.com/api");
    });
  });

  describe("fetchOptionsFlow", () => {
    it("옵션 플로우 데이터를 정규화하여 반환한다", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(MOCK_OPTIONS_RESPONSE),
      });

      const config = createUWApiConfig();
      const records = await fetchOptionsFlow(config, "2026-03-20");

      // ETF (SPY) 필터링됨
      expect(records).toHaveLength(1);
      expect(records[0].symbol).toBe("AAPL");
      expect(records[0].putCall).toBe("CALL");
      expect(records[0].sentiment).toBe("BULLISH");
      expect(records[0].isSweep).toBe(true);
      expect(records[0].externalId).toBe("opt-1");
    });

    it("빈 응답일 때 빈 배열을 반환한다", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: [] }),
      });

      const config = createUWApiConfig();
      const records = await fetchOptionsFlow(config, "2026-03-20");
      expect(records).toHaveLength(0);
    });

    it("data가 null이면 빈 배열을 반환한다", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: null }),
      });

      const config = createUWApiConfig();
      const records = await fetchOptionsFlow(config, "2026-03-20");
      expect(records).toHaveLength(0);
    });

    it("Authorization 헤더를 Bearer 토큰으로 전송한다", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: [] }),
      });

      const config = createUWApiConfig();
      await fetchOptionsFlow(config, "2026-03-20");

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/stock/flow?date=2026-03-20"),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer test-token-123",
          }),
        }),
      );
    });
  });

  describe("fetchDarkPoolTrades", () => {
    it("다크풀 거래 데이터를 정규화하여 반환한다", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(MOCK_DARKPOOL_RESPONSE),
      });

      const config = createUWApiConfig();
      const records = await fetchDarkPoolTrades(config, "2026-03-20");

      expect(records).toHaveLength(1);
      expect(records[0].symbol).toBe("NVDA");
      expect(records[0].size).toBe(10000);
      expect(records[0].notionalValue).toBe("8500000");
    });

    it("ticker가 비어있는 레코드를 필터링한다", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            data: [
              { ...MOCK_DARKPOOL_RESPONSE.data[0] },
              { ...MOCK_DARKPOOL_RESPONSE.data[0], ticker: "" },
            ],
          }),
      });

      const config = createUWApiConfig();
      const records = await fetchDarkPoolTrades(config, "2026-03-20");
      expect(records).toHaveLength(1);
    });
  });
});
