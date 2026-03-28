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
  extractKeyInsights,
  extractBullBearClassification,
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

describe("extractBullBearClassification", () => {
  it("🔥 섹션에서 강세 종목 추출", () => {
    const content = "🔥 강세 특이종목\n• NVDA RS 90 Phase 2 +8.5%\n• AAPL RS 80 Phase 2 +5.2%\n\n⚠️ 약세 경고";
    const result = extractBullBearClassification(content);
    expect(result.bullish).toContain("NVDA");
    expect(result.bullish).toContain("AAPL");
  });

  it("⚠️ 섹션에서 약세 종목 추출", () => {
    const content = "🔥 강세 특이종목\n• NVDA +8.5%\n\n⚠️ 약세 경고\n• UGRO RS 45 Phase 2 -22.84%\n• AXTI RS 60 Phase 1 -13.13%\n\n🌱 주도주 예비군";
    const result = extractBullBearClassification(content);
    expect(result.bearish).toContain("UGRO");
    expect(result.bearish).toContain("AXTI");
    expect(result.bearish).not.toContain("NVDA");
  });

  it("강세/약세 섹션 모두 없으면 빈 배열", () => {
    const content = "📊 시장 일일 브리핑\n일반 텍스트만 있는 리포트";
    const result = extractBullBearClassification(content);
    expect(result.bullish).toEqual([]);
    expect(result.bearish).toEqual([]);
  });

  it("null 입력 시 빈 배열", () => {
    const result = extractBullBearClassification(null);
    expect(result.bullish).toEqual([]);
    expect(result.bearish).toEqual([]);
  });

  it("빈 문자열 입력 시 빈 배열", () => {
    const result = extractBullBearClassification("");
    expect(result.bullish).toEqual([]);
    expect(result.bearish).toEqual([]);
  });

  it("일반 키워드(RS, Phase 등)는 제외", () => {
    const content = "🔥 강세 특이종목\n• TSLA RS 85 Phase 2 MA150\n\n⚠️ 약세";
    const result = extractBullBearClassification(content);
    expect(result.bullish).toEqual(["TSLA"]);
    expect(result.bullish).not.toContain("RS");
    expect(result.bullish).not.toContain("Phase");
  });

  it("⭐ 섹션도 강세로 분류", () => {
    const content = "⭐ 매수 후보\n• MSFT RS 88 Phase 2\n\n⚠️ 약세";
    const result = extractBullBearClassification(content);
    expect(result.bullish).toContain("MSFT");
  });
});

describe("formatPreviousReportContext — bull/bear classification", () => {
  it("fullContent에 강세/약세 분류가 있으면 태그 포함", () => {
    const logWithContent: DailyReportLog = {
      ...SAMPLE_LOG,
      fullContent: "🔥 강세 특이종목\n• AXTI RS 85 Phase 2 +10%\n\n⚠️ 약세 경고\n• XOM RS 78 Phase 2 -5%\n\n🌱 예비군",
    };

    const result = formatPreviousReportContext(logWithContent);

    expect(result).toContain("AXTI (Phase 2, RS 85, Technology) [강세]");
    expect(result).toContain("XOM (Phase 2, RS 78, Energy) [약세]");
  });

  it("fullContent가 없으면 태그 없이 기존 형식 유지", () => {
    const result = formatPreviousReportContext(SAMPLE_LOG);

    expect(result).toContain("AXTI (Phase 2, RS 85, Technology)");
    expect(result).not.toContain("[강세]");
    expect(result).not.toContain("[약세]");
  });
});

describe("formatPreviousReportContext — fearGreedScore emphasis", () => {
  it("fearGreedScore가 있으면 '전일 확정값' 강조 포함", () => {
    const logWithFg: DailyReportLog = {
      ...SAMPLE_LOG,
      marketSummary: {
        ...SAMPLE_LOG.marketSummary,
        fearGreedScore: 18.2,
      },
    };

    const result = formatPreviousReportContext(logWithFg);

    expect(result).toContain("전일 확정값");
    expect(result).toContain("18.2");
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

    expect(result).toContain("공포탐욕지수 (전일 확정값): 14.5");
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

describe("extractKeyInsights", () => {
  it("💡 인사이트 섹션에서 내용 추출", () => {
    const content = "💡 오늘의 인사이트\nFinancial Services 72건 Phase 1→2 전환 — 차기 주도섹터 전환 초입 신호\nAI 인프라 투자 사이클 2분기 연속 확대\n\n⚠️ 약세 경고";
    const result = extractKeyInsights(content);
    expect(result).toHaveLength(2);
    expect(result[0]).toContain("Financial Services");
    expect(result[1]).toContain("AI 인프라");
  });

  it("null 입력 시 빈 배열", () => {
    expect(extractKeyInsights(null)).toEqual([]);
  });

  it("빈 문자열 입력 시 빈 배열", () => {
    expect(extractKeyInsights("")).toEqual([]);
  });

  it("💡 섹션 없으면 빈 배열", () => {
    const content = "⭐ 강세 종목\n• NVDA RS 90 Phase 2";
    expect(extractKeyInsights(content)).toEqual([]);
  });

  it("짧은 줄(10자 이하)과 구분선은 제외", () => {
    const content = "💡 오늘의 인사이트\n---\n짧은\nFinancial Services Phase 1→2 전환 — 핵심 시그널\n\n⚠️ 약세";
    const result = extractKeyInsights(content);
    expect(result).toHaveLength(1);
    expect(result[0]).toContain("Financial Services");
  });

  it("## 헤더로 끝나는 섹션에서도 추출", () => {
    const content = "💡 오늘의 인사이트\nEnergy 섹터 지정학 리스크 기반 RS 상승\n\n## 시장 흐름 및 종합 전망";
    const result = extractKeyInsights(content);
    expect(result).toHaveLength(1);
    expect(result[0]).toContain("Energy");
  });
});

describe("formatPreviousReportContext — keyInsights", () => {
  it("fullContent에 인사이트 섹션이 있으면 핵심 인사이트 블록 포함", () => {
    const logWithInsights: DailyReportLog = {
      ...SAMPLE_LOG,
      fullContent: "💡 오늘의 인사이트\nFinancial Services 72건 Phase 1→2 전환 — 차기 주도섹터 전환 초입 신호\n\n⚠️ 약세 경고",
    };

    const result = formatPreviousReportContext(logWithInsights);

    expect(result).toContain("### 직전 핵심 인사이트 (후속 추적 필수)");
    expect(result).toContain("Financial Services");
  });

  it("fullContent에 인사이트 섹션이 없으면 핵심 인사이트 블록 미포함", () => {
    const result = formatPreviousReportContext(SAMPLE_LOG);

    expect(result).not.toContain("직전 핵심 인사이트");
  });

  it("fullContent가 없으면 핵심 인사이트 블록 미포함", () => {
    const logNoContent: DailyReportLog = {
      ...SAMPLE_LOG,
      fullContent: undefined,
    };

    const result = formatPreviousReportContext(logNoContent);

    expect(result).not.toContain("직전 핵심 인사이트");
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
