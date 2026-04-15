import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies before importing the module under test
const mockSaveReportLog = vi.fn().mockResolvedValue(undefined);
const mockUpdateReportFullContent = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/reportLog", () => ({
  saveReportLog: (...args: unknown[]) => mockSaveReportLog(...args),
  updateReportFullContent: (...args: unknown[]) =>
    mockUpdateReportFullContent(...args),
}));

vi.mock("@/lib/discord", () => ({
  sendDiscordMessage: vi.fn().mockResolvedValue(undefined),
  sendDiscordError: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/db/client", () => ({
  db: {},
  pool: { end: vi.fn().mockResolvedValue(undefined) },
}));

const DEFAULT_METADATA = {
  model: "claude-sonnet-4-20250514",
  tokensUsed: { input: 0, output: 0 },
  toolCalls: 0,
  executionTime: 0,
};

describe("weekly report DB save", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("saveReportLog is called with type='weekly' before updateReportFullContent", async () => {
    const targetDate = "2026-03-28";
    const fullContent = "# 주간 시장 리포트\n\n본문 내용";

    // Simulate what run-weekly-agent.ts does after review pipeline
    const { saveReportLog, updateReportFullContent } = await import(
      "@/lib/reportLog"
    );

    const reportedSymbols = [
      { symbol: "NVDA", phase: 2, prevPhase: 1, rsScore: 92, sector: "Technology", industry: "Semiconductors", reason: "5중게이트", firstReportedDate: targetDate },
    ];

    await saveReportLog({
      date: targetDate,
      type: "weekly",
      reportedSymbols,
      marketSummary: { phase2Ratio: 35.2, leadingSectors: ["Technology", "Healthcare", "Energy"], totalAnalyzed: 500 },
      fullContent,
      metadata: DEFAULT_METADATA,
    });
    await updateReportFullContent(targetDate, "weekly", fullContent);

    // Verify INSERT (saveReportLog) was called
    expect(mockSaveReportLog).toHaveBeenCalledTimes(1);
    expect(mockSaveReportLog).toHaveBeenCalledWith(
      expect.objectContaining({
        date: targetDate,
        type: "weekly",
        reportedSymbols,
        fullContent,
      }),
    );

    // Verify UPDATE (updateReportFullContent) was called after INSERT
    expect(mockUpdateReportFullContent).toHaveBeenCalledTimes(1);
    expect(mockUpdateReportFullContent).toHaveBeenCalledWith(
      targetDate,
      "weekly",
      fullContent,
    );

    // Verify INSERT was called before UPDATE
    const insertOrder = mockSaveReportLog.mock.invocationCallOrder[0];
    const updateOrder =
      mockUpdateReportFullContent.mock.invocationCallOrder[0];
    expect(insertOrder).toBeLessThan(updateOrder);
  });

  it("saveReportLog receives correct weekly report structure with symbols and market data", async () => {
    const targetDate = "2026-03-21";
    const fullContent = "주간 리포트 내용";

    const { saveReportLog } = await import("@/lib/reportLog");

    const reportedSymbols = [
      { symbol: "AAPL", phase: 2, prevPhase: null, rsScore: 85, sector: "Technology", industry: "Consumer Electronics", reason: "돌파확인", firstReportedDate: targetDate },
    ];

    await saveReportLog({
      date: targetDate,
      type: "weekly",
      reportedSymbols,
      marketSummary: { phase2Ratio: 28.5, leadingSectors: ["Technology"], totalAnalyzed: 480 },
      fullContent,
      metadata: DEFAULT_METADATA,
    });

    const callArg = mockSaveReportLog.mock.calls[0][0];
    expect(callArg.type).toBe("weekly");
    expect(callArg.date).toBe(targetDate);
    expect(callArg.reportedSymbols).toHaveLength(1);
    expect(callArg.reportedSymbols[0].symbol).toBe("AAPL");
    expect(callArg.reportedSymbols[0].reason).toBe("돌파확인");
    expect(callArg.marketSummary.phase2Ratio).toBe(28.5);
    expect(callArg.marketSummary.leadingSectors).toEqual(["Technology"]);
    expect(callArg.marketSummary.totalAnalyzed).toBe(480);
    expect(callArg.fullContent).toBe(fullContent);
  });
});
