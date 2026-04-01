import { describe, it, expect, vi, beforeEach } from "vitest";
import { tagPersistenceReason, tagSubstandardReason } from "../saveRecommendations";

/**
 * saveRecommendations 테스트.
 *
 * Step 3 (도구 역할 전환) 이후:
 * - execute()는 조회 모드 — 오늘 저장된 추천 목록을 DB에서 읽어 반환
 * - tagSubstandardReason, tagPersistenceReason 유틸 함수는 그대로 유지
 */

// --- 모듈 mock 설정 ---

vi.mock("@/db/client", () => ({
  db: {
    insert: vi.fn(),
  },
  pool: {
    query: vi.fn(),
  },
}));

vi.mock("@/etl/utils/retry", () => ({
  retryDatabaseOperation: vi.fn((fn: () => unknown) => fn()),
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// --- import (mock 이후) ---

import { saveRecommendations } from "../saveRecommendations";
import { pool } from "@/db/client";

const mockPool = pool as unknown as { query: ReturnType<typeof vi.fn> };

beforeEach(() => {
  vi.clearAllMocks();
});

// =============================================================================
// tagPersistenceReason 단위 테스트 (유틸 함수 — 변경 없음)
// =============================================================================

describe("tagPersistenceReason", () => {
  it("[지속성 미확인] 접두사를 추가한다", () => {
    expect(tagPersistenceReason("강한 RS")).toBe("[지속성 미확인] 강한 RS");
  });

  it("이미 접두사가 있으면 중복 추가하지 않는다", () => {
    expect(tagPersistenceReason("[지속성 미확인] 이미 태그됨")).toBe(
      "[지속성 미확인] 이미 태그됨",
    );
  });

  it("null을 처리한다", () => {
    expect(tagPersistenceReason(null)).toBe("[지속성 미확인]");
  });

  it("빈 문자열을 처리한다", () => {
    expect(tagPersistenceReason("")).toBe("[지속성 미확인]");
  });
});

// =============================================================================
// tagSubstandardReason 단위 테스트
// =============================================================================

describe("tagSubstandardReason", () => {
  it("Phase 1 종목에 [기준 미달] 접두사를 추가한다", () => {
    expect(tagSubstandardReason("RS 강세", 1, 80)).toBe("[기준 미달] RS 강세");
  });

  it("RS < 60 종목에 [기준 미달] 접두사를 추가한다", () => {
    expect(tagSubstandardReason("모멘텀", 2, 50)).toBe("[기준 미달] 모멘텀");
  });

  it("정상 종목은 reason을 그대로 반환한다", () => {
    expect(tagSubstandardReason("정상 사유", 2, 80)).toBe("정상 사유");
  });

  it("이미 태그가 있으면 중복 추가하지 않는다", () => {
    expect(tagSubstandardReason("[기준 미달] 이미", 1, 50)).toBe("[기준 미달] 이미");
  });
});

// =============================================================================
// execute() 조회 모드 테스트
// =============================================================================

describe("saveRecommendations.execute — 조회 모드", () => {
  it("도구 이름이 save_recommendations로 유지된다 (하위 호환)", () => {
    expect(saveRecommendations.definition.name).toBe("save_recommendations");
  });

  it("유효한 date와 symbols로 오늘 추천을 조회한다", async () => {
    mockPool.query.mockResolvedValue({
      rows: [
        {
          symbol: "AAPL",
          recommendation_date: "2026-04-01",
          entry_price: "150.00",
          entry_rs_score: 80,
          entry_phase: 2,
          sector: "Technology",
          industry: "Software",
          reason: "[ETL 자동] Phase 2 RS 80 자동 스캔",
          status: "ACTIVE",
          market_regime: "EARLY_BULL",
        },
      ],
    });

    const result = await saveRecommendations.execute({
      date: "2026-04-01",
      symbols: ["AAPL", "MSFT"],
    });

    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.count).toBe(1);
    expect(parsed.recommendations[0].symbol).toBe("AAPL");
    expect(parsed.recommendations[0].reason).toContain("[ETL 자동]");
  });

  it("symbols가 비어 있으면 오늘 전체 추천을 조회한다", async () => {
    mockPool.query.mockResolvedValue({
      rows: [
        {
          symbol: "AAPL",
          recommendation_date: "2026-04-01",
          entry_price: "150.00",
          entry_rs_score: 80,
          entry_phase: 2,
          sector: "Technology",
          industry: "Software",
          reason: "[ETL 자동] Phase 2 RS 80 자동 스캔",
          status: "ACTIVE",
          market_regime: "EARLY_BULL",
        },
        {
          symbol: "MSFT",
          recommendation_date: "2026-04-01",
          entry_price: "300.00",
          entry_rs_score: 75,
          entry_phase: 2,
          sector: "Technology",
          industry: "Software",
          reason: "[ETL 자동] Phase 2 RS 75 자동 스캔",
          status: "ACTIVE",
          market_regime: "EARLY_BULL",
        },
      ],
    });

    const result = await saveRecommendations.execute({
      date: "2026-04-01",
    });

    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.count).toBe(2);
    expect(parsed.recommendations).toHaveLength(2);
  });

  it("오늘 추천이 없으면 빈 배열을 반환한다", async () => {
    mockPool.query.mockResolvedValue({ rows: [] });

    const result = await saveRecommendations.execute({
      date: "2026-04-01",
      symbols: ["AAPL"],
    });

    const parsed = JSON.parse(result);
    expect(parsed.success).toBe(true);
    expect(parsed.count).toBe(0);
    expect(parsed.recommendations).toHaveLength(0);
  });

  it("잘못된 date 형식이면 에러를 반환한다", async () => {
    const result = await saveRecommendations.execute({
      date: "invalid-date",
      symbols: ["AAPL"],
    });

    const parsed = JSON.parse(result);
    expect(parsed.error).toBeDefined();
    expect(mockPool.query).not.toHaveBeenCalled();
  });

  it("잘못된 symbol은 필터링되고 유효한 symbol만 조회한다", async () => {
    mockPool.query.mockResolvedValue({ rows: [] });

    await saveRecommendations.execute({
      date: "2026-04-01",
      symbols: ["AAPL", "invalid@symbol", "MSFT"],
    });

    // query가 호출됐는지 확인 (유효한 2개 symbols로)
    expect(mockPool.query).toHaveBeenCalledTimes(1);
    const callArgs = mockPool.query.mock.calls[0];
    expect(callArgs[1][1]).toEqual(["AAPL", "MSFT"]);
  });

  it("description에 ETL 자동화 안내가 포함된다", () => {
    expect(saveRecommendations.definition.description).toContain("ETL");
    expect(saveRecommendations.definition.description).toContain("자동");
  });
});
