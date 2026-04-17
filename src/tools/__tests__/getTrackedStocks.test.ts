/**
 * getTrackedStocks.test.ts — 트래킹 종목 현황 조회 도구 테스트
 *
 * 외부 의존성(repository)은 모두 mock 처리.
 * getWatchlistStatus 핵심 시나리오를 커버하며, source/tier 필터 시나리오를 추가한다.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// --- 모듈 mock 설정 ---

vi.mock("@/etl/utils/retry", () => ({
  retryDatabaseOperation: vi.fn((fn: () => unknown) => fn()),
}));

vi.mock("@/db/repositories/trackedStocksRepository.js", () => ({
  findActiveTrackedStocks: vi.fn(),
  findActiveTrackedStocksBySource: vi.fn(),
  findActiveTrackedStocksByTier: vi.fn(),
}));

// --- import (mock 이후) ---

import { getTrackedStocks } from "../getTrackedStocks";
import {
  findActiveTrackedStocks,
  findActiveTrackedStocksBySource,
  findActiveTrackedStocksByTier,
} from "@/db/repositories/trackedStocksRepository.js";

const mockFindAll = findActiveTrackedStocks as ReturnType<typeof vi.fn>;
const mockFindBySource = findActiveTrackedStocksBySource as ReturnType<typeof vi.fn>;
const mockFindByTier = findActiveTrackedStocksByTier as ReturnType<typeof vi.fn>;

// --- 테스트용 Row 헬퍼 ---

function makeActiveRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    symbol: "AAPL",
    source: "etl_auto",
    tier: "standard",
    entry_date: "2026-01-01",
    entry_price: "150",
    entry_phase: 2,
    entry_prev_phase: null,
    entry_rs_score: 70,
    entry_sepa_grade: "A",
    entry_thesis_id: 42,
    entry_sector: "Technology",
    entry_industry: "Software",
    entry_reason: "AI 수요 확장",
    status: "ACTIVE",
    market_regime: null,
    tracking_end_date: "2026-04-01",
    current_phase: 2,
    current_rs_score: 75,
    current_price: "160",
    pnl_percent: "6.67",
    max_pnl_percent: "8.0",
    days_tracked: 21,
    last_updated: "2026-01-22",
    return_7d: "3.5",
    return_30d: null,
    return_90d: null,
    phase_trajectory: [
      { date: "2026-01-01", phase: 2, rsScore: 70 },
      { date: "2026-01-02", phase: 2, rsScore: 71 },
    ],
    sector_relative_perf: "5",
    exit_date: null,
    exit_reason: null,
    ...overrides,
  };
}

// ─── 기본 조회 테스트 ──────────────────────────────────────────────────────────

describe("getTrackedStocks.execute — 기본 조회", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("ACTIVE 종목 없으면 빈 목록 반환", async () => {
    mockFindAll.mockResolvedValue([]);
    const result = JSON.parse(await getTrackedStocks.execute({}));
    expect(result.count).toBe(0);
    expect(result.items).toHaveLength(0);
    expect(result.message).toContain("없습니다");
  });

  it("ACTIVE 종목 있으면 목록 반환", async () => {
    mockFindAll.mockResolvedValue([makeActiveRow()]);
    const result = JSON.parse(await getTrackedStocks.execute({}));
    expect(result.items).toHaveLength(1);
    expect(result.items[0].symbol).toBe("AAPL");
  });

  it("source와 tier 정보가 아이템에 포함된다", async () => {
    mockFindAll.mockResolvedValue([makeActiveRow({ source: "agent", tier: "featured" })]);
    const result = JSON.parse(await getTrackedStocks.execute({}));
    expect(result.items[0].source).toBe("agent");
    expect(result.items[0].tier).toBe("featured");
  });

  it("summary에 totalActive 포함", async () => {
    mockFindAll.mockResolvedValue([
      makeActiveRow(),
      makeActiveRow({ symbol: "NVDA", id: 2 }),
    ]);
    const result = JSON.parse(await getTrackedStocks.execute({}));
    expect(result.summary.totalActive).toBe(2);
  });

  it("summary에 bySource 통계 포함", async () => {
    mockFindAll.mockResolvedValue([
      makeActiveRow({ source: "etl_auto" }),
      makeActiveRow({ symbol: "NVDA", id: 2, source: "agent" }),
    ]);
    const result = JSON.parse(await getTrackedStocks.execute({}));
    expect(result.summary.bySource.etl_auto).toBe(1);
    expect(result.summary.bySource.agent).toBe(1);
    expect(result.summary.bySource.thesis_aligned).toBe(0);
  });

  it("summary에 byTier 통계 포함", async () => {
    mockFindAll.mockResolvedValue([
      makeActiveRow({ tier: "standard" }),
      makeActiveRow({ symbol: "NVDA", id: 2, tier: "featured" }),
    ]);
    const result = JSON.parse(await getTrackedStocks.execute({}));
    expect(result.summary.byTier.standard).toBe(1);
    expect(result.summary.byTier.featured).toBe(1);
  });
});

// ─── Phase 전이 탐지 테스트 ───────────────────────────────────────────────────

describe("getTrackedStocks.execute — Phase 전이 탐지", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("entryPhase와 currentPhase가 다르면 phaseChanges에 포함", async () => {
    mockFindAll.mockResolvedValue([
      makeActiveRow({ current_phase: 3 }), // Phase 2 → 3
    ]);
    const result = JSON.parse(await getTrackedStocks.execute({}));
    expect(result.summary.phaseChanges).toHaveLength(1);
    expect(result.summary.phaseChanges[0].symbol).toBe("AAPL");
    expect(result.summary.phaseChanges[0].entryPhase).toBe(2);
    expect(result.summary.phaseChanges[0].currentPhase).toBe(3);
    expect(result.summary.phaseChanges[0].source).toBe("etl_auto");
  });

  it("Phase 변경 없으면 phaseChanges 빈 배열", async () => {
    mockFindAll.mockResolvedValue([makeActiveRow({ current_phase: 2 })]);
    const result = JSON.parse(await getTrackedStocks.execute({}));
    expect(result.summary.phaseChanges).toHaveLength(0);
  });
});

// ─── Trajectory 테스트 ────────────────────────────────────────────────────────

describe("getTrackedStocks.execute — phase_trajectory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("include_trajectory: false (기본값)이면 최근 7일만 반환", async () => {
    const trajectory = Array.from({ length: 20 }, (_, i) => ({
      date: `2026-01-${String(i + 1).padStart(2, "0")}`,
      phase: 2,
      rsScore: 70 + i,
    }));
    mockFindAll.mockResolvedValue([makeActiveRow({ phase_trajectory: trajectory })]);

    const result = JSON.parse(await getTrackedStocks.execute({ include_trajectory: false }));
    expect(result.items[0].phaseTrajectory).toHaveLength(7);
  });

  it("include_trajectory: true이면 전체 이력 반환", async () => {
    const trajectory = Array.from({ length: 20 }, (_, i) => ({
      date: `2026-01-${String(i + 1).padStart(2, "0")}`,
      phase: 2,
      rsScore: 70 + i,
    }));
    mockFindAll.mockResolvedValue([makeActiveRow({ phase_trajectory: trajectory })]);

    const result = JSON.parse(await getTrackedStocks.execute({ include_trajectory: true }));
    expect(result.items[0].phaseTrajectory).toHaveLength(20);
  });

  it("phase_trajectory가 null이면 빈 배열로 처리", async () => {
    mockFindAll.mockResolvedValue([makeActiveRow({ phase_trajectory: null })]);
    const result = JSON.parse(await getTrackedStocks.execute({}));
    expect(result.items[0].phaseTrajectory).toEqual([]);
  });
});

// ─── 듀레이션 수익률 테스트 ───────────────────────────────────────────────────

describe("getTrackedStocks.execute — 듀레이션 수익률", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("return_7d가 있으면 아이템에 포함된다", async () => {
    mockFindAll.mockResolvedValue([makeActiveRow({ return_7d: "3.5" })]);
    const result = JSON.parse(await getTrackedStocks.execute({}));
    expect(result.items[0].return7d).toBeCloseTo(3.5);
  });

  it("return_30d가 null이면 아이템에서 null 반환", async () => {
    mockFindAll.mockResolvedValue([makeActiveRow({ return_30d: null })]);
    const result = JSON.parse(await getTrackedStocks.execute({}));
    expect(result.items[0].return30d).toBeNull();
  });

  it("return_90d가 null이면 아이템에서 null 반환", async () => {
    mockFindAll.mockResolvedValue([makeActiveRow({ return_90d: null })]);
    const result = JSON.parse(await getTrackedStocks.execute({}));
    expect(result.items[0].return90d).toBeNull();
  });
});

// ─── thesis 연결 테스트 ───────────────────────────────────────────────────────

describe("getTrackedStocks.execute — thesis 연결", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("thesis_id가 있으면 hasThesisBasis: true", async () => {
    mockFindAll.mockResolvedValue([makeActiveRow({ entry_thesis_id: 42 })]);
    const result = JSON.parse(await getTrackedStocks.execute({}));
    expect(result.items[0].hasThesisBasis).toBe(true);
    expect(result.items[0].entryThesisId).toBe(42);
  });

  it("thesis_id가 null이면 hasThesisBasis: false", async () => {
    mockFindAll.mockResolvedValue([makeActiveRow({ entry_thesis_id: null })]);
    const result = JSON.parse(await getTrackedStocks.execute({}));
    expect(result.items[0].hasThesisBasis).toBe(false);
    expect(result.items[0].entryThesisId).toBeNull();
  });
});

// ─── source/tier 필터 테스트 ──────────────────────────────────────────────────

describe("getTrackedStocks.execute — source/tier 필터", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindBySource.mockResolvedValue([makeActiveRow({ source: "etl_auto" })]);
    mockFindByTier.mockResolvedValue([makeActiveRow({ tier: "featured" })]);
    mockFindAll.mockResolvedValue([makeActiveRow()]);
  });

  it("source 필터 지정 시 findActiveTrackedStocksBySource 호출", async () => {
    const result = JSON.parse(
      await getTrackedStocks.execute({ source: "etl_auto" }),
    );
    expect(mockFindBySource).toHaveBeenCalledWith("etl_auto");
    expect(mockFindAll).not.toHaveBeenCalled();
    expect(result.items[0].source).toBe("etl_auto");
  });

  it("tier 필터 지정 시 findActiveTrackedStocksByTier 호출", async () => {
    const result = JSON.parse(
      await getTrackedStocks.execute({ tier: "featured" }),
    );
    expect(mockFindByTier).toHaveBeenCalledWith("featured");
    expect(mockFindAll).not.toHaveBeenCalled();
    expect(result.items[0].tier).toBe("featured");
  });

  it("필터 미지정 시 findActiveTrackedStocks 호출", async () => {
    await getTrackedStocks.execute({});
    expect(mockFindAll).toHaveBeenCalled();
    expect(mockFindBySource).not.toHaveBeenCalled();
    expect(mockFindByTier).not.toHaveBeenCalled();
  });

  it("유효하지 않은 source 값이면 필터 무시하고 전체 조회", async () => {
    await getTrackedStocks.execute({ source: "invalid_source" });
    expect(mockFindAll).toHaveBeenCalled();
    expect(mockFindBySource).not.toHaveBeenCalled();
  });
});

// ─── avgPnlPercent 계산 테스트 ────────────────────────────────────────────────

describe("getTrackedStocks.execute — avgPnlPercent 계산", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("avgPnlPercent가 summary에 포함됨", async () => {
    mockFindAll.mockResolvedValue([
      makeActiveRow({ pnl_percent: "10" }),
      makeActiveRow({ symbol: "NVDA", id: 2, pnl_percent: "20" }),
    ]);
    const result = JSON.parse(await getTrackedStocks.execute({}));
    expect(result.summary.avgPnlPercent).toBeCloseTo(15, 1);
  });

  it("pnl_percent가 null인 종목은 avgPnlPercent 계산에서 제외", async () => {
    mockFindAll.mockResolvedValue([
      makeActiveRow({ pnl_percent: "10" }),
      makeActiveRow({ symbol: "NVDA", id: 2, pnl_percent: null }),
    ]);
    const result = JSON.parse(await getTrackedStocks.execute({}));
    expect(result.summary.avgPnlPercent).toBeCloseTo(10, 1);
  });
});

// ─── detectionLag 테스트 ─────────────────────────────────────────────────────

describe("getTrackedStocks.execute — detectionLag", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("phase2_since가 있으면 entry_date와의 차이를 일수로 반환", async () => {
    mockFindAll.mockResolvedValue([
      makeActiveRow({ entry_date: "2026-01-10", phase2_since: "2026-01-07" }),
    ]);
    const result = JSON.parse(await getTrackedStocks.execute({}));
    expect(result.items[0].detectionLag).toBe(3);
  });

  it("phase2_since가 null이면 detectionLag도 null", async () => {
    mockFindAll.mockResolvedValue([
      makeActiveRow({ phase2_since: null }),
    ]);
    const result = JSON.parse(await getTrackedStocks.execute({}));
    expect(result.items[0].detectionLag).toBeNull();
  });

  it("phase2_since가 entry_date와 같으면 0", async () => {
    mockFindAll.mockResolvedValue([
      makeActiveRow({ entry_date: "2026-01-10", phase2_since: "2026-01-10" }),
    ]);
    const result = JSON.parse(await getTrackedStocks.execute({}));
    expect(result.items[0].detectionLag).toBe(0);
  });
});

// ─── recentPhase2Streak 테스트 ──────────────────────────────────────────────

describe("getTrackedStocks.execute — recentPhase2Streak", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("최근 14일 전부 Phase 2면 streak=14", async () => {
    const trajectory = Array.from({ length: 14 }, (_, i) => ({
      date: `2026-01-${String(i + 1).padStart(2, "0")}`,
      phase: 2,
      rsScore: 70,
    }));
    mockFindAll.mockResolvedValue([makeActiveRow({ phase_trajectory: trajectory })]);
    const result = JSON.parse(await getTrackedStocks.execute({}));
    expect(result.items[0].recentPhase2Streak).toBe(14);
  });

  it("마지막이 Phase 3이면 streak=0", async () => {
    const trajectory = [
      { date: "2026-01-01", phase: 2, rsScore: 70 },
      { date: "2026-01-02", phase: 2, rsScore: 71 },
      { date: "2026-01-03", phase: 3, rsScore: 72 },
    ];
    mockFindAll.mockResolvedValue([makeActiveRow({ phase_trajectory: trajectory })]);
    const result = JSON.parse(await getTrackedStocks.execute({}));
    expect(result.items[0].recentPhase2Streak).toBe(0);
  });

  it("중간에 Phase 3이 있으면 끊긴 이후만 카운트", async () => {
    const trajectory = [
      { date: "2026-01-01", phase: 2, rsScore: 70 },
      { date: "2026-01-02", phase: 3, rsScore: 71 },
      { date: "2026-01-03", phase: 2, rsScore: 72 },
      { date: "2026-01-04", phase: 2, rsScore: 73 },
    ];
    mockFindAll.mockResolvedValue([makeActiveRow({ phase_trajectory: trajectory })]);
    const result = JSON.parse(await getTrackedStocks.execute({}));
    expect(result.items[0].recentPhase2Streak).toBe(2);
  });

  it("trajectory가 비어있으면 streak=0", async () => {
    mockFindAll.mockResolvedValue([makeActiveRow({ phase_trajectory: [] })]);
    const result = JSON.parse(await getTrackedStocks.execute({}));
    expect(result.items[0].recentPhase2Streak).toBe(0);
  });

  it("trajectory가 null이면 streak=0", async () => {
    mockFindAll.mockResolvedValue([makeActiveRow({ phase_trajectory: null })]);
    const result = JSON.parse(await getTrackedStocks.execute({}));
    expect(result.items[0].recentPhase2Streak).toBe(0);
  });
});

// ─── tool definition 테스트 ───────────────────────────────────────────────────

describe("getTrackedStocks.definition", () => {
  it("도구 이름이 get_tracked_stocks이다", () => {
    expect(getTrackedStocks.definition.name).toBe("get_tracked_stocks");
  });

  it("source enum이 올바른 값을 포함한다", () => {
    const schema = getTrackedStocks.definition.input_schema as Record<string, unknown>;
    const properties = schema.properties as Record<string, Record<string, unknown>>;
    const sourceEnum = properties.source.enum as string[];
    expect(sourceEnum).toContain("etl_auto");
    expect(sourceEnum).toContain("agent");
    expect(sourceEnum).toContain("thesis_aligned");
  });

  it("tier enum이 올바른 값을 포함한다", () => {
    const schema = getTrackedStocks.definition.input_schema as Record<string, unknown>;
    const properties = schema.properties as Record<string, Record<string, unknown>>;
    const tierEnum = properties.tier.enum as string[];
    expect(tierEnum).toContain("standard");
    expect(tierEnum).toContain("featured");
  });
});
