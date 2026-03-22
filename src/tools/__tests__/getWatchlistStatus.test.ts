/**
 * getWatchlistStatus.test.ts — 관심종목 현황 조회 도구 테스트
 *
 * 외부 의존성(DB, pool)은 모두 mock 처리.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// --- 모듈 mock 설정 ---

vi.mock("@/etl/utils/retry", () => ({
  retryDatabaseOperation: vi.fn((fn: () => unknown) => fn()),
}));

vi.mock("@/db/repositories/watchlistRepository.js", () => ({
  findActiveWatchlist: vi.fn(),
}));

// --- import (mock 이후) ---

import { getWatchlistStatus } from "../getWatchlistStatus";
import { findActiveWatchlist } from "@/db/repositories/watchlistRepository.js";

const mockFindActive = findActiveWatchlist as ReturnType<typeof vi.fn>;

// --- 테스트용 Row 헬퍼 ---

function makeActiveRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    symbol: "AAPL",
    entry_date: "2026-01-01",
    entry_phase: 2,
    entry_rs_score: 70,
    entry_sector_rs: "60",
    entry_sepa_grade: "A",
    entry_thesis_id: 42,
    entry_sector: "Technology",
    entry_industry: "Software",
    entry_reason: "AI 수요 확장",
    tracking_end_date: "2026-04-01",
    current_phase: 2,
    current_rs_score: 75,
    phase_trajectory: [
      { date: "2026-01-01", phase: 2, rsScore: 70 },
      { date: "2026-01-02", phase: 2, rsScore: 71 },
    ],
    sector_relative_perf: "5",
    price_at_entry: "150",
    current_price: "160",
    pnl_percent: "6.67",
    max_pnl_percent: "8.0",
    days_tracked: 21,
    last_updated: "2026-01-22",
    ...overrides,
  };
}

// ─── getWatchlistStatus 테스트 ────────────────────────────────────────────────

describe("getWatchlistStatus.execute", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("ACTIVE 종목 없으면 빈 목록 반환", async () => {
    mockFindActive.mockResolvedValue([]);
    const result = JSON.parse(await getWatchlistStatus.execute({}));
    expect(result.count).toBe(0);
    expect(result.items).toHaveLength(0);
    expect(result.message).toContain("없습니다");
  });

  it("ACTIVE 종목 있으면 목록 반환", async () => {
    mockFindActive.mockResolvedValue([makeActiveRow()]);
    const result = JSON.parse(await getWatchlistStatus.execute({}));
    expect(result.items).toHaveLength(1);
    expect(result.items[0].symbol).toBe("AAPL");
  });

  it("summary에 totalActive 포함", async () => {
    mockFindActive.mockResolvedValue([makeActiveRow(), makeActiveRow({ symbol: "NVDA", id: 2 })]);
    const result = JSON.parse(await getWatchlistStatus.execute({}));
    expect(result.summary.totalActive).toBe(2);
  });

  it("Phase 전이 감지 — entryPhase와 currentPhase가 다른 경우 phaseChanges에 포함", async () => {
    mockFindActive.mockResolvedValue([
      makeActiveRow({ current_phase: 3 }), // Phase 2 → 3
    ]);
    const result = JSON.parse(await getWatchlistStatus.execute({}));
    expect(result.summary.phaseChanges).toHaveLength(1);
    expect(result.summary.phaseChanges[0].symbol).toBe("AAPL");
    expect(result.summary.phaseChanges[0].entryPhase).toBe(2);
    expect(result.summary.phaseChanges[0].currentPhase).toBe(3);
  });

  it("Phase 변경 없으면 phaseChanges 빈 배열", async () => {
    mockFindActive.mockResolvedValue([makeActiveRow({ current_phase: 2 })]);
    const result = JSON.parse(await getWatchlistStatus.execute({}));
    expect(result.summary.phaseChanges).toHaveLength(0);
  });

  it("include_trajectory: false (기본값)이면 최근 7일만 반환", async () => {
    const trajectory = Array.from({ length: 20 }, (_, i) => ({
      date: `2026-01-${String(i + 1).padStart(2, "0")}`,
      phase: 2,
      rsScore: 70 + i,
    }));
    mockFindActive.mockResolvedValue([makeActiveRow({ phase_trajectory: trajectory })]);

    const result = JSON.parse(await getWatchlistStatus.execute({ include_trajectory: false }));
    expect(result.items[0].phaseTrajectory).toHaveLength(7);
  });

  it("include_trajectory: true이면 전체 이력 반환", async () => {
    const trajectory = Array.from({ length: 20 }, (_, i) => ({
      date: `2026-01-${String(i + 1).padStart(2, "0")}`,
      phase: 2,
      rsScore: 70 + i,
    }));
    mockFindActive.mockResolvedValue([makeActiveRow({ phase_trajectory: trajectory })]);

    const result = JSON.parse(await getWatchlistStatus.execute({ include_trajectory: true }));
    expect(result.items[0].phaseTrajectory).toHaveLength(20);
  });

  it("thesis_id가 있으면 hasThesisBasis: true", async () => {
    mockFindActive.mockResolvedValue([makeActiveRow({ entry_thesis_id: 42 })]);
    const result = JSON.parse(await getWatchlistStatus.execute({}));
    expect(result.items[0].hasThesisBasis).toBe(true);
  });

  it("thesis_id가 null이면 hasThesisBasis: false", async () => {
    mockFindActive.mockResolvedValue([makeActiveRow({ entry_thesis_id: null })]);
    const result = JSON.parse(await getWatchlistStatus.execute({}));
    expect(result.items[0].hasThesisBasis).toBe(false);
  });

  it("phase_trajectory가 null이면 빈 배열로 처리", async () => {
    mockFindActive.mockResolvedValue([makeActiveRow({ phase_trajectory: null })]);
    const result = JSON.parse(await getWatchlistStatus.execute({}));
    expect(result.items[0].phaseTrajectory).toEqual([]);
  });

  it("avgPnlPercent가 summary에 포함됨", async () => {
    mockFindActive.mockResolvedValue([
      makeActiveRow({ pnl_percent: "10" }),
      makeActiveRow({ symbol: "NVDA", id: 2, pnl_percent: "20" }),
    ]);
    const result = JSON.parse(await getWatchlistStatus.execute({}));
    expect(result.summary.avgPnlPercent).toBeCloseTo(15, 1);
  });

  it("pnl_percent가 null인 종목은 avgPnlPercent 계산에서 제외", async () => {
    mockFindActive.mockResolvedValue([
      makeActiveRow({ pnl_percent: "10" }),
      makeActiveRow({ symbol: "NVDA", id: 2, pnl_percent: null }),
    ]);
    const result = JSON.parse(await getWatchlistStatus.execute({}));
    // null인 항목 제외하고 10%만 평균
    expect(result.summary.avgPnlPercent).toBeCloseTo(10, 1);
  });
});
