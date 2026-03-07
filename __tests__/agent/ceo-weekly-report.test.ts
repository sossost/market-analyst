import { describe, it, expect } from "vitest";
import { buildCeoWeeklyReport } from "@/agent/ceo-weekly-report";
import type { CeoReportData, ParamChangeRow } from "@/agent/ceo-weekly-report";
import type { AgentStats } from "@/lib/agent-performance";
import type { SignalStats } from "@/lib/signal-performance-stats";

function makeAgentStats(overrides: Partial<AgentStats> = {}): AgentStats {
  return {
    persona: "macro",
    total: 10,
    confirmed: 6,
    invalidated: 2,
    expired: 1,
    active: 1,
    hitRate: 0.75,
    byConfidence: {},
    ...overrides,
  };
}

function makeSignalStats(overrides: Partial<SignalStats> = {}): SignalStats {
  return {
    total: 20,
    active: 5,
    closed: 15,
    avgReturn20d: 3.5,
    winRate20d: 0.65,
    avgMaxReturn: 8.2,
    phaseExitWinRate: 0.55,
    ...overrides,
  };
}

function makeReportData(overrides: Partial<CeoReportData> = {}): CeoReportData {
  return {
    agentStats: [
      makeAgentStats({ persona: "macro", hitRate: 0.75, confirmed: 6, invalidated: 2 }),
      makeAgentStats({ persona: "tech", hitRate: 0.5, confirmed: 3, invalidated: 3, total: 8 }),
      makeAgentStats({ persona: "geopolitics", hitRate: 1.0, confirmed: 4, invalidated: 0, total: 5 }),
      makeAgentStats({ persona: "sentiment", hitRate: 0.33, confirmed: 2, invalidated: 4, total: 7 }),
    ],
    signalStats: makeSignalStats(),
    paramChanges: [],
    weekStart: "2026-02-27",
    weekEnd: "2026-03-06",
    ...overrides,
  };
}

describe("buildCeoWeeklyReport", () => {
  it("generates complete report with all sections", () => {
    const report = buildCeoWeeklyReport(makeReportData());

    // Header
    expect(report).toContain("CEO 주간 시스템 리포트");
    expect(report).toContain("2026-02-27 ~ 2026-03-06");

    // Signal section
    expect(report).toContain("시그널 성과");
    expect(report).toContain("활성: 5건");
    expect(report).toContain("종료: 15건");
    expect(report).toContain("20일 승률: 65%");
    expect(report).toContain("+3.5%");
    expect(report).toContain("Phase 종료 승률: 55%");

    // Agent section
    expect(report).toContain("애널리스트 성과");
    expect(report).toContain("macro");
    expect(report).toContain("tech");
    expect(report).toContain("geopolitics");
    expect(report).toContain("sentiment");
    expect(report).toContain("최우수");
    expect(report).toContain("최저");

    // Param section (no changes)
    expect(report).toContain("시스템 조정 내역");
    expect(report).toContain("이번 주 자동 조정 없음");

    // Judgment section
    expect(report).toContain("매니저 판단");
  });

  it("includes parameter changes when present", () => {
    const paramChanges: ParamChangeRow[] = [
      {
        paramName: "rs_threshold",
        currentValue: "75",
        previousValue: "70",
        changeReason: "승률 개선 목적",
        changedAt: new Date("2026-03-01"),
      },
      {
        paramName: "volume_required",
        currentValue: "false",
        previousValue: "true",
        changeReason: null,
        changedAt: new Date("2026-03-03"),
      },
    ];

    const report = buildCeoWeeklyReport(makeReportData({ paramChanges }));

    expect(report).toContain("rs_threshold: 70 -> 75 (승률 개선 목적)");
    expect(report).toContain("volume_required: true -> false");
    expect(report).not.toContain("이번 주 자동 조정 없음");
  });

  it("handles empty agent stats", () => {
    const report = buildCeoWeeklyReport(
      makeReportData({ agentStats: [] }),
    );

    expect(report).toContain("집계 대상 thesis 없음");
  });

  it("handles empty signal stats", () => {
    const report = buildCeoWeeklyReport(
      makeReportData({
        signalStats: makeSignalStats({
          total: 0,
          active: 0,
          closed: 0,
          avgReturn20d: null,
          winRate20d: null,
          avgMaxReturn: null,
          phaseExitWinRate: null,
        }),
      }),
    );

    expect(report).toContain("기록된 시그널 없음");
  });

  it("shows poor quality warning when winRate is low", () => {
    const report = buildCeoWeeklyReport(
      makeReportData({
        signalStats: makeSignalStats({ winRate20d: 0.3 }),
      }),
    );

    expect(report).toContain("시그널 품질 저조");
  });

  it("shows good quality message when winRate is high", () => {
    const report = buildCeoWeeklyReport(
      makeReportData({
        signalStats: makeSignalStats({ winRate20d: 0.7 }),
      }),
    );

    expect(report).toContain("시그널 품질 양호");
  });
});
