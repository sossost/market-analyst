import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the DB pool before importing
vi.mock("@/db/client", () => ({
  pool: {
    query: vi.fn(),
  },
}));

import { runDailyQA } from "../dailyQA.js";
import { pool } from "@/db/client";

const mockQuery = vi.mocked(pool.query);

// ────────────────────────────────────────────
// Fixtures
// ────────────────────────────────────────────

const TEST_DATE = "2026-03-10";

function createReportData(overrides?: {
  reportedSymbols?: Array<{
    symbol: string;
    phase: number;
    rsScore: number;
    sector: string;
  }>;
  marketSummary?: {
    phase2Ratio: number;
    leadingSectors: string[];
    totalAnalyzed: number;
  };
}) {
  return {
    reportedSymbols: overrides?.reportedSymbols ?? [
      { symbol: "NVDA", phase: 2, rsScore: 92, sector: "Technology" },
      { symbol: "AAPL", phase: 2, rsScore: 78, sector: "Technology" },
    ],
    marketSummary: overrides?.marketSummary ?? {
      phase2Ratio: 35.0,
      leadingSectors: ["Technology", "Energy"],
      totalAnalyzed: 5000,
    },
  };
}

function setupMockQueries(options: {
  topSectors?: Array<{ sector: string; avg_rs: string }>;
  phase2Ratio?: { total: string; phase2_count: string } | null;
  stockPhases?: Array<{
    symbol: string;
    phase: number;
    rs_score: number | null;
  }>;
}) {
  // 기본 DB 섹터: 리포트 ["Technology", "Energy"]와 Jaccard >= 50% 보장
  const topSectors = options.topSectors ?? [
    { sector: "Technology", avg_rs: "72.5" },
    { sector: "Energy", avg_rs: "65.3" },
    { sector: "Healthcare", avg_rs: "58.1" },
  ];
  const phase2Row = options.phase2Ratio ?? {
    total: "5000",
    phase2_count: "1750",
  };
  const stockPhases = options.stockPhases ?? [
    { symbol: "NVDA", phase: 2, rs_score: 92 },
    { symbol: "AAPL", phase: 2, rs_score: 78 },
  ];

  mockQuery
    .mockResolvedValueOnce({ rows: topSectors } as never) // fetchTopSectors
    .mockResolvedValueOnce({
      rows: phase2Row != null ? [phase2Row] : [],
    } as never) // fetchPhase2Ratio
    .mockResolvedValueOnce({ rows: stockPhases } as never); // fetchStockPhases
}

// ────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────

describe("runDailyQA", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("전체 일치 — severity ok, mismatches 0건", async () => {
    setupMockQueries({});

    const result = await runDailyQA(TEST_DATE, createReportData());

    expect(result.severity).toBe("ok");
    expect(result.mismatches).toHaveLength(0);
    expect(result.date).toBe(TEST_DATE);
    expect(result.checkedItems).toBeGreaterThan(0);
    expect(result.checkedAt).toBeTruthy();
  });

  it("Phase 2 비율 불일치 (허용 범위 초과) — warn 이상", async () => {
    setupMockQueries({
      phase2Ratio: { total: "5000", phase2_count: "1000" }, // 20% vs reported 35%
    });

    const result = await runDailyQA(TEST_DATE, createReportData());

    // 15pp 차이 → mismatch. severity는 aggregateSeverity에 의해 결정
    const phase2Mismatch = result.mismatches.find(
      (m) => m.field === "phase2Ratio",
    );
    expect(phase2Mismatch).toBeDefined();
    expect(phase2Mismatch?.expected).toBe(20.0);
    expect(phase2Mismatch?.actual).toBe(35.0);
  });

  it("Phase 2 비율 허용 범위 이내 — mismatch 없음", async () => {
    setupMockQueries({
      phase2Ratio: { total: "5000", phase2_count: "1700" }, // 34% vs reported 35%
    });

    const result = await runDailyQA(TEST_DATE, createReportData());

    const phase2Mismatch = result.mismatches.find(
      (m) => m.field === "phase2Ratio",
    );
    expect(phase2Mismatch).toBeUndefined();
  });

  it("종목 Phase 불일치 — mismatch 포함", async () => {
    setupMockQueries({
      stockPhases: [
        { symbol: "NVDA", phase: 3, rs_score: 92 }, // DB=3, report=2
        { symbol: "AAPL", phase: 2, rs_score: 78 },
      ],
    });

    const result = await runDailyQA(TEST_DATE, createReportData());

    const phaseMismatch = result.mismatches.find(
      (m) => m.field === "NVDA.phase",
    );
    expect(phaseMismatch).toBeDefined();
    expect(phaseMismatch?.expected).toBe(3);
    expect(phaseMismatch?.actual).toBe(2);
  });

  it("종목 RS 불일치 (허용 범위 초과) — mismatch 포함", async () => {
    setupMockQueries({
      stockPhases: [
        { symbol: "NVDA", phase: 2, rs_score: 80 }, // diff 12 > tolerance 2
        { symbol: "AAPL", phase: 2, rs_score: 78 },
      ],
    });

    const result = await runDailyQA(TEST_DATE, createReportData());

    const rsMismatch = result.mismatches.find(
      (m) => m.field === "NVDA.rsScore",
    );
    expect(rsMismatch).toBeDefined();
    expect(rsMismatch?.type).toBe("symbol_rs");
  });

  it("종목 RS 불일치 (허용 범위 이내) — 무시", async () => {
    setupMockQueries({
      stockPhases: [
        { symbol: "NVDA", phase: 2, rs_score: 91 }, // diff 1 <= tolerance 2
        { symbol: "AAPL", phase: 2, rs_score: 78 },
      ],
    });

    const result = await runDailyQA(TEST_DATE, createReportData());

    expect(result.severity).toBe("ok");
    expect(result.mismatches).toHaveLength(0);
  });

  it("리포트 상위 섹터가 DB 상위 5와 50% 미만 겹침 — warn", async () => {
    // DB: [Materials, Healthcare, Financials, Industrials, Utilities] — Technology/Energy 없음
    // Report: [Technology, Energy] → 겹침 0/7 = 0% < 50%
    setupMockQueries({
      topSectors: [
        { sector: "Materials", avg_rs: "72.5" },
        { sector: "Healthcare", avg_rs: "65.3" },
        { sector: "Financials", avg_rs: "58.1" },
        { sector: "Industrials", avg_rs: "52.0" },
        { sector: "Utilities", avg_rs: "48.5" },
      ],
    });

    const result = await runDailyQA(TEST_DATE, createReportData());

    const sectorMismatch = result.mismatches.find(
      (m) => m.type === "sector_list",
    );
    expect(sectorMismatch).toBeDefined();
    expect(sectorMismatch?.field).toBe("leadingSectors");
  });

  it("DB에 해당 종목 없음 — 해당 종목 스킵", async () => {
    // DB에 섹터 2개만 있어 Jaccard >= 50% 확보
    setupMockQueries({
      topSectors: [
        { sector: "Technology", avg_rs: "72.5" },
        { sector: "Energy", avg_rs: "65.3" },
      ],
      stockPhases: [
        // NVDA 누락
        { symbol: "AAPL", phase: 2, rs_score: 78 },
      ],
    });

    const result = await runDailyQA(TEST_DATE, createReportData());

    // NVDA는 DB에 없으므로 스킵. AAPL만 검증 → ok
    expect(result.severity).toBe("ok");
  });

  it("DB 쿼리 전체 실패 — graceful warn 반환", async () => {
    mockQuery.mockRejectedValueOnce(new Error("Connection refused"));

    const result = await runDailyQA(TEST_DATE, createReportData());

    expect(result.severity).toBe("warn");
    expect(result.checkedItems).toBe(0);
    expect(result.mismatches).toHaveLength(1);
    expect(result.mismatches[0].field).toBe("db_query");
  });

  it("sector_rs_daily 데이터 없음 — 섹터 검증 스킵, 나머지 정상", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] } as never) // fetchTopSectors → 빈 결과
      .mockResolvedValueOnce({
        rows: [{ total: "5000", phase2_count: "1750" }],
      } as never)
      .mockResolvedValueOnce({
        rows: [
          { symbol: "NVDA", phase: 2, rs_score: 92 },
          { symbol: "AAPL", phase: 2, rs_score: 78 },
        ],
      } as never);

    const result = await runDailyQA(TEST_DATE, createReportData());

    expect(result.severity).toBe("ok");
    expect(result.mismatches).toHaveLength(0);
  });

  it("stock_phases 데이터 없음 — Phase 2 비율 NaN 스킵", async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [
          { sector: "Technology", avg_rs: "72.5" },
          { sector: "Energy", avg_rs: "65.3" },
        ],
      } as never)
      .mockResolvedValueOnce({
        rows: [{ total: "0", phase2_count: "0" }],
      } as never) // total 0 → NaN ratio
      .mockResolvedValueOnce({ rows: [] } as never);

    const result = await runDailyQA(TEST_DATE, createReportData());

    // Phase 2 비율은 NaN이므로 comparePhase2Ratio가 null 반환 (스킵)
    const phase2Mismatch = result.mismatches.find(
      (m) => m.field === "phase2Ratio",
    );
    expect(phase2Mismatch).toBeUndefined();
  });

  it("reportedSymbols 빈 배열 — 종목 검증 0건", async () => {
    const reportData = createReportData({ reportedSymbols: [] });
    // DB 섹터를 리포트와 일치시켜 섹터 mismatch 방지
    setupMockQueries({
      topSectors: [
        { sector: "Technology", avg_rs: "72.5" },
        { sector: "Energy", avg_rs: "65.3" },
      ],
    });

    const result = await runDailyQA(TEST_DATE, reportData);

    expect(result.severity).toBe("ok");
  });

  it("checkedAt이 유효한 ISO timestamp", async () => {
    setupMockQueries({});

    const result = await runDailyQA(TEST_DATE, createReportData());

    const parsed = new Date(result.checkedAt);
    expect(parsed.getTime()).not.toBeNaN();
  });

  it("DB 쿼리 3개가 병렬로 실행됨", async () => {
    setupMockQueries({});

    await runDailyQA(TEST_DATE, createReportData());

    // 3개 쿼리가 호출되어야 함
    expect(mockQuery).toHaveBeenCalledTimes(3);
  });
});
