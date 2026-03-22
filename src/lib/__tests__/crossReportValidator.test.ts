// ---------------------------------------------------------------------------
// crossReportValidator.test.ts — 교차 리포트 검증 단위 테스트
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// DB pool mock
vi.mock("@/db/client", () => ({
  pool: {
    query: vi.fn(),
  },
}));

// logger mock
vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { pool } from "@/db/client";
import { validateCrossReport } from "../crossReportValidator";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockQuery = vi.mocked(pool.query);

/**
 * pool.query를 순서대로 다른 결과를 반환하도록 설정한다.
 * 첫 번째 호출(daily_reports), 두 번째 호출(theses) 순서.
 */
function setupQueryMocks(
  dailySymbols: Array<{ symbol: string }>,
  thesisRows: Array<{ debate_date: string; beneficiary_tickers: string | null }>,
): void {
  mockQuery
    .mockResolvedValueOnce({
      rows: dailySymbols.length > 0
        ? [{ reported_symbols: dailySymbols }]
        : [],
      rowCount: dailySymbols.length > 0 ? 1 : 0,
    } as never)
    .mockResolvedValueOnce({
      rows: thesisRows,
      rowCount: thesisRows.length,
    } as never);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("validateCrossReport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ────────────────────────────────────────────
  // 1. 완전 일치 — ok
  // ────────────────────────────────────────────
  it("일간과 토론 종목이 완전 일치하면 severity ok 반환", async () => {
    setupQueryMocks(
      [{ symbol: "NVDA" }, { symbol: "AAPL" }],
      [
        {
          debate_date: "2026-03-21",
          beneficiary_tickers: JSON.stringify(["NVDA", "AAPL"]),
        },
      ],
    );

    const result = await validateCrossReport("2026-03-21");

    expect(result.severity).toBe("ok");
    expect(result.hasMismatch).toBe(false);
    expect(result.dailyOnly).toHaveLength(0);
    expect(result.debateOnly).toHaveLength(0);
  });

  // ────────────────────────────────────────────
  // 2. 일간에만 있는 종목 — warn
  // ────────────────────────────────────────────
  it("일간에만 있는 종목이 있으면 dailyOnly에 포함 + warn", async () => {
    setupQueryMocks(
      [{ symbol: "NVDA" }, { symbol: "TSLA" }],
      [
        {
          debate_date: "2026-03-21",
          beneficiary_tickers: JSON.stringify(["NVDA"]),
        },
      ],
    );

    const result = await validateCrossReport("2026-03-21");

    expect(result.severity).toBe("warn");
    expect(result.hasMismatch).toBe(true);
    expect(result.dailyOnly).toContain("TSLA");
    expect(result.debateOnly).toHaveLength(0);
  });

  // ────────────────────────────────────────────
  // 3. 토론에만 있는 종목 — warn
  // ────────────────────────────────────────────
  it("토론에만 있는 종목이 있으면 debateOnly에 포함 + warn", async () => {
    setupQueryMocks(
      [{ symbol: "NVDA" }],
      [
        {
          debate_date: "2026-03-21",
          beneficiary_tickers: JSON.stringify(["NVDA", "AMD"]),
        },
      ],
    );

    const result = await validateCrossReport("2026-03-21");

    expect(result.severity).toBe("warn");
    expect(result.hasMismatch).toBe(true);
    expect(result.dailyOnly).toHaveLength(0);
    expect(result.debateOnly).toContain("AMD");
  });

  // ────────────────────────────────────────────
  // 4. 양쪽 모두 비어 있으면 ok (데이터 없음)
  // ────────────────────────────────────────────
  it("양쪽 모두 데이터가 없으면 ok 반환", async () => {
    setupQueryMocks([], []);

    const result = await validateCrossReport("2026-03-21");

    expect(result.severity).toBe("ok");
    expect(result.hasMismatch).toBe(false);
  });

  // ────────────────────────────────────────────
  // 5. 일간 리포트 없음 (토론만 있음) — warn
  // ────────────────────────────────────────────
  it("일간 리포트가 없고 토론만 있으면 warn 반환", async () => {
    setupQueryMocks(
      [],
      [
        {
          debate_date: "2026-03-21",
          beneficiary_tickers: JSON.stringify(["NVDA"]),
        },
      ],
    );

    const result = await validateCrossReport("2026-03-21");

    expect(result.severity).toBe("warn");
    expect(result.hasMismatch).toBe(true);
    expect(result.debateOnly).toContain("NVDA");
  });

  // ────────────────────────────────────────────
  // 6. DB 조회 실패 시 graceful — ok 반환 (비블로킹)
  // ────────────────────────────────────────────
  it("DB 조회 실패 시 예외 전파 없이 ok 반환", async () => {
    mockQuery.mockRejectedValueOnce(new Error("DB connection failed"));

    const result = await validateCrossReport("2026-03-21");

    // Promise가 reject되지 않고 ok를 반환해야 함
    expect(result).not.toBeNull();
    expect(result.severity).toBe("ok");
  });

  // ────────────────────────────────────────────
  // 7. beneficiary_tickers가 null인 thesis row — 빈 것으로 처리
  // ────────────────────────────────────────────
  it("beneficiary_tickers가 null인 thesis는 tickers 미포함", async () => {
    setupQueryMocks(
      [{ symbol: "NVDA" }],
      [{ debate_date: "2026-03-21", beneficiary_tickers: null }],
    );

    const result = await validateCrossReport("2026-03-21");

    // 일간에 NVDA 있고 토론에 없으면 mismatch
    expect(result.hasMismatch).toBe(true);
    expect(result.dailyOnly).toContain("NVDA");
  });

  // ────────────────────────────────────────────
  // 8. 대소문자 정규화 — NVDA와 nvda는 동일
  // ────────────────────────────────────────────
  it("대소문자 관계없이 동일 종목으로 처리", async () => {
    setupQueryMocks(
      [{ symbol: "nvda" }],
      [
        {
          debate_date: "2026-03-21",
          beneficiary_tickers: JSON.stringify(["NVDA"]),
        },
      ],
    );

    const result = await validateCrossReport("2026-03-21");

    expect(result.severity).toBe("ok");
    expect(result.hasMismatch).toBe(false);
  });

  // ────────────────────────────────────────────
  // 9. checkedAt 필드 포함 확인
  // ────────────────────────────────────────────
  it("반환 결과에 checkedAt이 ISO 형식으로 포함됨", async () => {
    setupQueryMocks(
      [{ symbol: "NVDA" }],
      [
        {
          debate_date: "2026-03-21",
          beneficiary_tickers: JSON.stringify(["NVDA"]),
        },
      ],
    );

    const result = await validateCrossReport("2026-03-21");

    expect(result.checkedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  // ────────────────────────────────────────────
  // 10. 복합 케이스 — 일부 일치, 일부 불일치
  // ────────────────────────────────────────────
  it("일부 일치하고 일부 불일치하면 각각 분리하여 반환", async () => {
    setupQueryMocks(
      [{ symbol: "NVDA" }, { symbol: "TSLA" }, { symbol: "AAPL" }],
      [
        {
          debate_date: "2026-03-21",
          beneficiary_tickers: JSON.stringify(["NVDA", "AAPL", "MSFT"]),
        },
      ],
    );

    const result = await validateCrossReport("2026-03-21");

    expect(result.hasMismatch).toBe(true);
    expect(result.severity).toBe("warn");
    expect(result.dailyOnly).toContain("TSLA");
    expect(result.dailyOnly).not.toContain("NVDA");
    expect(result.dailyOnly).not.toContain("AAPL");
    expect(result.debateOnly).toContain("MSFT");
    expect(result.debateOnly).not.toContain("NVDA");
  });
});
