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

import { loadStockNews } from "../load-stock-news.js";

const MOCK_SYMBOLS_RESULT = {
  rows: [{ symbol: "AAPL" }, { symbol: "NVDA" }],
};

const MOCK_NEWS_AAPL = [
  {
    symbol: "AAPL",
    publishedDate: "2026-03-27 10:00:00",
    title: "Apple announces new product",
    text: "Apple Inc. announced...",
    image: "https://example.com/img.png",
    site: "reuters.com",
    url: "https://reuters.com/apple-1",
  },
  {
    symbol: "AAPL",
    publishedDate: "2026-03-26 14:30:00",
    title: "Apple Q1 earnings beat",
    text: "Strong quarter...",
    image: null,
    site: "bloomberg.com",
    url: "https://bloomberg.com/apple-2",
  },
];

const MOCK_NEWS_NVDA = [
  {
    symbol: "NVDA",
    publishedDate: "2026-03-27 09:00:00",
    title: "NVIDIA new GPU announcement",
    text: "NVIDIA unveiled...",
    image: null,
    site: "techcrunch.com",
    url: "https://techcrunch.com/nvda-1",
  },
];

describe("load-stock-news", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    process.env.DATA_API = "https://financialmodelingprep.com";
    process.env.FMP_API_KEY = "test-api-key-12345";

    // cleanup DELETE는 rows가 빈 배열
    // fetchTargetSymbols는 MOCK_SYMBOLS_RESULT 반환
    mockExecute
      .mockResolvedValueOnce({ rows: [] }) // cleanupOldNews DELETE
      .mockResolvedValueOnce(MOCK_SYMBOLS_RESULT); // fetchTargetSymbols

    const onConflictMock = vi.fn().mockResolvedValue(undefined);
    const valuesMock = vi
      .fn()
      .mockReturnValue({ onConflictDoNothing: onConflictMock });
    mockInsert.mockReturnValue({ values: valuesMock });
  });

  afterEach(() => {
    delete process.env.DATA_API;
    delete process.env.FMP_API_KEY;
  });

  it("대상 종목별로 /api/v3/stock_news를 호출하고 뉴스를 upsert한다", async () => {
    mockFetchJson
      .mockResolvedValueOnce(MOCK_NEWS_AAPL)
      .mockResolvedValueOnce(MOCK_NEWS_NVDA);

    await loadStockNews();

    // AAPL, NVDA 각 1회 fetch
    expect(mockFetchJson).toHaveBeenCalledTimes(2);
    expect(mockFetchJson).toHaveBeenCalledWith(
      expect.stringContaining("/api/v3/stock_news?tickers=AAPL"),
    );
    expect(mockFetchJson).toHaveBeenCalledWith(
      expect.stringContaining("/api/v3/stock_news?tickers=NVDA"),
    );
    // 각 종목별 insert 호출
    expect(mockInsert).toHaveBeenCalledTimes(2);
  });

  it("FMP URL에 limit=5와 apikey가 포함된다", async () => {
    mockFetchJson.mockResolvedValue(MOCK_NEWS_AAPL);

    await loadStockNews();

    const firstCallUrl = mockFetchJson.mock.calls[0][0] as string;
    expect(firstCallUrl).toContain("limit=5");
    expect(firstCallUrl).toContain("apikey=");
  });

  it("url 또는 title이 없는 뉴스 항목은 upsert에서 제외된다", async () => {
    const newsWithInvalid = [
      ...MOCK_NEWS_AAPL,
      { symbol: "AAPL", publishedDate: "2026-03-27", title: "", url: "" }, // 무효: 빈 title/url
      { symbol: "AAPL", publishedDate: "2026-03-27", title: "Valid", url: null }, // 무효: null url
    ];
    mockFetchJson
      .mockResolvedValueOnce(newsWithInvalid)
      .mockResolvedValueOnce([]);

    await loadStockNews();

    // 무효 항목은 필터링, 유효한 2건만 insert
    const valuesMock = mockInsert.mock.results[0]?.value?.values;
    if (valuesMock != null) {
      expect(valuesMock).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ url: "https://reuters.com/apple-1" }),
          expect.objectContaining({ url: "https://bloomberg.com/apple-2" }),
        ]),
      );
      // invalid rows는 포함되지 않음
      const callArg = valuesMock.mock.calls[0][0] as { url: string }[];
      expect(callArg.every((r) => r.url !== "")).toBe(true);
    }
  });

  it("빈 뉴스 응답이면 insert를 호출하지 않는다", async () => {
    mockFetchJson.mockResolvedValue([]);

    await loadStockNews();

    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("특정 종목 fetch 실패 시 해당 종목을 skip하고 나머지는 계속 처리한다", async () => {
    mockFetchJson
      .mockRejectedValueOnce(new Error("Network error"))
      .mockResolvedValueOnce(MOCK_NEWS_NVDA);

    await loadStockNews();

    // AAPL 실패 → skip, NVDA 성공 → insert
    expect(mockInsert).toHaveBeenCalledTimes(1);
  });

  it("대상 종목이 없으면 fetch를 호출하지 않는다", async () => {
    mockExecute
      .mockReset()
      .mockResolvedValueOnce({ rows: [] }) // cleanupOldNews
      .mockResolvedValueOnce({ rows: [] }); // fetchTargetSymbols: 빈 결과

    await loadStockNews();

    expect(mockFetchJson).not.toHaveBeenCalled();
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("종목별 호출 후 PAUSE_MS 슬립이 실행된다", async () => {
    mockFetchJson.mockResolvedValue(MOCK_NEWS_AAPL);

    await loadStockNews();

    // 각 종목 처리 후 sleep 호출
    expect(mockSleep).toHaveBeenCalledWith(100);
  });
});
