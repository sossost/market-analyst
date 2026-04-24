/**
 * saveTrackedStock.test.ts — 트래킹 종목 등록/해제/조회 도구 테스트
 *
 * 외부 의존성(DB, pool, repository)은 모두 mock 처리.
 * saveWatchlist + saveRecommendations 핵심 시나리오를 통합하여 커버한다.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// --- 모듈 mock 설정 ---

vi.mock("@/db/client", () => ({
  db: {},
  pool: {
    query: vi.fn(),
  },
}));

vi.mock("@/etl/utils/retry", () => ({
  retryDatabaseOperation: vi.fn((fn: () => unknown) => fn()),
}));

vi.mock("@/db/repositories/trackedStocksRepository.js", () => ({
  findActiveTrackedStocksBySymbols: vi.fn(),
  exitTrackedStock: vi.fn(),
  insertTrackedStock: vi.fn(),
}));

vi.mock("@/db/repositories/stockPhaseRepository.js", () => ({
  findPhase2SinceDates: vi.fn().mockResolvedValue([]),
}));


vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// --- import (mock 이후) ---

import { saveTrackedStock } from "../saveTrackedStock";
import { pool } from "@/db/client";
import {
  findActiveTrackedStocksBySymbols,
  exitTrackedStock,
  insertTrackedStock,
} from "@/db/repositories/trackedStocksRepository.js";
import { findPhase2SinceDates } from "@/db/repositories/stockPhaseRepository.js";

const mockPool = pool as unknown as { query: ReturnType<typeof vi.fn> };
const mockFindActive = findActiveTrackedStocksBySymbols as ReturnType<typeof vi.fn>;
const mockExit = exitTrackedStock as ReturnType<typeof vi.fn>;
const mockInsert = insertTrackedStock as ReturnType<typeof vi.fn>;
const mockFindPhase2Since = findPhase2SinceDates as ReturnType<typeof vi.fn>;


// ─── 헬퍼 ─────────────────────────────────────────────────────────────────────

function makeValidRegisterInput(overrides: Record<string, unknown> = {}) {
  return {
    action: "register",
    register: {
      symbol: "AAPL",
      date: "2026-03-22",
      phase: 2,
      rs_score: 75,
      thesis_id: 42,
      sector: "Technology",
      industry: "Software",
      reason: "AI 수요 확장 → 데이터센터 투자 가속",
      price_at_entry: 180,
      tier: "standard",
      sepa_grade: "A",
      ...overrides,
    },
  };
}

// ─── register 테스트 ──────────────────────────────────────────────────────────

describe("saveTrackedStock.execute — register", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindActive.mockResolvedValue([]);
    mockInsert.mockResolvedValue(1); // 정상 삽입
    mockFindPhase2Since.mockResolvedValue([]); // 기본: Phase 2 시작일 없음
  });

  it("Phase 2 + 이유 명시 시 등록 성공", async () => {
    const result = JSON.parse(
      await saveTrackedStock.execute(makeValidRegisterInput()),
    );
    expect(result.success).toBe(true);
    expect(result.symbol).toBe("AAPL");
    expect(result.source).toBe("agent");
    expect(result.tier).toBe("standard");
    expect(result.entryDate).toBe("2026-03-22");
    expect(result.trackingEndDate).toBeDefined();
  });

  it("tier를 featured로 지정할 수 있다", async () => {
    const input = makeValidRegisterInput({ tier: "featured" });
    const result = JSON.parse(await saveTrackedStock.execute(input));
    expect(result.success).toBe(true);
    expect(result.tier).toBe("featured");
  });

  it("tier 미지정 시 standard로 기본값 설정", async () => {
    const input = { ...makeValidRegisterInput() };
    delete (input.register as Record<string, unknown>).tier;
    const result = JSON.parse(await saveTrackedStock.execute(input));
    expect(result.success).toBe(true);
    expect(result.tier).toBe("standard");
  });

  it("Phase 1이면 게이트 거부", async () => {
    const result = JSON.parse(
      await saveTrackedStock.execute(makeValidRegisterInput({ phase: 1 })),
    );
    expect(result.success).toBe(false);
    expect(result.blocked).toBe(true);
    expect(result.message).toContain("Phase");
  });

  it("reason이 빈 문자열이면 게이트 거부", async () => {
    const result = JSON.parse(
      await saveTrackedStock.execute(makeValidRegisterInput({ reason: "" })),
    );
    expect(result.success).toBe(false);
    expect(result.blocked).toBe(true);
    expect(result.message).toContain("reason");
  });

  it("이미 ACTIVE 종목이 존재하면 중복 등록 차단", async () => {
    mockFindActive.mockResolvedValue([
      { id: 1, symbol: "AAPL", entry_date: "2026-01-01" },
    ]);
    const result = JSON.parse(
      await saveTrackedStock.execute(makeValidRegisterInput()),
    );
    expect(result.success).toBe(false);
    expect(result.blocked).toBe(true);
    expect(result.message).toContain("ACTIVE");
  });

  it("insertTrackedStock이 null 반환 시(동시 요청 충돌) 실패 반환", async () => {
    mockInsert.mockResolvedValue(null);
    const result = JSON.parse(
      await saveTrackedStock.execute(makeValidRegisterInput()),
    );
    expect(result.success).toBe(false);
    expect(result.blocked).toBe(true);
    expect(result.message).toContain("동시 요청");
  });

  it("유효하지 않은 symbol이면 에러 반환", async () => {
    const result = JSON.parse(
      await saveTrackedStock.execute(makeValidRegisterInput({ symbol: "invalid symbol!" })),
    );
    expect(result.error).toBeDefined();
  });

  it("유효하지 않은 date이면 에러 반환", async () => {
    const result = JSON.parse(
      await saveTrackedStock.execute(makeValidRegisterInput({ date: "not-a-date" })),
    );
    expect(result.error).toBeDefined();
  });

  it("thesis_id / sector / industry 없이도 등록 가능 (에이전트 자유 판단)", async () => {
    const input = makeValidRegisterInput({
      thesis_id: undefined,
      sector: undefined,
      industry: undefined,
    });
    const result = JSON.parse(await saveTrackedStock.execute(input));
    expect(result.success).toBe(true);
  });

  it("insertTrackedStock 호출 시 source='agent' 전달", async () => {
    await saveTrackedStock.execute(makeValidRegisterInput());
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({ source: "agent" }),
    );
  });

  it("Phase 2 시작일이 존재하면 phase2Since를 채워서 전달", async () => {
    mockFindPhase2Since.mockResolvedValue([
      { symbol: "AAPL", phase2_since: "2026-03-10" },
    ]);
    await saveTrackedStock.execute(makeValidRegisterInput());
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({ phase2Since: "2026-03-10" }),
    );
  });

  it("Phase 2 시작일이 없으면 phase2Since를 null로 전달", async () => {
    mockFindPhase2Since.mockResolvedValue([]);
    await saveTrackedStock.execute(makeValidRegisterInput());
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({ phase2Since: null }),
    );
  });
});

// ─── exit 테스트 ─────────────────────────────────────────────────────────────

describe("saveTrackedStock.execute — exit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("ACTIVE 종목 존재 시 해제 성공", async () => {
    mockFindActive.mockResolvedValue([
      { id: 5, symbol: "AAPL", entry_date: "2026-01-01" },
    ]);
    mockExit.mockResolvedValue(undefined);

    // fetchLatestCloseForExit → pool.query mock
    const { pool } = await import("@/db/client");
    (pool.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      rows: [{ close: "185.50" }],
    });

    const result = JSON.parse(
      await saveTrackedStock.execute({
        action: "exit",
        exit: {
          symbol: "AAPL",
          exit_date: "2026-03-22",
          exit_reason: "Phase 3 진입",
        },
      }),
    );

    expect(result.success).toBe(true);
    expect(result.symbol).toBe("AAPL");
    expect(result.exitReason).toBe("Phase 3 진입");
    expect(mockExit).toHaveBeenCalledWith(5, "2026-03-22", "Phase 3 진입", 185.5);
  });

  it("ACTIVE 종목 없으면 실패 반환", async () => {
    mockFindActive.mockResolvedValue([]);

    const result = JSON.parse(
      await saveTrackedStock.execute({
        action: "exit",
        exit: {
          symbol: "NVDA",
          exit_date: "2026-03-22",
          exit_reason: "수동 제거",
        },
      }),
    );

    expect(result.success).toBe(false);
    expect(result.message).toContain("찾을 수 없습니다");
  });

  it("exit_reason 없으면 에러 반환", async () => {
    const result = JSON.parse(
      await saveTrackedStock.execute({
        action: "exit",
        exit: {
          symbol: "AAPL",
          exit_date: "2026-03-22",
          exit_reason: "",
        },
      }),
    );
    expect(result.error).toBeDefined();
  });

  it("유효하지 않은 exit_date이면 에러 반환", async () => {
    const result = JSON.parse(
      await saveTrackedStock.execute({
        action: "exit",
        exit: {
          symbol: "AAPL",
          exit_date: "bad-date",
          exit_reason: "테스트",
        },
      }),
    );
    expect(result.error).toBeDefined();
  });

  it("exit 데이터가 없으면 에러 반환", async () => {
    const result = JSON.parse(
      await saveTrackedStock.execute({ action: "exit" }),
    );
    expect(result.error).toBeDefined();
  });
});

// ─── query 테스트 ─────────────────────────────────────────────────────────────

describe("saveTrackedStock.execute — query", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("오늘 날짜 기준 ETL 자동 종목 전체 조회", async () => {
    mockPool.query.mockResolvedValue({
      rows: [
        {
          symbol: "AAPL",
          entry_date: "2026-04-01",
          entry_price: "150.00",
          entry_rs_score: 80,
          entry_phase: 2,
          entry_sector: "Technology",
          entry_industry: "Software",
          entry_reason: "[ETL 자동] Phase 2 RS 80",
          status: "ACTIVE",
          market_regime: "EARLY_BULL",
          source: "etl_auto",
          tier: "standard",
        },
      ],
    });

    const result = JSON.parse(
      await saveTrackedStock.execute({
        action: "query",
        query: { date: "2026-04-01" },
      }),
    );

    expect(result.success).toBe(true);
    expect(result.count).toBe(1);
    expect(result.trackedStocks[0].symbol).toBe("AAPL");
    expect(result.trackedStocks[0].source).toBe("etl_auto");
  });

  it("symbols 지정 시 해당 symbols만 조회", async () => {
    mockPool.query.mockResolvedValue({ rows: [] });

    await saveTrackedStock.execute({
      action: "query",
      query: {
        date: "2026-04-01",
        symbols: ["AAPL", "MSFT"],
      },
    });

    expect(mockPool.query).toHaveBeenCalledTimes(1);
    const callArgs = mockPool.query.mock.calls[0];
    expect(callArgs[1][1]).toEqual(["AAPL", "MSFT"]);
  });

  it("invalid symbol은 필터링하고 유효한 symbol만 조회", async () => {
    mockPool.query.mockResolvedValue({ rows: [] });

    await saveTrackedStock.execute({
      action: "query",
      query: {
        date: "2026-04-01",
        symbols: ["AAPL", "invalid@sym", "MSFT"],
      },
    });

    const callArgs = mockPool.query.mock.calls[0];
    expect(callArgs[1][1]).toEqual(["AAPL", "MSFT"]);
  });

  it("오늘 ETL 종목이 없으면 빈 배열 반환", async () => {
    mockPool.query.mockResolvedValue({ rows: [] });

    const result = JSON.parse(
      await saveTrackedStock.execute({
        action: "query",
        query: { date: "2026-04-01" },
      }),
    );

    expect(result.success).toBe(true);
    expect(result.count).toBe(0);
    expect(result.trackedStocks).toHaveLength(0);
  });

  it("잘못된 date이면 에러 반환", async () => {
    const result = JSON.parse(
      await saveTrackedStock.execute({
        action: "query",
        query: { date: "invalid-date" },
      }),
    );
    expect(result.error).toBeDefined();
    expect(mockPool.query).not.toHaveBeenCalled();
  });

  it("query 데이터가 없으면 에러 반환", async () => {
    const result = JSON.parse(
      await saveTrackedStock.execute({ action: "query" }),
    );
    expect(result.error).toBeDefined();
  });
});

// ─── 공통 테스트 ──────────────────────────────────────────────────────────────

describe("saveTrackedStock.definition", () => {
  it("도구 이름이 save_tracked_stock이다", () => {
    expect(saveTrackedStock.definition.name).toBe("save_tracked_stock");
  });

  it("action enum에 register, exit, query가 포함된다", () => {
    const schema = saveTrackedStock.definition.input_schema as Record<string, unknown>;
    const properties = schema.properties as Record<string, Record<string, unknown>>;
    const actionEnum = properties.action.enum as string[];
    expect(actionEnum).toContain("register");
    expect(actionEnum).toContain("exit");
    expect(actionEnum).toContain("query");
  });

  it("알 수 없는 action이면 에러 반환", async () => {
    const result = JSON.parse(
      await saveTrackedStock.execute({ action: "unknown" }),
    );
    expect(result.error).toBeDefined();
  });
});
