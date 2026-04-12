import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockInsert, mockQuery, mockFetchJson } = vi.hoisted(() => ({
  mockInsert: vi.fn(),
  mockQuery: vi.fn(),
  mockFetchJson: vi.fn(),
}));

vi.mock("@/db/client", () => ({
  db: { insert: mockInsert },
  pool: { end: vi.fn(), query: mockQuery },
}));
vi.mock("dotenv/config", () => ({}));
vi.mock("@/etl/utils/validation", () => ({
  validateFredEnvironment: vi
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
  toStrNum: (v: unknown) => {
    const n = Number(v);
    return Number.isFinite(n) ? String(n) : null;
  },
}));

import { collectCreditIndicators } from "../collect-credit-indicators.js";

const MOCK_FRED_RESPONSE = {
  observations: [
    { date: "2026-04-10", value: "272.50" },
    { date: "2026-04-11", value: "275.30" },
  ],
};

const MOCK_FRED_RESPONSE_WITH_DOT = {
  observations: [
    { date: "2026-04-10", value: "." },
    { date: "2026-04-11", value: "280.10" },
  ],
};

const MOCK_EMPTY_RESPONSE = {
  observations: [],
};

describe("collectCreditIndicators", () => {
  const mockValues = vi.fn();
  const mockOnConflictDoUpdate = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.FRED_API_KEY = "test-fred-key-12345";

    mockOnConflictDoUpdate.mockResolvedValue(undefined);
    mockValues.mockReturnValue({ onConflictDoUpdate: mockOnConflictDoUpdate });
    mockInsert.mockReturnValue({ values: mockValues });

    // z-score UPDATE query (pool.query)
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });
  });

  afterEach(() => {
    delete process.env.FRED_API_KEY;
  });

  it("4개 시리즈를 FRED API에서 수집하고 batch upsert한다", async () => {
    mockFetchJson.mockResolvedValue(MOCK_FRED_RESPONSE);

    await collectCreditIndicators();

    // 4개 시리즈 × 1번 batch insert = 4번 insert
    expect(mockInsert).toHaveBeenCalledTimes(4);
    // 각 batch에 2건의 values
    expect(mockValues).toHaveBeenCalledTimes(4);
    for (const call of mockValues.mock.calls) {
      expect(call[0]).toHaveLength(2);
    }
  });

  it("FRED 응답에서 '.' 값을 필터링한다", async () => {
    mockFetchJson.mockResolvedValue(MOCK_FRED_RESPONSE_WITH_DOT);

    await collectCreditIndicators();

    // 4개 시리즈 × 각 1건 (dot 제외)
    expect(mockInsert).toHaveBeenCalledTimes(4);
    for (const call of mockValues.mock.calls) {
      expect(call[0]).toHaveLength(1);
    }
  });

  it("빈 응답 시 해당 시리즈를 건너뛴다", async () => {
    mockFetchJson
      .mockResolvedValueOnce(MOCK_EMPTY_RESPONSE)
      .mockResolvedValueOnce(MOCK_FRED_RESPONSE)
      .mockResolvedValueOnce(MOCK_EMPTY_RESPONSE)
      .mockResolvedValueOnce(MOCK_FRED_RESPONSE);

    await collectCreditIndicators();

    // 2개 시리즈만 성공
    expect(mockInsert).toHaveBeenCalledTimes(2);
  });

  it("batch upsert 후 z-score UPDATE 쿼리를 시리즈별로 실행한다", async () => {
    mockFetchJson.mockResolvedValue(MOCK_FRED_RESPONSE);

    await collectCreditIndicators();

    // 4개 시리즈 × 1번 z-score update = 4번 pool.query
    expect(mockQuery).toHaveBeenCalledTimes(4);
    // 첫 번째 호출의 SQL에 UPDATE 포함 확인
    const firstCall = mockQuery.mock.calls[0];
    expect(firstCall[0]).toContain("UPDATE credit_indicators");
  });

  it("한 시리즈 실패해도 나머지는 계속 수집한다", async () => {
    mockFetchJson
      .mockRejectedValueOnce(new Error("API rate limited"))
      .mockResolvedValueOnce(MOCK_FRED_RESPONSE)
      .mockResolvedValueOnce(MOCK_FRED_RESPONSE)
      .mockResolvedValueOnce(MOCK_FRED_RESPONSE);

    await collectCreditIndicators();

    // 3개 시리즈 성공
    expect(mockInsert).toHaveBeenCalledTimes(3);
  });

  it("upsert 시 onConflictDoUpdate를 사용한다", async () => {
    mockFetchJson.mockResolvedValue({
      observations: [{ date: "2026-04-11", value: "275" }],
    });

    await collectCreditIndicators();

    expect(mockOnConflictDoUpdate).toHaveBeenCalledTimes(4);
  });

  it("올바른 series_id로 insert한다", async () => {
    mockFetchJson.mockResolvedValue({
      observations: [{ date: "2026-04-11", value: "100" }],
    });

    await collectCreditIndicators();

    const insertedSeriesIds = mockValues.mock.calls.map(
      (call: unknown[]) => ((call[0] as Array<{ seriesId: string }>)[0]).seriesId,
    );

    expect(insertedSeriesIds).toContain("BAMLH0A0HYM2");
    expect(insertedSeriesIds).toContain("BAMLH0A3HYC");
    expect(insertedSeriesIds).toContain("BAMLC0A4CBBB");
    expect(insertedSeriesIds).toContain("STLFSI4");
  });

  it("z-score update에 올바른 파라미터를 전달한다", async () => {
    mockFetchJson.mockResolvedValue({
      observations: [{ date: "2026-04-11", value: "300" }],
    });

    await collectCreditIndicators();

    const firstQuery = mockQuery.mock.calls[0];
    // [seriesId, minDate, Z_SCORE_LOOKBACK_DAYS, Z_SCORE_MIN_POINTS]
    expect(firstQuery[1][0]).toBe("BAMLH0A0HYM2");
    expect(firstQuery[1][1]).toBe("2026-04-11");
    expect(firstQuery[1][2]).toBe(180); // Z_SCORE_LOOKBACK_DAYS
    expect(firstQuery[1][3]).toBe(30);  // Z_SCORE_MIN_POINTS
  });

  it("NaN 값은 필터링한다", async () => {
    mockFetchJson.mockResolvedValue({
      observations: [
        { date: "2026-04-10", value: "invalid" },
        { date: "2026-04-11", value: "275" },
      ],
    });

    await collectCreditIndicators();

    // 각 시리즈에서 유효한 값은 1건
    for (const call of mockValues.mock.calls) {
      expect(call[0]).toHaveLength(1);
      expect(call[0][0].value).toBe("275");
    }
  });
});
