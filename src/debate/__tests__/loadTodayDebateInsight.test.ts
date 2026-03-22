import { describe, it, expect, vi, beforeEach } from "vitest";

// DB 모듈 mock — 실제 DB 연결 없이 단위 테스트
vi.mock("@/db/client", () => ({
  db: {
    select: vi.fn(),
  },
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { db } from "@/db/client";
import { loadTodayDebateInsight } from "../sessionStore.js";

// ────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────

function makeSelectChain(rows: unknown[]) {
  const limitFn = vi.fn().mockResolvedValue(rows);
  const whereFn = vi.fn().mockReturnValue({ limit: limitFn });
  const fromFn = vi.fn().mockReturnValue({ where: whereFn });
  const selectFn = vi.fn().mockReturnValue({ from: fromFn });
  return { selectFn, fromFn, whereFn, limitFn };
}

// ────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────

describe("loadTodayDebateInsight", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("세션이 없으면 빈 문자열을 반환한다", async () => {
    const { selectFn } = makeSelectChain([]);
    vi.mocked(db.select).mockImplementation(selectFn);

    const result = await loadTodayDebateInsight("2026-03-22");
    expect(result).toBe("");
  });

  it("synthesisReport에서 핵심 발견 섹션을 추출한다", async () => {
    const synthesisReport = `### 1. 핵심 한 줄
GPU 병목 해소 신호.

### 2. 시장 데이터
- SPY: 580.12

### 3. 핵심 발견 + 병목 상태
AI 인프라 수요 폭발적 증가 — NVDA Phase 2 진입.

### 4. 기회
반도체 섹터.`;

    const { selectFn } = makeSelectChain([{ synthesisReport }]);
    vi.mocked(db.select).mockImplementation(selectFn);

    const result = await loadTodayDebateInsight("2026-03-22");
    expect(result).toContain("AI 인프라 수요 폭발적 증가");
    expect(result).toContain("NVDA Phase 2 진입");
  });

  it("DB 오류 발생 시 빈 문자열을 반환한다 (fail-open)", async () => {
    vi.mocked(db.select).mockImplementation(() => {
      throw new Error("DB connection failed");
    });

    const result = await loadTodayDebateInsight("2026-03-22");
    expect(result).toBe("");
  });

  it("DB Promise reject 시 빈 문자열을 반환한다 (fail-open)", async () => {
    const limitFn = vi.fn().mockRejectedValue(new Error("Query timeout"));
    const whereFn = vi.fn().mockReturnValue({ limit: limitFn });
    const fromFn = vi.fn().mockReturnValue({ where: whereFn });
    const selectFn = vi.fn().mockReturnValue({ from: fromFn });
    vi.mocked(db.select).mockImplementation(selectFn);

    const result = await loadTodayDebateInsight("2026-03-22");
    expect(result).toBe("");
  });

  it("synthesisReport가 빈 문자열이면 빈 문자열을 반환한다", async () => {
    const { selectFn } = makeSelectChain([{ synthesisReport: "" }]);
    vi.mocked(db.select).mockImplementation(selectFn);

    const result = await loadTodayDebateInsight("2026-03-22");
    expect(result).toBe("");
  });

  it("구조화된 섹션이 없는 리포트는 첫 300자를 반환한다", async () => {
    const synthesisReport = "비구조화된 리포트 내용입니다. 시장이 하락했습니다.";
    const { selectFn } = makeSelectChain([{ synthesisReport }]);
    vi.mocked(db.select).mockImplementation(selectFn);

    const result = await loadTodayDebateInsight("2026-03-22");
    expect(result).toContain("시장이 하락했습니다");
    expect(result.length).toBeGreaterThan(0);
  });
});
