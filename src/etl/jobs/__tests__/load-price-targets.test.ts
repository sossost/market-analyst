import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── DB/외부 의존성 mock ──────────────────────────────────────────────────────
const { mockInsert, mockExecute, mockFetchJson, mockSleep } = vi.hoisted(() => ({
  mockInsert: vi.fn(),
  mockExecute: vi.fn(),
  mockFetchJson: vi.fn(),
  mockSleep: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/db/client", () => ({
  db: {
    insert: mockInsert,
    execute: mockExecute,
  },
  pool: { end: vi.fn() },
}));
vi.mock("dotenv/config", () => ({}));
vi.mock("@/etl/utils/validation", () => ({
  validateEnvironmentVariables: vi.fn().mockReturnValue({ isValid: true, errors: [], warnings: [] }),
}));
vi.mock("@/etl/utils/retry", () => ({
  retryApiCall: vi.fn((fn: () => unknown) => fn()),
  retryDatabaseOperation: vi.fn((fn: () => unknown) => fn()),
  DEFAULT_RETRY_OPTIONS: {},
}));
vi.mock("@/agent/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@/etl/utils/common", () => ({
  fetchJson: mockFetchJson,
  sleep: mockSleep,
}));


import { loadPriceTargets } from "../load-price-targets.js";

const MOCK_PRICE_TARGET_ROW = {
  symbol: "NVDA",
  targetHigh: "1600",
  targetLow: "900",
  targetMean: "1250",
  targetMedian: "1200",
  lastUpdated: "2026-03-10T00:00:00.000Z",
};

describe("load-price-targets", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    process.env.DATA_API = "https://financialmodelingprep.com";
    process.env.FMP_API_KEY = "test-api-key-12345";

    const onConflictMock = vi.fn().mockResolvedValue(undefined);
    const valuesMock = vi.fn().mockReturnValue({ onConflictDoUpdate: onConflictMock });
    mockInsert.mockReturnValue({ values: valuesMock });

    mockExecute.mockResolvedValue({ rows: [{ symbol: "NVDA" }] });
  });

  afterEach(() => {
    delete process.env.DATA_API;
    delete process.env.FMP_API_KEY;
  });

  it("가격 목표 컨센서스를 fetch하고 UPSERT한다", async () => {
    mockFetchJson.mockResolvedValue([MOCK_PRICE_TARGET_ROW]);

    await loadPriceTargets();

    expect(mockFetchJson).toHaveBeenCalledOnce();
    expect(mockFetchJson).toHaveBeenCalledWith(
      expect.stringContaining("/stable/price-target-consensus?symbol=NVDA"),
    );
    expect(mockInsert).toHaveBeenCalledOnce();
  });

  it("High/Low/Mean/Median 값이 올바르게 저장된다", async () => {
    mockFetchJson.mockResolvedValue([MOCK_PRICE_TARGET_ROW]);

    await loadPriceTargets();

    const valuesMock = mockInsert.mock.results[0].value.values;
    const insertedData = valuesMock.mock.calls[0][0];
    expect(insertedData.targetHigh).toBe("1600");
    expect(insertedData.targetLow).toBe("900");
    expect(insertedData.targetMean).toBe("1250");
    expect(insertedData.targetMedian).toBe("1200");
  });

  it("lastUpdated가 유효한 ISO 문자열이면 Date 객체로 변환한다", async () => {
    mockFetchJson.mockResolvedValue([MOCK_PRICE_TARGET_ROW]);

    await loadPriceTargets();

    const valuesMock = mockInsert.mock.results[0].value.values;
    const insertedData = valuesMock.mock.calls[0][0];
    expect(insertedData.lastUpdated).toBeInstanceOf(Date);
  });

  it("lastUpdated가 null이면 null로 저장된다", async () => {
    mockFetchJson.mockResolvedValue([
      { ...MOCK_PRICE_TARGET_ROW, lastUpdated: null },
    ]);

    await loadPriceTargets();

    const valuesMock = mockInsert.mock.results[0].value.values;
    const insertedData = valuesMock.mock.calls[0][0];
    expect(insertedData.lastUpdated).toBeNull();
  });

  it("빈 응답은 해당 종목을 skip 처리한다", async () => {
    mockFetchJson.mockResolvedValue([]);

    await loadPriceTargets();

    expect(mockInsert).not.toHaveBeenCalled();
  });
});
