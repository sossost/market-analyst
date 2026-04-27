import { describe, it, expect } from "vitest";
import {
  classifyHoldingDuration,
  classifyRsBand,
  isWithinDateRange,
  calculateWinRate,
  normalizeExitReason,
  buildRsBandStats,
  buildHoldingDurationStats,
  buildExitReasonStats,
  buildRegimeTransitionStats,
  buildWinnerLoserProfile,
  simulateStabilityFilter,
  buildExitPatternReport,
  type ExitedPosition,
} from "../exitPatternAnalysis";

// ─── 테스트 헬퍼 ──────────────────────────────────────────────────────────────

function makePosition(overrides: Partial<ExitedPosition> = {}): ExitedPosition {
  return {
    symbol: "AAPL",
    entryDate: "2026-04-10",
    exitDate: "2026-04-15",
    holdingDays: 5,
    entryRsScore: 72,
    pnlPercent: -2.5,
    maxPnlPercent: 1.0,
    exitReason: "phase_exit: 2 → 1",
    source: "etl_auto",
    tier: "standard",
    marketRegime: "MID_BULL",
    ...overrides,
  };
}

// ─── classifyHoldingDuration ──────────────────────────────────────────────────

describe("classifyHoldingDuration", () => {
  it.each([
    [0, "flash"],
    [1, "flash"],
    [2, "flash"],
    [3, "short"],
    [5, "short"],
    [7, "short"],
    [8, "medium"],
    [15, "medium"],
    [30, "medium"],
    [31, "long"],
    [90, "long"],
  ] as const)("days=%d → %s", (days, expected) => {
    expect(classifyHoldingDuration(days)).toBe(expected);
  });
});

// ─── classifyRsBand ───────────────────────────────────────────────────────────

describe("classifyRsBand", () => {
  it.each([
    [null, "N/A"],
    [55, "RS <60"],
    [60, "RS 60-69"],
    [65, "RS 60-69"],
    [69, "RS 60-69"],
    [70, "RS 70-79"],
    [75, "RS 70-79"],
    [79, "RS 70-79"],
    [80, "RS 80+"],
    [95, "RS 80+"],
    [100, "RS 80+"],
  ] as const)("rs=%s → %s", (rs, expected) => {
    expect(classifyRsBand(rs)).toBe(expected);
  });
});

// ─── isWithinDateRange ────────────────────────────────────────────────────────

describe("isWithinDateRange", () => {
  const start = "2026-04-13";
  const end = "2026-04-17";

  it("범위 시작 경계 포함", () => {
    expect(isWithinDateRange("2026-04-13", start, end)).toBe(true);
  });

  it("범위 종료 경계 포함", () => {
    expect(isWithinDateRange("2026-04-17", start, end)).toBe(true);
  });

  it("범위 내부", () => {
    expect(isWithinDateRange("2026-04-15", start, end)).toBe(true);
  });

  it("범위 이전", () => {
    expect(isWithinDateRange("2026-04-12", start, end)).toBe(false);
  });

  it("범위 이후", () => {
    expect(isWithinDateRange("2026-04-18", start, end)).toBe(false);
  });
});

// ─── calculateWinRate ─────────────────────────────────────────────────────────

describe("calculateWinRate", () => {
  it("빈 배열이면 0", () => {
    expect(calculateWinRate([])).toBe(0);
  });

  it("전부 null이면 0", () => {
    expect(calculateWinRate([null, null])).toBe(0);
  });

  it("승자 2건, 패자 1건이면 66.7%", () => {
    const result = calculateWinRate([5, -3, 10]);
    expect(result).toBeCloseTo(66.67, 1);
  });

  it("전부 양수이면 100%", () => {
    expect(calculateWinRate([1, 2, 3])).toBe(100);
  });

  it("0은 패자로 분류", () => {
    expect(calculateWinRate([0])).toBe(0);
  });

  it("null은 무시", () => {
    expect(calculateWinRate([5, null, -3])).toBe(50);
  });
});

// ─── normalizeExitReason ──────────────────────────────────────────────────────

describe("normalizeExitReason", () => {
  it("null → unknown", () => {
    expect(normalizeExitReason(null)).toBe("unknown");
  });

  it("phase_exit: 2 → 1 → phase_exit", () => {
    expect(normalizeExitReason("phase_exit: 2 → 1")).toBe("phase_exit");
  });

  it("phase_exit: 2 → 4 → phase_exit", () => {
    expect(normalizeExitReason("phase_exit: 2 → 4")).toBe("phase_exit");
  });

  it("tracking_window_expired → tracking_window_expired", () => {
    expect(normalizeExitReason("tracking_window_expired")).toBe(
      "tracking_window_expired",
    );
  });

  it("커스텀 사유는 그대로 반환", () => {
    expect(normalizeExitReason("Phase 3 진입")).toBe("Phase 3 진입");
  });
});

// ─── buildRsBandStats ─────────────────────────────────────────────────────────

describe("buildRsBandStats", () => {
  it("RS 대역별로 올바르게 분류한다", () => {
    const positions = [
      makePosition({ entryRsScore: 65, pnlPercent: 5 }),
      makePosition({ entryRsScore: 62, pnlPercent: -3 }),
      makePosition({ entryRsScore: 75, pnlPercent: 10 }),
      makePosition({ entryRsScore: 85, pnlPercent: -8 }),
    ];

    const stats = buildRsBandStats(positions);

    const band6069 = stats.find((s) => s.band === "RS 60-69");
    expect(band6069).toBeDefined();
    expect(band6069!.count).toBe(2);
    expect(band6069!.winnerCount).toBe(1);
    expect(band6069!.winRate).toBe(50);

    const band7079 = stats.find((s) => s.band === "RS 70-79");
    expect(band7079).toBeDefined();
    expect(band7079!.count).toBe(1);
    expect(band7079!.winRate).toBe(100);

    const band80 = stats.find((s) => s.band === "RS 80+");
    expect(band80).toBeDefined();
    expect(band80!.count).toBe(1);
    expect(band80!.winRate).toBe(0);
  });

  it("RS null인 종목은 N/A 대역에 분류된다", () => {
    const positions = [
      makePosition({ entryRsScore: null, pnlPercent: 3 }),
      makePosition({ entryRsScore: null, pnlPercent: -1 }),
    ];

    const stats = buildRsBandStats(positions);
    const naBand = stats.find((s) => s.band === "N/A");
    expect(naBand).toBeDefined();
    expect(naBand!.count).toBe(2);
    expect(naBand!.winnerCount).toBe(1);
  });

  it("빈 배열이면 빈 결과", () => {
    expect(buildRsBandStats([])).toEqual([]);
  });
});

// ─── buildHoldingDurationStats ────────────────────────────────────────────────

describe("buildHoldingDurationStats", () => {
  it("기간별로 올바르게 분류한다", () => {
    const positions = [
      makePosition({ holdingDays: 1, pnlPercent: -5 }),
      makePosition({ holdingDays: 2, pnlPercent: 3 }),
      makePosition({ holdingDays: 5, pnlPercent: -2 }),
      makePosition({ holdingDays: 15, pnlPercent: 8 }),
      makePosition({ holdingDays: 45, pnlPercent: 12 }),
    ];

    const stats = buildHoldingDurationStats(positions);

    const flash = stats.find((s) => s.duration === "flash");
    expect(flash).toBeDefined();
    expect(flash!.count).toBe(2);
    expect(flash!.winnerCount).toBe(1);

    const short = stats.find((s) => s.duration === "short");
    expect(short!.count).toBe(1);

    const medium = stats.find((s) => s.duration === "medium");
    expect(medium!.count).toBe(1);
    expect(medium!.winRate).toBe(100);

    const long = stats.find((s) => s.duration === "long");
    expect(long!.count).toBe(1);
  });
});

// ─── buildExitReasonStats ─────────────────────────────────────────────────────

describe("buildExitReasonStats", () => {
  it("phase_exit 변형을 통합한다", () => {
    const positions = [
      makePosition({ exitReason: "phase_exit: 2 → 1", holdingDays: 3, pnlPercent: -5 }),
      makePosition({ exitReason: "phase_exit: 2 → 4", holdingDays: 7, pnlPercent: -8 }),
      makePosition({ exitReason: "Phase 3 진입", holdingDays: 20, pnlPercent: 5 }),
    ];

    const stats = buildExitReasonStats(positions);

    const phaseExit = stats.find((s) => s.reason === "phase_exit");
    expect(phaseExit).toBeDefined();
    expect(phaseExit!.count).toBe(2);
    expect(phaseExit!.avgHoldingDays).toBe(5);

    const manual = stats.find((s) => s.reason === "Phase 3 진입");
    expect(manual).toBeDefined();
    expect(manual!.count).toBe(1);
  });
});

// ─── buildRegimeTransitionStats ───────────────────────────────────────────────

describe("buildRegimeTransitionStats", () => {
  it("전환기 내외를 올바르게 분류한다", () => {
    const positions = [
      makePosition({ entryDate: "2026-04-14", pnlPercent: -5 }),
      makePosition({ entryDate: "2026-04-16", pnlPercent: -3 }),
      makePosition({ entryDate: "2026-04-10", pnlPercent: 8 }),
      makePosition({ entryDate: "2026-04-20", pnlPercent: -2 }),
    ];

    const stats = buildRegimeTransitionStats(
      positions,
      "2026-04-13",
      "2026-04-17",
    );

    expect(stats.withinTransition).toBe(2);
    expect(stats.outsideTransition).toBe(2);
    expect(stats.withinTransitionWinRate).toBe(0);
    expect(stats.outsideTransitionWinRate).toBe(50);
  });
});

// ─── buildWinnerLoserProfile ──────────────────────────────────────────────────

describe("buildWinnerLoserProfile", () => {
  it("승자/패자를 올바르게 분리한다", () => {
    const positions = [
      makePosition({ pnlPercent: 10, holdingDays: 30, entryRsScore: 75, maxPnlPercent: 15 }),
      makePosition({ pnlPercent: 5, holdingDays: 20, entryRsScore: 80, maxPnlPercent: 8 }),
      makePosition({ pnlPercent: -3, holdingDays: 5, entryRsScore: 65, maxPnlPercent: 1 }),
      makePosition({ pnlPercent: 0, holdingDays: 3, entryRsScore: 68, maxPnlPercent: 0.5 }),
    ];

    const profile = buildWinnerLoserProfile(positions);

    expect(profile.winners.count).toBe(2);
    expect(profile.winners.avgHoldingDays).toBe(25);
    expect(profile.winners.avgRsScore).toBe(77.5);

    expect(profile.losers.count).toBe(2);
    expect(profile.losers.avgHoldingDays).toBe(4);
  });

  it("PnL null인 종목은 승자/패자 어디에도 포함되지 않는다", () => {
    const positions = [makePosition({ pnlPercent: null })];
    const profile = buildWinnerLoserProfile(positions);
    expect(profile.winners.count).toBe(0);
    expect(profile.losers.count).toBe(0);
  });
});

// ─── simulateStabilityFilter ──────────────────────────────────────────────────

describe("simulateStabilityFilter", () => {
  it("안정성 기준 강화 시 추가 차단 종목을 식별한다", () => {
    // AAPL: entry 04-10, 직전 5일 중 4일만 Phase 2 → 3일 기준 통과, 5일 기준 미통과
    const phaseHistory = new Map<string, Array<{ date: string; phase: number }>>([
      [
        "AAPL",
        [
          { date: "2026-04-04", phase: 1 }, // 5일전: Phase 1
          { date: "2026-04-05", phase: 2 }, // 4일전
          { date: "2026-04-07", phase: 2 }, // 3일전
          { date: "2026-04-08", phase: 2 }, // 2일전
          { date: "2026-04-09", phase: 2 }, // 1일전
        ],
      ],
      [
        "MSFT",
        [
          { date: "2026-04-04", phase: 2 },
          { date: "2026-04-05", phase: 2 },
          { date: "2026-04-07", phase: 2 },
          { date: "2026-04-08", phase: 2 },
          { date: "2026-04-09", phase: 2 },
        ],
      ],
    ]);

    const positions = [
      makePosition({ symbol: "AAPL", entryDate: "2026-04-10", pnlPercent: -5 }),
      makePosition({ symbol: "MSFT", entryDate: "2026-04-10", pnlPercent: 8 }),
    ];

    const result = simulateStabilityFilter(positions, phaseHistory, 3, 5);

    expect(result.originalCount).toBe(2);
    expect(result.additionallyBlockedCount).toBe(1);
    expect(result.filteredCount).toBe(1);
    expect(result.blockedAvgPnl).toBe(-5);
    expect(result.remainingAvgPnl).toBe(8);
  });

  it("데이터 부족 시 insufficientData로 제외한다", () => {
    const phaseHistory = new Map<string, Array<{ date: string; phase: number }>>([
      [
        "AAPL",
        [
          { date: "2026-04-09", phase: 2 },
        ],
      ],
    ]);

    const positions = [
      makePosition({ symbol: "AAPL", entryDate: "2026-04-10", pnlPercent: -3 }),
    ];

    const result = simulateStabilityFilter(positions, phaseHistory, 3, 5);

    expect(result.insufficientDataCount).toBe(1);
    expect(result.additionallyBlockedCount).toBe(0);
    expect(result.filteredCount).toBe(0);
  });

  it("현재 기준도 미통과인 종목은 remaining에 포함된다", () => {
    // 직전 5일 중 Phase 2가 1일뿐 → 3일 기준도 미통과, 5일 기준도 미통과
    const phaseHistory = new Map<string, Array<{ date: string; phase: number }>>([
      [
        "GOOG",
        [
          { date: "2026-04-04", phase: 1 },
          { date: "2026-04-05", phase: 1 },
          { date: "2026-04-07", phase: 1 },
          { date: "2026-04-08", phase: 1 },
          { date: "2026-04-09", phase: 2 },
        ],
      ],
    ]);

    const positions = [
      makePosition({ symbol: "GOOG", entryDate: "2026-04-10", pnlPercent: -4 }),
    ];

    const result = simulateStabilityFilter(positions, phaseHistory, 3, 5);

    // 양쪽 모두 미통과 ��� additionallyBlocked에 안 들어감 → remaining
    expect(result.additionallyBlockedCount).toBe(0);
    expect(result.filteredCount).toBe(1);
    expect(result.insufficientDataCount).toBe(0);
  });

  it("빈 포지션이면 빈 결과", () => {
    const result = simulateStabilityFilter([], new Map(), 3, 5);
    expect(result.originalCount).toBe(0);
    expect(result.additionallyBlockedCount).toBe(0);
    expect(result.insufficientDataCount).toBe(0);
  });
});

// ─── buildExitPatternReport ───────────────────────────────────────────────────

describe("buildExitPatternReport", () => {
  it("전체 리포트를 올바르게 생성한다", () => {
    const positions = [
      makePosition({ entryDate: "2026-04-10", pnlPercent: -5, holdingDays: 3, entryRsScore: 65 }),
      makePosition({ entryDate: "2026-04-14", pnlPercent: 8, holdingDays: 20, entryRsScore: 75 }),
      makePosition({ entryDate: "2026-04-20", pnlPercent: -2, holdingDays: 7, entryRsScore: 82 }),
    ];

    const report = buildExitPatternReport(positions, "2026-04-13", "2026-04-17");

    expect(report.totalExited).toBe(3);
    expect(report.overallWinRate).toBeCloseTo(33.3, 0);
    expect(report.byRsBand.length).toBeGreaterThan(0);
    expect(report.byHoldingDuration.length).toBeGreaterThan(0);
    expect(report.byExitReason.length).toBeGreaterThan(0);
    expect(report.regimeTransition.withinTransition).toBe(1);
    expect(report.regimeTransition.outsideTransition).toBe(2);
  });
});
