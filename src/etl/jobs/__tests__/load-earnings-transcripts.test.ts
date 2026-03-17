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

// FMP 응답은 최신순 — 최근 4분기치가 있어도 2개만 저장해야 한다
const MOCK_TRANSCRIPT_ROWS = [
  {
    symbol: "NVDA",
    quarter: 4,
    year: 2024,
    date: "2024-11-20",
    content: "Q4 2024 earnings call content. ".repeat(100),
  },
  {
    symbol: "NVDA",
    quarter: 3,
    year: 2024,
    date: "2024-08-28",
    content: "Q3 2024 earnings call content.",
  },
  {
    symbol: "NVDA",
    quarter: 2,
    year: 2024,
    date: "2024-05-22",
    content: "Q2 2024 earnings call content.",
  },
  {
    symbol: "NVDA",
    quarter: 1,
    year: 2024,
    date: "2024-02-21",
    content: "Q1 2024 earnings call content.",
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

  it("4개 응답 중 최근 2개만 저장한다", async () => {
    mockFetchJson.mockResolvedValue(MOCK_TRANSCRIPT_ROWS);

    await loadEarningsTranscripts();

    // MAX_TRANSCRIPTS = 2 이므로 2번만 insert 호출
    expect(mockInsert).toHaveBeenCalledTimes(2);
  });

  it("올바른 엔드포인트를 호출한다", async () => {
    mockFetchJson.mockResolvedValue(MOCK_TRANSCRIPT_ROWS.slice(0, 2));

    await loadEarningsTranscripts();

    expect(mockFetchJson).toHaveBeenCalledWith(
      expect.stringContaining("/stable/earning-call-transcript?symbol=NVDA"),
    );
  });

  it("빈 응답은 해당 종목을 skip 처리한다", async () => {
    mockFetchJson.mockResolvedValue([]);

    await loadEarningsTranscripts();

    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("원문 전체를 DB에 저장한다 (DB 레벨 트런케이트 없음)", async () => {
    const longContent = "A".repeat(10000); // 만 자
    mockFetchJson.mockResolvedValue([
      { ...MOCK_TRANSCRIPT_ROWS[0], content: longContent },
    ]);

    await loadEarningsTranscripts();

    // insert의 values 인자에 전체 content가 전달되어야 한다
    const valuesMock = mockInsert.mock.results[0].value.values;
    const insertedData = valuesMock.mock.calls[0][0];
    expect(insertedData.transcript).toBe(longContent);
  });
});
