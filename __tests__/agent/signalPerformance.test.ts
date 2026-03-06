import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock node:fs — must be before importing the module under test
// ---------------------------------------------------------------------------

const mockReaddirSync = vi.fn();
const mockReadFileSync = vi.fn();

vi.mock("node:fs", () => ({
  readdirSync: (...args: unknown[]) => mockReaddirSync(...args),
  readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
}));

const { loadSignalPerformanceSummary, loadLatestBacktestData } = await import(
  "@/agent/signalPerformance"
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createBacktestJson(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    runDate: "2026-03-06T08:19:54.533Z",
    dataRange: { from: "2025-09-25", to: "2026-03-05" },
    totalSignals: 605,
    paramResults: [
      {
        rsThreshold: 80,
        volumeRequired: true,
        sectorFilter: false,
        totalSignals: 222,
        returns: {
          "5": { avg: 0.1, median: -1.5, winRate: 45.8, count: 214 },
          "10": { avg: 4.8, median: -0.3, winRate: 48.2, count: 195 },
          "20": { avg: 19.9, median: -1.2, winRate: 48.0, count: 175 },
          "60": { avg: -4.0, median: -2.4, winRate: 44.4, count: 90 },
        },
        phaseExit: {
          avgReturn: 1.0,
          medianReturn: -8.2,
          winRate: 19.5,
          avgDays: 12.1,
          count: 159,
        },
        avgMaxReturn: 49.4,
      },
      {
        rsThreshold: 50,
        volumeRequired: false,
        sectorFilter: false,
        totalSignals: 6905,
        returns: {
          "5": { avg: 0.05, median: -0.2, winRate: 47.8, count: 6662 },
          "10": { avg: 1.4, median: 0.6, winRate: 53.2, count: 5195 },
          "20": { avg: 3.5, median: 1.6, winRate: 56.5, count: 4569 },
          "60": { avg: 7.2, median: 4.8, winRate: 60.4, count: 2524 },
        },
        phaseExit: {
          avgReturn: -3.3,
          medianReturn: -3.2,
          winRate: 16.1,
          avgDays: 9.9,
          count: 4357,
        },
        avgMaxReturn: 18.6,
      },
    ],
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("loadSignalPerformanceSummary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty string when backtest directory does not exist", () => {
    mockReaddirSync.mockImplementation(() => {
      throw new Error("ENOENT: no such file or directory");
    });

    const result = loadSignalPerformanceSummary();
    expect(result).toBe("");
  });

  it("returns empty string when directory is empty", () => {
    mockReaddirSync.mockReturnValue([]);

    const result = loadSignalPerformanceSummary();
    expect(result).toBe("");
  });

  it("returns empty string when no matching files exist", () => {
    mockReaddirSync.mockReturnValue(["other-file.json", "readme.txt"]);

    const result = loadSignalPerformanceSummary();
    expect(result).toBe("");
  });

  it("generates summary text from valid backtest data", () => {
    mockReaddirSync.mockReturnValue(["signal-backtest-2026-03-06.json"]);
    mockReadFileSync.mockReturnValue(createBacktestJson());

    const result = loadSignalPerformanceSummary();

    expect(result).not.toBe("");
    expect(result).toContain("기계적 시그널 백테스트");
    expect(result).toContain("2026-03-05");
  });

  it("includes bestConfig RS threshold info in summary", () => {
    mockReaddirSync.mockReturnValue(["signal-backtest-2026-03-06.json"]);
    mockReadFileSync.mockReturnValue(createBacktestJson());

    const result = loadSignalPerformanceSummary();

    // The best config should be RS>=80 + volume (20d avg = 19.9 vs 3.5)
    expect(result).toContain("RS>=80");
  });

  it("includes 20-day return stats in summary", () => {
    mockReaddirSync.mockReturnValue(["signal-backtest-2026-03-06.json"]);
    mockReadFileSync.mockReturnValue(createBacktestJson());

    const result = loadSignalPerformanceSummary();

    expect(result).toContain("20일 평균 수익률");
    expect(result).toContain("+19.9%");
    expect(result).toContain("N=175");
  });

  it("includes phase exit win rate in summary", () => {
    mockReaddirSync.mockReturnValue(["signal-backtest-2026-03-06.json"]);
    mockReadFileSync.mockReturnValue(createBacktestJson());

    const result = loadSignalPerformanceSummary();

    expect(result).toContain("Phase 종료 시점 승률");
    expect(result).toContain("19.5%");
  });

  it("loads the most recent file when multiple exist", () => {
    mockReaddirSync.mockReturnValue([
      "signal-backtest-2026-02-01.json",
      "signal-backtest-2026-03-06.json",
    ]);
    // The function sorts reverse so it picks the latest (2026-03-06)
    mockReadFileSync.mockReturnValue(
      createBacktestJson({
        dataRange: { from: "2025-09-25", to: "2026-03-05" },
      }),
    );

    const result = loadSignalPerformanceSummary();

    expect(result).toContain("2026-03-05");
    // Verify it reads the latest file
    const readPath = mockReadFileSync.mock.calls[0][0] as string;
    expect(readPath).toContain("signal-backtest-2026-03-06.json");
  });

  it("returns empty string when JSON is malformed", () => {
    mockReaddirSync.mockReturnValue(["signal-backtest-2026-03-06.json"]);
    mockReadFileSync.mockReturnValue("not valid json{{{");

    const result = loadSignalPerformanceSummary();
    expect(result).toBe("");
  });

  it("includes volume confirmation label when volumeRequired is true", () => {
    mockReaddirSync.mockReturnValue(["signal-backtest-2026-03-06.json"]);
    mockReadFileSync.mockReturnValue(createBacktestJson());

    const result = loadSignalPerformanceSummary();

    expect(result).toContain("거래량확인");
  });

  it("handles paramResults with no entries having 50+ signals gracefully", () => {
    const data = createBacktestJson({
      paramResults: [
        {
          rsThreshold: 90,
          volumeRequired: true,
          sectorFilter: true,
          totalSignals: 5,
          returns: {
            "20": { avg: 10.0, median: 5.0, winRate: 60.0, count: 3 },
          },
          phaseExit: {
            avgReturn: -2.0,
            medianReturn: -1.0,
            winRate: 33.3,
            avgDays: 5.0,
            count: 3,
          },
          avgMaxReturn: 15.0,
        },
      ],
    });
    mockReaddirSync.mockReturnValue(["signal-backtest-2026-03-06.json"]);
    mockReadFileSync.mockReturnValue(data);

    const result = loadSignalPerformanceSummary();

    // Should still produce output using the fallback (first entry)
    expect(result).toContain("RS>=90");
  });
});

describe("loadLatestBacktestData", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when directory does not exist", () => {
    mockReaddirSync.mockImplementation(() => {
      throw new Error("ENOENT");
    });

    const result = loadLatestBacktestData();
    expect(result).toBeNull();
  });

  it("returns parsed data when valid file exists", () => {
    mockReaddirSync.mockReturnValue(["signal-backtest-2026-03-06.json"]);
    mockReadFileSync.mockReturnValue(createBacktestJson());

    const result = loadLatestBacktestData();

    expect(result).not.toBeNull();
    expect(result!.dataRange.to).toBe("2026-03-05");
    expect(result!.paramResults).toHaveLength(2);
  });

  it("returns null when no matching files", () => {
    mockReaddirSync.mockReturnValue(["readme.txt"]);

    const result = loadLatestBacktestData();
    expect(result).toBeNull();
  });
});
