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


import { loadAnnualFinancials } from "../load-annual-financials.js";

const MOCK_INCOME_ROWS = [
  {
    symbol: "AAPL",
    date: "2024-09-30",
    calendarYear: "2024",
    revenue: "391035000000",
    netIncome: "93736000000",
    epsdiluted: "6.08",
    grossProfit: "170782000000",
    operatingIncome: "123216000000",
    ebitda: "130000000000",
    freeCashFlow: "108807000000",
  },
  {
    symbol: "AAPL",
    date: "2023-09-30",
    calendarYear: "2023",
    revenue: "383285000000",
    netIncome: "96995000000",
    epsdiluted: "6.13",
    grossProfit: "169148000000",
    operatingIncome: "114301000000",
    ebitda: "123000000000",
    freeCashFlow: "99584000000",
  },
];

describe("load-annual-financials", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    process.env.DATA_API = "https://financialmodelingprep.com";
    process.env.FMP_API_KEY = "test-api-key-12345";

    const onConflictMock = vi.fn().mockResolvedValue(undefined);
    const valuesMock = vi.fn().mockReturnValue({ onConflictDoUpdate: onConflictMock });
    mockInsert.mockReturnValue({ values: valuesMock });

    mockExecute.mockResolvedValue({ rows: [{ symbol: "AAPL" }] });
  });

  afterEach(() => {
    delete process.env.DATA_API;
    delete process.env.FMP_API_KEY;
  });

  it("연간 재무제표 데이터를 fetch하고 UPSERT한다", async () => {
    mockFetchJson.mockResolvedValue(MOCK_INCOME_ROWS);

    await loadAnnualFinancials();

    expect(mockFetchJson).toHaveBeenCalledOnce();
    expect(mockFetchJson).toHaveBeenCalledWith(
      expect.stringContaining("period=annual&limit=3"),
    );
    // 2개 row → 2번 insert
    expect(mockInsert).toHaveBeenCalledTimes(2);
  });

  it("calendarYear 없을 때 date에서 연도 추출한다", async () => {
    const rowWithoutCalendarYear = [
      { ...MOCK_INCOME_ROWS[0], calendarYear: undefined },
    ];
    mockFetchJson.mockResolvedValue(rowWithoutCalendarYear);

    // 에러 없이 실행되어야 한다
    await expect(loadAnnualFinancials()).resolves.toBeUndefined();
    expect(mockInsert).toHaveBeenCalledOnce();
  });

  it("빈 응답은 해당 종목을 skip 처리한다", async () => {
    mockFetchJson.mockResolvedValue([]);

    await loadAnnualFinancials();

    expect(mockInsert).not.toHaveBeenCalled();
  });
});
