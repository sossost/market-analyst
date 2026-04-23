/**
 * analyzeTrackedFactors.test.ts — 팩터별 성과 슬라이싱 분석 도구 테스트
 *
 * 외부 의존성(pool)은 모두 mock 처리.
 * SEPA, RS, 섹터, 업종, Phase전이, detection_lag 슬라이싱 + 교차 분석 커버.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// --- 모듈 mock 설정 ---

vi.mock("@/db/client", () => ({
  pool: {
    query: vi.fn(),
  },
}));

vi.mock("@/etl/utils/retry", () => ({
  retryDatabaseOperation: vi.fn((fn: () => unknown) => fn()),
}));

// --- import (mock 이후) ---

import { analyzeTrackedFactors } from "../analyzeTrackedFactors";
import { pool } from "@/db/client";

const mockPool = pool as unknown as { query: ReturnType<typeof vi.fn> };

// ─── 헬퍼 ─────────────────────────────────────────────────────────────────────

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    symbol: "AAPL",
    source: "etl_auto",
    status: "EXITED",
    entry_date: "2026-01-01",
    entry_sepa_grade: "A",
    entry_rs_score: 75,
    entry_sector: "Technology",
    entry_industry: "Semiconductors",
    entry_phase: 2,
    entry_prev_phase: 1,
    phase2_since: "2025-12-30",
    pnl_percent: "10.0",
    max_pnl_percent: "15.0",
    days_tracked: 30,
    ...overrides,
  };
}

// ─── tool definition ─────────────────────────────────────────────────────────

describe("analyzeTrackedFactors — definition", () => {
  it("도구 이름이 analyze_tracked_factors이다", () => {
    expect(analyzeTrackedFactors.definition.name).toBe(
      "analyze_tracked_factors",
    );
  });

  it("source enum에 all, etl_auto, agent, thesis_aligned이 포함된다", () => {
    const schema = analyzeTrackedFactors.definition.input_schema as Record<
      string,
      unknown
    >;
    const properties = schema.properties as Record<
      string,
      Record<string, unknown>
    >;
    const sourceEnum = properties.source.enum as string[];
    expect(sourceEnum).toContain("all");
    expect(sourceEnum).toContain("etl_auto");
    expect(sourceEnum).toContain("agent");
    expect(sourceEnum).toContain("thesis_aligned");
  });
});

// ─── 빈 데이터 ───────────────────────────────────────────────────────────────

describe("analyzeTrackedFactors — 빈 데이터", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("데이터가 없으면 경고와 totalCount: 0 반환", async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const result = JSON.parse(
      await analyzeTrackedFactors.execute({}),
    );

    expect(result.warning).toBeDefined();
    expect(result.totalCount).toBe(0);
  });
});

// ─── meta 정보 ───────────────────────────────────────────────────────────────

describe("analyzeTrackedFactors — meta", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("meta에 totalCount, activeCount, closedCount가 포함된다", async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [
        makeRow({ status: "ACTIVE" }),
        makeRow({ symbol: "NVDA", status: "EXITED" }),
        makeRow({ symbol: "MSFT", status: "EXPIRED" }),
      ],
    });

    const result = JSON.parse(
      await analyzeTrackedFactors.execute({}),
    );

    expect(result.meta.totalCount).toBe(3);
    expect(result.meta.activeCount).toBe(1);
    expect(result.meta.closedCount).toBe(2);
  });

  it("NULL 비율이 계산된다", async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [
        makeRow({ entry_sepa_grade: null, entry_rs_score: null }),
        makeRow({ symbol: "NVDA" }),
      ],
    });

    const result = JSON.parse(
      await analyzeTrackedFactors.execute({}),
    );

    expect(result.meta.nullRates.sepaGrade).toBe(50);
    expect(result.meta.nullRates.rsScore).toBe(50);
  });

  it("종료 건수 < 30이면 dataWarning 반환", async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [makeRow()],
    });

    const result = JSON.parse(
      await analyzeTrackedFactors.execute({}),
    );

    expect(result.meta.dataWarning).toContain("30");
  });
});

// ─── SEPA등급 슬라이싱 ──────────────────────────────────────────────────────

describe("analyzeTrackedFactors — bySepaGrade", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("SEPA등급별로 슬라이싱된다", async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [
        makeRow({ entry_sepa_grade: "S", pnl_percent: "20.0" }),
        makeRow({ symbol: "NVDA", entry_sepa_grade: "S", pnl_percent: "15.0" }),
        makeRow({ symbol: "MSFT", entry_sepa_grade: "F", pnl_percent: "-5.0" }),
      ],
    });

    const result = JSON.parse(
      await analyzeTrackedFactors.execute({}),
    );

    expect(result.bySepaGrade.S).toBeDefined();
    expect(result.bySepaGrade.S.count).toBe(2);
    expect(result.bySepaGrade.S.winRate).toBe(100);
    expect(result.bySepaGrade.F).toBeDefined();
    expect(result.bySepaGrade.F.count).toBe(1);
    expect(result.bySepaGrade.F.winRate).toBe(0);
  });

  it("entry_sepa_grade가 null이면 UNKNOWN으로 분류된다", async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [makeRow({ entry_sepa_grade: null })],
    });

    const result = JSON.parse(
      await analyzeTrackedFactors.execute({}),
    );

    expect(result.bySepaGrade.UNKNOWN).toBeDefined();
    expect(result.bySepaGrade.UNKNOWN.count).toBe(1);
  });
});

// ─── RS구간 슬라이싱 ─────────────────────────────────────────────────────────

describe("analyzeTrackedFactors — byRsBucket", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("RS 구간별로 슬라이싱된다", async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [
        makeRow({ entry_rs_score: 30 }),
        makeRow({ symbol: "NVDA", entry_rs_score: 55 }),
        makeRow({ symbol: "MSFT", entry_rs_score: 80 }),
        makeRow({ symbol: "TSLA", entry_rs_score: 95 }),
      ],
    });

    const result = JSON.parse(
      await analyzeTrackedFactors.execute({}),
    );

    expect(result.byRsBucket["<50"]).toBeDefined();
    expect(result.byRsBucket["<50"].count).toBe(1);
    expect(result.byRsBucket["50-69"]).toBeDefined();
    expect(result.byRsBucket["50-69"].count).toBe(1);
    expect(result.byRsBucket["70-89"]).toBeDefined();
    expect(result.byRsBucket["70-89"].count).toBe(1);
    expect(result.byRsBucket["90+"]).toBeDefined();
    expect(result.byRsBucket["90+"].count).toBe(1);
  });

  it("entry_rs_score가 null이면 UNKNOWN으로 분류된다", async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [makeRow({ entry_rs_score: null })],
    });

    const result = JSON.parse(
      await analyzeTrackedFactors.execute({}),
    );

    expect(result.byRsBucket.UNKNOWN).toBeDefined();
  });
});

// ─── 섹터 슬라이싱 ───────────────────────────────────────────────────────────

describe("analyzeTrackedFactors — bySector", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("섹터별로 슬라이싱된다", async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [
        makeRow({ entry_sector: "Technology" }),
        makeRow({ symbol: "XOM", entry_sector: "Energy" }),
      ],
    });

    const result = JSON.parse(
      await analyzeTrackedFactors.execute({}),
    );

    expect(result.bySector.Technology).toBeDefined();
    expect(result.bySector.Energy).toBeDefined();
  });
});

// ─── 업종 슬라이싱 ───────────────────────────────────────────────────────────

describe("analyzeTrackedFactors — byIndustry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("3건 미만 업종은 제외된다", async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [
        makeRow({ entry_industry: "Semiconductors" }),
        makeRow({ symbol: "NVDA", entry_industry: "Semiconductors" }),
        makeRow({ symbol: "AVGO", entry_industry: "Semiconductors" }),
        makeRow({ symbol: "TSLA", entry_industry: "Auto Manufacturers" }),
      ],
    });

    const result = JSON.parse(
      await analyzeTrackedFactors.execute({}),
    );

    expect(result.byIndustry.Semiconductors).toBeDefined();
    expect(result.byIndustry.Semiconductors.count).toBe(3);
    // Auto Manufacturers has only 1 entry, filtered out
    expect(result.byIndustry["Auto Manufacturers"]).toBeUndefined();
  });
});

// ─── Phase전이 슬라이싱 ──────────────────────────────────────────────────────

describe("analyzeTrackedFactors — byPhaseTransition", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("Phase 전이 조합별로 슬라이싱된다", async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [
        makeRow({ entry_prev_phase: 1, entry_phase: 2 }),
        makeRow({ symbol: "NVDA", entry_prev_phase: 2, entry_phase: 2 }),
        makeRow({ symbol: "MSFT", entry_prev_phase: 3, entry_phase: 2 }),
      ],
    });

    const result = JSON.parse(
      await analyzeTrackedFactors.execute({}),
    );

    expect(result.byPhaseTransition["1→2"]).toBeDefined();
    expect(result.byPhaseTransition["2→2"]).toBeDefined();
    expect(result.byPhaseTransition["3→2"]).toBeDefined();
  });

  it("entry_prev_phase가 null이면 ?→N으로 표시된다", async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [makeRow({ entry_prev_phase: null, entry_phase: 2 })],
    });

    const result = JSON.parse(
      await analyzeTrackedFactors.execute({}),
    );

    expect(result.byPhaseTransition["?→2"]).toBeDefined();
  });
});

// ─── Detection Lag 슬라이싱 ──────────────────────────────────────────────────

describe("analyzeTrackedFactors — byDetectionLag", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("detection_lag 구간별로 슬라이싱된다", async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [
        makeRow({ entry_date: "2026-01-03", phase2_since: "2026-01-01" }), // lag=2 → early
        makeRow({ symbol: "NVDA", entry_date: "2026-01-06", phase2_since: "2026-01-01" }), // lag=5 → normal
        makeRow({ symbol: "MSFT", entry_date: "2026-01-15", phase2_since: "2026-01-01" }), // lag=14 → late
      ],
    });

    const result = JSON.parse(
      await analyzeTrackedFactors.execute({}),
    );

    expect(result.byDetectionLag.early).toBeDefined();
    expect(result.byDetectionLag.early.count).toBe(1);
    expect(result.byDetectionLag.normal).toBeDefined();
    expect(result.byDetectionLag.normal.count).toBe(1);
    expect(result.byDetectionLag.late).toBeDefined();
    expect(result.byDetectionLag.late.count).toBe(1);
  });

  it("phase2_since가 null이면 UNKNOWN으로 분류된다", async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [makeRow({ phase2_since: null })],
    });

    const result = JSON.parse(
      await analyzeTrackedFactors.execute({}),
    );

    expect(result.byDetectionLag.UNKNOWN).toBeDefined();
  });
});

// ─── 교차 분석 ───────────────────────────────────────────────────────────────

describe("analyzeTrackedFactors — cross analysis", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("SEPA × RS 교차 분석이 반환된다", async () => {
    const rows = Array.from({ length: 6 }, (_, i) =>
      makeRow({
        symbol: `SYM${i}`,
        entry_sepa_grade: "S",
        entry_rs_score: 92,
        pnl_percent: `${10 + i}.0`,
      }),
    );
    mockPool.query.mockResolvedValueOnce({ rows });

    const result = JSON.parse(
      await analyzeTrackedFactors.execute({}),
    );

    expect(result.cross.sepaXrs).toBeDefined();
    const key = "S × 90+";
    expect(result.cross.sepaXrs[key]).toBeDefined();
    expect(result.cross.sepaXrs[key].count).toBe(6);
  });

  it("셀 건수 5건 미만이면 insufficient_data 표시", async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [
        makeRow({ entry_sepa_grade: "S", entry_rs_score: 92 }),
        makeRow({ symbol: "NVDA", entry_sepa_grade: "S", entry_rs_score: 92 }),
      ],
    });

    const result = JSON.parse(
      await analyzeTrackedFactors.execute({}),
    );

    const key = "S × 90+";
    expect(result.cross.sepaXrs[key].insufficient_data).toBe(true);
    expect(result.cross.sepaXrs[key].count).toBe(2);
  });

  it("SEPA × 섹터 교차 분석이 반환된다", async () => {
    const rows = Array.from({ length: 5 }, (_, i) =>
      makeRow({
        symbol: `SYM${i}`,
        entry_sepa_grade: "A",
        entry_sector: "Technology",
        pnl_percent: `${5 + i}.0`,
      }),
    );
    mockPool.query.mockResolvedValueOnce({ rows });

    const result = JSON.parse(
      await analyzeTrackedFactors.execute({}),
    );

    expect(result.cross.sepaXsector).toBeDefined();
    const key = "A × Technology";
    expect(result.cross.sepaXsector[key]).toBeDefined();
    expect(result.cross.sepaXsector[key].count).toBe(5);
  });
});

// ─── 통계 계산 ───────────────────────────────────────────────────────────────

describe("analyzeTrackedFactors — 통계 계산", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("avgPnl, maxPnl, winRate가 올바르게 계산된다", async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [
        makeRow({ entry_sepa_grade: "S", pnl_percent: "10.0", max_pnl_percent: "20.0" }),
        makeRow({ symbol: "NVDA", entry_sepa_grade: "S", pnl_percent: "-5.0", max_pnl_percent: "5.0" }),
      ],
    });

    const result = JSON.parse(
      await analyzeTrackedFactors.execute({}),
    );

    const stats = result.bySepaGrade.S;
    expect(stats.avgPnl).toBe(2.5); // (10 + -5) / 2
    expect(stats.maxPnl).toBe(20); // max of 20, 5
    expect(stats.winRate).toBe(50); // 1/2
  });

  it("ACTIVE 종목은 winRate/avgPnl 계산에서 제외된다", async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [
        makeRow({ status: "ACTIVE", entry_sepa_grade: "A", pnl_percent: "50.0" }),
        makeRow({ symbol: "NVDA", status: "EXITED", entry_sepa_grade: "A", pnl_percent: "-5.0" }),
      ],
    });

    const result = JSON.parse(
      await analyzeTrackedFactors.execute({}),
    );

    const stats = result.bySepaGrade.A;
    expect(stats.count).toBe(2);
    expect(stats.activeCount).toBe(1);
    expect(stats.closedCount).toBe(1);
    // 성과 통계는 closed만 기준
    expect(stats.avgPnl).toBe(-5);
    expect(stats.winRate).toBe(0);
  });

  it("closed 종목이 없으면 성과 통계가 null이다", async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [
        makeRow({ status: "ACTIVE", entry_sepa_grade: "B" }),
      ],
    });

    const result = JSON.parse(
      await analyzeTrackedFactors.execute({}),
    );

    const stats = result.bySepaGrade.B;
    expect(stats.avgPnl).toBeNull();
    expect(stats.maxPnl).toBeNull();
    expect(stats.winRate).toBeNull();
  });
});

// ─── 필터 ────────────────────────────────────────────────────────────────────

describe("analyzeTrackedFactors — 필터", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("source 필터가 SQL WHERE에 반영된다", async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [makeRow()] });

    await analyzeTrackedFactors.execute({ source: "etl_auto" });

    const sql = mockPool.query.mock.calls[0][0] as string;
    expect(sql).toContain("source = $1");
    expect(mockPool.query.mock.calls[0][1]).toEqual(["etl_auto"]);
  });

  it("status ACTIVE 필터가 SQL WHERE에 반영된다", async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    await analyzeTrackedFactors.execute({ status: "ACTIVE" });

    const sql = mockPool.query.mock.calls[0][0] as string;
    expect(sql).toContain("status = 'ACTIVE'");
  });

  it("status CLOSED 필터가 SQL WHERE에 반영된다", async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    await analyzeTrackedFactors.execute({ status: "CLOSED" });

    const sql = mockPool.query.mock.calls[0][0] as string;
    expect(sql).toContain("status <> 'ACTIVE'");
  });

  it("source=all이면 소스 필터 없이 전체 조회", async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    await analyzeTrackedFactors.execute({ source: "all" });

    const sql = mockPool.query.mock.calls[0][0] as string;
    expect(sql).not.toContain("source =");
  });
});

// ─── 업종 필터 최소 건수 경계값 ──────────────────────────────────────────────

describe("analyzeTrackedFactors — 업종 경계값", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("정확히 3건인 업종은 포함된다", async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [
        makeRow({ entry_industry: "Banks" }),
        makeRow({ symbol: "B", entry_industry: "Banks" }),
        makeRow({ symbol: "C", entry_industry: "Banks" }),
      ],
    });

    const result = JSON.parse(
      await analyzeTrackedFactors.execute({}),
    );

    expect(result.byIndustry.Banks).toBeDefined();
    expect(result.byIndustry.Banks.count).toBe(3);
  });

  it("2건인 업종은 제외된다", async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [
        makeRow({ entry_industry: "Rare" }),
        makeRow({ symbol: "B", entry_industry: "Rare" }),
        // 3건 이상 업종도 있어야 전체 결과가 나옴
        makeRow({ symbol: "C", entry_industry: "Common" }),
        makeRow({ symbol: "D", entry_industry: "Common" }),
        makeRow({ symbol: "E", entry_industry: "Common" }),
      ],
    });

    const result = JSON.parse(
      await analyzeTrackedFactors.execute({}),
    );

    expect(result.byIndustry.Rare).toBeUndefined();
    expect(result.byIndustry.Common).toBeDefined();
  });
});
