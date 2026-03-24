import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/reportLog", () => ({
  readReportLogs: vi.fn(),
  readReportLogsFromDb: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), step: vi.fn() },
}));

import { readReportLogs, readReportLogsFromDb } from "@/lib/reportLog";
import { loadReportLogs } from "../readReportHistory";
import type { DailyReportLog } from "@/types";

const mockFileLogs = vi.mocked(readReportLogs);
const mockDbLogs = vi.mocked(readReportLogsFromDb);

const SAMPLE_LOG: DailyReportLog = {
  date: "2026-03-20",
  type: "daily",
  reportedSymbols: [],
  marketSummary: {
    phase2Ratio: 30,
    leadingSectors: ["Energy"],
    totalAnalyzed: 100,
  },
  metadata: {
    model: "test",
    tokensUsed: { input: 0, output: 0 },
    toolCalls: 0,
    executionTime: 0,
  },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("loadReportLogs (file → DB fallback)", () => {
  it("파일에 이력이 있으면 파일 결과 반환, DB 미호출", async () => {
    mockFileLogs.mockReturnValue([SAMPLE_LOG]);

    const result = await loadReportLogs(7);

    expect(result).toEqual([SAMPLE_LOG]);
    expect(mockDbLogs).not.toHaveBeenCalled();
  });

  it("파일 이력 비어있으면 DB fallback", async () => {
    mockFileLogs.mockReturnValue([]);
    mockDbLogs.mockResolvedValue([SAMPLE_LOG]);

    const result = await loadReportLogs(7);

    expect(result).toEqual([SAMPLE_LOG]);
    expect(mockDbLogs).toHaveBeenCalledWith(7);
  });

  it("파일도 DB도 비어있으면 빈 배열", async () => {
    mockFileLogs.mockReturnValue([]);
    mockDbLogs.mockResolvedValue([]);

    const result = await loadReportLogs(7);

    expect(result).toEqual([]);
  });

  it("DB fallback 오류 시 빈 배열 반환 (fail-open)", async () => {
    mockFileLogs.mockReturnValue([]);
    mockDbLogs.mockRejectedValue(new Error("connection refused"));

    const result = await loadReportLogs(7);

    expect(result).toEqual([]);
  });
});
