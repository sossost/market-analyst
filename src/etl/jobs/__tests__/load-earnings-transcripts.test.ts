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


import { loadEarningsTranscripts } from "../load-earnings-transcripts.js";

// earning-call-transcript-dates 응답 — 최신순
const MOCK_DATE_ROWS = [
  { symbol: "NVDA", quarter: 4, year: 2024, date: "2024-11-20" },
  { symbol: "NVDA", quarter: 3, year: 2024, date: "2024-08-28" },
  { symbol: "NVDA", quarter: 2, year: 2024, date: "2024-05-22" },
  { symbol: "NVDA", quarter: 1, year: 2024, date: "2024-02-21" },
];

// earning-call-transcript 응답 (단일 row 배열)
const MOCK_TRANSCRIPT_Q4 = [
  {
    symbol: "NVDA",
    quarter: 4,
    year: 2024,
    date: "2024-11-20",
    content: "Q4 2024 earnings call content. ".repeat(100),
  },
];
const MOCK_TRANSCRIPT_Q3 = [
  {
    symbol: "NVDA",
    quarter: 3,
    year: 2024,
    date: "2024-08-28",
    content: "Q3 2024 earnings call content.",
  },
];

describe("load-earnings-transcripts", () => {
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

  it("4개 날짜 중 최근 2개만 트랜스크립트를 조회하여 저장한다", async () => {
    // 첫 호출: dates 조회, 이후 2회: 각 quarter 트랜스크립트 조회
    mockFetchJson
      .mockResolvedValueOnce(MOCK_DATE_ROWS)
      .mockResolvedValueOnce(MOCK_TRANSCRIPT_Q4)
      .mockResolvedValueOnce(MOCK_TRANSCRIPT_Q3);

    await loadEarningsTranscripts();

    // MAX_TRANSCRIPTS = 2 이므로 2번만 insert 호출
    expect(mockInsert).toHaveBeenCalledTimes(2);
  });

  it("dates 엔드포인트를 먼저 호출한다", async () => {
    mockFetchJson
      .mockResolvedValueOnce(MOCK_DATE_ROWS)
      .mockResolvedValueOnce(MOCK_TRANSCRIPT_Q4)
      .mockResolvedValueOnce(MOCK_TRANSCRIPT_Q3);

    await loadEarningsTranscripts();

    expect(mockFetchJson).toHaveBeenCalledWith(
      expect.stringContaining("/stable/earning-call-transcript-dates?symbol=NVDA"),
    );
  });

  it("트랜스크립트 호출 시 year/quarter 파라미터를 포함한다", async () => {
    mockFetchJson
      .mockResolvedValueOnce(MOCK_DATE_ROWS)
      .mockResolvedValueOnce(MOCK_TRANSCRIPT_Q4)
      .mockResolvedValueOnce(MOCK_TRANSCRIPT_Q3);

    await loadEarningsTranscripts();

    const calls = mockFetchJson.mock.calls.map((c) => c[0] as string);
    // dates 이후 트랜스크립트 호출에 year/quarter 포함 확인
    expect(calls.some((url) => url.includes("year=2024") && url.includes("quarter=4"))).toBe(true);
    expect(calls.some((url) => url.includes("year=2024") && url.includes("quarter=3"))).toBe(true);
  });

  it("dates 응답이 빈 경우 해당 종목을 skip 처리한다", async () => {
    mockFetchJson.mockResolvedValue([]);

    await loadEarningsTranscripts();

    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("원문 전체를 DB에 저장한다 (DB 레벨 트런케이트 없음)", async () => {
    const longContent = "A".repeat(10000); // 만 자
    mockFetchJson
      .mockResolvedValueOnce(MOCK_DATE_ROWS.slice(0, 1))
      .mockResolvedValueOnce([{ ...MOCK_TRANSCRIPT_Q4[0], content: longContent }]);

    await loadEarningsTranscripts();

    // insert의 values 인자에 전체 content가 전달되어야 한다
    const valuesMock = mockInsert.mock.results[0].value.values;
    const insertedData = valuesMock.mock.calls[0][0];
    expect(insertedData.transcript).toBe(longContent);
  });
});
