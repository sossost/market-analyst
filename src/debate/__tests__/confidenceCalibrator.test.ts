import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── DB 모킹 ─────────────────────────────────────────────────────────────────

const mockSelect = vi.fn();
const mockFrom = vi.fn();
const mockWhere = vi.fn();
const mockGroupBy = vi.fn();

vi.mock("@/db/client", () => ({
  db: {
    select: (...args: unknown[]) => {
      mockSelect(...args);
      return {
        from: (...a: unknown[]) => {
          mockFrom(...a);
          return {
            where: (...b: unknown[]) => {
              mockWhere(...b);
              return {
                groupBy: mockGroupBy,
              };
            },
          };
        },
      };
    },
  },
}));

vi.mock("drizzle-orm", () => ({
  sql: (str: unknown) => str,
  eq: (col: unknown, val: unknown) => ({ col, val }),
  and: (...args: unknown[]) => args,
  inArray: (col: unknown, vals: unknown) => ({ col, vals }),
}));

vi.mock("@/db/schema/analyst", () => ({
  theses: {
    confidence: "confidence",
    status: "status",
    agentPersona: "agent_persona",
    category: "category",
  },
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// ─── 모킹 후 대상 모듈 import ─────────────────────────────────────────────────

import {
  calcCalibrationBins,
  calcCalibrationBinsForPersona,
  buildBinsFromRows,
  calcECE,
  getCalibrationResult,
  getCalibrationResultForPersona,
  buildPerAgentCalibrationContexts,
  formatCalibrationForPrompt,
  generateFeedback,
  formatRecentFailuresForPrompt,
  formatModeratorPerformanceContext,
  formatCategoryHitRateContext,
  formatPersonaCategoryHitRates,
  type CalibrationBin,
  type CalibrationResult,
  type InvalidatedThesisRow,
  type PersonaHitRate,
  type CategoryHitRate,
  type PersonaCategoryHitRate,
} from "../confidenceCalibrator.js";

// ─── 헬퍼 ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

function makeBin(overrides: Partial<CalibrationBin> & Pick<CalibrationBin, "confidence">): CalibrationBin {
  const defaults: Record<string, CalibrationBin> = {
    low: { confidence: "low", expectedRate: 0.4, actualRate: null, confirmed: 0, invalidated: 0, total: 0, gap: null },
    medium: { confidence: "medium", expectedRate: 0.6, actualRate: null, confirmed: 0, invalidated: 0, total: 0, gap: null },
    high: { confidence: "high", expectedRate: 0.8, actualRate: null, confirmed: 0, invalidated: 0, total: 0, gap: null },
  };
  return { ...defaults[overrides.confidence], ...overrides };
}

// ─── buildBinsFromRows ──────────────────────────────────────────────────────

describe("buildBinsFromRows", () => {
  it("모든 confidence 레벨을 포함한다 (데이터 없는 레벨도)", () => {
    const bins = buildBinsFromRows([]);
    expect(bins).toHaveLength(3);
    expect(bins.map((b) => b.confidence)).toEqual(["low", "medium", "high"]);
  });

  it("적중률과 gap을 올바르게 계산한다", () => {
    const bins = buildBinsFromRows([
      { confidence: "high", confirmed: 6, invalidated: 4 },
      { confidence: "medium", confirmed: 3, invalidated: 7 },
    ]);

    const high = bins.find((b) => b.confidence === "high")!;
    expect(high.total).toBe(10);
    expect(high.actualRate).toBe(0.6); // 6/10
    expect(high.gap).toBeCloseTo(0.2); // 0.8 - 0.6 = 과신 +0.2

    const medium = bins.find((b) => b.confidence === "medium")!;
    expect(medium.actualRate).toBe(0.3); // 3/10
    expect(medium.gap).toBeCloseTo(0.3); // 0.6 - 0.3 = 과신 +0.3
  });

  it("데이터 없는 레벨은 actualRate=null, gap=null", () => {
    const bins = buildBinsFromRows([
      { confidence: "high", confirmed: 5, invalidated: 5 },
    ]);

    const low = bins.find((b) => b.confidence === "low")!;
    expect(low.actualRate).toBeNull();
    expect(low.gap).toBeNull();
    expect(low.total).toBe(0);
  });
});

// ─── calcECE ────────────────────────────────────────────────────────────────

describe("calcECE", () => {
  it("가중 평균 절대 오차를 산출한다", () => {
    const bins: CalibrationBin[] = [
      makeBin({ confidence: "low", expectedRate: 0.4, actualRate: 0.5, total: 10, gap: -0.1 }),
      makeBin({ confidence: "medium", expectedRate: 0.6, actualRate: 0.4, total: 20, gap: 0.2 }),
      makeBin({ confidence: "high", expectedRate: 0.8, actualRate: 0.6, total: 10, gap: 0.2 }),
    ];

    // ECE = (10/40)*|0.4-0.5| + (20/40)*|0.6-0.4| + (10/40)*|0.8-0.6|
    //      = 0.25*0.1 + 0.5*0.2 + 0.25*0.2
    //      = 0.025 + 0.1 + 0.05 = 0.175
    const ece = calcECE(bins);
    expect(ece).toBe(0.175);
  });

  it("데이터 없으면 null 반환", () => {
    const bins: CalibrationBin[] = [
      makeBin({ confidence: "low" }),
      makeBin({ confidence: "medium" }),
      makeBin({ confidence: "high" }),
    ];
    expect(calcECE(bins)).toBeNull();
  });

  it("일부 빈만 데이터 있어도 계산 가능", () => {
    const bins: CalibrationBin[] = [
      makeBin({ confidence: "low" }), // no data
      makeBin({ confidence: "medium", expectedRate: 0.6, actualRate: 0.6, total: 10, gap: 0 }),
      makeBin({ confidence: "high", expectedRate: 0.8, actualRate: 0.8, total: 10, gap: 0 }),
    ];

    // 완벽히 캘리브레이션된 경우 ECE = 0
    expect(calcECE(bins)).toBe(0);
  });
});

// ─── calcCalibrationBins (DB 연동) ──────────────────────────────────────────

describe("calcCalibrationBins", () => {
  it("DB 결과를 CalibrationBin으로 변환한다", async () => {
    mockGroupBy.mockResolvedValueOnce([
      { confidence: "high", confirmed: 8, invalidated: 2 },
      { confidence: "medium", confirmed: 5, invalidated: 5 },
      { confidence: "low", confirmed: 2, invalidated: 3 },
    ]);

    const bins = await calcCalibrationBins();

    expect(bins).toHaveLength(3);

    const high = bins.find((b) => b.confidence === "high")!;
    expect(high.actualRate).toBe(0.8);
    expect(high.gap).toBeCloseTo(0); // 0.8 - 0.8 = 완벽 캘리브레이션

    const low = bins.find((b) => b.confidence === "low")!;
    expect(low.actualRate).toBe(0.4);
    expect(low.gap).toBeCloseTo(0); // 0.4 - 0.4 = 완벽 캘리브레이션
  });

  it("빈 결과 시 모든 레벨이 0건으로 반환", async () => {
    mockGroupBy.mockResolvedValueOnce([]);

    const bins = await calcCalibrationBins();

    expect(bins).toHaveLength(3);
    expect(bins.every((b) => b.total === 0)).toBe(true);
  });
});

// ─── getCalibrationResult ───────────────────────────────────────────────────

describe("getCalibrationResult", () => {
  it("충분한 데이터가 있으면 hasSufficientData=true", async () => {
    mockGroupBy.mockResolvedValueOnce([
      { confidence: "high", confirmed: 10, invalidated: 5 },
      { confidence: "medium", confirmed: 4, invalidated: 6 },
    ]);

    const result = await getCalibrationResult();

    expect(result.totalResolved).toBe(25);
    expect(result.hasSufficientData).toBe(true);
    expect(result.ece).not.toBeNull();
  });

  it("20건 미만이면 hasSufficientData=false", async () => {
    mockGroupBy.mockResolvedValueOnce([
      { confidence: "high", confirmed: 3, invalidated: 1 },
    ]);

    const result = await getCalibrationResult();

    expect(result.totalResolved).toBe(4);
    expect(result.hasSufficientData).toBe(false);
  });
});

// ─── generateFeedback ───────────────────────────────────────────────────────

describe("generateFeedback", () => {
  it("과신 구간에 대해 경고를 생성한다", () => {
    const bins: CalibrationBin[] = [
      makeBin({ confidence: "high", expectedRate: 0.8, actualRate: 0.5, total: 10, gap: 0.3 }),
    ];

    const feedback = generateFeedback(bins);

    expect(feedback).toHaveLength(1);
    expect(feedback[0]).toContain("HIGH 과신 경고");
    expect(feedback[0]).toContain("50%");
  });

  it("과소확신 구간에 대해 피드백을 생성한다", () => {
    const bins: CalibrationBin[] = [
      makeBin({ confidence: "low", expectedRate: 0.4, actualRate: 0.7, total: 10, gap: -0.3 }),
    ];

    const feedback = generateFeedback(bins);

    expect(feedback).toHaveLength(1);
    expect(feedback[0]).toContain("LOW 과소확신");
  });

  it("gap 10%p 이내면 피드백 없음", () => {
    const bins: CalibrationBin[] = [
      makeBin({ confidence: "high", expectedRate: 0.8, actualRate: 0.75, total: 10, gap: 0.05 }),
    ];

    expect(generateFeedback(bins)).toHaveLength(0);
  });

  it("데이터 3건 미만이면 피드백 생략", () => {
    const bins: CalibrationBin[] = [
      makeBin({ confidence: "high", expectedRate: 0.8, actualRate: 0.2, total: 2, gap: 0.6 }),
    ];

    expect(generateFeedback(bins)).toHaveLength(0);
  });
});

// ─── formatCalibrationForPrompt ─────────────────────────────────────────────

describe("formatCalibrationForPrompt", () => {
  const makeResult = (overrides?: Partial<CalibrationResult>): CalibrationResult => ({
    bins: [
      makeBin({ confidence: "low", expectedRate: 0.4, actualRate: 0.5, confirmed: 5, invalidated: 5, total: 10, gap: -0.1 }),
      makeBin({ confidence: "medium", expectedRate: 0.6, actualRate: 0.4, confirmed: 4, invalidated: 6, total: 10, gap: 0.2 }),
      makeBin({ confidence: "high", expectedRate: 0.8, actualRate: 0.6, confirmed: 6, invalidated: 4, total: 10, gap: 0.2 }),
    ],
    ece: 0.17,
    totalResolved: 30,
    hasSufficientData: true,
    ...overrides,
  });

  it("데이터 부족 시 빈 문자열 반환", () => {
    const result = makeResult({ hasSufficientData: false });
    expect(formatCalibrationForPrompt(result)).toBe("");
  });

  it("헤더와 캘리브레이션 테이블을 포함한다", () => {
    const output = formatCalibrationForPrompt(makeResult());
    expect(output).toContain("## Thesis Confidence 캘리브레이션");
    expect(output).toContain("전체 적중률");
    expect(output).toContain("50%"); // 15/30
    expect(output).toContain("ECE");
    expect(output).toContain("17.0%");
    expect(output).toContain("보정 필요");
    expect(output).toContain("HIGH");
    expect(output).toContain("MED");
    expect(output).toContain("LOW");
  });

  it("ECE < 0.1이면 '양호' 표시", () => {
    const output = formatCalibrationForPrompt(makeResult({ ece: 0.05 }));
    expect(output).toContain("양호");
  });

  it("ECE < 0.15이면 '보통' 표시", () => {
    const output = formatCalibrationForPrompt(makeResult({ ece: 0.12 }));
    expect(output).toContain("보통");
  });

  it("과신 구간에 대한 보정 지침을 포함한다", () => {
    const output = formatCalibrationForPrompt(makeResult());
    expect(output).toContain("보정 지침");
    expect(output).toContain("과신 경고");
  });

  it("완벽 캘리브레이션 시 보정 지침 없음", () => {
    const perfectResult = makeResult({
      bins: [
        makeBin({ confidence: "low", expectedRate: 0.4, actualRate: 0.4, confirmed: 4, invalidated: 6, total: 10, gap: 0 }),
        makeBin({ confidence: "medium", expectedRate: 0.6, actualRate: 0.6, confirmed: 6, invalidated: 4, total: 10, gap: 0 }),
        makeBin({ confidence: "high", expectedRate: 0.8, actualRate: 0.8, confirmed: 8, invalidated: 2, total: 10, gap: 0 }),
      ],
      ece: 0,
    });
    const output = formatCalibrationForPrompt(perfectResult);
    expect(output).not.toContain("보정 지침");
  });
});

// ─── calcCalibrationBinsForPersona ──────────────────────────────────────────

describe("calcCalibrationBinsForPersona", () => {
  it("특정 에이전트의 CalibrationBin을 반환한다", async () => {
    mockGroupBy.mockResolvedValueOnce([
      { confidence: "high", confirmed: 1, invalidated: 0 },
      { confidence: "medium", confirmed: 1, invalidated: 3 },
    ]);

    const bins = await calcCalibrationBinsForPersona("geopolitics");

    expect(bins).toHaveLength(3);

    const medium = bins.find((b) => b.confidence === "medium")!;
    expect(medium.confirmed).toBe(1);
    expect(medium.invalidated).toBe(3);
    expect(medium.actualRate).toBe(0.25); // 1/4
    expect(medium.gap).toBeCloseTo(0.35); // 0.6 - 0.25 = 과신
  });

  it("빈 결과 시 모든 레벨이 0건으로 반환", async () => {
    mockGroupBy.mockResolvedValueOnce([]);

    const bins = await calcCalibrationBinsForPersona("macro");

    expect(bins).toHaveLength(3);
    expect(bins.every((b) => b.total === 0)).toBe(true);
  });
});

// ─── getCalibrationResultForPersona ─────────────────────────────────────────

describe("getCalibrationResultForPersona", () => {
  it("5건 이상이면 hasSufficientData=true (per-agent 기준)", async () => {
    mockGroupBy.mockResolvedValueOnce([
      { confidence: "high", confirmed: 1, invalidated: 0 },
      { confidence: "medium", confirmed: 1, invalidated: 3 },
    ]);

    const result = await getCalibrationResultForPersona("geopolitics");

    expect(result.totalResolved).toBe(5);
    expect(result.hasSufficientData).toBe(true);
    expect(result.ece).not.toBeNull();
  });

  it("5건 미만이면 hasSufficientData=false", async () => {
    mockGroupBy.mockResolvedValueOnce([
      { confidence: "high", confirmed: 1, invalidated: 1 },
    ]);

    const result = await getCalibrationResultForPersona("tech");

    expect(result.totalResolved).toBe(2);
    expect(result.hasSufficientData).toBe(false);
  });
});

// ─── buildPerAgentCalibrationContexts ───────────────────────────────────────

describe("buildPerAgentCalibrationContexts", () => {
  it("충분한 데이터가 있는 에이전트만 컨텍스트를 포함한다", async () => {
    // EXPERT_PERSONAS 순서: ["macro", "tech", "geopolitics", "sentiment"]
    // macro: 3건 (insufficient, < 5)
    mockGroupBy.mockResolvedValueOnce([
      { confidence: "high", confirmed: 3, invalidated: 0 },
    ]);
    // tech: 10건 (sufficient)
    mockGroupBy.mockResolvedValueOnce([
      { confidence: "medium", confirmed: 6, invalidated: 4 },
    ]);
    // geopolitics: 0건 (insufficient)
    mockGroupBy.mockResolvedValueOnce([]);
    // sentiment: 8건 (sufficient)
    mockGroupBy.mockResolvedValueOnce([
      { confidence: "medium", confirmed: 4, invalidated: 4 },
    ]);

    const contexts = await buildPerAgentCalibrationContexts();

    // tech(10건), sentiment(8건) — sufficient → 컨텍스트 포함
    expect("tech" in contexts).toBe(true);
    expect("sentiment" in contexts).toBe(true);
    // macro(3건), geopolitics(0건) — insufficient → 제외
    expect("macro" in contexts).toBe(false);
    expect("geopolitics" in contexts).toBe(false);
  });

  it("모든 에이전트 데이터 부족 시 빈 객체 반환", async () => {
    mockGroupBy.mockResolvedValue([]);

    const contexts = await buildPerAgentCalibrationContexts();

    expect(Object.keys(contexts)).toHaveLength(0);
  });
});

// ─── formatRecentFailuresForPrompt ──────────────────────────────────────────

describe("formatRecentFailuresForPrompt", () => {
  it("빈 배열이면 빈 문자열 반환", () => {
    expect(formatRecentFailuresForPrompt([])).toBe("");
  });

  it("INVALIDATED thesis를 마크다운으로 포매팅한다", () => {
    const failures: InvalidatedThesisRow[] = [
      {
        thesis: "Energy XLE RS 60일 내 60선 하회",
        verificationMetric: "Energy RS",
        targetCondition: "Energy RS < 60",
        debateDate: "2025-03-10",
      },
      {
        thesis: "Basic Materials RS 90일 내 70+ 돌파",
        verificationMetric: "Basic Materials RS",
        targetCondition: "Basic Materials RS > 70",
        debateDate: "2025-02-15",
      },
    ];

    const output = formatRecentFailuresForPrompt(failures);

    expect(output).toContain("최근 INVALIDATED");
    expect(output).toContain("기각된");
    expect(output).toContain("동일 섹터·동일 방향의 예측을 반복하지 마세요");
    expect(output).toContain("Energy XLE RS 60일 내 60선 하회");
    expect(output).toContain("2025-03-10");
    expect(output).toContain("Basic Materials RS");
    expect(output).toContain("INVALIDATED");
  });

  it("각 실패 thesis에 날짜와 검증 조건을 포함한다", () => {
    const failures: InvalidatedThesisRow[] = [
      {
        thesis: "Test thesis",
        verificationMetric: "Technology RS",
        targetCondition: "Technology RS > 70",
        debateDate: "2025-03-20",
      },
    ];

    const output = formatRecentFailuresForPrompt(failures);

    expect(output).toContain("[2025-03-20]");
    expect(output).toContain("Technology RS > 70");
  });
});

// ─── formatModeratorPerformanceContext ───────────────────────────────────────

describe("formatModeratorPerformanceContext", () => {
  it("빈 배열이면 빈 문자열 반환", () => {
    expect(formatModeratorPerformanceContext([])).toBe("");
  });

  it("에이전트별 적중률 테이블을 생성한다", () => {
    const hitRates: PersonaHitRate[] = [
      { persona: "macro", confirmed: 3, invalidated: 0, expired: 0, hitRate: 1.0 },
      { persona: "tech", confirmed: 2, invalidated: 1, expired: 0, hitRate: 0.67 },
      { persona: "sentiment", confirmed: 4, invalidated: 4, expired: 0, hitRate: 0.5 },
      { persona: "geopolitics", confirmed: 2, invalidated: 3, expired: 0, hitRate: 0.4 },
    ];

    const output = formatModeratorPerformanceContext(hitRates);

    expect(output).toContain("에이전트별 Thesis 적중률");
    expect(output).toContain("적중률이 높은 분석가의 의견에 더 큰 비중");
    expect(output).toContain("50% 미만 분석가의 단독 의견");
    expect(output).toContain("매크로 이코노미스트");
    expect(output).toContain("지정학 전략가");
    expect(output).toContain("EXPIRED");
    expect(output).toContain("만료");
    expect(output).toContain("100%");
    expect(output).toContain("40%");
  });

  it("적중률 내림차순으로 정렬한다", () => {
    const hitRates: PersonaHitRate[] = [
      { persona: "geopolitics", confirmed: 2, invalidated: 3, expired: 0, hitRate: 0.4 },
      { persona: "macro", confirmed: 3, invalidated: 0, expired: 0, hitRate: 1.0 },
    ];

    const output = formatModeratorPerformanceContext(hitRates);

    const macroIdx = output.indexOf("매크로 이코노미스트");
    const geoIdx = output.indexOf("지정학 전략가");
    expect(macroIdx).toBeLessThan(geoIdx);
  });

  it("적중률 50% 미만은 저신뢰로 표시한다", () => {
    const hitRates: PersonaHitRate[] = [
      { persona: "geopolitics", confirmed: 2, invalidated: 3, expired: 0, hitRate: 0.4 },
    ];

    const output = formatModeratorPerformanceContext(hitRates);

    expect(output).toContain("⚠️ 저신뢰");
  });

  it("3건 미만은 데이터 부족으로 표시한다", () => {
    const hitRates: PersonaHitRate[] = [
      { persona: "macro", confirmed: 1, invalidated: 0, expired: 0, hitRate: 1.0 },
    ];

    const output = formatModeratorPerformanceContext(hitRates);

    expect(output).toContain("데이터 부족");
  });

  it("3건 이상 + 50% 이상은 정상으로 표시한다", () => {
    const hitRates: PersonaHitRate[] = [
      { persona: "tech", confirmed: 4, invalidated: 2, expired: 0, hitRate: 0.67 },
    ];

    const output = formatModeratorPerformanceContext(hitRates);

    expect(output).toContain("정상");
  });

  it("EXPIRED를 만료 컬럼에 표시한다", () => {
    const hitRates: PersonaHitRate[] = [
      { persona: "macro", confirmed: 3, invalidated: 2, expired: 1, hitRate: 0.5 },
    ];

    const output = formatModeratorPerformanceContext(hitRates);

    expect(output).toContain("만료");
    expect(output).toContain("| 1 |");
  });
});

// ─── formatCategoryHitRateContext ─────────────────────────────────────────────

describe("formatCategoryHitRateContext", () => {
  it("빈 배열이면 빈 문자열 반환", () => {
    expect(formatCategoryHitRateContext([])).toBe("");
  });

  it("카테고리별 적중률 테이블을 생성한다", () => {
    const hitRates: CategoryHitRate[] = [
      { category: "structural_narrative", confirmed: 6, invalidated: 1, expired: 0, hitRate: 0.857 },
      { category: "sector_rotation", confirmed: 3, invalidated: 2, expired: 0, hitRate: 0.6 },
      { category: "short_term_outlook", confirmed: 8, invalidated: 9, expired: 0, hitRate: 0.471 },
    ];

    const output = formatCategoryHitRateContext(hitRates);

    expect(output).toContain("카테고리별 Thesis 적중률");
    expect(output).toContain("구조적 서사");
    expect(output).toContain("섹터 로테이션");
    expect(output).toContain("단기 전망");
    expect(output).toContain("만료");
    expect(output).toContain("86%"); // structural_narrative
    expect(output).toContain("47%"); // short_term_outlook
  });

  it("적중률 55% 미만 카테고리에 저적중 경고를 포함한다", () => {
    const hitRates: CategoryHitRate[] = [
      { category: "structural_narrative", confirmed: 6, invalidated: 1, expired: 0, hitRate: 0.857 },
      { category: "short_term_outlook", confirmed: 8, invalidated: 9, expired: 0, hitRate: 0.471 },
    ];

    const output = formatCategoryHitRateContext(hitRates);

    expect(output).toContain("⚠️ 저신뢰");
    expect(output).toContain("저적중 카테고리 경고");
    expect(output).toContain("단기 전망");
    expect(output).toContain("조건부(if-then) 형식");
    expect(output).toContain("confidence를 한 단계 낮춰");
  });

  it("모든 카테고리가 55% 이상이면 경고 없음", () => {
    const hitRates: CategoryHitRate[] = [
      { category: "structural_narrative", confirmed: 6, invalidated: 1, expired: 0, hitRate: 0.857 },
      { category: "sector_rotation", confirmed: 4, invalidated: 2, expired: 0, hitRate: 0.667 },
      { category: "short_term_outlook", confirmed: 7, invalidated: 5, expired: 0, hitRate: 0.583 },
    ];

    const output = formatCategoryHitRateContext(hitRates);

    expect(output).not.toContain("저적중 카테고리 경고");
  });

  it("3건 미만 카테고리는 데이터 부족으로 표시한다", () => {
    const hitRates: CategoryHitRate[] = [
      { category: "structural_narrative", confirmed: 1, invalidated: 0, expired: 0, hitRate: 1.0 },
    ];

    const output = formatCategoryHitRateContext(hitRates);

    expect(output).toContain("데이터 부족");
  });

  it("적중률 내림차순으로 정렬한다", () => {
    const hitRates: CategoryHitRate[] = [
      { category: "short_term_outlook", confirmed: 5, invalidated: 5, expired: 0, hitRate: 0.5 },
      { category: "structural_narrative", confirmed: 8, invalidated: 2, expired: 0, hitRate: 0.8 },
    ];

    const output = formatCategoryHitRateContext(hitRates);

    const structIdx = output.indexOf("구조적 서사");
    const shortIdx = output.indexOf("단기 전망");
    expect(structIdx).toBeLessThan(shortIdx);
  });

  it("EXPIRED를 만료 컬럼에 표시한다", () => {
    const hitRates: CategoryHitRate[] = [
      { category: "short_term_outlook", confirmed: 9, invalidated: 14, expired: 9, hitRate: 0.281 },
    ];

    const output = formatCategoryHitRateContext(hitRates);

    expect(output).toContain("만료");
    expect(output).toContain("| 9 |");
    expect(output).toContain("28%");
  });
});

// ─── formatPersonaCategoryHitRates ──────────────────────────────────────────

describe("formatPersonaCategoryHitRates", () => {
  it("빈 배열이면 빈 문자열 반환", () => {
    expect(formatPersonaCategoryHitRates([])).toBe("");
  });

  it("3건 미만 항목은 필터링한다", () => {
    const rates: PersonaCategoryHitRate[] = [
      { persona: "sentiment", category: "short_term_outlook", confirmed: 1, invalidated: 1, expired: 0, hitRate: 0.5 },
    ];

    expect(formatPersonaCategoryHitRates(rates)).toBe("");
  });

  it("카테고리별 적중률 테이블을 생성한다", () => {
    const rates: PersonaCategoryHitRate[] = [
      { persona: "sentiment", category: "short_term_outlook", confirmed: 3, invalidated: 5, expired: 0, hitRate: 0.375 },
      { persona: "sentiment", category: "structural_narrative", confirmed: 4, invalidated: 1, expired: 0, hitRate: 0.8 },
    ];

    const output = formatPersonaCategoryHitRates(rates);

    expect(output).toContain("카테고리별 적중률");
    expect(output).toContain("단기 전망");
    expect(output).toContain("구조적 서사");
    expect(output).toContain("만료");
    expect(output).toContain("38%"); // short_term_outlook
    expect(output).toContain("80%"); // structural_narrative
  });

  it("55% 미만 카테고리에 경고를 포함한다", () => {
    const rates: PersonaCategoryHitRate[] = [
      { persona: "geopolitics", category: "short_term_outlook", confirmed: 3, invalidated: 4, expired: 0, hitRate: 0.429 },
    ];

    const output = formatPersonaCategoryHitRates(rates);

    expect(output).toContain("⚠️");
    expect(output).toContain("방향성 예측을 자제");
    expect(output).toContain("조건부 형식");
  });

  it("모든 카테고리가 55% 이상이면 경고 없음", () => {
    const rates: PersonaCategoryHitRate[] = [
      { persona: "tech", category: "structural_narrative", confirmed: 5, invalidated: 1, expired: 0, hitRate: 0.833 },
    ];

    const output = formatPersonaCategoryHitRates(rates);

    expect(output).not.toContain("⚠️");
  });

  it("EXPIRED 포함 시 3건 이상이면 유효 데이터로 처리한다", () => {
    const rates: PersonaCategoryHitRate[] = [
      { persona: "macro", category: "short_term_outlook", confirmed: 1, invalidated: 0, expired: 2, hitRate: 0.333 },
    ];

    const output = formatPersonaCategoryHitRates(rates);

    // 1 + 0 + 2 = 3건 → 유효 데이터로 처리됨
    expect(output).toContain("만료");
    expect(output).toContain("33%");
  });
});
