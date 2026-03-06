import { describe, it, expect } from "vitest";
import {
  calculateSignalStats,
  summarizeSignalStats,
} from "@/lib/signal-performance-stats";
import type { SignalLogRow } from "@/lib/signal-performance-stats";

function makeSignal(overrides: Partial<SignalLogRow> = {}): SignalLogRow {
  return {
    status: "ACTIVE",
    return5d: null,
    return10d: null,
    return20d: null,
    return60d: null,
    maxReturn: null,
    phaseExitReturn: null,
    phaseExitDate: null,
    ...overrides,
  };
}

describe("calculateSignalStats", () => {
  it("returns zero stats for empty input", () => {
    const result = calculateSignalStats([]);

    expect(result.total).toBe(0);
    expect(result.active).toBe(0);
    expect(result.closed).toBe(0);
    expect(result.avgReturn20d).toBeNull();
    expect(result.winRate20d).toBeNull();
    expect(result.avgMaxReturn).toBeNull();
    expect(result.phaseExitWinRate).toBeNull();
  });

  it("calculates stats for mixed data", () => {
    const signals: SignalLogRow[] = [
      makeSignal({
        status: "CLOSED",
        return20d: "5.0",
        maxReturn: "10.0",
        phaseExitDate: "2026-01-15",
        phaseExitReturn: "3.0",
      }),
      makeSignal({
        status: "CLOSED",
        return20d: "-2.0",
        maxReturn: "4.0",
        phaseExitDate: "2026-01-20",
        phaseExitReturn: "-1.0",
      }),
      makeSignal({
        status: "ACTIVE",
        return20d: "8.0",
        maxReturn: "12.0",
      }),
      makeSignal({
        status: "ACTIVE",
        return5d: "1.0",
      }),
    ];

    const result = calculateSignalStats(signals);

    expect(result.total).toBe(4);
    expect(result.active).toBe(2);
    expect(result.closed).toBe(2);

    // avgReturn20d = (5 + -2 + 8) / 3 = 3.667
    expect(result.avgReturn20d).toBeCloseTo(3.667, 2);

    // winRate20d = 2/3 (5.0 and 8.0 are > 0)
    expect(result.winRate20d).toBeCloseTo(0.667, 2);

    // avgMaxReturn = (10 + 4 + 12) / 3 = 8.667
    expect(result.avgMaxReturn).toBeCloseTo(8.667, 2);

    // phaseExitWinRate = 1/2 (3.0 > 0, -1.0 <= 0)
    expect(result.phaseExitWinRate).toBe(0.5);
  });

  it("handles all ACTIVE signals", () => {
    const signals: SignalLogRow[] = [
      makeSignal({ status: "ACTIVE" }),
      makeSignal({ status: "ACTIVE" }),
    ];

    const result = calculateSignalStats(signals);

    expect(result.total).toBe(2);
    expect(result.active).toBe(2);
    expect(result.closed).toBe(0);
    expect(result.avgReturn20d).toBeNull();
    expect(result.winRate20d).toBeNull();
    expect(result.phaseExitWinRate).toBeNull();
  });

  it("handles all CLOSED signals with full data", () => {
    const signals: SignalLogRow[] = [
      makeSignal({
        status: "CLOSED",
        return20d: "10.0",
        maxReturn: "15.0",
        phaseExitDate: "2026-01-10",
        phaseExitReturn: "8.0",
      }),
      makeSignal({
        status: "CLOSED",
        return20d: "12.0",
        maxReturn: "20.0",
        phaseExitDate: "2026-01-15",
        phaseExitReturn: "5.0",
      }),
    ];

    const result = calculateSignalStats(signals);

    expect(result.total).toBe(2);
    expect(result.active).toBe(0);
    expect(result.closed).toBe(2);
    expect(result.avgReturn20d).toBe(11);
    expect(result.winRate20d).toBe(1);
    expect(result.avgMaxReturn).toBe(17.5);
    expect(result.phaseExitWinRate).toBe(1);
  });
});

describe("summarizeSignalStats", () => {
  it("returns message for empty stats", () => {
    const stats = calculateSignalStats([]);
    expect(summarizeSignalStats(stats)).toBe("기록된 시그널 없음");
  });

  it("formats summary text with return data", () => {
    const signals: SignalLogRow[] = [
      makeSignal({
        status: "CLOSED",
        return20d: "5.0",
        maxReturn: "10.0",
        phaseExitDate: "2026-01-15",
        phaseExitReturn: "3.0",
      }),
      makeSignal({
        status: "ACTIVE",
        return20d: "-2.0",
        maxReturn: "4.0",
      }),
    ];

    const stats = calculateSignalStats(signals);
    const summary = summarizeSignalStats(stats);

    expect(summary).toContain("2건");
    expect(summary).toContain("활성: 1");
    expect(summary).toContain("종료: 1");
    expect(summary).toContain("20일 승률");
    expect(summary).toContain("Phase 종료 승률");
  });

  it("handles signals without 20d return data", () => {
    const signals: SignalLogRow[] = [
      makeSignal({ status: "ACTIVE" }),
    ];

    const stats = calculateSignalStats(signals);
    const summary = summarizeSignalStats(stats);

    expect(summary).toContain("1건");
    expect(summary).not.toContain("20일 승률");
  });
});
