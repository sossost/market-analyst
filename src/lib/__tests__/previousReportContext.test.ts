import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/reportLog", () => ({
  readReportLogsFromDb: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), step: vi.fn() },
}));

import { readReportLogsFromDb } from "@/lib/reportLog";
import {
  loadPreviousReportContext,
  formatPreviousReportContext,
} from "../previousReportContext";
import type { DailyReportLog } from "@/types";

const mockReadDb = vi.mocked(readReportLogsFromDb);

const SAMPLE_LOG: DailyReportLog = {
  date: "2026-03-20",
  type: "daily",
  reportedSymbols: [
    {
      symbol: "AXTI",
      phase: 2,
      prevPhase: 1,
      rsScore: 85,
      sector: "Technology",
      industry: "Semiconductors",
      reason: "Phase 전환 + 거래량 급증",
      firstReportedDate: "2026-03-20",
    },
    {
      symbol: "XOM",
      phase: 2,
      prevPhase: 2,
      rsScore: 78,
      sector: "Energy",
      industry: "Oil & Gas",
      reason: "RS 상위 유지",
      firstReportedDate: "2026-03-18",
    },
  ],
  marketSummary: {
    phase2Ratio: 32.5,
    leadingSectors: ["Energy", "Healthcare"],
    totalAnalyzed: 150,
  },
  metadata: {
    model: "claude-sonnet-4-6",
    tokensUsed: { input: 5000, output: 2000 },
    toolCalls: 10,
    executionTime: 30000,
  },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("loadPreviousReportContext", () => {
  it("직전 daily 리포트가 있으면 formatted context 반환", async () => {
    mockReadDb.mockResolvedValue([SAMPLE_LOG]);

    const result = await loadPreviousReportContext("2026-03-23");

    expect(result).toContain("직전 리포트 요약 (2026-03-20)");
    expect(result).toContain("Phase 2 비율: 32.5%");
    expect(result).toContain("Energy, Healthcare");
    expect(result).toContain("AXTI");
    expect(result).toContain("XOM");
  });

  it("DB에 리포트가 없으면 빈 문자열 반환", async () => {
    mockReadDb.mockResolvedValue([]);

    const result = await loadPreviousReportContext("2026-03-23");

    expect(result).toBe("");
  });

  it("targetDate 이전 리포트만 사용 — 동일 날짜 제외", async () => {
    const sameDayLog: DailyReportLog = { ...SAMPLE_LOG, date: "2026-03-23" };
    mockReadDb.mockResolvedValue([sameDayLog]);

    const result = await loadPreviousReportContext("2026-03-23");

    expect(result).toBe("");
  });

  it("debate 타입 리포트는 건너뜀", async () => {
    const debateLog: DailyReportLog = { ...SAMPLE_LOG, type: "debate" };
    mockReadDb.mockResolvedValue([debateLog]);

    const result = await loadPreviousReportContext("2026-03-23");

    expect(result).toBe("");
  });

  it("DB 오류 시 빈 문자열 반환 (fail-open)", async () => {
    mockReadDb.mockRejectedValue(new Error("connection refused"));

    const result = await loadPreviousReportContext("2026-03-23");

    expect(result).toBe("");
  });

  it("여러 리포트 중 targetDate 이전 첫 daily만 사용", async () => {
    const olderLog: DailyReportLog = {
      ...SAMPLE_LOG,
      date: "2026-03-18",
      marketSummary: { ...SAMPLE_LOG.marketSummary, leadingSectors: ["Technology"] },
    };
    mockReadDb.mockResolvedValue([SAMPLE_LOG, olderLog]);

    const result = await loadPreviousReportContext("2026-03-23");

    expect(result).toContain("2026-03-20");
    expect(result).not.toContain("2026-03-18");
  });
});

describe("formatPreviousReportContext", () => {
  it("필수 항목 모두 포함", () => {
    const result = formatPreviousReportContext(SAMPLE_LOG);

    expect(result).toContain("## 직전 리포트 요약 (2026-03-20)");
    expect(result).toContain("Phase 2 비율: 32.5%");
    expect(result).toContain("주도 섹터: Energy, Healthcare");
    expect(result).toContain("분석 종목수: 150");
    expect(result).toContain("AXTI (Phase 2, RS 85, Technology)");
    expect(result).toContain("XOM (Phase 2, RS 78, Energy)");
  });

  it("특이종목 없으면 '없음' 표기", () => {
    const emptyLog: DailyReportLog = {
      ...SAMPLE_LOG,
      reportedSymbols: [],
    };

    const result = formatPreviousReportContext(emptyLog);

    expect(result).toContain("- 없음");
  });
});
