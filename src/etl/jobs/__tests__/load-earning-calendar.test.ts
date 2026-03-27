import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockInsert, mockExecute, mockFetchJson } = vi.hoisted(() => ({
  mockInsert: vi.fn(),
  mockExecute: vi.fn(),
  mockFetchJson: vi.fn(),
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
  getFmpV3Config: () => ({
    baseUrl: process.env.DATA_API ?? "https://financialmodelingprep.com",
    key: process.env.FMP_API_KEY ?? "test-api-key-12345",
  }),
  toStrNum: (v: unknown) => {
    const n = Number(v);
    return Number.isFinite(n) ? String(n) : null;
  },
}));

import { loadEarningCalendar } from "../load-earning-calendar.js";

const MOCK_TARGET_SYMBOLS = {
  rows: [{ symbol: "AAPL" }, { symbol: "NVDA" }, { symbol: "MSFT" }],
};

const MOCK_CALENDAR_ROWS = [
  {
    symbol: "AAPL",
    date: "2026-04-10",
    eps: "1.56",
    epsEstimated: "1.50",
    revenue: "95000000000",
    revenueEstimated: "94000000000",
    time: "amc",
  },
  {
    symbol: "NVDA",
    date: "2026-04-20",
    eps: null,
    epsEstimated: "6.20",
    revenue: null,
    revenueEstimated: "38000000000",
    time: "amc",
  },
  {
    symbol: "TSLA", // 관심 대상 아님 → 필터링 제거
    date: "2026-04-15",
    eps: "0.72",
    epsEstimated: "0.70",
    revenue: "25000000000",
    revenueEstimated: "24500000000",
    time: "bmo",
  },
];

describe("load-earning-calendar", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    process.env.DATA_API = "https://financialmodelingprep.com";
    process.env.FMP_API_KEY = "test-api-key-12345";

    mockExecute.mockResolvedValue(MOCK_TARGET_SYMBOLS);

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

  it("단일 API 호출로 날짜 범위 전체를 가져온다", async () => {
    mockFetchJson.mockResolvedValue(MOCK_CALENDAR_ROWS);

    await loadEarningCalendar();

    // earning_calendar는 1회만 호출
    expect(mockFetchJson).toHaveBeenCalledTimes(1);
    expect(mockFetchJson).toHaveBeenCalledWith(
      expect.stringContaining("/api/v3/earning_calendar?from="),
    );
  });

  it("FMP URL에 from/to 날짜 파라미터와 apikey가 포함된다", async () => {
    mockFetchJson.mockResolvedValue(MOCK_CALENDAR_ROWS);

    await loadEarningCalendar();

    const callUrl = mockFetchJson.mock.calls[0][0] as string;
    expect(callUrl).toMatch(/from=\d{4}-\d{2}-\d{2}/);
    expect(callUrl).toMatch(/to=\d{4}-\d{2}-\d{2}/);
    expect(callUrl).toContain("apikey=");
  });

  it("대상 종목(AAPL, NVDA)만 upsert하고 관심 외 종목(TSLA)은 제외한다", async () => {
    mockFetchJson.mockResolvedValue(MOCK_CALENDAR_ROWS);

    await loadEarningCalendar();

    expect(mockInsert).toHaveBeenCalledTimes(1);
    const insertArgs = mockInsert.mock.results[0].value.values.mock.calls[0][0] as { symbol: string }[];
    expect(insertArgs).toHaveLength(2);
    expect(insertArgs.map((r) => r.symbol)).toEqual(
      expect.arrayContaining(["AAPL", "NVDA"]),
    );
    expect(insertArgs.map((r) => r.symbol)).not.toContain("TSLA");
  });

  it("발표 전 종목은 eps/revenue가 null로 upsert된다", async () => {
    mockFetchJson.mockResolvedValue(MOCK_CALENDAR_ROWS);

    await loadEarningCalendar();

    const insertArgs = mockInsert.mock.results[0].value.values.mock.calls[0][0] as {
      symbol: string;
      eps: string | null;
      revenue: string | null;
    }[];
    const nvdaRow = insertArgs.find((r) => r.symbol === "NVDA");
    expect(nvdaRow).toBeDefined();
    expect(nvdaRow?.eps).toBeNull();
    expect(nvdaRow?.revenue).toBeNull();
  });

  it("빈 캘린더 응답이면 insert를 호출하지 않는다", async () => {
    mockFetchJson.mockResolvedValue([]);

    await loadEarningCalendar();

    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("대상 종목이 없으면 insert를 호출하지 않는다", async () => {
    mockExecute.mockResolvedValue({ rows: [] });
    mockFetchJson.mockResolvedValue(MOCK_CALENDAR_ROWS);

    await loadEarningCalendar();

    expect(mockInsert).not.toHaveBeenCalled();
  });
});
