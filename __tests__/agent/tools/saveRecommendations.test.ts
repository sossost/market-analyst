import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * saveRecommendations 도구 테스트 (조회 모드).
 *
 * Step 3 이후: 도구는 오늘 ETL이 저장한 추천 목록을 조회하는 역할.
 * 저장 로직은 scan-recommendation-candidates ETL job이 담당.
 */

const { mockPoolQuery } = vi.hoisted(() => ({
  mockPoolQuery: vi.fn(),
}));

vi.mock("@/db/client", () => ({
  db: { insert: vi.fn() },
  pool: { query: mockPoolQuery },
}));

vi.mock("@/etl/utils/retry", () => ({
  retryDatabaseOperation: vi.fn((fn: () => unknown) => fn()),
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { saveRecommendations } from "@/tools/saveRecommendations";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("saveRecommendations — 조회 모드", () => {
  it("도구 이름이 save_recommendations로 유지된다 (하위 호환)", () => {
    expect(saveRecommendations.definition.name).toBe("save_recommendations");
  });

  it("잘못된 date이면 에러를 반환한다", async () => {
    const result = await saveRecommendations.execute({
      date: "not-a-date",
    });
    const parsed = JSON.parse(result);

    expect(parsed.error).toContain("Invalid");
  });

  it("유효한 date와 symbols로 오늘 추천을 조회한다", async () => {
    mockPoolQuery.mockResolvedValue({
      rows: [
        {
          symbol: "AAPL",
          recommendation_date: "2026-03-05",
          entry_price: "185.50",
          entry_rs_score: 78,
          entry_phase: 2,
          sector: "Technology",
          industry: "Consumer Electronics",
          reason: "[ETL 자동] Phase 2 RS 78 자동 스캔",
          status: "ACTIVE",
          market_regime: "EARLY_BULL",
        },
      ],
    });

    const result = await saveRecommendations.execute({
      date: "2026-03-05",
      symbols: ["AAPL"],
    });
    const parsed = JSON.parse(result);

    expect(parsed.success).toBe(true);
    expect(parsed.count).toBe(1);
    expect(parsed.recommendations[0].symbol).toBe("AAPL");
  });

  it("symbols가 비어 있으면 오늘 전체 추천을 조회한다", async () => {
    mockPoolQuery.mockResolvedValue({
      rows: [
        {
          symbol: "AAPL",
          recommendation_date: "2026-03-05",
          entry_price: "185.50",
          entry_rs_score: 78,
          entry_phase: 2,
          sector: "Technology",
          industry: "Consumer Electronics",
          reason: "[ETL 자동] Phase 2 RS 78 자동 스캔",
          status: "ACTIVE",
          market_regime: "EARLY_BULL",
        },
      ],
    });

    const result = await saveRecommendations.execute({ date: "2026-03-05" });
    const parsed = JSON.parse(result);

    expect(parsed.success).toBe(true);
    expect(parsed.count).toBe(1);
  });

  it("오늘 추천이 없으면 count=0, 빈 배열을 반환한다", async () => {
    mockPoolQuery.mockResolvedValue({ rows: [] });

    const result = await saveRecommendations.execute({
      date: "2026-03-05",
      symbols: ["AAPL"],
    });
    const parsed = JSON.parse(result);

    expect(parsed.success).toBe(true);
    expect(parsed.count).toBe(0);
    expect(parsed.recommendations).toHaveLength(0);
  });

  it("잘못된 symbol은 필터링되고 유효한 symbol만 조회한다", async () => {
    mockPoolQuery.mockResolvedValue({ rows: [] });

    await saveRecommendations.execute({
      date: "2026-03-05",
      symbols: ["AAPL", "invalid@sym", "MSFT"],
    });

    expect(mockPoolQuery).toHaveBeenCalledTimes(1);
    const callArgs = mockPoolQuery.mock.calls[0];
    expect(callArgs[1][1]).toEqual(["AAPL", "MSFT"]);
  });

  it("symbols가 undefined이면 전체 조회 쿼리를 실행한다", async () => {
    mockPoolQuery.mockResolvedValue({ rows: [] });

    await saveRecommendations.execute({ date: "2026-03-05" });

    expect(mockPoolQuery).toHaveBeenCalledTimes(1);
    // symbols가 없는 쿼리 — $2 파라미터가 없다
    const callArgs = mockPoolQuery.mock.calls[0];
    expect(callArgs[1]).toHaveLength(1); // date만
  });

  it("description에 ETL 자동화 안내가 포함된다", () => {
    expect(saveRecommendations.definition.description).toContain("ETL");
    expect(saveRecommendations.definition.description).toContain("자동");
  });
});
