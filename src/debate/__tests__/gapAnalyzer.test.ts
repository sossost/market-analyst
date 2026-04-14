/**
 * gapAnalyzer.test.ts — 뉴스 사각지대 분석 단위 테스트
 *
 * parseGapResponse()와 buildGapPrompt()는 순수 함수 — 모킹 불필요.
 * callGapAnalysis(), saveGapResults(), analyzeGaps()는 외부 의존성 모킹.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  parseGapResponse,
  buildGapPrompt,
  callGapAnalysis,
  saveGapResults,
  analyzeGaps,
  hasGapAnalysisToday,
  type GapResult,
  type GapAnalyzerInput,
} from "../gapAnalyzer";

// ─── 모킹 ──────────────────────────────────────────────────────────────────

vi.mock("@/debate/llm/providerFactory.js", () => ({
  createProvider: vi.fn(() => ({
    call: vi.fn(),
  })),
}));

vi.mock("@/db/client", () => ({
  db: {
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        onConflictDoUpdate: vi.fn(() => Promise.resolve({ rowCount: 1 })),
      })),
    })),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(() => Promise.resolve([])),
          orderBy: vi.fn(() => Promise.resolve([])),
        })),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve({ rowCount: 1 })),
      })),
    })),
  },
  pool: {
    query: vi.fn(() => Promise.resolve({ rows: [] })),
  },
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// ─── 테스트 데이터 ────────────────────────────────────────────────────────

const validGaps: GapResult[] = [
  {
    theme: "PE/CLO 신용경색의 소프트웨어 섹터 영향",
    query: "private credit CLO software sector impact",
    rationale: "Software RS 33 바닥권이나 원인 뉴스 0건",
  },
  {
    theme: "리튬 공급과잉의 EV 밸류체인 영향",
    query: "lithium oversupply EV battery supply chain",
    rationale: "Energy 섹터 RS 급락 중이나 원자재 관련 뉴스 부재",
  },
  {
    theme: "일본 엔화 캐리트레이드 청산 위험",
    query: "Japan yen carry trade unwind risk 2026",
    rationale: "금융 스트레스 z=1.8 주의 신호이나 관련 뉴스 0건",
  },
];

const sampleInput: GapAnalyzerInput = {
  activeTheses: [
    "[macro] Fed 금리 동결 장기화로 크레딧 스프레드 확대",
    "[tech] AI 인프라 capex 사이클 피크아웃",
  ],
  creditAnomalies: [
    "HY 스프레드: z=1.82, 값=4.35",
    "금융 스트레스: z=1.55, 값=0.92",
  ],
  categoryDistribution: {
    POLICY: 15,
    TECHNOLOGY: 12,
    MARKET: 8,
    GEOPOLITICAL: 6,
    CREDIT: 3,
    OTHER: 2,
  },
  topSectors: [
    "Technology (RS=78, 4주변화=+5.2)",
    "Healthcare (RS=72, 4주변화=+3.1)",
  ],
  bottomSectors: [
    "Energy (RS=22, 4주변화=-8.3)",
    "Real Estate (RS=28, 4주변화=-4.1)",
  ],
};

// ─── parseGapResponse ──────────────────────────────────────────────

describe("parseGapResponse", () => {
  it("정상 JSON 배열 파싱", () => {
    const response = JSON.stringify(validGaps);
    const result = parseGapResponse(response);

    expect(result).toHaveLength(3);
    expect(result[0]).toEqual(validGaps[0]);
    expect(result[1]).toEqual(validGaps[1]);
    expect(result[2]).toEqual(validGaps[2]);
  });

  it("코드 펜스로 감싼 JSON 파싱", () => {
    const response = "```json\n" + JSON.stringify(validGaps) + "\n```";
    const result = parseGapResponse(response);

    expect(result).toHaveLength(3);
    expect(result[0]!.theme).toBe("PE/CLO 신용경색의 소프트웨어 섹터 영향");
  });

  it("앞뒤 텍스트가 있는 JSON 파싱", () => {
    const response = `Here are the gaps:\n${JSON.stringify(validGaps)}\n\nAnalysis complete.`;
    const result = parseGapResponse(response);

    expect(result).toHaveLength(3);
  });

  it("빈 배열 파싱", () => {
    const result = parseGapResponse("[]");
    expect(result).toHaveLength(0);
  });

  it("JSON이 없으면 빈 배열 반환", () => {
    const result = parseGapResponse("No gaps found.");
    expect(result).toHaveLength(0);
  });

  it("잘못된 JSON이면 빈 배열 반환", () => {
    const result = parseGapResponse("[{invalid}]");
    expect(result).toHaveLength(0);
  });

  it("배열이 아닌 JSON이면 빈 배열 반환", () => {
    const result = parseGapResponse('{"theme": "test"}');
    expect(result).toHaveLength(0);
  });

  it("5개 초과 시 5개로 제한", () => {
    const sixGaps = Array.from({ length: 6 }, (_, i) => ({
      theme: `테마 ${i + 1}`,
      query: `query ${i + 1}`,
      rationale: `근거 ${i + 1}`,
    }));

    const result = parseGapResponse(JSON.stringify(sixGaps));
    expect(result).toHaveLength(5);
  });

  it("필수 필드 누락 시 해당 항목만 필터링", () => {
    const mixed = [
      { theme: "유효", query: "valid", rationale: "ok" },
      { theme: "누락", query: "missing rationale" }, // rationale 누락
      { theme: "", query: "empty theme", rationale: "ok" }, // 빈 theme
      { theme: "두 번째 유효", query: "also valid", rationale: "fine" },
    ];

    const result = parseGapResponse(JSON.stringify(mixed));
    expect(result).toHaveLength(2);
    expect(result[0]!.theme).toBe("유효");
    expect(result[1]!.theme).toBe("두 번째 유효");
  });

  it("null 항목은 무시", () => {
    const withNulls = [null, validGaps[0], undefined, validGaps[1]];
    const result = parseGapResponse(JSON.stringify(withNulls));
    expect(result).toHaveLength(2);
  });
});

// ─── buildGapPrompt ──────────────────────────────────────────────

describe("buildGapPrompt", () => {
  it("모든 섹션이 포함된 프롬프트 생성", () => {
    const prompt = buildGapPrompt(sampleInput);

    expect(prompt).toContain("## (a) 현재 추적 중인 ACTIVE Thesis");
    expect(prompt).toContain("[macro] Fed 금리 동결 장기화");
    expect(prompt).toContain("## (b) 정량 이상 신호 (z-score ≥ 1.5)");
    expect(prompt).toContain("HY 스프레드: z=1.82");
    expect(prompt).toContain("## (c) 최근 24시간 뉴스 카테고리 분포");
    expect(prompt).toContain("POLICY: 15건");
    expect(prompt).toContain("## (d) RS 상위 5개 섹터");
    expect(prompt).toContain("Technology");
    expect(prompt).toContain("## (e) RS 하위 5개 섹터");
    expect(prompt).toContain("Energy");
  });

  it("빈 입력 시에도 기본 구조 유지", () => {
    const emptyInput: GapAnalyzerInput = {
      activeTheses: [],
      creditAnomalies: [],
      categoryDistribution: {},
      topSectors: [],
      bottomSectors: [],
    };

    const prompt = buildGapPrompt(emptyInput);

    expect(prompt).toContain("## (a) 현재 추적 중인 ACTIVE Thesis\n없음");
    expect(prompt).toContain("이상 신호 없음 (정상 범위)");
    expect(prompt).toContain("수집된 뉴스 없음");
  });

  it("카테고리 분포가 건수 내림차순으로 정렬", () => {
    const prompt = buildGapPrompt(sampleInput);

    const policyIdx = prompt.indexOf("POLICY: 15건");
    const techIdx = prompt.indexOf("TECHNOLOGY: 12건");
    const marketIdx = prompt.indexOf("MARKET: 8건");

    expect(policyIdx).toBeLessThan(techIdx);
    expect(techIdx).toBeLessThan(marketIdx);
  });
});

// ─── callGapAnalysis ──────────────────────────────────────────────

describe("callGapAnalysis", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("LLM 응답을 파싱하여 GapResult[] 반환", async () => {
    const { createProvider } = await import("@/debate/llm/providerFactory.js");
    const mockCall = vi.fn().mockResolvedValue({
      content: JSON.stringify(validGaps.slice(0, 2)),
      tokensUsed: { input: 500, output: 200 },
    });
    vi.mocked(createProvider).mockReturnValue({ call: mockCall });

    const result = await callGapAnalysis(sampleInput);

    expect(result).toHaveLength(2);
    expect(result[0]!.theme).toBe(validGaps[0]!.theme);
    expect(createProvider).toHaveBeenCalledWith("haiku");
    expect(mockCall).toHaveBeenCalledTimes(1);
  });
});

// ─── saveGapResults ──────────────────────────────────────────────

describe("saveGapResults", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("빈 결과 시 0 반환", async () => {
    const saved = await saveGapResults("2026-04-13", []);
    expect(saved).toBe(0);
  });

  it("결과를 DB에 저장하고 건수 반환", async () => {
    const { db } = await import("@/db/client");
    const mockOnConflict = vi.fn(() => Promise.resolve({ rowCount: 1 }));
    const mockValues = vi.fn(() => ({ onConflictDoUpdate: mockOnConflict }));
    vi.mocked(db.insert).mockReturnValue({ values: mockValues } as any);

    const saved = await saveGapResults("2026-04-13", validGaps);
    expect(saved).toBe(3);
    expect(vi.mocked(db.insert)).toHaveBeenCalledTimes(3);
  });
});

// ─── hasGapAnalysisToday ─────────────────────────────────────────

describe("hasGapAnalysisToday", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("결과가 있으면 true 반환", async () => {
    const { db } = await import("@/db/client");
    const mockLimit = vi.fn(() => Promise.resolve([{ id: 1 }]));
    const mockWhere = vi.fn(() => ({ limit: mockLimit }));
    const mockFrom = vi.fn(() => ({ where: mockWhere }));
    vi.mocked(db.select).mockReturnValue({ from: mockFrom } as any);

    const result = await hasGapAnalysisToday("2026-04-13");
    expect(result).toBe(true);
  });

  it("결과가 없으면 false 반환", async () => {
    const { db } = await import("@/db/client");
    const mockLimit = vi.fn(() => Promise.resolve([]));
    const mockWhere = vi.fn(() => ({ limit: mockLimit }));
    const mockFrom = vi.fn(() => ({ where: mockWhere }));
    vi.mocked(db.select).mockReturnValue({ from: mockFrom } as any);

    const result = await hasGapAnalysisToday("2026-04-13");
    expect(result).toBe(false);
  });
});

// ─── analyzeGaps ─────────────────────────────────────────────────

describe("analyzeGaps", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("이미 분석 완료된 날짜면 빈 배열 반환", async () => {
    const { db } = await import("@/db/client");
    const mockLimit = vi.fn(() => Promise.resolve([{ id: 1 }]));
    const mockWhere = vi.fn(() => ({ limit: mockLimit }));
    const mockFrom = vi.fn(() => ({ where: mockWhere }));
    vi.mocked(db.select).mockReturnValue({ from: mockFrom } as any);

    const result = await analyzeGaps("2026-04-13");
    expect(result).toHaveLength(0);
  });
});
