import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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
  getFmpV3Config: () => ({
    baseUrl: "https://financialmodelingprep.com",
    key: "test-api-key-12345",
  }),
  toStrNum: (v: unknown) => {
    const n = Number(v);
    return Number.isFinite(n) ? String(n) : null;
  },
}));

import { loadEarningsSurprisesFmp } from "../load-earnings-surprises-fmp.js";

const MOCK_SYMBOLS_RESULT = {
  rows: [{ symbol: "AAPL" }, { symbol: "NVDA" }],
};

const MOCK_SURPRISES_AAPL = [
  {
    symbol: "AAPL",
    date: "2025-12-31",
    actualEarningResult: "2.40",
    estimatedEarning: "2.35",
  },
  {
    symbol: "AAPL",
    date: "2025-09-30",
    actualEarningResult: "1.64",
    estimatedEarning: "1.60",
  },
  {
    symbol: "AAPL",
    date: "2025-06-30",
    actualEarningResult: "1.53",
    estimatedEarning: "1.48",
  },
  {
    symbol: "AAPL",
    date: "2025-03-31",
    actualEarningResult: "1.52",
    estimatedEarning: "1.50",
  },
  // 5번째 항목은 LIMIT_QUARTERS=4로 인해 제외됨
  {
    symbol: "AAPL",
    date: "2024-12-31",
    actualEarningResult: "2.18",
    estimatedEarning: "2.10",
  },
];

const MOCK_SURPRISES_NVDA = [
  {
    symbol: "NVDA",
    date: "2025-10-31",
    actualEarningResult: "0.81",
    estimatedEarning: "0.75",
  },
];

describe("load-earnings-surprises-fmp", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    process.env.DATA_API = "https://financialmodelingprep.com";
    process.env.FMP_API_KEY = "test-api-key-12345";

    mockExecute.mockResolvedValue(MOCK_SYMBOLS_RESULT);

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

  it("대상 종목별로 /api/v3/earnings-surprises/{symbol}을 호출한다", async () => {
    mockFetchJson
      .mockResolvedValueOnce(MOCK_SURPRISES_AAPL)
      .mockResolvedValueOnce(MOCK_SURPRISES_NVDA);

    await loadEarningsSurprisesFmp();

    expect(mockFetchJson).toHaveBeenCalledTimes(2);
    expect(mockFetchJson).toHaveBeenCalledWith(
      expect.stringContaining("/api/v3/earnings-surprises/AAPL"),
    );
    expect(mockFetchJson).toHaveBeenCalledWith(
      expect.stringContaining("/api/v3/earnings-surprises/NVDA"),
    );
  });

  it("최근 4분기만 처리한다 (5개 응답 → 4건 배치 upsert)", async () => {
    mockFetchJson
      .mockResolvedValueOnce(MOCK_SURPRISES_AAPL) // 5개
      .mockResolvedValueOnce([]);

    await loadEarningsSurprisesFmp();

    // AAPL: 4건을 배치 1회 upsert (5번째 항목 제외), NVDA: 빈 배열이므로 upsert 없음
    expect(mockInsert).toHaveBeenCalledTimes(1);
  });

  it("FMP URL에 apikey가 포함된다", async () => {
    mockFetchJson.mockResolvedValue(MOCK_SURPRISES_AAPL);

    await loadEarningsSurprisesFmp();

    const firstCallUrl = mockFetchJson.mock.calls[0][0] as string;
    expect(firstCallUrl).toContain("apikey=");
  });

  it("date가 없는 항목은 upsert에서 제외된다", async () => {
    const rowsWithInvalid = [
      ...MOCK_SURPRISES_NVDA,
      { symbol: "NVDA", date: "", actualEarningResult: "1.0", estimatedEarning: "0.9" }, // 무효
      { symbol: "NVDA", date: null, actualEarningResult: "1.0", estimatedEarning: "0.9" }, // 무효
    ];
    mockFetchJson
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(rowsWithInvalid);

    await loadEarningsSurprisesFmp();

    // 유효한 1건만 upsert
    expect(mockInsert).toHaveBeenCalledTimes(1);
  });

  it("특정 종목 fetch 실패 시 skip하고 나머지를 계속 처리한다", async () => {
    mockFetchJson
      .mockRejectedValueOnce(new Error("API error"))
      .mockResolvedValueOnce(MOCK_SURPRISES_NVDA);

    await loadEarningsSurprisesFmp();

    // AAPL 실패 → skip, NVDA 성공 → 1건 upsert
    expect(mockInsert).toHaveBeenCalledTimes(1);
  });

  it("대상 종목이 없으면 fetch를 호출하지 않는다", async () => {
    mockExecute.mockResolvedValue({ rows: [] });

    await loadEarningsSurprisesFmp();

    expect(mockFetchJson).not.toHaveBeenCalled();
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("종목별 호출 후 PAUSE_MS 슬립이 실행된다", async () => {
    mockFetchJson.mockResolvedValue(MOCK_SURPRISES_NVDA);

    await loadEarningsSurprisesFmp();

    expect(mockSleep).toHaveBeenCalledWith(100);
  });
});
