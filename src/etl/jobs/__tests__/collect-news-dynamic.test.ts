/**
 * collect-news-dynamic.test.ts — 동적 쿼리 실행 단위 테스트
 *
 * executeDynamicQueries()가 gap analyzer 결과를 기반으로
 * Brave News Search를 호출하고 결과를 저장하는 흐름을 검증한다.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── 모킹 (collect-news.ts는 top-level main()이 있어 모든 의존성 모킹 필수) ──

vi.mock("dotenv/config", () => ({}));

vi.mock("@/debate/gapAnalyzer", () => ({
  analyzeGaps: vi.fn(),
  updateArticlesFound: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/db/client", () => ({
  db: {
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        onConflictDoNothing: vi.fn(() => Promise.resolve({ rowCount: 1 })),
      })),
    })),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          orderBy: vi.fn(() => ({
            limit: vi.fn(() => Promise.resolve([])),
          })),
        })),
      })),
    })),
  },
  pool: {
    end: vi.fn(() => Promise.resolve()),
  },
}));

vi.mock("@/lib/newsClassifier", () => ({
  classifyCategory: vi.fn(() => "MARKET"),
  classifySentiment: vi.fn(() => "NEU"),
}));

vi.mock("@/lib/themeExtractor", () => ({
  extractAndSaveThemes: vi.fn(() => Promise.resolve({ extracted: 0, saved: 0 })),
}));

vi.mock("@/etl/utils/validation", () => ({
  assertValidEnvironment: vi.fn(),
}));

vi.mock("@/etl/utils/date-helpers", () => ({
  getLatestPriceDate: vi.fn(() => Promise.resolve("2026-04-13")),
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    step: vi.fn(),
  },
}));

// fetch 모킹 — Brave API 응답 시뮬레이션
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// main() 실행 방지 — BRAVE_API_KEY가 없으면 collectAndStoreNews가 throw
// 하지만 main()은 모듈 로드 시 실행됨. 이를 위해 env 설정
beforeEach(() => {
  process.env.BRAVE_API_KEY = "test-api-key";
  process.env.NODE_ENV = "test";
});

// ─── 테스트 ──────────────────────────────────────────────────────────────

describe("executeDynamicQueries", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockFetch.mockReset();
    // 기본: 고정 쿼리 + main()에 대한 fetch 응답
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ results: [] }),
    });
  });

  it("gap analyzer가 빈 결과 반환 시 추가 fetch 없음", async () => {
    const { analyzeGaps } = await import("@/debate/gapAnalyzer");
    vi.mocked(analyzeGaps).mockResolvedValue([]);

    const { executeDynamicQueries } = await import("../collect-news");

    // 기존 fetch 호출 카운트 초기화
    mockFetch.mockClear();

    const result = await executeDynamicQueries("2026-04-13", "test-api-key");
    expect(result).toEqual({ dynamicFetched: 0, dynamicInserted: 0 });
    // gap analyzer가 빈 결과면 추가 fetch 없어야 함
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("gap analyzer 실패 시 graceful skip", async () => {
    const { analyzeGaps } = await import("@/debate/gapAnalyzer");
    vi.mocked(analyzeGaps).mockRejectedValue(new Error("LLM timeout"));

    const { executeDynamicQueries } = await import("../collect-news");

    mockFetch.mockClear();

    const result = await executeDynamicQueries("2026-04-13", "test-api-key");
    expect(result).toEqual({ dynamicFetched: 0, dynamicInserted: 0 });
  });

  it("최대 3개 쿼리만 실행", async () => {
    const { analyzeGaps, updateArticlesFound } = await import("@/debate/gapAnalyzer");
    vi.mocked(analyzeGaps).mockResolvedValue([
      { theme: "테마1", query: "query1", rationale: "근거1" },
      { theme: "테마2", query: "query2", rationale: "근거2" },
      { theme: "테마3", query: "query3", rationale: "근거3" },
      { theme: "테마4", query: "query4", rationale: "근거4" },
      { theme: "테마5", query: "query5", rationale: "근거5" },
    ]);
    vi.mocked(updateArticlesFound).mockResolvedValue();

    const { executeDynamicQueries } = await import("../collect-news");

    // fetch 초기화 후 동적 쿼리용 응답 설정
    mockFetch.mockClear();
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        results: [
          { title: "Article 1", url: "https://example.com/1", description: "Desc 1" },
          { title: "Article 2", url: "https://example.com/2", description: "Desc 2" },
        ],
      }),
    });

    const result = await executeDynamicQueries("2026-04-13", "test-api-key");

    // 3개 쿼리만 실행 (5개 중 MAX_DYNAMIC_QUERIES=3)
    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(result.dynamicFetched).toBe(6); // 2 articles * 3 queries
  });

  it("개별 쿼리 실패 시 다른 쿼리는 계속 실행", async () => {
    const { analyzeGaps, updateArticlesFound } = await import("@/debate/gapAnalyzer");
    vi.mocked(analyzeGaps).mockResolvedValue([
      { theme: "테마1", query: "query1", rationale: "근거1" },
      { theme: "테마2", query: "query2", rationale: "근거2" },
    ]);
    vi.mocked(updateArticlesFound).mockResolvedValue();

    const { executeDynamicQueries } = await import("../collect-news");

    mockFetch.mockClear();
    // 첫 번째 성공, 두 번째 실패
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          results: [{ title: "Article", url: "https://example.com/1", description: "Desc" }],
        }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
      });

    const result = await executeDynamicQueries("2026-04-13", "test-api-key");

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(result.dynamicFetched).toBe(1); // 첫 번째 쿼리만 성공
  });
});
