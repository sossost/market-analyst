/**
 * saveWatchlist.test.ts — 관심종목 등록/해제 도구 테스트
 *
 * 외부 의존성(DB, pool)은 모두 mock 처리.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

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

vi.mock("@/db/repositories/watchlistRepository.js", () => ({
  findActiveWatchlistBySymbols: vi.fn(),
  exitWatchlistItem: vi.fn(),
}));

vi.mock("@/corporate-analyst/runCorporateAnalyst.js", () => ({
  runCorporateAnalyst: vi.fn().mockResolvedValue({ success: true }),
}));

// drizzle schema 컬럼 참조를 mock — onConflictDoNothing target에서 사용
vi.mock("@/db/schema/analyst", () => ({
  watchlistStocks: {
    symbol: "symbol",
    entryDate: "entry_date",
  },
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// --- import (mock 이후) ---

import { saveWatchlist } from "../saveWatchlist";
import { db } from "@/db/client";
import {
  findActiveWatchlistBySymbols,
  exitWatchlistItem,
} from "@/db/repositories/watchlistRepository.js";

const mockDb = db as unknown as { insert: ReturnType<typeof vi.fn> };
const mockFindActive = findActiveWatchlistBySymbols as ReturnType<typeof vi.fn>;
const mockExit = exitWatchlistItem as ReturnType<typeof vi.fn>;

// --- 헬퍼 ---

function makeValidRegisterInput() {
  return {
    action: "register",
    register: {
      symbol: "AAPL",
      date: "2026-03-22",
      phase: 2,
      rs_score: 75,
      industry_rs: 65,
      sepa_grade: "A",
      thesis_id: 42,
      sector: "Technology",
      industry: "Software",
      reason: "AI 수요 확장 → 데이터센터 투자 가속",
    },
  };
}

function makeInsertChain(inserted = true) {
  const returningMock = vi.fn().mockResolvedValue(inserted ? [{ id: 1 }] : []);
  const conflictChain = {
    returning: returningMock,
  };
  const valuesChain = {
    onConflictDoNothing: vi.fn().mockReturnValue(conflictChain),
  };
  const insertChain = {
    values: vi.fn().mockReturnValue(valuesChain),
  };
  mockDb.insert.mockReturnValue(insertChain);
  return { insertChain, valuesChain, returningMock };
}

// ─── 등록 (register) ──────────────────────────────────────────────────────────

describe("saveWatchlist.execute — register", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindActive.mockResolvedValue([]);
    makeInsertChain();
  });

  it("5중 게이트 통과 시 등록 성공", async () => {
    const result = JSON.parse(
      await saveWatchlist.execute(makeValidRegisterInput()),
    );
    expect(result.success).toBe(true);
    expect(result.symbol).toBe("AAPL");
    expect(result.entryDate).toBe("2026-03-22");
    expect(result.trackingEndDate).toBeDefined();
  });

  it("Phase 1이면 게이트 거부", async () => {
    const input = makeValidRegisterInput();
    (input.register as Record<string, unknown>).phase = 1;
    const result = JSON.parse(await saveWatchlist.execute(input));
    expect(result.success).toBe(false);
    expect(result.blocked).toBe(true);
    expect(result.gateFailures.some((f: { condition: string }) => f.condition === "phase")).toBe(true);
  });

  it("업종 RS 미달이면 게이트 거부", async () => {
    const input = makeValidRegisterInput();
    (input.register as Record<string, unknown>).industry_rs = 20;
    const result = JSON.parse(await saveWatchlist.execute(input));
    expect(result.success).toBe(false);
    expect(result.blocked).toBe(true);
    expect(result.gateFailures.some((f: { condition: string }) => f.condition === "industryRs")).toBe(true);
  });

  it("개별 RS 미달이면 게이트 거부", async () => {
    const input = makeValidRegisterInput();
    (input.register as Record<string, unknown>).rs_score = 40;
    const result = JSON.parse(await saveWatchlist.execute(input));
    expect(result.success).toBe(false);
    expect(result.gateFailures.some((f: { condition: string }) => f.condition === "individualRs")).toBe(true);
  });

  it("thesis_id 없으면 게이트 거부", async () => {
    const input = makeValidRegisterInput();
    (input.register as Record<string, unknown>).thesis_id = null;
    const result = JSON.parse(await saveWatchlist.execute(input));
    expect(result.success).toBe(false);
    expect(result.gateFailures.some((f: { condition: string }) => f.condition === "narrativeBasis")).toBe(true);
  });

  it("SEPA C 등급이면 게이트 거부", async () => {
    const input = makeValidRegisterInput();
    (input.register as Record<string, unknown>).sepa_grade = "C";
    const result = JSON.parse(await saveWatchlist.execute(input));
    expect(result.success).toBe(false);
    expect(result.gateFailures.some((f: { condition: string }) => f.condition === "sepaGrade")).toBe(true);
  });

  it("이미 ACTIVE 종목이 존재하면 중복 등록 차단", async () => {
    mockFindActive.mockResolvedValue([
      { id: 1, symbol: "AAPL", entry_date: "2026-01-01" },
    ]);
    const result = JSON.parse(
      await saveWatchlist.execute(makeValidRegisterInput()),
    );
    expect(result.success).toBe(false);
    expect(result.blocked).toBe(true);
    expect(result.message).toContain("ACTIVE");
  });

  it("동시 요청에 의한 중복 시 returning 빈 배열 → 실패 반환", async () => {
    makeInsertChain(false); // returning이 빈 배열 반환
    const result = JSON.parse(
      await saveWatchlist.execute(makeValidRegisterInput()),
    );
    expect(result.success).toBe(false);
    expect(result.blocked).toBe(true);
    expect(result.message).toContain("동시 요청");
  });

  it("action이 없으면 에러 반환", async () => {
    const result = JSON.parse(
      await saveWatchlist.execute({ action: "unknown" }),
    );
    expect(result.error).toBeDefined();
  });

  it("유효하지 않은 symbol이면 에러 반환", async () => {
    const input = makeValidRegisterInput();
    (input.register as Record<string, unknown>).symbol = "invalid symbol!";
    const result = JSON.parse(await saveWatchlist.execute(input));
    expect(result.error).toBeDefined();
  });

  it("유효하지 않은 date이면 에러 반환", async () => {
    const input = makeValidRegisterInput();
    (input.register as Record<string, unknown>).date = "not-a-date";
    const result = JSON.parse(await saveWatchlist.execute(input));
    expect(result.error).toBeDefined();
  });
});

// ─── 해제 (exit) ─────────────────────────────────────────────────────────────

describe("saveWatchlist.execute — exit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("ACTIVE 종목 존재 시 해제 성공", async () => {
    mockFindActive.mockResolvedValue([
      { id: 5, symbol: "AAPL", entry_date: "2026-01-01" },
    ]);
    mockExit.mockResolvedValue(undefined);

    const result = JSON.parse(
      await saveWatchlist.execute({
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
    expect(mockExit).toHaveBeenCalledWith(5, "2026-03-22", "Phase 3 진입");
  });

  it("ACTIVE 종목 없으면 실패 반환", async () => {
    mockFindActive.mockResolvedValue([]);

    const result = JSON.parse(
      await saveWatchlist.execute({
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
      await saveWatchlist.execute({
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
      await saveWatchlist.execute({
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
});
