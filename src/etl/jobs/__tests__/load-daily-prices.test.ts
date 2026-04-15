import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockInsert, mockSelect, mockFetchJson, mockSleep, mockLogger } = vi.hoisted(() => ({
  mockInsert: vi.fn(),
  mockSelect: vi.fn(),
  mockFetchJson: vi.fn(),
  mockSleep: vi.fn().mockResolvedValue(undefined),
  mockLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@/db/client", () => ({
  db: {
    insert: mockInsert,
    select: mockSelect,
  },
  pool: { end: vi.fn() },
}));
vi.mock("dotenv/config", () => ({}));
vi.mock("p-limit", () => ({
  default: () => (fn: () => unknown) => fn(),
}));
vi.mock("@/etl/utils/validation", () => ({
  validateEnvironmentVariables: vi
    .fn()
    .mockReturnValue({ isValid: true, errors: [], warnings: [] }),
  validatePriceData: vi
    .fn()
    .mockReturnValue({ isValid: true, errors: [], warnings: [] }),
  validateBatchData: vi
    .fn()
    .mockReturnValue({ isValid: true, errors: [], warnings: [] }),
}));
vi.mock("@/etl/utils/retry", () => ({
  retryApiCall: vi.fn((fn: () => unknown) => fn()),
  retryDatabaseOperation: vi.fn((fn: () => unknown) => fn()),
  DEFAULT_RETRY_OPTIONS: {},
}));
vi.mock("@/lib/logger", () => ({
  logger: mockLogger,
}));
vi.mock("@/etl/utils/common", () => ({
  fetchJson: mockFetchJson,
  sleep: mockSleep,
  toStrNum: (v: unknown) => {
    const n = Number(v);
    return Number.isFinite(n) ? String(n) : null;
  },
}));
vi.mock("@/db/schema/market", () => ({
  dailyPrices: { symbol: "symbol", date: "date" },
  symbols: { symbol: "symbol", isActivelyTrading: "is_actively_trading" },
}));

// Setup mocks before module import
const onConflictMock = vi.fn().mockResolvedValue(undefined);
const valuesMock = vi.fn().mockReturnValue({ onConflictDoUpdate: onConflictMock });
mockInsert.mockReturnValue({ values: valuesMock });

const whereMock = vi.fn().mockResolvedValue([{ symbol: "AAPL" }]);
const fromMock = vi.fn().mockReturnValue({ where: whereMock });
mockSelect.mockReturnValue({ from: fromMock });

process.env.DATA_API = "https://financialmodelingprep.com";
process.env.FMP_API_KEY = "test-api-key-12345";

// Provide default fetch response for module-level main() execution
mockFetchJson.mockResolvedValue({
  historical: [
    { date: "2026-04-03", open: 150, high: 155, low: 148, close: 153, volume: 1000000 },
  ],
});

import { loadDailyPrices } from "../load-daily-prices.js";

describe("load-daily-prices", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    process.env.DATA_API = "https://financialmodelingprep.com";
    process.env.FMP_API_KEY = "test-api-key-12345";

    onConflictMock.mockResolvedValue(undefined);
    valuesMock.mockReturnValue({ onConflictDoUpdate: onConflictMock });
    mockInsert.mockReturnValue({ values: valuesMock });

    whereMock.mockResolvedValue([{ symbol: "AAPL" }]);
    fromMock.mockReturnValue({ where: whereMock });
    mockSelect.mockReturnValue({ from: fromMock });
  });

  afterEach(() => {
    delete process.env.DATA_API;
    delete process.env.FMP_API_KEY;
  });

  it("filters out weekend dates from FMP response before INSERT", async () => {
    mockFetchJson.mockResolvedValue({
      historical: [
        { date: "2026-04-05", open: 150, high: 155, low: 148, close: 153, volume: 1000000 }, // Sunday
        { date: "2026-04-04", open: 150, high: 155, low: 148, close: 153, volume: 1000000 }, // Saturday
        { date: "2026-04-03", open: 150, high: 155, low: 148, close: 153, volume: 1000000 }, // Friday
        { date: "2026-04-02", open: 150, high: 155, low: 148, close: 153, volume: 1000000 }, // Thursday
        { date: "2026-04-01", open: 150, high: 155, low: 148, close: 153, volume: 1000000 }, // Wednesday
      ],
    });

    await loadDailyPrices();

    // Only weekday records (3 out of 5) should be inserted
    expect(valuesMock).toHaveBeenCalledTimes(1);
    const insertedValues = valuesMock.mock.calls[0][0];
    expect(insertedValues).toHaveLength(3);

    const insertedDates = insertedValues.map((v: { date: string }) => v.date);
    expect(insertedDates).toEqual(["2026-04-03", "2026-04-02", "2026-04-01"]);
    expect(insertedDates).not.toContain("2026-04-05");
    expect(insertedDates).not.toContain("2026-04-04");
  });

  it("logs warning when weekend records are filtered", async () => {
    mockFetchJson.mockResolvedValue({
      historical: [
        { date: "2026-04-05", open: 150, high: 155, low: 148, close: 153, volume: 1000000 }, // Sunday
        { date: "2026-04-03", open: 150, high: 155, low: 148, close: 153, volume: 1000000 }, // Friday
      ],
    });

    await loadDailyPrices();

    expect(mockLogger.warn).toHaveBeenCalledWith(
      "LOAD_DAILY_PRICES",
      expect.stringContaining("Filtered 1 weekend records"),
    );
  });

  it("handles all-weekend data gracefully (no insert)", async () => {
    mockFetchJson.mockResolvedValue({
      historical: [
        { date: "2026-04-04", open: 150, high: 155, low: 148, close: 153, volume: 1000000 }, // Saturday
        { date: "2026-04-05", open: 150, high: 155, low: 148, close: 153, volume: 1000000 }, // Sunday
      ],
    });

    await loadDailyPrices();

    // No insert calls when all records are weekends
    expect(valuesMock).not.toHaveBeenCalled();
  });

  it("does not filter weekday-only data", async () => {
    mockFetchJson.mockResolvedValue({
      historical: [
        { date: "2026-04-03", open: 150, high: 155, low: 148, close: 153, volume: 1000000 }, // Friday
        { date: "2026-04-02", open: 150, high: 155, low: 148, close: 153, volume: 1000000 }, // Thursday
      ],
    });

    await loadDailyPrices();

    expect(valuesMock).toHaveBeenCalledTimes(1);
    const insertedValues = valuesMock.mock.calls[0][0];
    expect(insertedValues).toHaveLength(2);

    // No weekend warning logged
    const warnCalls = mockLogger.warn.mock.calls.filter(
      (c: string[]) => c[1]?.includes("weekend"),
    );
    expect(warnCalls).toHaveLength(0);
  });
});
