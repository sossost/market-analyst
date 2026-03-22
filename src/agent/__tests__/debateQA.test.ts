import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the DB pool before importing
vi.mock("@/db/client", () => ({
  pool: {
    query: vi.fn(),
  },
}));

import {
  runDebateQA,
  detectBullBias,
  checkSectorAccuracy,
  checkTickerAccuracy,
} from "../debateQA.js";
import { pool } from "@/db/client";
import type { Thesis } from "@/types/debate";

const mockQuery = vi.mocked(pool.query);

// ────────────────────────────────────────────
// Fixtures
// ────────────────────────────────────────────

const TEST_DATE = "2026-03-20";

function makeThesis(overrides?: Partial<Thesis>): Thesis {
  return {
    agentPersona: "tech",
    thesis: "AI 반도체 수요 확대로 상승 모멘텀 지속",
    timeframeDays: 60,
    verificationMetric: "NVDA 주가",
    targetCondition: "NVDA $150 돌파",
    confidence: "high",
    consensusLevel: "3/4",
    category: "structural_narrative",
    beneficiarySectors: ["Technology"],
    beneficiaryTickers: ["NVDA"],
    minorityView: null,
    ...overrides,
  };
}

function makeBearishThesis(): Thesis {
  return makeThesis({
    agentPersona: "macro",
    thesis: "금리 인상 리스크로 성장주 조정 가능성",
    beneficiarySectors: [],
    beneficiaryTickers: [],
    minorityView: null,
  });
}

function setupMockQueries(options?: {
  sectorRows?: Array<{ sector: string; group_phase: number }>;
  stockRows?: Array<{ symbol: string; phase: number; rs_score: number | null }>;
}) {
  const sectorRows = options?.sectorRows ?? [
    { sector: "Technology", group_phase: 2 },
    { sector: "Energy", group_phase: 1 },
    { sector: "Healthcare", group_phase: 1 },
  ];
  const stockRows = options?.stockRows ?? [
    { symbol: "NVDA", phase: 2, rs_score: 92 },
    { symbol: "AAPL", phase: 2, rs_score: 78 },
  ];

  // 첫 번째 호출: sector_rs_daily
  mockQuery.mockResolvedValueOnce({ rows: sectorRows } as never);
  // 두 번째 호출: stock_phases
  mockQuery.mockResolvedValueOnce({ rows: stockRows } as never);
}

// ────────────────────────────────────────────
// detectBullBias
// ────────────────────────────────────────────

describe("detectBullBias", () => {
  it("thesis 3건 이상 전부 bullish이고 bearish 관점 없으면 경고 반환", () => {
    const theses = [
      makeThesis({ thesis: "AI 수혜 확대 — 반도체 상승 지속" }),
      makeThesis({ thesis: "클라우드 성장 가속 — AWS 수혜" }),
      makeThesis({ thesis: "전력 수요 확대 — 유틸리티 상승 모멘텀" }),
    ];

    const result = detectBullBias(theses);
    expect(result).not.toBeNull();
    expect(result!.field).toBe("bull_bias");
  });

  it("bearish thesis가 하나라도 있으면 null 반환", () => {
    const theses = [
      makeThesis({ thesis: "AI 수혜 확대 — 반도체 상승 지속" }),
      makeThesis({ thesis: "클라우드 성장 가속 — AWS 수혜" }),
      makeBearishThesis(),
    ];

    const result = detectBullBias(theses);
    expect(result).toBeNull();
  });

  it("bearish minorityView가 있으면 null 반환", () => {
    const theses = [
      makeThesis({ thesis: "AI 수혜 확대 — 반도체 상승 지속" }),
      makeThesis({ thesis: "클라우드 성장 가속 — AWS 수혜" }),
      makeThesis({
        thesis: "전력 수요 확대 — 유틸리티 상승 모멘텀",
        minorityView: {
          analyst: "macro",
          position: "bearish",
          reasoning: "금리 리스크",
          wasCorrect: null,
        },
      }),
    ];

    const result = detectBullBias(theses);
    expect(result).toBeNull();
  });

  it("thesis 2건이면 null 반환 (최소 3건 필요)", () => {
    const theses = [
      makeThesis({ thesis: "AI 수혜 확대 — 반도체 상승 지속" }),
      makeThesis({ thesis: "클라우드 성장 가속 — AWS 수혜" }),
    ];

    const result = detectBullBias(theses);
    expect(result).toBeNull();
  });

  it("빈 배열이면 null 반환", () => {
    expect(detectBullBias([])).toBeNull();
  });
});

// ────────────────────────────────────────────
// checkSectorAccuracy
// ────────────────────────────────────────────

describe("checkSectorAccuracy", () => {
  it("thesis 섹터가 DB에 존재하면 mismatch 없음", () => {
    const theses = [makeThesis({ beneficiarySectors: ["Technology"] })];
    const dbSectors = [{ sector: "Technology", group_phase: 2 }];

    const result = checkSectorAccuracy(theses, dbSectors);
    expect(result).toHaveLength(0);
  });

  it("thesis 섹터가 DB에 없으면 warn mismatch", () => {
    const theses = [makeThesis({ beneficiarySectors: ["Quantum Computing"] })];
    const dbSectors = [{ sector: "Technology", group_phase: 2 }];

    const result = checkSectorAccuracy(theses, dbSectors);
    expect(result).toHaveLength(1);
    expect(result[0].field).toContain("Quantum Computing");
    expect(result[0].severity).toBe("warn");
  });

  it("DB 섹터가 비어있으면 스킵", () => {
    const theses = [makeThesis({ beneficiarySectors: ["Technology"] })];
    const result = checkSectorAccuracy(theses, []);
    expect(result).toHaveLength(0);
  });

  it("beneficiarySectors가 null이면 스킵", () => {
    const theses = [makeThesis({ beneficiarySectors: null })];
    const dbSectors = [{ sector: "Technology", group_phase: 2 }];

    const result = checkSectorAccuracy(theses, dbSectors);
    expect(result).toHaveLength(0);
  });
});

// ────────────────────────────────────────────
// checkTickerAccuracy
// ────────────────────────────────────────────

describe("checkTickerAccuracy", () => {
  it("수혜주 ticker가 Phase 2 이상이면 mismatch 없음", () => {
    const theses = [makeThesis({ beneficiaryTickers: ["NVDA"] })];
    const dbStocks = [{ symbol: "NVDA", phase: 2, rs_score: 92 }];

    const result = checkTickerAccuracy(theses, dbStocks);
    expect(result).toHaveLength(0);
  });

  it("수혜주 ticker가 Phase 1이면 warn mismatch", () => {
    const theses = [makeThesis({ beneficiaryTickers: ["NVDA"] })];
    const dbStocks = [{ symbol: "NVDA", phase: 1, rs_score: 45 }];

    const result = checkTickerAccuracy(theses, dbStocks);
    expect(result).toHaveLength(1);
    expect(result[0].field).toBe("NVDA.phase");
    expect(result[0].severity).toBe("warn");
  });

  it("DB에 없는 ticker는 스킵", () => {
    const theses = [makeThesis({ beneficiaryTickers: ["ZZZZZ"] })];
    const dbStocks = [{ symbol: "NVDA", phase: 2, rs_score: 92 }];

    const result = checkTickerAccuracy(theses, dbStocks);
    expect(result).toHaveLength(0);
  });

  it("beneficiaryTickers가 null이면 스킵", () => {
    const theses = [makeThesis({ beneficiaryTickers: null })];
    const dbStocks = [{ symbol: "NVDA", phase: 2, rs_score: 92 }];

    const result = checkTickerAccuracy(theses, dbStocks);
    expect(result).toHaveLength(0);
  });

  it("DB 종목이 비어있으면 스킵", () => {
    const theses = [makeThesis({ beneficiaryTickers: ["NVDA"] })];
    const result = checkTickerAccuracy(theses, []);
    expect(result).toHaveLength(0);
  });
});

// ────────────────────────────────────────────
// runDebateQA (orchestrator)
// ────────────────────────────────────────────

describe("runDebateQA", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("thesis 0건이면 severity ok, 검증 스킵", async () => {
    const result = await runDebateQA(TEST_DATE, []);
    expect(result.severity).toBe("ok");
    expect(result.mismatches).toHaveLength(0);
    expect(result.checkedItems).toBe(0);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("전체 일치 — severity ok", async () => {
    const theses = [
      makeThesis({ beneficiarySectors: ["Technology"], beneficiaryTickers: ["NVDA"] }),
    ];
    setupMockQueries();

    const result = await runDebateQA(TEST_DATE, theses);
    expect(result.severity).toBe("ok");
    expect(result.mismatches).toHaveLength(0);
    expect(result.checkedItems).toBeGreaterThanOrEqual(1);
  });

  it("bull-bias 감지 시 severity warn", async () => {
    const theses = [
      makeThesis({ thesis: "AI 수혜 확대 — 반도체 상승 지속" }),
      makeThesis({ thesis: "클라우드 성장 가속 — AWS 수혜" }),
      makeThesis({ thesis: "전력 수요 확대 — 유틸리티 상승 모멘텀" }),
    ];
    setupMockQueries();

    const result = await runDebateQA(TEST_DATE, theses);
    expect(result.severity).toBe("warn");
    expect(result.mismatches.some((m) => m.field === "bull_bias")).toBe(true);
  });

  it("DB에 없는 섹터 + Phase 1 종목 — severity block (2건 불일치)", async () => {
    const theses = [
      makeThesis({
        beneficiarySectors: ["Quantum Computing"],
        beneficiaryTickers: ["QBIT"],
      }),
    ];
    setupMockQueries({
      sectorRows: [{ sector: "Technology", group_phase: 2 }],
      stockRows: [{ symbol: "QBIT", phase: 1, rs_score: 30 }],
    });

    const result = await runDebateQA(TEST_DATE, theses);
    expect(result.severity).toBe("block");
    expect(result.mismatches.length).toBeGreaterThanOrEqual(2);
  });

  it("DB 쿼리 실패 시 graceful warn 반환", async () => {
    const theses = [makeThesis()];
    mockQuery.mockRejectedValueOnce(new Error("DB connection timeout"));

    const result = await runDebateQA(TEST_DATE, theses);
    expect(result.severity).toBe("warn");
    expect(result.mismatches[0].type).toBe("db_error");
    expect(result.checkedItems).toBe(0);
  });

  it("DB 병렬 쿼리 2회 실행 (섹터 + 종목)", async () => {
    const theses = [
      makeThesis({ beneficiaryTickers: ["NVDA", "AAPL"] }),
    ];
    setupMockQueries();

    await runDebateQA(TEST_DATE, theses);
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });
});
