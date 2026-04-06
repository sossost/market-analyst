import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockInsert, mockFetchJson, mockSleep } = vi.hoisted(() => ({
  mockInsert: vi.fn(),
  mockFetchJson: vi.fn(),
  mockSleep: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/db/client", () => ({
  db: {
    insert: mockInsert,
  },
  pool: { end: vi.fn() },
}));
vi.mock("dotenv/config", () => ({}));
vi.mock("@/etl/utils/validation", () => ({
  validateEnvironmentVariables: vi
    .fn()
    .mockReturnValue({ isValid: true, errors: [], warnings: [] }),
}));
vi.mock("@/etl/utils/retry", () => ({
  retryApiCall: vi.fn((fn: () => unknown) => fn()),
  retryDatabaseOperation: vi.fn((fn: () => unknown) => fn()),
  DEFAULT_RETRY_OPTIONS: {},
}));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@/etl/utils/common", () => ({
  fetchJson: mockFetchJson,
  sleep: mockSleep,
  toStrNum: (v: unknown) => {
    const n = Number(v);
    return Number.isFinite(n) ? String(n) : null;
  },
}));

import { loadIndexPrices } from "../load-index-prices.js";

const MOCK_HISTORICAL = [
  { date: "2026-03-24", open: 5800, high: 5850, low: 5780, close: 5830, volume: 3500000000 },
  { date: "2026-03-23", open: 5750, high: 5810, low: 5740, close: 5800, volume: 3200000000 },
];

describe("load-index-prices", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    process.env.DATA_API = "https://financialmodelingprep.com";
    process.env.FMP_API_KEY = "test-api-key-12345";

    const onConflictMock = vi.fn().mockResolvedValue(undefined);
    const valuesMock = vi
      .fn()
      .mockReturnValue({ onConflictDoUpdate: onConflictMock });
    mockInsert.mockReturnValue({ values: valuesMock });
  });

  afterEach(() => {
    delete process.env.DATA_API;
    delete process.env.FMP_API_KEY;
  });

  it("7개 지수의 가격 데이터를 fetch하고 UPSERT한다", async () => {
    mockFetchJson.mockResolvedValue({ historical: MOCK_HISTORICAL });

    await loadIndexPrices();

    // 7개 지수에 대해 각 1회 fetch
    expect(mockFetchJson).toHaveBeenCalledTimes(7);
    expect(mockFetchJson).toHaveBeenCalledWith(
      expect.stringContaining("/api/v3/historical-price-full/%5EGSPC"),
    );
    expect(mockFetchJson).toHaveBeenCalledWith(
      expect.stringContaining("/api/v3/historical-price-full/%5EIXIC"),
    );
    expect(mockFetchJson).toHaveBeenCalledWith(
      expect.stringContaining("/api/v3/historical-price-full/%5ETNX"),
    );
    expect(mockFetchJson).toHaveBeenCalledWith(
      expect.stringContaining("/api/v3/historical-price-full/DX-Y.NYB"),
    );
    // 7개 지수에 대해 각 1회 insert
    expect(mockInsert).toHaveBeenCalledTimes(7);
  });

  it("빈 historical 응답이면 해당 지수를 skip한다", async () => {
    mockFetchJson.mockResolvedValue({ historical: [] });

    await loadIndexPrices();

    // 빈 응답 → throw → skip, insert는 호출되지 않음
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("fetch 실패 시 해당 지수를 skip하고 나머지는 계속 처리한다", async () => {
    let callCount = 0;
    mockFetchJson.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return { historical: [] };
      }
      return { historical: MOCK_HISTORICAL };
    });

    await loadIndexPrices();

    // 첫 번째 지수는 빈 응답으로 skip, 나머지 6개는 성공
    expect(mockInsert).toHaveBeenCalledTimes(6);
  });

  it("FMP URL에 올바른 심볼과 apikey가 포함된다", async () => {
    mockFetchJson.mockResolvedValue({ historical: MOCK_HISTORICAL });

    await loadIndexPrices();

    const firstCallUrl = mockFetchJson.mock.calls[0][0] as string;
    expect(firstCallUrl).toContain("apikey=");
    expect(firstCallUrl).toContain("timeseries=5");
  });
});
