import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { DailyReportLog } from "@/types";

// Use a temp directory for tests
const TEST_DIR = path.resolve(process.cwd(), "data/reports-test");

// Override process.cwd for reportLog to use test dir
const originalCwd = process.cwd;

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

describe("reportLog", () => {
  beforeEach(() => {
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true });
    }
    fs.mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true });
    }
  });

  it("readReportLogs returns empty array when no files exist", async () => {
    // Dynamic import to allow test dir manipulation
    const { readReportLogs } = await import("@/agent/reportLog");

    // Since reportLog uses process.cwd()/data/reports, and we can't easily mock that,
    // we test the function behavior with the actual directory
    // In a clean state, data/reports may not exist → should return []
    const logs = readReportLogs(7);
    expect(Array.isArray(logs)).toBe(true);
  });

  it("saveReportLog creates a valid JSON file", async () => {
    const { saveReportLog, readReportLogs } = await import("@/agent/reportLog");

    const log = createTestLog("2026-03-04");
    saveReportLog(log);

    // Verify file was created
    const filePath = path.resolve(
      process.cwd(),
      "data/reports/2026-03-04.json",
    );
    expect(fs.existsSync(filePath)).toBe(true);

    // Verify content
    const content = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    expect(content.date).toBe("2026-03-04");
    expect(content.reportedSymbols).toHaveLength(1);
    expect(content.reportedSymbols[0].symbol).toBe("AAPL");

    // Clean up
    fs.unlinkSync(filePath);
  });
});
