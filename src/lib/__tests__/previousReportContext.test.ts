import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/reportLog", () => ({
  readPreviousDailyReport: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), step: vi.fn() },
}));

import { readPreviousDailyReport } from "@/lib/reportLog";
import {
  loadPreviousReportContext,
  formatPreviousReportContext,
  extractReserveStocks,
  formatSectorRsLines,
} from "../previousReportContext";
import type { DailyReportLog } from "@/types";

const mockReadPrevious = vi.mocked(readPreviousDailyReport);

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
    mockReadPrevious.mockResolvedValue(SAMPLE_LOG);

    const result = await loadPreviousReportContext("2026-03-23");

    expect(result).toContain("직전 리포트 요약 (2026-03-20)");
    expect(result).toContain("Phase 2 비율: 32.5%");
    expect(result).toContain("Energy, Healthcare");
    expect(result).toContain("AXTI");
    expect(result).toContain("XOM");
  });

  it("DB에 리포트가 없으면 빈 문자열 반환", async () => {
    mockReadPrevious.mockResolvedValue(null);

    const result = await loadPreviousReportContext("2026-03-23");

    expect(result).toBe("");
  });

  it("DB 오류 시 빈 문자열 반환 (fail-open)", async () => {
    mockReadPrevious.mockRejectedValue(new Error("connection refused"));

    const result = await loadPreviousReportContext("2026-03-23");

    expect(result).toBe("");
  });

  it("targetDate를 readPreviousDailyReport에 전달", async () => {
    mockReadPrevious.mockResolvedValue(null);

    await loadPreviousReportContext("2026-03-23");

    expect(mockReadPrevious).toHaveBeenCalledWith("2026-03-23");
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

  it("fullContent에 예비군 섹션이 있으면 예비군 종목 포함", () => {
    const logWithContent: DailyReportLog = {
      ...SAMPLE_LOG,
      fullContent: "🌱 주도주 예비군\n• EXE RS 45 Phase 1\n• CRNT RS 42 Phase 1\n\n⚠️ 약세 경고",
    };

    const result = formatPreviousReportContext(logWithContent);

    expect(result).toContain("직전 예비군 종목");
    expect(result).toContain("EXE");
    expect(result).toContain("CRNT");
  });

  it("fullContent 없으면 예비군 '없음' 표기", () => {
    const result = formatPreviousReportContext(SAMPLE_LOG);

    expect(result).toContain("직전 예비군 종목");
    expect(result).toMatch(/직전 예비군 종목[\s\S]*- 없음/);
  });
});

describe("extractReserveStocks", () => {
  it("🌱 섹션에서 티커 추출", () => {
    const content = "🌱 주도주 예비군\n• EXE RS 45 Phase 1\n• CRNT RS 42 Phase 1\n\n⚠️ 약세 경고";
    const result = extractReserveStocks(content);
    expect(result).toEqual(["EXE", "CRNT"]);
  });

  it("null 입력 시 빈 배열", () => {
    expect(extractReserveStocks(null)).toEqual([]);
  });

  it("빈 문자열 입력 시 빈 배열", () => {
    expect(extractReserveStocks("")).toEqual([]);
  });

  it("🌱 섹션 없으면 빈 배열", () => {
    const content = "⭐ 강세 종목\n• NVDA RS 90 Phase 2";
    expect(extractReserveStocks(content)).toEqual([]);
  });

  it("일반 키워드(RS, MA, Phase 등)는 제외", () => {
    const content = "🌱 주도주 예비군\n• IKT RS 50 Phase 1 MA150 양전환\n\n⚠️ 약세";
    const result = extractReserveStocks(content);
    expect(result).toEqual(["IKT"]);
    expect(result).not.toContain("RS");
    expect(result).not.toContain("Phase");
  });

  it("중복 티커는 한 번만 포함", () => {
    const content = "🌱 주도주 예비군\n• HLN RS 48 Phase 1\n• HLN 추가 설명\n\n⚠️ 약세";
    const result = extractReserveStocks(content);
    expect(result).toEqual(["HLN"]);
  });
});

describe("formatPreviousReportContext — fearGreedScore", () => {
  it("fearGreedScore가 있으면 공포탐욕지수 줄 포함", () => {
    const logWithFg: DailyReportLog = {
      ...SAMPLE_LOG,
      marketSummary: {
        ...SAMPLE_LOG.marketSummary,
        fearGreedScore: 14.5,
      },
    };

    const result = formatPreviousReportContext(logWithFg);

    expect(result).toContain("공포탐욕지수: 14.5");
  });

  it("fearGreedScore가 없으면 공포탐욕지수 줄 미포함", () => {
    const result = formatPreviousReportContext(SAMPLE_LOG);

    expect(result).not.toContain("공포탐욕지수");
  });
});

describe("formatPreviousReportContext — topSectorRs", () => {
  it("topSectorRs가 있으면 섹터 RS 상위 섹션 포함", () => {
    const logWithRs: DailyReportLog = {
      ...SAMPLE_LOG,
      marketSummary: {
        ...SAMPLE_LOG.marketSummary,
        topSectorRs: [
          { sector: "Energy", avgRs: 72.3 },
          { sector: "Healthcare", avgRs: 65.1 },
        ],
      },
    };

    const result = formatPreviousReportContext(logWithRs);

    expect(result).toContain("### 직전 섹터 RS 상위");
    expect(result).toContain("Energy (RS 72.3)");
    expect(result).toContain("Healthcare (RS 65.1)");
  });

  it("topSectorRs가 없으면 섹터 RS 상위 섹션 미포함", () => {
    const result = formatPreviousReportContext(SAMPLE_LOG);

    expect(result).not.toContain("직전 섹터 RS 상위");
  });

  it("topSectorRs가 빈 배열이면 섹터 RS 상위 섹션 미포함", () => {
    const logWithEmptyRs: DailyReportLog = {
      ...SAMPLE_LOG,
      marketSummary: {
        ...SAMPLE_LOG.marketSummary,
        topSectorRs: [],
      },
    };

    const result = formatPreviousReportContext(logWithEmptyRs);

    expect(result).not.toContain("직전 섹터 RS 상위");
  });
});

describe("formatSectorRsLines", () => {
  it("섹터 RS 목록을 마크다운 리스트로 변환", () => {
    const result = formatSectorRsLines([
      { sector: "Energy", avgRs: 72.3 },
      { sector: "Tech", avgRs: 65.0 },
    ]);

    expect(result).toBe("- Energy (RS 72.3)\n- Tech (RS 65)");
  });

  it("빈 배열이면 빈 문자열 반환", () => {
    expect(formatSectorRsLines([])).toBe("");
  });
});
