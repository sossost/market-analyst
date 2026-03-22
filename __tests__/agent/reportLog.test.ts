import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { DailyReportLog } from "@/types";

function createTestLog(date: string): DailyReportLog {
  return {
    date,
    reportedSymbols: [
      {
        symbol: "AAPL",
        phase: 2,
        prevPhase: 1,
        rsScore: 85,
        sector: "Technology",
        industry: "Consumer Electronics",
        reason: "Phase 1→2 전환",
        firstReportedDate: date,
      },
    ],
    marketSummary: {
      phase2Ratio: 29.5,
      leadingSectors: ["Technology", "Energy"],
      totalAnalyzed: 3000,
    },
    metadata: {
      model: "claude-opus-4-6",
      tokensUsed: { input: 5000, output: 2000 },
      toolCalls: 7,
      executionTime: 45000,
    },
  };
}

// Mock DB module to avoid needing a real database connection
vi.mock("../../src/db/client.js", () => ({
  db: {
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoNothing: vi.fn().mockResolvedValue(undefined),
      }),
    }),
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        orderBy: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    }),
  },
  pool: { end: vi.fn() },
}));

describe("reportLog — file operations", () => {
  it("readReportLogs returns empty array when no files exist", async () => {
    const { readReportLogs } = await import("@/lib/reportLog");
    const logs = readReportLogs(7);
    expect(Array.isArray(logs)).toBe(true);
  });

  it("saveReportLogToFile creates a valid JSON file", async () => {
    const { saveReportLogToFile } = await import("@/lib/reportLog");

    const log = createTestLog("2026-03-04");
    saveReportLogToFile(log);

    const filePath = path.resolve(
      process.cwd(),
      "data/reports/2026-03-04.json",
    );
    expect(fs.existsSync(filePath)).toBe(true);

    const content = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    expect(content.date).toBe("2026-03-04");
    expect(content.reportedSymbols).toHaveLength(1);
    expect(content.reportedSymbols[0].symbol).toBe("AAPL");

    // Clean up
    fs.unlinkSync(filePath);
  });

  it("saveReportLog saves to file and attempts DB insert", async () => {
    const { saveReportLog } = await import("@/lib/reportLog");
    const { db } = await import("../../src/db/client.js");

    const log = createTestLog("2026-03-05");
    await saveReportLog(log);

    // Verify file was created
    const filePath = path.resolve(
      process.cwd(),
      "data/reports/2026-03-05.json",
    );
    expect(fs.existsSync(filePath)).toBe(true);

    // Verify DB insert was attempted
    expect(db.insert).toHaveBeenCalled();

    // Clean up
    fs.unlinkSync(filePath);
  });

  it("saveReportLog survives DB failure and keeps file backup", async () => {
    const { db } = await import("../../src/db/client.js");

    // Make DB insert throw
    vi.mocked(db.insert).mockReturnValueOnce({
      values: vi.fn().mockReturnValue({
        onConflictDoNothing: vi
          .fn()
          .mockRejectedValue(new Error("DB connection failed")),
      }),
    } as unknown as ReturnType<typeof db.insert>);

    const { saveReportLog } = await import("@/lib/reportLog");
    const log = createTestLog("2026-03-06");

    // Should not throw even when DB fails
    await expect(saveReportLog(log)).resolves.toBeUndefined();

    // File backup should still exist
    const filePath = path.resolve(
      process.cwd(),
      "data/reports/2026-03-06.json",
    );
    expect(fs.existsSync(filePath)).toBe(true);

    // Clean up
    fs.unlinkSync(filePath);
  });
});

describe("reportLog — DB read operations", () => {
  it("readReportLogsFromDb returns empty array when no rows", async () => {
    const { readReportLogsFromDb } = await import("@/lib/reportLog");
    const logs = await readReportLogsFromDb(7);
    expect(logs).toEqual([]);
  });

  it("readReportLogsFromDb maps DB rows to DailyReportLog", async () => {
    const { db } = await import("../../src/db/client.js");
    const mockRow = {
      id: 1,
      reportDate: "2026-03-04",
      type: "daily",
      reportedSymbols: [
        {
          symbol: "AAPL",
          phase: 2,
          prevPhase: 1,
          rsScore: 85,
          sector: "Technology",
          industry: "Consumer Electronics",
          reason: "Phase 1→2 전환",
          firstReportedDate: "2026-03-04",
        },
      ],
      marketSummary: {
        phase2Ratio: 29.5,
        leadingSectors: ["Technology"],
        totalAnalyzed: 3000,
      },
      metadata: {
        model: "claude-opus-4-6",
        tokensUsed: { input: 5000, output: 2000 },
        toolCalls: 7,
        executionTime: 45000,
      },
      fullContent: null,
      createdAt: new Date(),
    };

    vi.mocked(db.select).mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        orderBy: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([mockRow]),
        }),
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([mockRow]),
        }),
      }),
    } as unknown as ReturnType<typeof db.select>);

    const { readReportLogsFromDb } = await import("@/lib/reportLog");
    const logs = await readReportLogsFromDb(7);

    expect(logs).toHaveLength(1);
    expect(logs[0].date).toBe("2026-03-04");
    expect(logs[0].reportedSymbols[0].symbol).toBe("AAPL");
    expect(logs[0].metadata.model).toBe("claude-opus-4-6");
  });

  it("readReportByDate returns null when not found", async () => {
    const { readReportByDate } = await import("@/lib/reportLog");
    const result = await readReportByDate("2099-01-01");
    expect(result).toBeNull();
  });

  it("readReportLogsFromDb provides default metadata when null", async () => {
    const { db } = await import("../../src/db/client.js");
    const mockRow = {
      id: 1,
      reportDate: "2026-03-04",
      type: "daily",
      reportedSymbols: [],
      marketSummary: {
        phase2Ratio: 0,
        leadingSectors: [],
        totalAnalyzed: 0,
      },
      metadata: null,
      fullContent: null,
      createdAt: new Date(),
    };

    vi.mocked(db.select).mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        orderBy: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([mockRow]),
        }),
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([mockRow]),
        }),
      }),
    } as unknown as ReturnType<typeof db.select>);

    const { readReportLogsFromDb } = await import("@/lib/reportLog");
    const logs = await readReportLogsFromDb(7);

    expect(logs[0].metadata.model).toBe("unknown");
    expect(logs[0].metadata.tokensUsed).toEqual({ input: 0, output: 0 });
  });
});
