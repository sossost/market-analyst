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


import { loadAnalystEstimates } from "../load-analyst-estimates.js";

const MOCK_ESTIMATE_ROWS = [
  {
    symbol: "AAPL",
    date: "2026-03-31",
    estimatedEpsAvg: "1.65",
    estimatedEpsHigh: "1.80",
    estimatedEpsLow: "1.50",
    estimatedRevenueAvg: "94000000000",
    numberAnalystEstimatedEps: 28,
  },
  {
    symbol: "AAPL",
    date: "2025-12-31",
    estimatedEpsAvg: "2.35",
    estimatedEpsHigh: "2.50",
    estimatedEpsLow: "2.20",
    estimatedRevenueAvg: "124000000000",
    numberAnalystEstimatedEps: 30,
  },
];

const MOCK_SURPRISE_ROWS = [
  {
    symbol: "AAPL",
    date: "2025-11-01",
    actualEarningResult: "1.64",
    estimatedEarning: "1.59",
  },
  {
    symbol: "AAPL",
    date: "2025-08-01",
    actualEarningResult: "1.40",
    estimatedEarning: "1.35",
  },
];

describe("load-analyst-estimates", () => {
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

  it("analyst-estimates + earnings-surprises 두 엔드포인트를 모두 호출한다", async () => {
    mockFetchJson
      .mockResolvedValueOnce(MOCK_ESTIMATE_ROWS)
      .mockResolvedValueOnce(MOCK_SURPRISE_ROWS);

    await loadAnalystEstimates();

    expect(mockFetchJson).toHaveBeenCalledTimes(2);

    const calls = mockFetchJson.mock.calls.map((c) => c[0] as string);
    expect(calls.some((url) => url.includes("analyst-estimates"))).toBe(true);
    expect(calls.some((url) => url.includes("earnings-surprises"))).toBe(true);
  });

  it("추정치 2개 + 서프라이즈 2개 → 4번 insert 호출된다", async () => {
    mockFetchJson
      .mockResolvedValueOnce(MOCK_ESTIMATE_ROWS)
      .mockResolvedValueOnce(MOCK_SURPRISE_ROWS);

    await loadAnalystEstimates();

    expect(mockInsert).toHaveBeenCalledTimes(4);
  });

  it("두 엔드포인트 모두 빈 응답이면 skip 처리한다", async () => {
    mockFetchJson
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    await loadAnalystEstimates();

    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("추정치가 비어도 서프라이즈 데이터가 있으면 저장한다", async () => {
    mockFetchJson
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(MOCK_SURPRISE_ROWS);

    await loadAnalystEstimates();

    expect(mockInsert).toHaveBeenCalledTimes(2);
  });
});
